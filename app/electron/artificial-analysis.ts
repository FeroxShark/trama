// Artificial Analysis (https://artificialanalysis.ai): de ahí sale la inteligencia medida de los modelos para `reparto` cuando el dueño
// pegó su API key (Ajustes > Modelos > «Modelos para workers»). Acá: bajar la lista (a lo sumo una vez cada 24 h, o a pedido), guardarla
// en la caché que lee `reparto` (<estado de pa>/reparto/aa-modelos.json) y contar qué pasó (key mala, límite diario, sin red, forma rara).
// El emparejamiento de nombres vive en motor/bin/reparto, que es quien conoce los ids; los índices se guardan crudos (sin calibrar), junto con costo, tokens y tiempo por tarea cuando AA los trae.
// Node puro con fetch y reloj inyectables: lo prueban tests/artificial-analysis.test.ts y un servidor falso. La key nunca se loguea ni
// vuelve en un mensaje. Atribución obligatoria donde se muestren los números: «Datos: Artificial Analysis» con el enlace `URL_AA`.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { estadoPa } from "./rutas.ts";

export const URL_AA = "https://artificialanalysis.ai";
/** El endpoint del plan gratis y, si ése no existe (404), el que usa código de terceros. */
export const RUTAS_AA = ["/api/v2/language/models/free", "/api/v2/data/llms/models"] as const;
/** Cada cuánto se vuelve a bajar sola la lista. */
export const VIGENCIA_AA_MS = 24 * 3_600_000;
/** Tras un fallo que no es el límite diario, no se reintenta sola antes de esto. */
export const ESPERA_FALLO_MS = 10 * 60_000;

type Env = Record<string, string | undefined>;

export type ModeloAA = { name: string; slug: string; creator: string; intelligence: number | null; coding: number | null; agentic: number | null;
  /** Por tarea, si AA lo trae: costo (USD), tokens y segundos. Ausentes si el endpoint no los da. Los nombres de los campos de AA son los que se esperan (`COSTO_CLAVES` etc.): no hay forma de verlos sin key. */
  cost?: number; tokens?: number; time?: number };
export type CacheAA = { version: 1; fetched: string; modelos: ModeloAA[] };

/** `fetch` mínimo (el global o uno falso). */
export type FetchAA = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(n: string): string | null }; json(): Promise<unknown> }>;

export type TipoFalloAA = "sin-clave" | "clave" | "limite" | "red" | "forma";
export type FalloAA = { ok: false; tipo: TipoFalloAA; /** Segundos que pide `Retry-After` (límite diario). */ reintentarS?: number; detalle?: string };
export type ListaAA = { ok: true; modelos: ModeloAA[] } | FalloAA;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const indice = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const COSTO_CLAVES = ["cost", "cost_per_task", "cost_to_run", "cost_to_run_usd", "total_cost"];
const TOKENS_CLAVES = ["tokens", "tokens_per_task", "total_tokens", "output_tokens"];
const TIEMPO_CLAVES = ["time", "time_per_task", "time_per_task_seconds", "total_time_seconds"];

