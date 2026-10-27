// Ajustes > Modelos > «Modelos para workers»: la lógica de la tabla sin React. Cada fila sale de `reparto --tabla --json`
// (electron/reparto-tabla.ts); lo que se edita es el borrador de modelos.json: `excluir` por id exacto (el interruptor) y `calidad`
// (la inteligencia). Una regla de `excluir` por familia o patrón sigue valiendo y se ve aparte: el interruptor de un modelo que
// saca una de esas reglas no se puede prender desde acá (se saca la regla).
import { EFFORTS_CALIDAD, type EffortCalidad } from "../../electron/efforts-calidad";
import type { FilaTabla } from "../../electron/reparto-tabla";
import type { Empresa } from "../hilo/modelos";
import { EXCLUIR_MAX, type Borrador } from "./modelos-borrador";

/** Los grupos de la tabla, en el orden en que se muestran. */
export const GRUPOS_TABLA = ["anthropic", "google", "openai", "opencode", "deepseek", "ollama", "local"] as const;
export type GrupoTabla = (typeof GRUPOS_TABLA)[number];

/** El logo de cada grupo (`openai` no tiene: ChatGPT/Codex sale sólo con el nombre). */
export const EMPRESA_DE_GRUPO: Record<GrupoTabla, Empresa | null> = {
  anthropic: "anthropic",
  google: "google",
  openai: null,
  opencode: "opencode",
  deepseek: "dsh",
  ollama: "ollama",
  local: "local",
};

/** En qué grupo va una fila: por la empresa que hace el modelo o el programa que lo corre. */
export function grupoDe(f: FilaTabla): GrupoTabla {
  switch (f.proveedor) {
    case "claude": return "anthropic";
    case "google": return "google";
    case "openai": return "openai";
    case "opencode": return "opencode";
    case "deepseek": return "deepseek";
    case "ollama": return "ollama";
    default: return "local";
  }
}

/** La clave de `calidad` que fija la inteligencia de esa fila: la familia para los de Claude/Google/ChatGPT, el id para el resto. */
export const claveCalidad = (f: FilaTabla): string => (["opencode", "ollama", "deepseek", "local"].includes(f.proveedor) || f.familia === "dsh" || f.familia === "local" ? f.id : f.familia);

/** Un modelo que está en varias cuentas es una sola fila (la de más cupo libre). */
export function filasUnicas(filas: FilaTabla[]): FilaTabla[] {
  const por = new Map<string, FilaTabla>();
  for (const f of filas) {
    const a = por.get(f.id);
    if (!a || (f.libre ?? -1) > (a.libre ?? -1)) por.set(f.id, f);
  }
  return [...por.values()];
}

/** La regla de `excluir` que saca a ese id (misma cuenta que `reparto`: familia, id exacto, id sin el sufijo de esfuerzo o prefijo con `*`). */
export function reglaQueExcluye(f: FilaTabla, excluir: string[]): string | null {
  const m = f.id.toLowerCase();
  for (const p of excluir) if (p === f.familiaExcluir || p === m || m.startsWith(`${p}-`) || (p.endsWith("*") && m.startsWith(p.slice(0, -1)))) return p;
  return null;
}

export type Estado = { permitido: boolean; /** La regla que lo saca, si no es la de su propio id. */ regla: string | null };
export function estadoDe(f: FilaTabla, b: Borrador): Estado {
  const r = reglaQueExcluye(f, b.excluir);
  return { permitido: r === null, regla: r !== null && r !== f.id.toLowerCase() ? r : null };
}

/** Prender o apagar un modelo: apagar anota su id exacto en `excluir`; prender saca ese id (una regla de familia no se toca). */
export function ponerPermitido(b: Borrador, f: FilaTabla, on: boolean): Borrador {
  const id = f.id.toLowerCase();
  if (on) return { ...b, excluir: b.excluir.filter((x) => x !== id) };
  return b.excluir.includes(id) || b.excluir.length >= EXCLUIR_MAX ? b : { ...b, excluir: [...b.excluir, id] };
}

/** La inteligencia que se ve: la que fijó el borrador o la de la tabla; sigue estimada mientras nadie la fijó. */
export function inteligenciaDe(f: FilaTabla, b: Borrador): { valor: number; estimada: boolean; fijada: boolean } {
  const v = b.calidad[claveCalidad(f)];
  return v === undefined ? { valor: f.calidad, estimada: f.estimada, fijada: false } : { valor: v, estimada: false, fijada: true };
}

