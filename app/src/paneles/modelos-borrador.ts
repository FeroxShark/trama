// Lo que se está editando en Ajustes > Modelos antes de Guardar. Puro (sin React ni puente): nace de lo que dice el main
// (`EstadoModelos`), se cambia con estas funciones y se compara con lo guardado; Cancelar es volver a nacer de lo guardado.
// Lo que el borrador no define ("como hoy") no se escribe: el archivo sólo dice lo que se eligió. Lo prueba
// tests/modelos-borrador.test.ts.
import type { EstadoModelos } from "../../electron/modelos-config";
import {
  AGY,
  CUPO_MAX,
  CUPO_MIN,
  defaultsDe,
  efectivoDe,
  esAgy,
  esClaude,
  esGemini,
  esOllama,
  GEMINI,
  HOY,
  SIN_CLAUDE,
  TIPOS,
  TOPE_CLAUDE_DEFECTO,
  URL_OLLAMA,
  urlOllama,
  type ConfigModelos,
  type Eleccion,
  type Local,
  type ModoReparto,
  type SinClaude,
  type Tipo,
} from "../../electron/modelos-tipos";
import { defDe, effortDeModelo, TABLA } from "../hilo/modelos";

export { AGY, CUPO_MAX, CUPO_MIN, GEMINI, SIN_CLAUDE, TIPOS, TOPE_CLAUDE_DEFECTO, URL_OLLAMA };
export type { Eleccion, Local, SinClaude, Tipo };

/** El cupo va como texto mientras se escribe; el resto es la config tal cual. */
export type Borrador = {
  lider?: Eleccion;
  reparto?: ModoReparto;
  workers: Partial<Record<Tipo, Eleccion>>;
  locales: Local[];
  cupo: string;
  sin_claude?: SinClaude;
  /** Los topes de Claude (5 h y semanal) como texto mientras se escriben. */
  tope5: string;
  tope7: string;
};

export const borradorDe = (e: EstadoModelos): Borrador => ({
  ...(e.config.lider ? { lider: { ...e.config.lider } } : {}),
  ...(e.config.reparto ? { reparto: e.config.reparto } : {}),
  workers: Object.fromEntries(Object.entries(e.config.workers).map(([k, v]) => [k, { ...v }])),
  locales: e.config.locales.map((l) => ({ ...l })),
  cupo: e.config.gemini.cupo_max === undefined ? "" : String(e.config.gemini.cupo_max),
  ...(e.config.gemini.sin_claude ? { sin_claude: e.config.gemini.sin_claude } : {}),
  tope5: e.config.claude.tope_5h === undefined ? "" : String(e.config.claude.tope_5h),
  tope7: e.config.claude.tope_7d === undefined ? "" : String(e.config.claude.tope_7d),
});

/** El cupo escrito: `null` vacío (sin definir), el número si vale, `"mal"` si no. */
export function cupoDe(texto: string): number | null | "mal" {
  const s = texto.trim();
  if (!s) return null;
  if (!/^\d{1,3}$/.test(s)) return "mal";
  const n = Number(s);
  return n >= CUPO_MIN && n <= CUPO_MAX ? n : "mal";
}

/** La config que se guardaría, o `null` si el cupo escrito no vale. */
export function configDe(b: Borrador): ConfigModelos | null {
  const cupo = cupoDe(b.cupo);
  const t5 = cupoDe(b.tope5);
  const t7 = cupoDe(b.tope7);
  if (cupo === "mal" || t5 === "mal" || t7 === "mal") return null;
  const workers: ConfigModelos["workers"] = {};
  for (const t of TIPOS) if (b.workers[t]) workers[t] = { ...b.workers[t]! };
  return {
    ...(b.lider ? { lider: { ...b.lider } } : {}),
    ...(b.reparto ? { reparto: b.reparto } : {}),
    workers,
    locales: b.locales.map((l) => ({ ...l })),
    gemini: { ...(cupo !== null ? { cupo_max: cupo } : {}), ...(b.sin_claude ? { sin_claude: b.sin_claude } : {}) },
    claude: { ...(t5 !== null ? { tope_5h: t5 } : {}), ...(t7 !== null ? { tope_7d: t7 } : {}) },
  };
}

/** Lo mismo con las claves en un orden fijo, para comparar. */
const huella = (c: ConfigModelos) =>
  JSON.stringify([
    c.lider ?? null,
    c.reparto ?? null,
    TIPOS.map((t) => c.workers[t] ?? null),
    c.locales.map((l) => [l.id, l.nombre, l.url, l.modelo]),
    c.gemini.cupo_max ?? null,
    c.gemini.sin_claude ?? null,
    c.claude.tope_5h ?? null,
    c.claude.tope_7d ?? null,
  ]);

