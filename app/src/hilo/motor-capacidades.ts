// Qué trae cada motor del selector de modelo (la línea de debajo de la lista): skills, MCP, subagentes e imágenes. Una tabla por
// motor, sin React; la pinta el selector y la prueba tests/motor-capacidades.test.ts. Confirmadas contra los binarios y protocolos
// de esta máquina (agy, dsh, opencode, claude).
import type { Empresa } from "./modelos.ts";

export type Motor = "claude" | "agy" | "dsh" | "opencode" | "local";
export type Capacidad = "skills" | "mcp" | "subagentes" | "imagenes";

/** En el orden en que la línea las muestra. */
export const CAPACIDADES: readonly Capacidad[] = ["skills", "mcp", "subagentes", "imagenes"];

export const MOTORES: Readonly<Record<Motor, Readonly<Record<Capacidad, boolean>>>> = {
  // Claude Code: las skills, los conectores MCP (Ajustes > Conectores) y la herramienta Agent; las imágenes van como bloques nativos.
  claude: { skills: true, mcp: true, subagentes: true, imagenes: true },
  // agy (Gemini): expone las skills de sus plugins (electron/agy-puente.ts); sin MCP («no disponible», AGENTS.md);
  // subagentes nativos en agy (invoke_subagent en el binario); las imágenes se guardan y las lee con view_file (agy-puente.ts).
  agy: { skills: true, mcp: false, subagentes: true, imagenes: true },
  // DeepSeek Harness: skills nativas (@deepseek-ai/dsh-skill-filesystem); conectores MCP por ACP (dsh-puente.ts);
  // subagentes nativos (@deepseek-ai/dsh-tool-subagent); sin imágenes (la API de DeepSeek es de texto y ACP declara image: false).
  dsh: { skills: true, mcp: true, subagentes: true, imagenes: false },
  // OpenCode (su programa, por el mismo puente ACP que dsh): skills nativas en su config; MCP según ACP;
  // subagentes nativos (Explore, fork en ACP); imágenes nativas (promptCapabilities.image: true en ACP).
  opencode: { skills: true, mcp: true, subagentes: true, imagenes: true },
  // Lo local (llama-server y Ollama) corre con Claude Code contra otro destino: las mismas herramientas, pero la imagen depende de cada modelo.
  local: { skills: true, mcp: true, subagentes: true, imagenes: false },
};

/** El motor de cada columna del selector (`Opcion.col`, que es la empresa del modelo). */
export const MOTOR_DE_EMPRESA: Readonly<Record<Empresa, Motor>> = {
  anthropic: "claude",
  google: "agy",
  dsh: "dsh",
  opencode: "opencode",
  local: "local",
  ollama: "local",
};

/** Las capacidades de un motor, en el orden de `CAPACIDADES`: `[capacidad, sí o no]`. */
export const capacidadesDe = (motor: Motor): [Capacidad, boolean][] => CAPACIDADES.map((c) => [c, MOTORES[motor][c]]);

/** El motor de una columna del selector; `null` si no es una empresa conocida. */
export const motorDeEmpresa = (empresa: string | null | undefined): Motor | null => (empresa && Object.hasOwn(MOTOR_DE_EMPRESA, empresa) ? MOTOR_DE_EMPRESA[empresa as Empresa] : null);
