// OpenCode Go (plan pago de OpenCode: «Go» y «Go Plus»), APAGADO por defecto: sin elegir un plan en Ajustes > OpenCode todo queda como antes.
// Acá: la tabla de topes por modelo (se lee de opencode.ai/go con motor/opencode/go-topes.mjs, al arrancar y cada día, a un caché en el estado de
// trama: `opencode-go-topes.json`, con la fecha de lectura; lo lee también `reparto`. Sin red, el respaldo es motor/opencode/go-topes.json y la
// interfaz lo dice), qué modelos de Go se ofrecen según el plan y cómo se guarda el plan (`opencode_plan` de modelos.json). Sin Electron.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolverPa } from "./binario.ts";
import { errorT } from "./errores.ts";
import { estadoHilos } from "./rutas.ts";
import { PLANES_OPENCODE, PROVEEDOR_GO, planOpencode, rutaModelosOc, type PlanOpencode } from "./opencode.ts";

type Env = Record<string, string | undefined>;

/** Los planes con Go (el resto, `gratis`, es como antes). */
export type PlanGo = Exclude<PlanOpencode, "gratis">;
export const esPlanGo = (p: unknown): p is PlanGo => p === "go" || p === "go-plus";

/** Los topes de un modelo en un plan: pedidos cada 5 h y el equivalente mensual en USD. */
export type TopesGo = { pedidos5h: number; usdMes: number };
export type ModeloGo = {
  /** El id del slug en la tabla (`deepseek-v4.1-flash`). */
  slug: string;
  nombre: string;
  topes: Record<PlanGo, TopesGo | null>;
};
export type TablaGo = {
  /** De dónde salen los topes y a qué fecha. */
  fuente: string;
  fecha: string;
  /** Cuándo se leyó de OpenCode (ISO); `""` en el respaldo, que es a mano. */
  leido: string;
  /** `cache`: leída de opencode.ai/go; `respaldo`: go-topes.json (no hay caché o no sirve). */
  origen: "cache" | "respaldo";
  /** Lo que cuesta Go por mes, USD (Go Plus: no se sabe, `null`). */
  precios: Record<PlanGo, number | null>;
  modelos: ModeloGo[];
};

const entero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const topes = (v: unknown): TopesGo | null => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const p = entero(o.pedidos_5h);
  const u = entero(o.usd_mes);
  return p === null || u === null ? null : { pedidos5h: p, usdMes: u };
};

/** El texto de go-topes.json → la tabla; `null` si no es el contrato (JSON roto, otra versión, sin modelos). */
export function parsearTablaGo(texto: string): TablaGo | null {
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    return null;
  }
  const r = j as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || r.version !== 1 || !Array.isArray(r.modelos)) return null;
  const modelos: ModeloGo[] = [];
  for (const m of r.modelos) {
    const o = m as Record<string, unknown> | null;
    const slug = typeof o?.id === "string" ? o.id.trim() : "";
    if (!o || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) continue;
    modelos.push({ slug, nombre: typeof o.nombre === "string" && o.nombre.trim() ? o.nombre.trim() : slug, topes: { go: topes(o.go), "go-plus": topes(o["go-plus"]) } });
  }
  if (!modelos.length) return null;
  const planes = (r.planes && typeof r.planes === "object" ? r.planes : {}) as Record<string, { usd_mes?: unknown } | undefined>;
  return {
    fuente: typeof r.fuente === "string" ? r.fuente : "",
    fecha: typeof r.fecha === "string" ? r.fecha : "",
    leido: typeof r.leido === "string" ? r.leido : "",
    origen: "respaldo",
    precios: { go: entero(planes.go?.usd_mes), "go-plus": entero(planes["go-plus"]?.usd_mes) },
    modelos,
  };
}

/** El caché de topes leído de OpenCode (lo escribe motor/opencode/go-topes.mjs; lo lee también `reparto`). */
export const rutaCacheGo = (env: Env = process.env, home: string = os.homedir()): string => path.join(estadoHilos(env, home), "opencode-go-topes.json");

/** Dónde puede estar go-topes.json (el respaldo): `HILOS_OPENCODE_GO` (pruebas), junto al `pa` instalado (motor/bin/../opencode) o junto a esta app (el repo). */
export function rutasTablaGo(env: Env = process.env, home: string = os.homedir()): string[] {
  const out: string[] = [];
  if (env.HILOS_OPENCODE_GO) out.push(env.HILOS_OPENCODE_GO);
  try {
    const pa = resolverPa(env, home);
    if (path.isAbsolute(pa)) out.push(path.join(path.dirname(realpathSync(pa)), "..", "opencode", "go-topes.json"));
  } catch {
    /* sin pa */
  }
  out.push(path.join(import.meta.dirname, "..", "..", "motor", "opencode", "go-topes.json"));
  return out;
}

