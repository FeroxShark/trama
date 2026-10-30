// El catálogo buscable de skills instaladas (panel de contexto): nombre, descripción, de dónde viene (usuario, proyecto, plugin o la cuenta
// de claude.ai), cuántos tokens ocupa su renglón en el prompt de sistema y su estado (prendida, apagada por Trama o apagada porque su
// plugin lo está). Sale del inventario de conectores (conectores-claude.ts) y del registro de apagados (apagados.ts). Los tokens son una
// estimación (nombre y descripción, como los lista Claude Code) salvo que un líder vivo los haya dicho (`exactos`). Node puro.
import type { Apagados } from "./apagados.ts";
import type { Conector, Inventario } from "./conectores-claude.ts";
import { tokensAprox } from "./contexto-desglose.ts";

export type EstadoSkill = "activa" | "apagada" | "plugin-apagado";

export type SkillCatalogo = {
  id: string;
  /** El nombre con que la lista Claude Code y la clave del apagado (`plugin:skill` si viene de un plugin). */
  clave: string;
  nombre: string;
  descripcion: string;
  origen: Conector["origen"];
  /** El plugin (`nombre@mercado` o el de claude.ai) o el proyecto de donde viene; vacío si es del usuario. */
  de: string;
  tokens: number;
  tokensEstimado: boolean;
  estado: EstadoSkill;
};

/** El nombre del plugin de una skill de plugin (lo que va antes de `:` en su nombre completo). */
function pluginDe(c: Conector): string | null {
  if (c.origen === "plugin") return c.de.split("@")[0] || null;
  if (c.origen === "claudeai") return c.de || null;
  return null;
}

/** El catálogo, ordenado por lo que más pesa. `exactos`: tokens por clave que dijo un líder vivo (`get_context_usage`). */
export function catalogoSkills(inv: Inventario, apagados: Apagados, exactos: Map<string, number> = new Map()): SkillCatalogo[] {
  const r: SkillCatalogo[] = [];
  for (const c of inv.items) {
    if (c.tipo !== "skill") continue;
    const p = pluginDe(c);
    const clave = p && !c.nombre.includes(":") ? `${p}:${c.nombre}` : c.nombre;
    const exacto = exactos.get(clave) ?? exactos.get(c.nombre);
    const estado: EstadoSkill = apagados.skills.includes(clave) || apagados.skills.includes(c.nombre) ? "apagada" : c.activo ? "activa" : "plugin-apagado";
    r.push({
      id: c.id,
      clave,
      nombre: c.nombre,
      descripcion: c.descripcion,
      origen: c.origen,
      de: c.de,
      tokens: exacto ?? tokensAprox(`- ${clave}: ${c.descripcion}`),
      tokensEstimado: exacto === undefined,
      estado,
    });
  }
  return r.sort((a, b) => b.tokens - a.tokens || a.clave.localeCompare(b.clave));
}

/** Sin tildes ni mayúsculas, para buscar. */
const plano = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Las que tienen todas las palabras de `q` en su nombre, descripción, origen o plugin. Vacío: todas. */
export function buscarSkills(lista: SkillCatalogo[], q: unknown): SkillCatalogo[] {
  const palabras = typeof q === "string" ? plano(q).split(/\s+/).filter(Boolean) : [];
  if (!palabras.length) return lista;
  return lista.filter((s) => {
    const t = plano(`${s.clave} ${s.descripcion} ${s.origen} ${s.de}`);
    return palabras.every((p) => t.includes(p));
  });
}

/** Qué skills se usaron en las sesiones recientes de Claude de la persona (todas, no sólo la abierta). */
export type UsosCatalogo = {
  dias: number;
  /** Sesiones con actividad en esos días. */
  sesiones: number;
  /** skill (por su clave o su nombre, como la invocó la persona o el modelo) → veces: la herramienta Skill más los `/comandos`. */
  skills: Record<string, number>;
  /** Claves de skills que un hook mete al contexto solo (un plugin con hooks activos cuya skill lleva su nombre). */
  porHook: string[];
};

/** Los días que miran los usos del catálogo. */
export const DIAS_USOS = 30;

/** De lo que indexó el historial a lo que usa el catálogo. Una consulta con error o vacía no dice nada: `null`, nunca "no se usó". */
export function usosDeHistorial(c: unknown, lista: Pick<SkillCatalogo, "clave" | "nombre" | "origen" | "de">[]): UsosCatalogo | null {
  const q = c as { sesiones?: unknown; piezas?: { clase: string; nombre: string; usos: number | null; ganchos: number }[]; comandos?: Record<string, number>; error?: unknown } | null;
  if (!q || q.error || typeof q.sesiones !== "number" || !Array.isArray(q.piezas) || q.sesiones <= 0) return null;
  const skills: Record<string, number> = {};
  for (const p of q.piezas) if (p.clase === "skill" && (p.usos ?? 0) > 0) skills[p.nombre] = (skills[p.nombre] ?? 0) + (p.usos ?? 0);
  for (const [n, v] of Object.entries(q.comandos ?? {})) skills[n] = (skills[n] ?? 0) + v;
  const ganchos = new Set(q.piezas.filter((p) => p.clase === "plugin" && p.ganchos > 0).map((p) => p.nombre));
  const porHook = lista
    .filter((s) => (s.origen === "plugin" || s.origen === "claudeai") && ganchos.has(s.de.split("@")[0]) && s.nombre.split(":").pop() === s.de.split("@")[0])
    .map((s) => s.clave);
  return { dias: DIAS_USOS, sesiones: q.sesiones, skills, porHook };
}
