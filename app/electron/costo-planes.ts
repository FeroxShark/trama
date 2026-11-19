// Costo por suscripción: bajar los datos públicos de Priors (`/api/plan-prices`, sin clave) con caché de 6 h en el estado de trama
// (`<estado>/costo-planes.json`) y detectar el plan de Claude. Es un sitio de terceros: nunca bloquea nada; si falla se usa la caché
// vieja y, sin caché, nada (Ajustes sigue con la estimación). El pedido va con un User-Agent genérico y sin ningún dato de la persona.
// Del credentials de Claude se leen SÓLO `claudeAiOauth.subscriptionType` y `claudeAiOauth.rateLimitTier`: el resto (tokens) no sale
// de `planClaudeDetectado`, ni a un log ni a la ventana. Node puro con fetch, reloj y rutas inyectables: tests/costo-planes.test.ts.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { estadoHilos, homeDe, plataformaActual, type Plataforma } from "./rutas.ts";
import { hayAgy } from "./capacidades.ts";
import { planDeClaude, RUTA_PRIORS, URL_PRIORS, validarPriors, type DatosPriors, type VistaPlanes } from "./costo-planes-texto.ts";

export { URL_PRIORS };
/** Cuánto vale la caché antes de volver a pedir. */
export const VIGENCIA_PLANES_MS = 6 * 3_600_000;
/** Tope del pedido: no se espera más que esto a un sitio ajeno. */
export const TOPE_PEDIDO_MS = 8_000;

type Env = Record<string, string | undefined>;
export type FetchPlanes = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
type CachePlanes = { version: 1; bajado: number; datos: DatosPriors };

export const rutaCachePlanes = (env: Env = process.env) => path.join(estadoHilos(env), "costo-planes.json");

async function leerCache(ruta: string): Promise<CachePlanes | null> {
  try {
    const j = JSON.parse(await readFile(ruta, "utf8")) as Partial<CachePlanes>;
    const datos = validarPriorsCache(j.datos);
    return j.version === 1 && typeof j.bajado === "number" && datos ? { version: 1, bajado: j.bajado, datos } : null;
  } catch {
    return null;
  }
}

/** La caché guarda ya lo validado; al releerla se revisa igual (el archivo puede estar tocado a mano). */
function validarPriorsCache(d: unknown): DatosPriors | null {
  if (!d || typeof d !== "object") return null;
  const x = d as DatosPriors;
  if (!Array.isArray(x.labs) || !Array.isArray(x.modelos)) return null;
  // Se vuelve a la forma de la API para pasar por el mismo validador.
  return validarPriors({
    generatedAt: x.fecha,
    labs: x.labs.map((l) => ({ id: l?.id, name: l?.nombre, plans: Array.isArray(l?.planes) ? l.planes.map((p) => ({ plan: p })) : [] })),
    models: x.modelos.map((m) => ({ id: m?.id, lab: m?.lab, aa: m?.aa, plans: Object.fromEntries(Object.entries(m?.planes ?? {}).map(([k, v]) => [k, { ratio: v?.ratio, confidence: v?.confianza ?? undefined }])) })),
  });
}

async function escribirCache(ruta: string, c: CachePlanes): Promise<void> {
  await mkdir(path.dirname(ruta), { recursive: true });
  const tmp = `${ruta}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(c), "utf8");
  await rename(tmp, ruta);
}

export type OpcionesPlanes = {
  fetch?: FetchPlanes;
  ahora?: () => number;
  ruta?: string;
  /** Otra base (un servidor falso en los tests): `PRIORS_URL` del entorno hace lo mismo. */
  baseUrl?: string;
  /** Sin red (pruebas y capturas): sólo la caché. */
  sinRed?: boolean;
};

/** Los datos de Priors: la caché si tiene menos de 6 h; si no, bajados (y guardados). Si el pedido falla, la caché vieja; sin nada, `null`. Nunca tira. */
export async function datosPlanes(o: OpcionesPlanes = {}): Promise<DatosPriors | null> {
  return (await refrescarPlanes(o)).datos;
}

/** Como `datosPlanes`, y además si se bajaron recién (`nuevo`): el refresco de fondo del motor avisa a la ventana sólo entonces. */
export async function refrescarPlanes(o: OpcionesPlanes = {}): Promise<{ datos: DatosPriors | null; nuevo: boolean }> {
  const ruta = o.ruta ?? rutaCachePlanes();
  const ahora = (o.ahora ?? Date.now)();
  const cache = await leerCache(ruta);
  const viejo = { datos: cache?.datos ?? null, nuevo: false };
  if (cache && ahora - cache.bajado < VIGENCIA_PLANES_MS) return viejo;
  if (o.sinRed) return viejo;
  const f = o.fetch ?? (globalThis.fetch as unknown as FetchPlanes);
  const base = (o.baseUrl ?? process.env.PRIORS_URL ?? URL_PRIORS).replace(/\/+$/, "");
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), TOPE_PEDIDO_MS);
  try {
    const r = await f(`${base}${RUTA_PRIORS}`, { headers: { "User-Agent": "Trama", Accept: "application/json" }, signal: corte.signal });
    if (r.status !== 200) return viejo;
    const datos = validarPriors(await r.json());
    if (!datos) return viejo;
    await escribirCache(ruta, { version: 1, bajado: ahora, datos }).catch(() => undefined);
    return { datos, nuevo: true };
  } catch {
    return viejo;
  } finally {
    clearTimeout(reloj);
  }
}

/** `~/.claude/.credentials.json` (en Windows `%USERPROFILE%\.claude\.credentials.json`). */
export const rutaCredencialesClaude = (env: Env = process.env, plat: Plataforma = plataformaActual()) =>
  (plat === "win32" ? path.win32 : path.posix).join(homeDe(env, plat), ".claude", ".credentials.json");

/** El plan de Claude según el credentials: sólo mira `subscriptionType` y `rateLimitTier`; cualquier error o dato raro, `null`. */
export async function planClaudeDetectado(ruta: string = rutaCredencialesClaude()): Promise<string | null> {
  try {
    const j = JSON.parse(await readFile(ruta, "utf8")) as unknown;
    const oauth = j && typeof j === "object" ? (j as Record<string, unknown>).claudeAiOauth : null;
    if (!oauth || typeof oauth !== "object") return null;
    const o = oauth as Record<string, unknown>;
    return planDeClaude(o.subscriptionType, o.rateLimitTier);
  } catch {
    return null;
  }
}

/** Lo que pide Ajustes (canal `planes:leer`): datos de Priors, plan de Claude detectado y si hay `agy`. */
export async function vistaPlanes(o: OpcionesPlanes & { credenciales?: string; agy?: boolean } = {}): Promise<VistaPlanes> {
  const [datos, claude] = await Promise.all([datosPlanes(o), planClaudeDetectado(o.credenciales)]);
  return { datos, claude, agy: o.agy ?? hayAgy() };
}
