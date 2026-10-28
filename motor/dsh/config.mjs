// DeepSeek Harness (`dsh`, npm `@deepseek-ai/dsh`) como motor de Trama: la configuración que `dsh` necesita para correr
// modelos gratis (Ollama local, OpenCode Zen) o con API (DeepSeek). Sin dependencias y sin importar nada de app/ (pa
// corre sin la app). OJO: app/electron/dsh.ts duplica esto A PROPÓSITO (es TypeScript y vive en el bundle de la app);
// si cambia uno, cambia el otro (tests/dsh-correr.test.ts y tests/dsh-puente.test.ts cubren cada uno).
//
// Convención de modelo en Trama: `dsh:<proveedor>/<modelo>`, p. ej. `dsh:ollama/qwen2.5-coder:7b`,
// `dsh:opencode/big-pickle`, `dsh:deepseek/deepseek-v4-flash`. El modelo puede llevar `:` y `/` (se parte en la primera `/`).
//
// Qué se le dice a dsh (un parche `--patch <archivo>` de cordis, verificado contra dsh 0.2.1-rc.2):
//   ollama    ruta propia `ollama` (api openai-completions, baseURL …:11434/v1, apiKeyEnv OLLAMA_API_KEY con un valor
//             cualquiera: Ollama no valida la key pero dsh exige que exista). Los modelos hay que listarlos.
//   opencode  ruta propia `opencode-trama` (api openai-completions, baseURL https://opencode.ai/inference/v1, apiKeyEnv
//             OPENCODE_API_KEY; sin key, "public" para los gratis). No se usa el `opencode` del catálogo de pi-ai: hay
//             instalaciones de dsh sin ese adaptador («no adapter registered for provider "opencode"»).
//   deepseek  `deepseek-official` (el default de dsh), key en `DEEPSEEK_API_KEY`.
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROVEEDORES = ["ollama", "opencode", "deepseek"];
export const OLLAMA_URL = "http://127.0.0.1:11434/v1";
export const OPENCODE_URL = "https://opencode.ai/inference/v1";
/** La ruta con la que dsh conoce a cada proveedor. */
const RUTA = { ollama: "ollama", opencode: "opencode-trama", deepseek: "deepseek-official" };

/** `dsh:<proveedor>/<modelo>` → `{ proveedor, modelo }`; `null` si no es de dsh o está mal armado. */
export function parsearModelo(id) {
  if (typeof id !== "string" || !id.startsWith("dsh:")) return null;
  const resto = id.slice(4);
  const i = resto.indexOf("/");
  if (i <= 0) return null;
  const proveedor = resto.slice(0, i);
  const modelo = resto.slice(i + 1);
  if (!PROVEEDORES.includes(proveedor) || !modelo.trim()) return null;
  return { proveedor, modelo };
}

export const formatearModelo = (proveedor, modelo) => `dsh:${proveedor}/${modelo}`;
export const esModeloDsh = (id) => parsearModelo(id) !== null;

const q = (s) => JSON.stringify(String(s)); // un string JSON es un escalar YAML válido

/**
 * El contenido de `cordis.patch.yml` para `--patch`. `agent-default-model` es lo que usa headless; `acp` es la selección
 * inicial de `session/new` (y el respaldo de `session/resume`).
 * @param {{ proveedor: string, modelo: string, baseURL?: string, imagenes?: boolean, contexto?: number }} c
 */
export function escribirParche(c) {
  if (!PROVEEDORES.includes(c.proveedor)) throw new Error(`dsh: proveedor desconocido «${c.proveedor}» (${PROVEEDORES.join(", ")})`);
  if (!c.modelo || !String(c.modelo).trim()) throw new Error("dsh: falta el modelo");
  const ruta = RUTA[c.proveedor];
  const l = [];
  if (c.proveedor === "ollama" || c.proveedor === "opencode") {
    const [url, clave] = c.proveedor === "ollama" ? [OLLAMA_URL, "OLLAMA_API_KEY"] : [OPENCODE_URL, "OPENCODE_API_KEY"];
    l.push("- id: llm-pi-ai", "  config:", "    providers:", `      ${ruta}:`, "        api: openai-completions");
    l.push(`        baseURL: ${q(c.baseURL || url)}`, `        apiKeyEnv: ${clave}`, "        models:");
    l.push(`          - id: ${q(c.modelo)}`, `            name: ${q(c.modelo)}`, `            input: [${c.imagenes ? "text, image" : "text"}]`);
    if (c.contexto) l.push(`            contextWindow: ${Math.trunc(c.contexto)}`);
  } else if (c.baseURL) {
    // Un gateway propio para un proveedor del catálogo (sólo cambia la URL; la key sigue saliendo del entorno).
    l.push("- id: llm-pi-ai", "  config:", "    providers:", `      ${ruta}:`, `        baseURL: ${q(c.baseURL)}`);
  }
  for (const id of ["agent-default-model", "acp"]) l.push(`- id: ${id}`, "  config:", `    provider: ${ruta}`, `    model: ${q(c.modelo)}`);
  return l.join("\n") + "\n";
}

/** El valor de `session/set_config_option` (`configId: "model"`): un string JSON de `[ruta, modelo]`. */
export const valorModeloAcp = (proveedor, modelo) => JSON.stringify([RUTA[proveedor], modelo]);