/** Un modelo de la respuesta → el que se guarda; `null` si no tiene nombre (o slug) ni ningún índice. Los índices pueden venir sueltos o en `evaluations`. */
export function modeloDe(raw: unknown): ModeloAA | null {
  const o = obj(raw);
  if (!o) return null;
  const ev = obj(o.evaluations) ?? obj(o.indices) ?? {};
  const pick = (...claves: string[]): number | null => {
    for (const k of claves) {
      const v = indice(o[k]) ?? indice(ev[k]);
      if (v !== null) return v;
    }
    return null;
  };
  const intelligence = pick("artificial_analysis_intelligence_index", "intelligence_index", "intelligence");
  const coding = pick("artificial_analysis_coding_index", "coding_index", "coding");
  const agentic = pick("artificial_analysis_agentic_index", "agentic_index", "agentic");
  const name = texto(o.name) || texto(o.model_name);
  const slug = texto(o.slug) || texto(o.id);
  const c = o.model_creator ?? o.creator;
  const creator = typeof c === "string" ? c.trim() : texto(obj(c)?.name) || texto(obj(c)?.slug);
  if ((!name && !slug) || (intelligence === null && coding === null && agentic === null)) return null;
  // Costo y tokens también pueden venir en un objeto (`intelligence_index_cost: {total_cost}`, `intelligence_index_token_counts: {...}`).
  const sub = (k: string, ...claves: string[]): number | null => {
    const d = obj(o[k]) ?? obj(ev[k]);
    if (!d) return null;
    for (const c of claves) if (indice(d[c]) !== null) return indice(d[c]);
    return null;
  };
  const suma = (k: string): number | null => {
    const d = obj(o[k]) ?? obj(ev[k]);
    const v = d ? Object.values(d).map(indice).filter((n): n is number => n !== null) : [];
    return v.length ? v.reduce((x, y) => x + y, 0) : null;
  };
  const cost = pick(...COSTO_CLAVES) ?? sub("intelligence_index_cost", "total_cost", "total"), time = pick(...TIEMPO_CLAVES);
  const tokens = pick(...TOKENS_CLAVES) ?? sub("intelligence_index_token_counts", "total_tokens", "total") ?? suma("intelligence_index_token_counts");
  return { name: name || slug, slug, creator, intelligence, coding, agentic, ...(cost !== null ? { cost } : {}), ...(tokens !== null ? { tokens } : {}), ...(time !== null ? { time } : {}) };
}

/** El JSON de la respuesta → los modelos: `{data: [...]}`, `{models: [...]}` o el arreglo suelto. Lo que no sirve se descarta. */
export function parsearLista(json: unknown): ModeloAA[] {
  const o = obj(json);
  const lista = Array.isArray(json) ? json : Array.isArray(o?.data) ? o.data : Array.isArray(o?.models) ? o.models : Array.isArray(o?.results) ? o.results : [];
  return lista.map(modeloDe).filter((m): m is ModeloAA => m !== null);
}

/** `Retry-After`: segundos o fecha HTTP → segundos (máx. un día); `undefined` si no vino o no se entiende. */
export function reintentarEn(h: string | null, ahoraMs: number): number | undefined {
  if (!h) return undefined;
  const n = /^\d+$/.test(h.trim()) ? Number(h) : (Date.parse(h) - ahoraMs) / 1000;
  return Number.isFinite(n) ? Math.max(0, Math.min(86400, Math.ceil(n))) : undefined;
}

export type DepsAA = { fetch?: FetchAA; ahora?: () => number; baseUrl?: string; timeoutMs?: number };

/** Baja la lista con la key: prueba cada ruta en orden (sigue a la siguiente sólo con 404 o una respuesta sin modelos). 401 → key mala, 429 → límite. */
export async function bajarLista(clave: string, deps: DepsAA = {}): Promise<ListaAA> {
  if (!clave) return { ok: false, tipo: "sin-clave" };
  const f = deps.fetch ?? (globalThis.fetch as unknown as FetchAA);
  const ahora = deps.ahora ?? Date.now;
  const base = (deps.baseUrl ?? URL_AA).replace(/\/+$/, "");
  let ultimo: FalloAA = { ok: false, tipo: "forma" };
  for (const ruta of RUTAS_AA) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 12000);
    try {
      const r = await f(base + ruta, { headers: { "x-api-key": clave, accept: "application/json" }, signal: ctl.signal });
      if (r.status === 401 || r.status === 403) return { ok: false, tipo: "clave" };
      if (r.status === 429) return { ok: false, tipo: "limite", reintentarS: reintentarEn(r.headers.get("retry-after"), ahora()) };
      if (r.status === 404) {
        ultimo = { ok: false, tipo: "forma", detalle: "404" };
        continue;
      }
      if (r.status < 200 || r.status >= 300) return { ok: false, tipo: "red", detalle: `HTTP ${r.status}` };
      const modelos = parsearLista(await r.json().catch(() => null));
      if (modelos.length) return { ok: true, modelos };
      ultimo = { ok: false, tipo: "forma" };
    } catch (e) {
      // Sin red, cortado por el tiempo o la respuesta no es JSON: el mensaje nunca lleva la key (viaja en un header, no en la URL).
      return { ok: false, tipo: "red", detalle: String((e as Error)?.message ?? e).split(clave).join("***").slice(0, 160) };
    } finally {
      clearTimeout(timer);
    }
  }
  return ultimo;
}

