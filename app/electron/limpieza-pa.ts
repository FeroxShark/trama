// La limpieza de worktrees y ramas viejos de `pa` (`pa --limpiar`, motor/bin/pa y electron/cli/pa/limpiar.ts) vista desde la app:
// Ajustes > Proyectos muestra qué se quitaría (`--ver --json`), pide confirmación y lo aplica (`--si`); y, si el usuario lo prendió,
// una pasada automática cada tanto. Node puro: `pa` entra por `correr`, así se prueba con un `pa` falso.
// Lo seguro lo decide `pa` (puestos libres, sin trabajo sin integrar, ramas ya enteras en main); acá sólo se piden los días.
import { errorT } from "./errores.ts";

export const LIMPIEZA_DIAS_DEFAULT = 7;
export const LIMPIEZA_DIAS_MIN = 1;
export const LIMPIEZA_DIAS_MAX = 365;

/** Lo que el usuario deja dicho: si la pasada automática está prendida (por defecto NO) y desde cuántos días de antigüedad. */
export type ConfigLimpieza = { auto: boolean; dias: number };
export const CONFIG_LIMPIEZA_DEFAULT: ConfigLimpieza = { auto: false, dias: LIMPIEZA_DIAS_DEFAULT };

export type BuildViejo = { puesto: string; dir: string; bytes: number };
export type WorktreeViejo = { puesto: string; dias: number; bytes: number };
export type RamaVieja = { proyecto: string; rama: string; dias: number; commits: number };
/** Lo que dice `pa --limpiar --json`: lo que se quitaría (`aplicado: false`) o lo que se quitó. */
export type PlanLimpieza = {
  dias: number;
  aplicado: boolean;
  enUso: string[];
  builds: BuildViejo[];
  worktrees: WorktreeViejo[];
  ramas: RamaVieja[];
  bytes: number;
};
export type Corrida = (args: string[]) => Promise<{ rc: number; out: string; dijo: string }>;

/** Días válidos: entero de 1 a 365. `null` si no vale. */
export function diasLimpieza(x: unknown): number | null {
  const n = typeof x === "string" && /^[0-9]+$/.test(x) ? Number(x) : x;
  return typeof n === "number" && Number.isInteger(n) && n >= LIMPIEZA_DIAS_MIN && n <= LIMPIEZA_DIAS_MAX ? n : null;
}

/** La config que se guarda a partir de lo que mande la página: lo que no vale se ignora (queda lo que había). */
export function configLimpieza(actual: ConfigLimpieza, cambio: unknown): ConfigLimpieza {
  const c = (cambio && typeof cambio === "object" ? cambio : {}) as { auto?: unknown; dias?: unknown };
  return {
    auto: typeof c.auto === "boolean" ? c.auto : actual.auto,
    dias: diasLimpieza(c.dias) ?? actual.dias,
  };
}

const lista = <T>(x: unknown, ok: (f: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(x) ? x.flatMap((f) => (f && typeof f === "object" ? [ok(f as Record<string, unknown>)] : [])).filter((f): f is T => f !== null) : [];
const txt = (x: unknown) => (typeof x === "string" ? x : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** El JSON de `pa --limpiar --json` → un plan con los tipos comprobados. Rechaza si no es lo que `pa` dice que da. */
export function planDe(salida: string): PlanLimpieza {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(salida.trim().split("\n").pop() ?? "");
  } catch {
    throw errorT("main.limpiezaSalida");
  }
  if (!j || typeof j !== "object" || num(j.dias) === null) throw errorT("main.limpiezaSalida");
  return {
    dias: j.dias as number,
    aplicado: j.aplicado === true,
    enUso: Array.isArray(j.enUso) ? j.enUso.filter((x): x is string => typeof x === "string") : [],
    builds: lista(j.builds, (f) => (txt(f.puesto) !== null && txt(f.dir) !== null && num(f.bytes) !== null ? { puesto: f.puesto as string, dir: f.dir as string, bytes: f.bytes as number } : null)),
    worktrees: lista(j.worktrees, (f) => (txt(f.puesto) !== null && num(f.dias) !== null && num(f.bytes) !== null ? { puesto: f.puesto as string, dias: f.dias as number, bytes: f.bytes as number } : null)),
    ramas: lista(j.ramas, (f) =>
      txt(f.proyecto) !== null && txt(f.rama) !== null && num(f.dias) !== null && num(f.commits) !== null
        ? { proyecto: f.proyecto as string, rama: f.rama as string, dias: f.dias as number, commits: f.commits as number }
        : null,
    ),
    bytes: num(j.bytes) ?? 0,
  };
}

/** Los argumentos de `pa`: `ver` no toca nada; `aplicar` quita lo que `ver` mostraba. Siempre con los días explícitos y por JSON. */
export const argvLimpieza = (modo: "ver" | "aplicar", dias: number): string[] => ["--limpiar", modo === "ver" ? "--ver" : "--si", "--dias", String(dias), "--json"];

async function pedir(correr: Corrida, modo: "ver" | "aplicar", dias: unknown): Promise<PlanLimpieza> {
  const d = diasLimpieza(dias);
  if (d === null) throw errorT("main.limpiezaDias", { min: LIMPIEZA_DIAS_MIN, max: LIMPIEZA_DIAS_MAX });
  const r = await correr(argvLimpieza(modo, d));
  if (r.rc !== 0) throw new Error(r.dijo || `pa --limpiar: salió ${r.rc}`);
  return planDe(r.out);
}

/** Qué quitaría `pa --limpiar` con esa antigüedad, sin tocar nada. */
export const verLimpieza = (correr: Corrida, dias: unknown) => pedir(correr, "ver", dias);
/** Lo quita. La página lo pide después de mostrar la lista y de que el usuario confirme. */
export const aplicarLimpieza = (correr: Corrida, dias: unknown) => pedir(correr, "aplicar", dias);

export const hayAlgo = (p: PlanLimpieza) => p.builds.length + p.worktrees.length + p.ramas.length > 0;

/**
 * La pasada automática: sólo si el usuario la prendió. Devuelve lo que se quitó, o `null` si estaba apagada o falló (una pasada
 * que falla no tira la app ni se reintenta enseguida: la próxima es la del turno siguiente).
 */
export async function pasadaAutomatica(leer: () => Promise<ConfigLimpieza>, correr: Corrida): Promise<PlanLimpieza | null> {
  const cfg = await leer();
  if (!cfg.auto) return null;
  return aplicarLimpieza(correr, cfg.dias).catch(() => null);
}

/** Cada cuánto se mira si toca limpiar (la primera, a los 3 minutos de abrir la app: no compite con el arranque). */
export const PRIMERA_PASADA_MS = 3 * 60_000;
export const CADA_PASADA_MS = 6 * 3600_000;

/** Arma el reloj de la pasada automática. Devuelve cómo pararlo. `pasada` es lo que se corre cada vez (ya mira si está prendida). */
export function programarPasadas(pasada: () => Promise<unknown>, o: { primera?: number; cada?: number } = {}): () => void {
  let t: NodeJS.Timeout | null = null;
  let parado = false;
  const siguiente = (ms: number) => {
    if (parado) return;
    t = setTimeout(() => {
      void pasada().catch(() => {}).finally(() => siguiente(o.cada ?? CADA_PASADA_MS));
    }, ms);
    t.unref?.();
  };
  siguiente(o.primera ?? PRIMERA_PASADA_MS);
  return () => {
    parado = true;
    if (t) clearTimeout(t);
  };
}
