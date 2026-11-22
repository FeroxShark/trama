// La ventana de contexto de los motores que no son Claude, por el id del modelo con que Trama los lanza. Pura (sin Node): la usa también la
// ventana (`ventanaDe` de src/hilo/contexto-logica.ts). `null`: ese id no es de un motor que se conozca (vale la regla de Claude).
// Son las ventanas por defecto: si el motor dice la suya (dsh `usage_update.size`, el rollout de codex), esa manda.

/** Gemini 4 por agy: 1 M (el mismo número que `VENTANA_GEMINI` de agy-stream.ts). */
export const VENTANA_AGY = 1_000_000;
/** Los modelos de OpenAI por `codex`: 400 mil. */
export const VENTANA_CODEX = 400_000;
/** DeepSeek por `dsh`: 128 mil. */
export const VENTANA_DSH = 128_000;
/** Lo que no se sabe de un modelo de OpenCode (cada proveedor trae la suya): una ventana corta, para no decir menos presión de la que hay. */
export const VENTANA_OPENCODE = 200_000;
/** Un modelo local u Ollama sin el `-c` a mano. */
export const VENTANA_LOCAL = 32_768;

export function ventanaDeMotor(modelo: string | null | undefined): number | null {
  const m = (modelo ?? "").toLowerCase();
  if (m.startsWith("codex:")) return VENTANA_CODEX;
  if (m.startsWith("dsh:")) return VENTANA_DSH;
  if (m.startsWith("opencode:")) return VENTANA_OPENCODE;
  if (m.startsWith("ollama:")) return VENTANA_LOCAL;
  if (m.startsWith("gemini-") || /^agy:gemini/.test(m)) return VENTANA_AGY;
  return null;
}
