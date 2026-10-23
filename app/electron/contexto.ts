// Los umbrales del anillo de contexto (B16). El que manda en un líder es el del
// relevo: a partir de ahí el hook de contexto (`aviso-contexto.sh` del
// orquestador) hace que el jefe se reemplace por uno nuevo con contexto limpio.
// Sale de `AVISO_CONTEXTO` (tokens) si está; si no, del plan de `pa` (primera
// línea de `~/.local/state/pa/plan`): max 200 mil, si no (pro o sin plan) 120
// mil; igual que el hook. `HILOS_PA_PLAN` cambia la ruta del plan. Aparte, el
// `autoCompactWindow` de `~/.claude/settings.json` (`HILOS_CLAUDE_SETTINGS`
// cambia la ruta): el de los workers y la línea secundaria del detalle. Las
// pruebas no leen los reales. Sólo se lee. Lo prueba `tests/contexto.test.ts`.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const RUTA_SETTINGS = process.env.HILOS_CLAUDE_SETTINGS ?? path.join(os.homedir(), ".claude", "settings.json");
export const RUTA_PLAN =
  process.env.HILOS_PA_PLAN ?? path.join(process.env.PA_STATE ?? path.join(os.homedir(), ".local", "state", "pa"), "plan");

/** El relevo según el plan de `pa`. */
export const RELEVO_MAX = 200_000;
export const RELEVO_PRO = 120_000;

/** El `autoCompactWindow` del texto de un settings.json; `null` si no está o no es un número que sirva. */
export function umbralDeSettings(texto: string): number | null {
  try {
    const n = JSON.parse(texto)?.autoCompactWindow;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export async function leerUmbral(ruta = RUTA_SETTINGS): Promise<number | null> {
  try {
    return umbralDeSettings(await readFile(ruta, "utf8"));
  } catch {
    return null;
  }
}

/** El umbral del relevo: `AVISO_CONTEXTO` si es un entero positivo; si no, por el plan (texto del archivo, o `null`). */
export function relevoDe(plan: string | null, aviso: string | undefined): number {
  if (aviso && /^[0-9]+$/.test(aviso.trim()) && Number(aviso) > 0) return Number(aviso);
  const p = (plan ?? "").split("\n")[0].replace(/\s/g, "").toLowerCase();
  return p === "max" ? RELEVO_MAX : RELEVO_PRO;
}

export async function leerRelevo(ruta = RUTA_PLAN, aviso = process.env.AVISO_CONTEXTO): Promise<number> {
  return relevoDe(await readFile(ruta, "utf8").catch(() => null), aviso);
}

export type Umbrales = { relevo: number; autoCompact: number | null };

export async function leerUmbrales(): Promise<Umbrales> {
  const [relevo, autoCompact] = await Promise.all([leerRelevo(), leerUmbral()]);
  return { relevo, autoCompact };
}