/** Hay algo distinto de lo guardado (o un cupo a medio escribir que no vale). */
export function sucio(e: EstadoModelos, b: Borrador): boolean {
  const c = configDe(b);
  return c === null || huella(c) !== huella(e.config);
}

// --- Qué se puede elegir ------------------------------------------------------------------

export type Proveedor = "anthropic" | "google" | "ollama" | "otro";
export type Modelo = { id: string; nombre: string; proveedor: Proveedor; desc: "argon" | "flash" | "agy" | "local" | "otro" | null };

/** "gemini-4-argon-high" → "Gemini 4 Argon · high". */
const NOMBRES_AGY: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5 (por Google)",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 (por Google)",
  "gpt-oss-120b": "GPT-OSS 120B (por Google)",
};

export function nombreGemini(id: string): string {
  const a = /^agy:(.+)-(low|medium|high)$/.exec(id);
  if (a) return `${NOMBRES_AGY[a[1]!] ?? `${a[1]} (por Google)`} · ${a[2]}`;
  const m = /^gemini-(.+)-(low|medium|high)$/.exec(id);
  if (!m) return id;
  const familia = m[1]!.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  return `Gemini ${familia} · ${m[2]}`;
}

/** Todo lo que se ofrece en un selector de modelo: los de Claude de la tabla, los Gemini de `pa` y los locales de la config. */
export function modelosPara(locales: Local[], actuales: string[] = [], agy = true): Modelo[] {
  const lista: Modelo[] = [
    ...TABLA.filter((m) => m.empresa === "anthropic").map((m): Modelo => ({ id: m.id, nombre: m.nombre, proveedor: "anthropic", desc: null })),
    ...(agy ? GEMINI.map((id): Modelo => ({ id, nombre: nombreGemini(id), proveedor: "google", desc: id.includes("argon") ? "argon" : "flash" })) : []),
    ...(agy ? AGY.map((id): Modelo => ({ id, nombre: nombreGemini(id), proveedor: "google", desc: "agy" })) : []),
    ...locales.map((l): Modelo => ({ id: l.id, nombre: l.nombre, proveedor: "ollama", desc: "local" })),
  ];
  for (const id of actuales) {
    if (!id || id === "auto" || lista.some((m) => m.id === id)) continue;
    lista.push({ id, nombre: esGemini(id) || esAgy(id) ? nombreGemini(id) : id, proveedor: esClaude(id) ? "anthropic" : esGemini(id) || esAgy(id) ? "google" : esOllama(id) ? "ollama" : "otro", desc: "otro" });
  }
  return lista;
}

/** El nombre corto de un modelo para decir con cuál corre algo. */
export function nombreDe(id: string, locales: Local[]): string {
  if (esOllama(id)) return locales.find((l) => l.id === id)?.nombre ?? id.slice("ollama:".length);
  if (esGemini(id) || esAgy(id)) return nombreGemini(id);
  return defDe(id)?.nombre ?? id;
}

/** Una elección de ese modelo conservando el esfuerzo de antes si el modelo lo tiene; sólo Claude lleva esfuerzo. */
export function eleccionDe(modelo: string, antes?: Eleccion): Eleccion {
  if (!esClaude(modelo)) return { modelo };
  return { modelo, effort: effortDeModelo(modelo, antes?.effort) ?? defDe(modelo)?.effortDefecto ?? "high" };
}

/** Lo que dice `Corre con …` / `Hoy: …` de una elección. */
export const textoEleccion = (e: Eleccion, locales: Local[]) => (e.effort ? `${nombreDe(e.modelo, locales)} · ${e.effort}` : nombreDe(e.modelo, locales));

// --- Cambios ---------------------------------------------------------------------------------

/** `id` vacío = "como hoy": la clave sale del archivo. */
export function elegirLider(b: Borrador, id: string): Borrador {
  const { lider: _, ...resto } = b;
  return id ? { ...resto, lider: eleccionDe(id, b.lider) } : resto;
}

export function elegirEffortLider(b: Borrador, effort: string): Borrador {
  return b.lider && esClaude(b.lider.modelo) ? { ...b, lider: { modelo: b.lider.modelo, effort } } : b;
}

export function elegirWorker(b: Borrador, tipo: Tipo, id: string): Borrador {
  const workers = { ...b.workers };
  if (id === "auto") {
    delete workers[tipo];
    return { ...b, reparto: "auto", workers };
  }
  const { reparto: _, ...resto } = b;
  if (id) {
    workers[tipo] = eleccionDe(id, workers[tipo]);
    return { ...(b.reparto ? { reparto: b.reparto } : {}), ...resto, workers };
  }
  delete workers[tipo];
  return { ...resto, workers };
}

