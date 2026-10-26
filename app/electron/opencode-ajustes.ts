// Ajustes > DeepSeek Harness > OpenCode: ¿está `opencode` instalado, en qué versión, hay login (OpenCode Console)? y los modelos que
// ofrece (`opencode models`), con una caché en `$HILOS_STATE/opencode-modelos.json` para que el selector no espere a un proceso de ~2 s.
// Sólo se ofrecen los de proveedores usables: `opencode/*` (los gratis y los de Zen) y los de los proveedores con login. Node puro.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ESTADO } from "./estado.ts";
import { errorT, MARCA } from "./errores.ts";
import { estadoOpencode, esGratis, hayOpencode, listarModelosConEfforts, proveedoresConLogin, type EstadoOpencode } from "./opencode.ts";

const CACHE = () => path.join(process.env.HILOS_STATE ?? ESTADO, "opencode-modelos.json");

/** Lo que `opencode models` listaba para `opencode/*` hasta hoy: se ofrece mientras no hay caché (la primera vez, el proceso tarda ~2 s). */
export const GRATIS_CONOCIDOS = [
  "opencode/big-pickle",
  "opencode/beam-free",
  "opencode/deepseek-v4.1-flash-free",
  "opencode/flint-40b-free",
  "opencode/glm-5.3-flash-free",
  "opencode/mimo-v2.6-flash-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/nemotron-3.5-lightning-free",
  "opencode/nemotron-3.5-super-vl-free",
];

export type EstadoOpencodeUi = EstadoOpencode & {
  /** Cuántos modelos se ofrecen (los gratis y, con login, los de los proveedores conectados) y cuántos de ellos son gratis. */
  modelos: number;
  gratis: number;
  /** Cuándo se leyó la lista (ms); `null`: nunca (se muestran los conocidos). */
  actualizado: number | null;
};

type Cache = { version: 1; en: number; modelos: string[]; /** Niveles de esfuerzo por modelo (`opencode/xxx` → `["low","medium"]`); ausente en cachés viejas. */ efforts?: Record<string, string[]> };

function leerCache(): Cache | null {
  try {
    const j = JSON.parse(readFileSync(CACHE(), "utf8"));
    if (j?.version === 1 && typeof j.en === "number" && Array.isArray(j.modelos)) {
      const modelos = j.modelos.filter((m: unknown): m is string => typeof m === "string");
      if (!j.efforts || typeof j.efforts !== "object" || Array.isArray(j.efforts)) return { version: 1, en: j.en, modelos };
      const efforts: Record<string, string[]> = {};
      for (const [m, v] of Object.entries(j.efforts)) if (Array.isArray(v)) efforts[m] = v.filter((x: unknown): x is string => typeof x === "string");
      return { version: 1, en: j.en, modelos, efforts };
    }
  } catch {
    /* sin caché o rota: se vuelve a pedir */
  }
  return null;
}

function guardarCache(modelos: string[], efforts: Record<string, string[]> = {}) {
  try {
    mkdirSync(path.dirname(CACHE()), { recursive: true });
    const tmp = `${CACHE()}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, en: Date.now(), modelos, efforts }));
    renameSync(tmp, CACHE());
  } catch {
    /* sin caché se pide cada vez */
  }
}

/** Los modelos que se ofrecen: los gratis (`opencode/*`) primero, después el resto de `opencode/*` y los de los proveedores con login. */
export function elegibles(todos: string[], conLogin: string[]): string[] {
  const ok = todos.filter((m) => {
    const p = m.slice(0, m.indexOf("/"));
    return p === "opencode" || conLogin.includes(p);
  });
  return [...ok.filter(esGratis), ...ok.filter((m) => !esGratis(m))];
}

/** Los modelos de OpenCode para el selector (`opencode/…`, sin el prefijo de Trama), de la caché. `[]` si `opencode` no está instalado. Nunca espera: la caché vieja se refresca aparte. */
export function modelosOpencode(env = process.env): string[] {
  if (!hayOpencode(env)) return [];
  const c = leerCache();
  // Una caché de antes de los niveles (sin `efforts`) se pide de nuevo ya.
  if (!c || !c.efforts || Date.now() - c.en > 24 * 3600_000) void refrescarModelos().catch(() => {});
  return elegibles(c?.modelos ?? GRATIS_CONOCIDOS, proveedoresConLogin(env));
}

/** Los niveles de esfuerzo de los modelos que se ofrecen (de la caché): `opencode/xxx` → niveles. Sin caché (o sin niveles): `{}`. */
export function effortsOpencode(env = process.env): Record<string, string[]> {
  if (!hayOpencode(env)) return {};
  const e = leerCache()?.efforts ?? {};
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v.length));
}

let enCurso: Promise<string[]> | null = null;
/** Vuelve a pedirle la lista a `opencode` (`refrescar`: también al catálogo de models.dev) y la guarda. Rechaza si falla. */
export function refrescarModelos(refrescar = false): Promise<string[]> {
  return (enCurso ??= listarModelosConEfforts(undefined, refrescar)
    .then(({ modelos: m, efforts }) => {
      if (!m.length) throw errorT("main.opencodeSinModelos");
      guardarCache(m, efforts);
      return m;
    })
    .finally(() => (enCurso = null)));
}

/** El estado para Ajustes: instalado, versión, login y cuántos modelos se ofrecen. */
export async function vistaOpencode(): Promise<EstadoOpencodeUi> {
  const e = await estadoOpencode();
  const c = leerCache();
  const lista = e.instalado ? elegibles(c?.modelos ?? GRATIS_CONOCIDOS, e.proveedores) : [];
  return { ...e, modelos: lista.length, gratis: lista.filter(esGratis).length, actualizado: c?.en ?? null };
}

/** «Actualizar modelos»: pide la lista de nuevo y devuelve el estado de después. */
export async function actualizarOpencode(): Promise<EstadoOpencodeUi> {
  if (!hayOpencode()) throw errorT("main.opencodeNoEsta");
  await refrescarModelos(true).catch((e) => {
    const m = String((e as Error)?.message ?? e);
    throw m.startsWith(MARCA) ? e : errorT("main.opencodeFallo", { e: m.slice(0, 200) });
  });
  return vistaOpencode();
}