/**
 * La tabla de topes de Go: `HILOS_OPENCODE_GO` (pruebas) manda; si no, el caché leído de OpenCode; si no hay o no sirve, el respaldo
 * (go-topes.json, con `origen: "respaldo"`); `null` si nada sirve (entonces Go no ofrece modelos: no se inventa nada).
 */
export function cargarTablaGo(env: Env = process.env, home: string = os.homedir()): TablaGo | null {
  const lugares = rutasTablaGo(env, home).map((f) => ({ f, origen: "respaldo" as TablaGo["origen"] }));
  lugares.splice(env.HILOS_OPENCODE_GO ? 1 : 0, 0, { f: rutaCacheGo(env, home), origen: "cache" });
  for (const { f, origen } of lugares) {
    try {
      const t = parsearTablaGo(readFileSync(f, "utf8"));
      if (t) return { ...t, origen };
    } catch {
      /* el siguiente lugar */
    }
  }
  return null;
}

type ResultadoTopes = { ok: boolean; vigente?: boolean; motivo?: string };
type ModuloTopes = { refrescar(o: { cache: string; siViejo: boolean; respaldo?: string; env: Env }): Promise<ResultadoTopes> };

/**
 * Lee los topes de OpenCode y actualiza el caché (motor/opencode/go-topes.mjs, el mismo código que usan `reparto` y el runner). `siViejo`: sólo si
 * el caché tiene más de un día y no se intentó hace una hora. Nunca tira: sin red (o sin el módulo) devuelve `ok: false` y queda lo que había.
 */
export async function refrescarTopesGo(env: Env = process.env, home: string = os.homedir(), siViejo = true): Promise<ResultadoTopes> {
  if (env.TRAMA_GO_SIN_RED === "1") return { ok: false, motivo: "sin red (TRAMA_GO_SIN_RED=1)" };
  for (const json of rutasTablaGo(env, home)) {
    const mjs = path.join(path.dirname(json), "go-topes.mjs");
    try {
      readFileSync(mjs);
    } catch {
      continue;
    }
    try {
      const m = (await import(pathToFileURL(mjs).href)) as ModuloTopes;
      return await m.refrescar({ cache: rutaCacheGo(env, home), siViejo, respaldo: json, env });
    } catch (e) {
      return { ok: false, motivo: (e as Error).message };
    }
  }
  return { ok: false, motivo: "no se encontró motor/opencode/go-topes.mjs" };
}

/** Al arrancar y después cada hora (que sólo trabaja si el caché pasó de un día): mantiene el caché al día. Devuelve cómo parar. */
export function mantenerTopesGo(env: Env = process.env, home: string = os.homedir(), alRefrescar: () => void = () => {}): () => void {
  const una = () => void refrescarTopesGo(env, home, true).then((r) => r.ok && !r.vigente && alRefrescar());
  una();
  const t = setInterval(una, 3600_000);
  t.unref();
  return () => clearInterval(t);
}