export function elegirEffortWorker(b: Borrador, tipo: Tipo, effort: string): Borrador {
  const e = b.workers[tipo];
  return e && esClaude(e.modelo) ? { ...b, workers: { ...b.workers, [tipo]: { modelo: e.modelo, effort } } } : b;
}

/** "Un solo modelo para todo": el líder y cada tipo de worker (con `default`) con ese modelo, en un toque. */
export function todoEn(b: Borrador, id: string): Borrador {
  if (!id) return b;
  if (id === "auto") return { ...b, reparto: "auto", workers: {} };
  const { reparto: _, ...resto } = b;
  const workers: Borrador["workers"] = {};
  for (const t of TIPOS) workers[t] = eleccionDe(id, b.workers[t]);
  return { ...resto, lider: eleccionDe(id, b.lider), workers };
}

/** Un local nuevo (`ollama:<modelo>`); si ya está, no se repite. */
export function agregarLocal(b: Borrador, url: string, modelo: string): Borrador {
  const id = `ollama:${modelo}`;
  const u = urlOllama(url);
  if (!u || !modelo || b.locales.some((l) => l.id === id)) return b;
  return { ...b, locales: [...b.locales, { id, nombre: modelo, url: u, modelo }] };
}

/** Quita un local y lo que lo usaba vuelve a "como hoy" (no queda una elección que apunte a algo que no existe). */
export function quitarLocal(b: Borrador, id: string): Borrador {
  const workers = { ...b.workers };
  for (const t of TIPOS) if (workers[t]?.modelo === id) delete workers[t];
  const r: Borrador = { ...b, workers, locales: b.locales.filter((l) => l.id !== id) };
  if (r.lider?.modelo === id) delete r.lider;
  return r;
}

/** Con qué corre un tipo según el borrador (sus filas, el `default` o lo de hoy). */
export function efectivoBorrador(b: Borrador, tipo: Tipo, soloGemini = false): Eleccion {
  return efectivoDe({ lider: b.lider, workers: b.workers, locales: b.locales, gemini: {}, claude: {} }, tipo, soloGemini);
}

/** "Usar los recomendados": cada tipo de worker con su modelo por defecto (los de Gemini si no hay Claude). El líder y el reparto quedan como están. */
export function defaultsEn(b: Borrador, soloGemini = false): Borrador {
  const { reparto: _, ...resto } = b;
  const d = defaultsDe(soloGemini);
  const workers: Borrador["workers"] = {};
  for (const t of TIPOS) workers[t] = { ...d[t] };
  return { ...resto, workers };
}

export const liderEfectivo = (b: Borrador): Eleccion => b.lider ?? HOY.lider;

// --- Topes de Claude -------------------------------------------------------------------------------

export type Ventana5o7 = "5h" | "7d";
/** Una ventana del plan de Claude que ya pasó el tope: cuánto va y cuál era el tope. */
export type Cruce = { ventana: Ventana5o7; pct: number; tope: number };

/** El tope que vale para una ventana: el escrito o el de `reparto` si se deja vacío. */
export function topeEfectivo(b: Borrador, v: Ventana5o7): number {
  const n = cupoDe(v === "5h" ? b.tope5 : b.tope7);
  return typeof n === "number" ? n : TOPE_CLAUDE_DEFECTO;
}

/**
 * Qué ventanas del plan ya cruzaron su tope con lo que se ve del uso (`pct` de 0 a 100; `null`: sin dato, no se afirma nada).
 * Cruzar es llegar al tope: `reparto` descarta a Claude cuando lo libre es igual o menor que la reserva.
 */
export function cruces(b: Borrador, uso: { five_hour: { pct: number } | null; seven_day: { pct: number } | null } | null): Cruce[] {
  if (!uso) return [];
  const r: Cruce[] = [];
  const mira = (v: Ventana5o7, w: { pct: number } | null) => {
    const tope = topeEfectivo(b, v);
    if (w && w.pct >= tope) r.push({ ventana: v, pct: Math.round(w.pct), tope });
  };
  mira("5h", uso.five_hour);
  mira("7d", uso.seven_day);
  return r;
}

// --- Bajar un modelo de Ollama -----------------------------------------------------------------------

/** Lo mismo que `NOMBRE_MODELO` del main (`ollama-bajar.ts`): lo que se escribe en el campo para bajar. */
export const nombreModeloValido = (s: string) => /^[A-Za-z0-9][\w.:/-]{0,120}$/.test(s.trim());

/** Porcentaje entero de la capa que baja; `null` si todavía no se sabe el total. */
export const porcentaje = (b: { completado: number | null; total: number | null }): number | null =>
  b.total && b.completado !== null ? Math.max(0, Math.min(100, Math.floor((b.completado / b.total) * 100))) : null;