/** Lo que se escribe en el campo de inteligencia → unidades de Artificial Analysis (0–200, un decimal), o `null` si no vale. */
export function calidadEscrita(texto: string): number | null {
  const s = texto.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d)?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 200 ? n : null;
}

/** Una cifra de inteligencia para mostrar: un decimal sin ceros de sobra (43 → «43», 47.9 → «47.9»). */
export const cifra = (n: number): string => String(Math.round(n * 10) / 10);

/** El esfuerzo con que se muestra la inteligencia de cada modelo cuando nada lo restringe (el de los tipos de código; igual a EFFORT_TABLA de reparto). */
export const EFFORT_BASE: EffortCalidad = "high";

/** El esfuerzo más cercano entre `ok` a `efecto`: primero el siguiente más alto, si no el más alto de los de abajo; `null` si no hay ninguno. */
export function masCercano(efecto: EffortCalidad, ok: EffortCalidad[]): EffortCalidad | null {
  if (!ok.length) return null;
  if (ok.includes(efecto)) return efecto;
  const i = EFFORTS_CALIDAD.indexOf(efecto);
  return ok.find((e) => EFFORTS_CALIDAD.indexOf(e) > i) ?? [...ok].reverse().find((e) => EFFORTS_CALIDAD.indexOf(e) < i) ?? null;
}

/** Igual que `calidad_en_effort` de reparto: el medido, interpolado entre vecinos (por posición), o el vecino más cercano; sin mapa, `base`. */
export function calidadEnEffort(mapa: Partial<Record<EffortCalidad, number>>, effort: EffortCalidad, base: number): number {
  const m = EFFORTS_CALIDAD.filter((e) => mapa[e] !== undefined);
  if (!m.length) return base;
  const v = mapa[effort];
  if (v !== undefined) return v;
  const i = EFFORTS_CALIDAD.indexOf(effort);
  const ant = m.filter((e) => EFFORTS_CALIDAD.indexOf(e) < i).pop();
  const sig = m.find((e) => EFFORTS_CALIDAD.indexOf(e) > i);
  if (ant && sig) {
    const [i0, i1] = [EFFORTS_CALIDAD.indexOf(ant), EFFORTS_CALIDAD.indexOf(sig)];
    return Math.round((mapa[ant]! + ((mapa[sig]! - mapa[ant]!) * (i - i0)) / (i1 - i0)) * 10) / 10;
  }
  return mapa[ant ?? sig!]!;
}

/** Los esfuerzos que los workers pueden usar de ese modelo según el borrador (sin la clave: todos). */
export const effortsPermitidos = (f: FilaTabla, b: Borrador): EffortCalidad[] => {
  const l = b.efforts_permitidos[claveCalidad(f)];
  return l === undefined ? [...EFFORTS_CALIDAD] : EFFORTS_CALIDAD.filter((e) => l.includes(e));
};

/**
 * El número grande de la fila: la inteligencia al esfuerzo que `reparto` usaría de verdad. Sin restricción es `high` (nunca el máximo); si el
 * esfuerzo no está permitido, el permitido más cercano (primero el siguiente más alto). `efecto: null` = sin desglose por esfuerzo (la cifra es única)
 * o el modelo no tiene ningún esfuerzo permitido (`valor: null`: reparto no lo usa).
 */
export function usadoDe(f: FilaTabla, b: Borrador): { efecto: EffortCalidad | null; valor: number | null; estimado: boolean } {
  if (b.calidad[claveCalidad(f)] !== undefined) return { efecto: null, valor: b.calidad[claveCalidad(f)]!, estimado: false };
  if (!Object.keys(f.calidadPorEffort).length) return { efecto: null, valor: f.calidad, estimado: false };
  const e = masCercano(EFFORT_BASE, effortsPermitidos(f, b));
  return e ? { efecto: e, valor: f.calidadPorEffort[e] ?? f.calidadEstimadaPorEffort[e] ?? calidadEnEffort(f.calidadPorEffort, e, f.calidad), estimado: f.calidadPorEffort[e] === undefined } : { efecto: null, valor: null, estimado: false };
}

