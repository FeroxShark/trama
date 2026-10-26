// Lo que comparten las pruebas de opencode (puente de líder, runner de workers): encontrar un `opencode` de verdad y armarle un
// entorno aislado con un proveedor OpenAI-compatible falso (scripts/openai-falso.mjs) por `OPENCODE_CONFIG_CONTENT`. Nunca toca el
// `~` ni el login reales de OpenCode. No es una prueba.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/** El `opencode` para las pruebas: `TRAMA_OPENCODE_BIN`, el de `app/node_modules`, o el del PATH. `null`: se saltean. */
export function buscarOpencode(): string | null {
  const candidatos = [
    process.env.TRAMA_OPENCODE_BIN,
    path.join(import.meta.dirname, "..", "node_modules", ".bin", "opencode"),
    ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, "opencode")),
  ];
  return candidatos.find((c): c is string => !!c && existsSync(c)) ?? null;
}

export const OPENCODE = buscarOpencode();
/** Para `{ skip: SIN_OPENCODE }`: el motivo si no hay opencode, `false` si lo hay. */
export const SIN_OPENCODE: string | false = OPENCODE ? false : "no hay un binario `opencode` (npm i opencode-ai, o TRAMA_OPENCODE_BIN=<ruta>)";

/** El id del modelo falso en las pruebas: `opencode:falso/fake-model`. */
export const MODELO_FALSO = "opencode:falso/fake-model";

/**
 * El entorno de un `opencode` aislado: HOME y XDG_* en `home`, sin actualizaciones ni descarga del catálogo de modelos (models.dev),
 * y un proveedor `falso` (OpenAI-compatible) que apunta al servidor falso `baseURL`.
 */
export function entornoOpencodeTmp(home: string, baseURL: string): Record<string, string> {
  for (const d of ["config", "data", "cache", "state"]) mkdirSync(path.join(home, ".xdg", d), { recursive: true });
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".xdg", "config"),
    XDG_DATA_HOME: path.join(home, ".xdg", "data"),
    XDG_CACHE_HOME: path.join(home, ".xdg", "cache"),
    XDG_STATE_HOME: path.join(home, ".xdg", "state"),
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      autoupdate: false,
      share: "disabled",
      provider: { falso: { npm: "@ai-sdk/openai-compatible", name: "Falso", options: { baseURL, apiKey: "x" }, models: { "fake-model": { name: "Fake", tool_call: true } } } },
    }),
  };
}