/** Dónde queda la caché: `REPARTO_AA` (un archivo; `0` la apaga), si no <REPARTO_STATE o estado de pa/reparto>/aa-modelos.json, igual que `reparto`. */
export function rutaCacheAA(env: Env = process.env): string | null {
  if (env.REPARTO_AA === "0") return null;
  return env.REPARTO_AA || path.join(env.REPARTO_STATE || path.join(estadoPa(env), "reparto"), "aa-modelos.json");
}

/** La caché guardada; `null` si no hay, está rota o no es la versión. */
export async function leerCacheAA(ruta: string | null = rutaCacheAA()): Promise<CacheAA | null> {
  if (!ruta) return null;
  try {
    const j = obj(JSON.parse(await readFile(ruta, "utf8")));
    if (!j || j.version !== 1 || !Array.isArray(j.modelos) || !Number.isFinite(Date.parse(texto(j.fetched)))) return null;
    return { version: 1, fetched: texto(j.fetched), modelos: j.modelos.map(modeloDe).filter((m): m is ModeloAA => m !== null) };
  } catch {
    return null;
  }
}

export async function guardarCacheAA(modelos: ModeloAA[], ahoraMs: number, ruta: string | null = rutaCacheAA()): Promise<void> {
  if (!ruta) return;
  const c: CacheAA = { version: 1, fetched: new Date(ahoraMs).toISOString(), modelos };
  await mkdir(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(c, null, 1) + "\n");
  await rename(tmp, ruta);
}

/** Cuándo se puede volver a intentar sola (epoch ms); lo mueve un 429 (su Retry-After) o cualquier otro fallo (diez minutos). */
export type EsperaAA = { hasta: number };
export const esperaGlobal: EsperaAA = { hasta: 0 };

export type ResultadoAA = { ok: true; /** `true`: la caché ya valía y no se llamó a la API. */ vigente: boolean; modelos: number; fetched: string } | FalloAA;

/**
 * Deja la caché al día: si es de hace menos de 24 h (y no se pide `forzar`) no hace nada; si no, baja la lista y la guarda. Un fallo no
 * toca la caché de antes. `forzar` (el botón) ignora la vigencia y la espera, no la key.
 */
export async function refrescarAA(clave: string | undefined, o: { forzar?: boolean; ruta?: string | null; espera?: EsperaAA } & DepsAA = {}): Promise<ResultadoAA> {
  const ahora = o.ahora ?? Date.now;
  const ruta = o.ruta === undefined ? rutaCacheAA() : o.ruta;
  const espera = o.espera ?? esperaGlobal;
  if (!clave) return { ok: false, tipo: "sin-clave" };
  const c = await leerCacheAA(ruta);
  if (!o.forzar) {
    if (c && ahora() - Date.parse(c.fetched) < VIGENCIA_AA_MS) return { ok: true, vigente: true, modelos: c.modelos.length, fetched: c.fetched };
    if (ahora() < espera.hasta) return { ok: false, tipo: "limite", reintentarS: Math.ceil((espera.hasta - ahora()) / 1000) };
  }
  const r = await bajarLista(clave, o);
  if (!r.ok) {
    espera.hasta = ahora() + (r.tipo === "limite" ? (r.reintentarS ?? 3600) * 1000 : ESPERA_FALLO_MS);
    return r;
  }
  espera.hasta = 0;
  await guardarCacheAA(r.modelos, ahora(), ruta);
  return { ok: true, vigente: false, modelos: r.modelos.length, fetched: new Date(ahora()).toISOString() };
}

/** Lo que ve Ajustes: si hay key, y de cuándo es la caché y cuántos modelos trae. Nunca la key. */
export type EstadoAA = { version: 1; hayClave: boolean; fecha: number | null; modelos: number };
export async function estadoAA(hayClave: boolean, ruta: string | null = rutaCacheAA()): Promise<EstadoAA> {
  const c = await leerCacheAA(ruta);
  return { version: 1, hayClave, fecha: c ? Date.parse(c.fetched) : null, modelos: c?.modelos.length ?? 0 };
}