/** `$XDG_DATA_HOME/trama/dsh` (default `~/.local/share/trama/dsh`): el DSH_HOME propio de Trama, aparte del `~/.dsh` del usuario. */
export function dirDsh(env = process.env, home = os.homedir()) {
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "trama", "dsh");
}

/**
 * El entorno con el que correr `dsh`: DSH_HOME propio, modo de permisos `workspace-write` (escribe sólo bajo el cwd) y la key
 * del proveedor. `DSH_HOME` ya puesto en `env` gana (las pruebas apuntan a un tmp).
 */
export function entornoDsh(proveedor, env = process.env, home = os.homedir()) {
  const e = { ...env };
  e.DSH_HOME = env.DSH_HOME || dirDsh(env, home);
  e.DSH_PERMISSION_MODE = env.DSH_PERMISSION_MODE || "workspace-write";
  if (proveedor === "ollama") e.OLLAMA_API_KEY = env.OLLAMA_API_KEY || "ollama";
  // OpenCode Zen: sus modelos gratis andan con la key pública; una propia (OPENCODE_API_KEY) tiene prioridad.
  else if (proveedor === "opencode") e.OPENCODE_API_KEY = env.OPENCODE_API_KEY || "public";
  return e;
}

/** ¿Falta la key que el proveedor necesita? Devuelve el nombre de la variable, o `null` si está todo. */
export const falta = (proveedor, env = process.env) => (proveedor === "deepseek" && !env.DEEPSEEK_API_KEY ? "DEEPSEEK_API_KEY" : null);

/** ¿El error de dsh/OpenCode es de cuota o de límite de uso (HTTP 429, `QUOTA`, `FreeUsageLimitError`)? */
export const esErrorCuota = (texto) => /\bQUOTA\b|FreeUsageLimitError|\b429\b\s*[:\-]\s*(?:\{|Too Many|rate|quota|free)|(?:HTTP|status|code)\W{0,3}429\b/i.test(texto);

/** Qué decirle a la persona cuando OpenCode corta por cuota: sin clave propia es el cupo gratis COMPARTIDO de la clave pública. */
export const mensajeCuotaOpencode = (conClave) =>
  conClave
    ? "OpenCode: tu clave llegó al límite de uso. Esperá un rato o revisá tu plan en opencode.ai, o probá con otro modelo."
    : "OpenCode: se terminó el uso gratis de la clave pública. Creá una clave gratis en opencode.ai (Console → Settings → API keys / Service accounts, con permiso de sólo lectura) y pegala en Ajustes → DeepSeek Harness.";

const ejecutable = (f) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * El binario `dsh`: `HILOS_DSH`, el PATH, `~/.local/bin`, el prefijo de la instalación de Trama y el prefijo global de npm
 * (`npm_config_prefix`, `~/.npm-global`, `/usr/local`, la carpeta de node). En Windows npm deja `dsh.cmd` en la RAÍZ del prefijo
 * (`<casa>\.local`) y en `%APPDATA%\npm`, no en `bin\`. Sin nada: `dsh` pelado. Igual que `resolverDsh` de app/electron/dsh.ts.
 */
export function resolverDsh(env = process.env, home = os.homedir(), esEjecutable = ejecutable, plat = process.platform === "win32" ? "win32" : "linux") {
  if (env.HILOS_DSH) return env.HILOS_DSH;
  const c = plat === "win32" ? path.win32 : path.posix;
  const nombres = plat === "win32" ? ["dsh.cmd", "dsh.exe", "dsh"] : ["dsh"];
  const dirs = (env.PATH ?? env.Path ?? "").split(c.delimiter).filter(Boolean);
  dirs.push(c.join(home, ".local", "bin"));
  if (plat === "win32") dirs.push(c.join(home, ".local"), ...(env.APPDATA ? [c.join(env.APPDATA, "npm")] : []), c.join(home, "AppData", "Roaming", "npm"));
  if (env.npm_config_prefix) dirs.push(plat === "win32" ? env.npm_config_prefix : c.join(env.npm_config_prefix, "bin"));
  dirs.push(c.join(home, ".npm-global", "bin"), "/usr/local/bin", c.dirname(process.execPath));
  for (const d of dirs) for (const n of nombres) if (esEjecutable(c.join(d, n))) return c.join(d, n);
  return "dsh";
}

/**
 * Cómo lanzar `dsh`: en Windows un `.cmd` de npm no se ejecuta directo (EINVAL), va por cmd.exe con los argumentos tal cual
 * (`windowsVerbatimArguments`). En Linux, igual que siempre. Igual que `paraLanzar` de app/electron/binario.ts.
 */
export function lanzarDsh(cmd, args, env = process.env, plat = process.platform === "win32" ? "win32" : "linux") {
  if (plat !== "win32" || !/\.(cmd|bat)$/i.test(cmd)) return { file: cmd, args, verbatim: false };
  const arg = (a) => {
    if (/["%\r\n]/.test(a)) throw new Error(`argumento no apto para cmd.exe: ${JSON.stringify(String(a).slice(0, 40))}`);
    return a === "" || /[\s&|<>^()!,;=]/.test(a) ? `"${a}"` : a;
  };
  return { file: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${[cmd, ...args].map(arg).join(" ")}"`], verbatim: true };
}

