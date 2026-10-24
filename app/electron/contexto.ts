// El umbral del anillo de contexto (B16): el `autoCompactWindow` de
// `~/.claude/settings.json` (`HILOS_CLAUDE_SETTINGS` cambia la ruta), el mismo
// para líderes y workers: a ese tamaño Claude Code compacta solo. El relevo del
// líder (una sesión nueva con contexto limpio) se descartó: ya no hay umbral de
// relevo. Las pruebas no leen el real. Sólo se lee. Lo prueba `tests/contexto.test.ts`.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const RUTA_SETTINGS = process.env.HILOS_CLAUDE_SETTINGS ?? path.join(os.homedir(), ".claude", "settings.json");

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

export type Umbrales = { autoCompact: number | null };

export async function leerUmbrales(): Promise<Umbrales> {
  return { autoCompact: await leerUmbral() };
}
