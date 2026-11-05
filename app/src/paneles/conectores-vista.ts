// Ajustes > Conectores: lo que se hace con el inventario de Claude Code antes de dibujarlo (agrupar por tipo, ordenar, buscar). Puro: lo prueba
// tests/conectores-vista.test.ts.
import type { Conector, TipoConector } from "../../electron/conectores-claude";
import { claveSkill, nombreServidor, pluginDe, type UsosCatalogo } from "../../electron/usos-historial.ts";

export const TIPOS: readonly TipoConector[] = ["skill", "plugin", "mcp", "hook"];

const ORDEN_ORIGEN = { usuario: 0, proyecto: 1, plugin: 2, claudeai: 3 } as const;

const sinTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const carpeta = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** Cómo se llama el lugar de donde viene (para mostrarlo y para buscar): el plugin, o la carpeta del proyecto. */
export const deDonde = (c: Conector): string => (c.origen === "proyecto" && c.de && !c.de.includes("@") ? carpeta(c.de) : c.de);

/** Cada palabra de la búsqueda tiene que estar en el nombre, la descripción, el origen o el destino (sin tildes ni mayúsculas). */
export function filtrar(items: Conector[], consulta: string): Conector[] {
  const palabras = sinTildes(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return items;
  return items.filter((c) => {
    const pajar = sinTildes([c.nombre, c.descripcion, deDonde(c), c.origen, c.clase ?? "", c.destino ?? "", (c.variables ?? []).join(" ")].join(" "));
    return palabras.every((p) => pajar.includes(p));
  });
}

/** Los de un tipo, del usuario primero, después proyectos, plugins y claude.ai; por nombre dentro de cada origen. */
export function delTipo(items: Conector[], tipo: TipoConector): Conector[] {
  return items
    .filter((c) => c.tipo === tipo)
    .sort((a, b) => ORDEN_ORIGEN[a.origen] - ORDEN_ORIGEN[b.origen] || deDonde(a).localeCompare(deDonde(b)) || a.nombre.localeCompare(b.nombre));
}

/** Los plugins de un catálogo que coinciden con la búsqueda: cada palabra tiene que estar en el nombre, la categoría o la descripción (sin tildes ni mayúsculas). */
export function buscarPlugins<T extends { nombre: string; descripcion: string; categoria: string }>(plugins: T[], consulta: string): T[] {
  const palabras = sinTildes(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return plugins;
  return plugins.filter((p) => {
    const pajar = sinTildes(`${p.nombre} ${p.categoria} ${p.descripcion}`);
    return palabras.every((w) => pajar.includes(w));
  });
}

// --- Uso: ordenar por más usados, menos usados y último uso ---------------------------------------------------------------------------------
// Los números salen del registro histórico (`historial:consultar`, 30 días) pasado por `usosDeHistorial` (electron/usos-historial.ts). Tres estados
// distintos, que nunca se mezclan: usado (veces > 0), **sin uso en esos 30 días** (veces 0: no dice "nunca", el rango es corto) y **sin dato**
// (veces `null`: no hay registro, o de ese tipo no se cuenta, como los hooks).

export type Orden = "origen" | "mas" | "menos" | "ultimo";
export const ORDENES: readonly Orden[] = ["origen", "mas", "menos", "ultimo"];

export type UsoConector = { veces: number | null; ultimo: string | null };
export const SIN_DATO: UsoConector = { veces: null, ultimo: null };

const sumaDe = (en: Record<string, number> | undefined, esDe: (k: string) => boolean): number => {
  let n = 0;
  for (const [k, v] of Object.entries(en ?? {})) if (esDe(k)) n += v;
  return n;
};
const masNuevo = (en: Record<string, string> | undefined, esDe: (k: string) => boolean): string | null => {
  let r: string | null = null;
  for (const [k, d] of Object.entries(en ?? {})) if (esDe(k) && (r === null || d > r)) r = d;
  return r;
};

/** El uso de cada conector del inventario, por su id. Sin registro (`usos` en `null`): todos sin dato. */
export function usosPorConector(items: Conector[], usos: UsosCatalogo | null): Map<string, UsoConector> {
  const r = new Map<string, UsoConector>();
  if (!usos) {
    for (const c of items) r.set(c.id, SIN_DATO);
    return r;
  }
  const ult = usos.ultimo ?? { skills: {}, mcp: {} };
  const porHook = new Set(usos.porHook);
  // Lo que cada plugin trae: sin skills ni servidores propios sólo actúa por hooks y no hay con qué contarlo.
  const traeSkills = new Set<string>();
  const traeMcp = new Set<string>();
  for (const c of items) {
    const p = pluginDe(c);
    if (c.tipo === "skill" && p) traeSkills.add(p);
    if (c.tipo === "mcp" && p) traeMcp.add(p);
  }
  for (const c of items) {
    if (c.tipo === "skill") {
      const clave = claveSkill(c);
      const veces = (usos.skills[clave] ?? 0) + (clave === c.nombre ? 0 : (usos.skills[c.nombre] ?? 0));
      const hoy = veces === 0 && porHook.has(clave);
      const esDe = (k: string) => k === clave || k === c.nombre;
      r.set(c.id, hoy ? SIN_DATO : { veces, ultimo: masNuevo(ult.skills, esDe) });
    } else if (c.tipo === "plugin") {
      const p = c.nombre;
      const prefijo = `${p}:`;
      const mcp = `plugin_${nombreServidor(p)}_`;
      const veces = sumaDe(usos.skills, (k) => k.startsWith(prefijo)) + sumaDe(usos.mcp, (k) => k.startsWith(mcp));
      const ultimo = [masNuevo(ult.skills, (k) => k.startsWith(prefijo)), masNuevo(ult.mcp, (k) => k.startsWith(mcp))].filter((x): x is string => x !== null).sort().pop() ?? null;
      const cuenta = veces > 0 || ((traeSkills.has(p) || traeMcp.has(p)) && ![...porHook].some((k) => k.startsWith(prefijo)));
      r.set(c.id, cuenta ? { veces, ultimo } : SIN_DATO);
    } else if (c.tipo === "mcp") {
      const nombre = nombreServidor(c.nombre);
      const p = pluginDe(c);
      // Las herramientas de un servidor de plugin o de claude.ai llevan su prefijo (`mcp__plugin_<plugin>_<servidor>__…`, `mcp__claude_ai_<nombre>__…`).
      const nombres = new Set([nombre, ...(c.origen === "plugin" && p ? [`plugin_${nombreServidor(p)}_${nombre}`] : []), ...(c.origen === "claudeai" ? [`claude_ai_${nombre}`] : [])]);
      r.set(c.id, usos.mcp ? { veces: sumaDe(usos.mcp, (k) => nombres.has(k)), ultimo: masNuevo(ult.mcp, (k) => nombres.has(k)) } : SIN_DATO);
    } else r.set(c.id, SIN_DATO);
  }
  return r;
}

/**
 * Los conectores de un grupo en el orden pedido (sin tocar la lista que llega). `origen`: como vienen. Con uso, lo que no tiene dato va siempre
 * al final, y los que tienen el mismo número quedan en el orden de origen (la sort es estable).
 * - `mas`: de más a menos veces; a igual número, el de uso más reciente primero.
 * - `menos`: de menos a más; los de cero uso arriba (los candidatos a sacar).
 * - `ultimo`: el de uso más reciente primero; después los que no se usaron en los 30 días.
 */
export function ordenarPorUso(lista: Conector[], orden: Orden, uso: Map<string, UsoConector>): Conector[] {
  if (orden === "origen") return lista;
  const de = (c: Conector) => uso.get(c.id) ?? SIN_DATO;
  const dias = (u: UsoConector) => u.ultimo ?? "";
  return [...lista].sort((a, b) => {
    const x = de(a);
    const y = de(b);
    if ((x.veces === null) !== (y.veces === null)) return x.veces === null ? 1 : -1;
    if (x.veces === null || y.veces === null) return 0;
    if (orden === "mas") return y.veces - x.veces || dias(y).localeCompare(dias(x));
    if (orden === "menos") return x.veces - y.veces || dias(x).localeCompare(dias(y));
    return dias(y).localeCompare(dias(x)) || y.veces - x.veces;
  });
}

/** Cuánto hace de un día `AAAA-MM-DD` (local) a otro: 0 hoy, 1 ayer… (negativo no existe: un día futuro es hoy). */
export function haceDias(dia: string, hoy: string): number {
  const [a, b, c] = dia.split("-").map(Number);
  const [d, e, f] = hoy.split("-").map(Number);
  if (![a, b, c, d, e, f].every(Number.isFinite)) return 0;
  return Math.max(0, Math.round((Date.UTC(d, e - 1, f) - Date.UTC(a, b - 1, c)) / 86_400_000));
}

/** Los grupos de a `n` para dibujar una lista larga por bloques (Bloque virtual de AjustesConectoresInventario.tsx). */
export function enBloques<T>(lista: T[], n: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < lista.length; i += n) r.push(lista.slice(i, i + n));
  return r;
}

const GUION = /([\w.-]+\.(?:sh|bash|fish|zsh|py|mjs|cjs|js|ts|rb|pl|ps1|cmd|bat))(?![\w.-])/;
/** Hooks que instala Trama (su motor, su carpeta de configuración o su app): se dicen "de Trama", no "tuyo". */
const DE_TRAMA = /(?:motor|trama|app)[\\/]hooks[\\/]|[\\/]\.?(?:config|share)[\\/]trama[\\/]/i;

/** Un nombre legible para un hook: el de su script (`guardia.sh`), y si no hay script (un comando suelto, una URL) su evento. */
export function nombreHook(c: Conector): string {
  return GUION.exec(c.destino ?? "")?.[1] ?? c.clase ?? c.nombre;
}

/** ¿Lo instala o lo maneja Trama? Un hook de su motor, o el servidor MCP `trama`. */
export const esDeTrama = (c: Conector): boolean => (c.tipo === "hook" && DE_TRAMA.test(c.destino ?? "")) || (c.tipo === "mcp" && c.nombre.toLowerCase() === "trama");