/** `Kimi K3.1 Pro`, `opencode-go/kimi-k3.1-pro`, `kimi_k3-1-pro` → `kimik31pro`: para emparejar el slug de la tabla con el que lista `opencode models`. */
export const normalizarSlug = (s: string): string => s.toLowerCase().replace(/^opencode:/, "").replace(/^opencode-go\//, "").replace(/[^a-z0-9]/g, "");

export type OfertaGo = { id: string; nombre: string; topes: TopesGo | null };

/**
 * Los modelos de Go que se ofrecen: con plan Go o Go Plus, los de la tabla (sin plan, ninguno). Si `opencode models` ya listó modelos del proveedor
 * `opencode-go`, se usa el id tal cual lo lista (emparejado con la tabla por el slug normalizado) y los de la tabla que no aparecen no se ofrecen;
 * si no listó ninguno (caché vieja, sin login), se ofrecen los de la tabla con el id `opencode-go/<slug>`.
 */
export function ofertasGo(plan: PlanOpencode, tabla: TablaGo | null, listados: readonly string[] = []): OfertaGo[] {
  if (!esPlanGo(plan) || !tabla) return [];
  const delGo = listados.filter((m) => m.startsWith(`${PROVEEDOR_GO}/`));
  if (!delGo.length) return tabla.modelos.map((m) => ({ id: `${PROVEEDOR_GO}/${m.slug}`, nombre: m.nombre, topes: m.topes[plan] }));
  const out: OfertaGo[] = [];
  for (const m of tabla.modelos) {
    const id = delGo.find((l) => normalizarSlug(l) === normalizarSlug(m.slug));
    if (id) out.push({ id, nombre: m.nombre, topes: m.topes[plan] });
  }
  return out;
}

// --- El plan en modelos.json ------------------------------------------------------------------------------------------------------

export { planOpencode, PLANES_OPENCODE, type PlanOpencode };

/** Guarda el plan en `opencode_plan` de modelos.json sin tocar lo demás (tmp + rename; crea la carpeta si falta). `gratis` saca la clave: así el archivo queda como antes. */
export async function guardarPlanOpencode(plan: unknown, env: Env = process.env, home: string = os.homedir()): Promise<PlanOpencode> {
  if (!(PLANES_OPENCODE as readonly unknown[]).includes(plan)) throw errorT("main.opencodePlan", { v: String(plan).slice(0, 20) });
  const ruta = rutaModelosOc(env, home);
  let texto: string | null = null;
  try {
    texto = await readFile(ruta, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw errorT("main.noLeo", { ruta, e: (e as Error).message });
  }
  let obj: Record<string, unknown> = { version: 1 };
  if (texto !== null) {
    try {
      const j = JSON.parse(texto);
      if (!j || typeof j !== "object" || Array.isArray(j) || j.version !== 1) throw new Error("no es un modelos.json v1");
      obj = j;
    } catch (e) {
      // No se escribe encima de un archivo roto o de otra versión.
      throw errorT("main.modelosRoto", { ruta, e: (e as Error).message });
    }
  }
  if (plan === "gratis") delete obj.opencode_plan;
  else obj.opencode_plan = plan;
  if (plan === "gratis" && texto === null) return "gratis"; // sin archivo y sin plan: no se crea nada
  const nuevo = JSON.stringify(obj, null, 2) + "\n";
  if (nuevo !== texto) {
    await mkdir(path.dirname(ruta), { recursive: true });
    const real = texto === null ? ruta : await realpath(ruta);
    const tmp = `${real}.trama-${process.pid}.tmp`;
    await writeFile(tmp, nuevo);
    await rename(tmp, real);
  }
  return plan as PlanOpencode;
}

/** Lo que Ajustes > OpenCode muestra del plan: el elegido, la tabla de topes de ese plan y de dónde salen. */
export type VistaPlanGo = {
  plan: PlanOpencode;
  /** De dónde salen los topes y a qué fecha (`null`: no se encontró la tabla). */
  fuente: string | null;
  fecha: string | null;
  /** De dónde salen: `cache` (leídos de OpenCode, `leido` es cuándo) o `respaldo` (go-topes.json: sin caché; la interfaz dice «datos del <fecha>»). */
  origen: TablaGo["origen"] | null;
  leido: string | null;
  /** USD por mes de Go (el de Go Plus no se sabe). */
  precio: number | null;
  modelos: { id: string; nombre: string; pedidos5h: number | null; usdMes: number | null }[];
  /** El uso real del plan según OpenCode. Vive en su consola, detrás del login (ni la API ni el CLI lo traen): siempre `false`; los pedidos los cuenta Trama aparte (opencode-pedidos.ts). */
  usoDisponible: boolean;
};

export function vistaPlanGo(env: Env = process.env, home: string = os.homedir()): VistaPlanGo {
  const plan = planOpencode(env, home);
  const tabla = cargarTablaGo(env, home);
  // Con un plan Go se muestran los topes de ese plan; sin plan, los de Go (para ver qué ofrecería).
  const p: PlanGo = esPlanGo(plan) ? plan : "go";
  return {
    plan,
    fuente: tabla?.fuente || null,
    fecha: tabla?.fecha || null,
    origen: tabla?.origen ?? null,
    leido: tabla?.leido || null,
    precio: tabla?.precios[p] ?? null,
    modelos: (tabla?.modelos ?? []).map((m) => ({ id: `${PROVEEDOR_GO}/${m.slug}`, nombre: m.nombre, pedidos5h: m.topes[p]?.pedidos5h ?? null, usdMes: m.topes[p]?.usdMes ?? null })),
    usoDisponible: false,
  };
}