/** Los esfuerzos que se muestran de un modelo: los medidos y los estimados (en orden de menor a mayor); `[]` si no tiene desglose por esfuerzo. */
export const effortsMostrados = (f: FilaTabla): EffortCalidad[] =>
  Object.keys(f.calidadPorEffort).length ? EFFORTS_CALIDAD.filter((e) => f.calidadPorEffort[e] !== undefined || f.effortsEstimados.includes(e)) : [];

/** ¿La cifra de ese esfuerzo es una estimación (no la midió Artificial Analysis ni la fijó el dueño)? */
export const esEstimado = (f: FilaTabla, e: EffortCalidad): boolean => f.calidadPorEffort[e] === undefined && f.effortsEstimados.includes(e);

export type OrigenVista = { tipo: "usuario" | "aa" | "estimada" | "defecto"; /** `26/10`: el día del dato de Artificial Analysis. */ fecha: string | null };

/** `AAAA-MM-DD` → `DD/MM`; `null` si no es una fecha. */
export function fechaCorta(iso: string | null): string | null {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[1]}` : null;
}

/** De dónde sale la cifra que se ve: lo fijado en el borrador es «tuyo» aunque todavía no se guardó; si no, lo que dice `reparto` (que ya aplicó usuario > Artificial Analysis > defecto > estimada). */
export function origenDe(f: FilaTabla, b: Borrador): OrigenVista {
  if (b.calidad[claveCalidad(f)] !== undefined) return { tipo: "usuario", fecha: null };
  if (f.origen === "artificial-analysis") return { tipo: "aa", fecha: fechaCorta(f.aaFecha) };
  return { tipo: f.origen === "usuario" ? "usuario" : f.estimada || f.origen === "estimada" ? "estimada" : "defecto", fecha: null };
}

/**
 * El nombre de `reparto` viene en castellano («glm-5.3 (OpenCode, gratis)», «(DeepSeek, de pago)», «(por Google)»): en inglés se traduce
 * lo que va entre paréntesis; los nombres de los modelos no se tocan.
 */
export function nombreVisible(nombre: string, idioma: "es" | "en"): string {
  if (idioma === "es") return nombre;
  return nombre.replace(/\(([^)]*)\)/g, (_, dentro: string) => `(${dentro.replace(/\bde pago\b/g, "paid").replace(/\bgratis\b/g, "free").replace(/\bpor Google\b/g, "via Google")})`);
}

/** Fija la inteligencia (`null`: vuelve a la estimación del reparto, la clave sale de `calidad`). */
export function ponerInteligencia(b: Borrador, f: FilaTabla, n: number | null): Borrador {
  const k = claveCalidad(f);
  const { [k]: _, ...resto } = b.calidad;
  return { ...b, calidad: n === null ? resto : { ...resto, [k]: n } };
}

/** Las reglas de `excluir` que no son el id de ninguna fila (familias como `opus`, patrones con `*`): siguen valiendo y se ven aparte. */
export function reglasSueltas(excluir: string[], filas: FilaTabla[]): string[] {
  const ids = new Set(filas.map((f) => f.id.toLowerCase()));
  return excluir.filter((x) => !ids.has(x));
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** La búsqueda: cada palabra tiene que estar en el nombre, el id o el proveedor. */
export function filtrar(filas: FilaTabla[], q: string): FilaTabla[] {
  const ps = sinTildes(q).split(/\s+/).filter(Boolean);
  if (!ps.length) return filas;
  return filas.filter((f) => {
    const h = sinTildes(`${f.nombre} ${f.id} ${f.proveedor}`);
    return ps.every((p) => h.includes(p));
  });
}

/** Las filas agrupadas en el orden de `GRUPOS_TABLA` (sin los grupos vacíos); dentro de cada uno, de más a menos inteligente. */
export function agrupar(filas: FilaTabla[], b: Borrador): { grupo: GrupoTabla; filas: FilaTabla[]; permitidos: number }[] {
  return GRUPOS_TABLA.map((g) => {
    const fs = filas.filter((f) => grupoDe(f) === g).sort((a, z) => z.calidad - a.calidad || (a.id < z.id ? -1 : 1));
    return { grupo: g, filas: fs, permitidos: fs.filter((f) => estadoDe(f, b).permitido).length };
  }).filter((x) => x.filas.length > 0);
}
