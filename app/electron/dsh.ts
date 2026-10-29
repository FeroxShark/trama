// DeepSeek Harness (`dsh`, npm `@deepseek-ai/dsh`) como motor de Trama: la configuración que `dsh` necesita para correr
// modelos gratis (Ollama local, OpenCode Zen) o con API (DeepSeek). Sin Electron. DUPLICA A PROPÓSITO motor/dsh/config.mjs
// (el runner de workers de `pa` no puede importar nada de app/): si cambia uno, cambia el otro.
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
// Modelo LOCAL (ollama): además, `maxTokens` 8192 en el modelo y `compaction-basic` con headroom chico (1024). El default de
// dsh (headroom 65536, maxTokens por modelo 32768) con una ventana de 32k da umbral negativo y nunca compacta.
import { accessSync, constants, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolverNpm } from "./binario.ts";
import { caminoDe, configTrama, type Plataforma, plataformaActual } from "./rutas.ts";

export const PROVEEDORES = ["ollama", "opencode", "deepseek"] as const;
export type ProveedorDsh = (typeof PROVEEDORES)[number];
export const OLLAMA_URL = "http://127.0.0.1:11434/v1";
export const OPENCODE_URL = "https://opencode.ai/inference/v1";
/** La ruta con la que dsh conoce a cada proveedor. */
const RUTA: Record<ProveedorDsh, string> = { ollama: "ollama", opencode: "opencode-trama", deepseek: "deepseek-official" };

type Env = Record<string, string | undefined>;

export type ConfigDsh = {
  proveedor: ProveedorDsh;
  modelo: string;
  /** Otra URL para el proveedor (Ollama en otra máquina, un gateway). */
  baseURL?: string;
  /** El modelo (de Ollama) acepta imágenes: se declara `input: [text, image]` y dsh anuncia `promptCapabilities.image`. */
  imagenes?: boolean;
  /** Ventana de contexto del modelo de Ollama (default de dsh: 262144, más de lo que casi cualquier local carga). */
  contexto?: number;
};

const esProveedor = (s: string): s is ProveedorDsh => (PROVEEDORES as readonly string[]).includes(s);

/** `dsh:<proveedor>/<modelo>` → `{ proveedor, modelo }`; `null` si no es de dsh o está mal armado. */
export function parsearModelo(id: unknown): { proveedor: ProveedorDsh; modelo: string } | null {
  if (typeof id !== "string" || !id.startsWith("dsh:")) return null;
  const resto = id.slice(4);
  const i = resto.indexOf("/");
  if (i <= 0) return null;
  const proveedor = resto.slice(0, i);
  const modelo = resto.slice(i + 1);
  if (!esProveedor(proveedor) || !modelo.trim()) return null;
  return { proveedor, modelo };
}

export const formatearModelo = (proveedor: ProveedorDsh, modelo: string) => `dsh:${proveedor}/${modelo}`;
export const esModeloDsh = (id: unknown) => parsearModelo(id) !== null;

const q = (s: unknown) => JSON.stringify(String(s)); // un string JSON es un escalar YAML válido

/** Lo que se le pone a un modelo local (ollama): tope de salida del modelo y autocompact para una ventana chica. */
export const LOCAL = {
  maxTokens: 8192,
  compactacion: { thresholdRatio: 0.75, headroomTokens: 1024, maxTokens: 4096 },
} as const;

/**
 * El `contextWindow` real de un modelo local: el `LLAMA_CTX` (el `-c` de la unit) de su env file `<carpeta locales>/<clave>.env`.
 * La clave es la de la entrada de `locales.json` que sirve ese modelo (`alias`, o `id` si no lo tiene); sin entrada, el nombre del
 * modelo. `null` si no hay dato. Igual que `contextoLocal` de motor/dsh/config.mjs (las rutas, como `configTrama` de rutas.ts).
 */
export function contextoLocal(modelo: string, env: Env = process.env, plat: Plataforma = plataformaActual()): number | null {
  const c = caminoDe(plat);
  let clave = modelo;
  try {
    const decl = JSON.parse(readFileSync(env.HILOS_LOCALES_JSON || c.join(configTrama(env, undefined, plat), "locales.json"), "utf8"));
    const m = decl?.version === 1 && Array.isArray(decl.modelos) ? decl.modelos.find((x: any) => x && (x.alias ?? x.id) === modelo) : null;
    if (m && typeof (m.clave ?? m.id) === "string") clave = m.clave ?? m.id;
  } catch {
    /* sin locales.json (o roto): el nombre del modelo */
  }
  if (!/^\w[\w.-]*$/.test(clave)) return null;
  try {
    const carpeta = env.HILOS_LOCALES_DIR || c.join(configTrama(env, undefined, plat), "locales");
    const n = readFileSync(c.join(carpeta, `${clave}.env`), "utf8").match(/^LLAMA_CTX=(\d+)\s*$/m);
    return n ? Number(n[1]) : null;
  } catch {
    return null;
  }
}

/**
 * El contenido de `cordis.patch.yml` para `--patch`. `agent-default-model` es lo que usa headless; `acp` es la selección
 * inicial de `session/new` (y el respaldo de `session/resume`). Con `ollama` (local) va además el ajuste de autocompact de `LOCAL`.
 */
export function escribirParche(c: ConfigDsh): string {
  if (!esProveedor(c.proveedor)) throw new Error(`dsh: proveedor desconocido «${String(c.proveedor)}» (${PROVEEDORES.join(", ")})`);
  if (!c.modelo || !String(c.modelo).trim()) throw new Error("dsh: falta el modelo");
  const ruta = RUTA[c.proveedor];
  const local = c.proveedor === "ollama";
  const l: string[] = [];
  if (c.proveedor === "ollama" || c.proveedor === "opencode") {
    const [url, clave] = c.proveedor === "ollama" ? [OLLAMA_URL, "OLLAMA_API_KEY"] : [OPENCODE_URL, "OPENCODE_API_KEY"];
    l.push("- id: llm-pi-ai", "  config:", "    providers:", `      ${ruta}:`, "        api: openai-completions");
    l.push(`        baseURL: ${q(c.baseURL || url)}`, `        apiKeyEnv: ${clave}`, "        models:");
    l.push(`          - id: ${q(c.modelo)}`, `            name: ${q(c.modelo)}`, `            input: [${c.imagenes ? "text, image" : "text"}]`);
    if (c.contexto) l.push(`            contextWindow: ${Math.trunc(c.contexto)}`);
    if (local) l.push(`            maxTokens: ${LOCAL.maxTokens}`);
  } else if (c.baseURL) {
    // Un gateway propio para un proveedor del catálogo (sólo cambia la URL; la key sigue saliendo del entorno).
    l.push("- id: llm-pi-ai", "  config:", "    providers:", `      ${ruta}:`, `        baseURL: ${q(c.baseURL)}`);
  }
  if (local) {
    const k = LOCAL.compactacion;
    l.push("- id: compaction-basic", "  config:", `    thresholdRatio: ${k.thresholdRatio}`, `    headroomTokens: ${k.headroomTokens}`, `    maxTokens: ${k.maxTokens}`);
  }
  for (const id of ["agent-default-model", "acp"]) l.push(`- id: ${id}`, "  config:", `    provider: ${ruta}`, `    model: ${q(c.modelo)}`);
  return l.join("\n") + "\n";
}

/** El valor de `session/set_config_option` (`configId: "model"`): un string JSON de `[ruta, modelo]`. */
export const valorModeloAcp = (proveedor: ProveedorDsh, modelo: string) => JSON.stringify([RUTA[proveedor], modelo]);

/** `$XDG_DATA_HOME/trama/dsh` (default `~/.local/share/trama/dsh`): el DSH_HOME propio de Trama, aparte del `~/.dsh` del usuario. */
export function dirDsh(env: Env = process.env, home: string = os.homedir()): string {
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "trama", "dsh");
}

/**
 * El entorno con el que correr `dsh`: DSH_HOME propio, modo de permisos `workspace-write` (escribe sólo bajo el cwd) y la key
 * del proveedor. `DSH_HOME` ya puesto en `env` gana (las pruebas apuntan a un tmp).
 */
export function entornoDsh(proveedor: ProveedorDsh, env: Env = process.env, home: string = os.homedir()): Env {
  const e: Env = { ...env };
  e.DSH_HOME = env.DSH_HOME || dirDsh(env, home);
  e.DSH_PERMISSION_MODE = env.DSH_PERMISSION_MODE || "workspace-write";
  if (proveedor === "ollama") e.OLLAMA_API_KEY = env.OLLAMA_API_KEY || "ollama";
  // OpenCode Zen: sus modelos gratis andan con la key pública; una propia (OPENCODE_API_KEY) tiene prioridad.
  else if (proveedor === "opencode") e.OPENCODE_API_KEY = env.OPENCODE_API_KEY || "public";
  return e;
}

/** ¿Falta la key que el proveedor necesita? Devuelve el nombre de la variable, o `null` si está todo. */
export const falta = (proveedor: ProveedorDsh, env: Env = process.env): string | null => (proveedor === "deepseek" && !env.DEEPSEEK_API_KEY ? "DEEPSEEK_API_KEY" : null);

/** ¿El error de dsh/OpenCode es de cuota o de límite de uso (HTTP 429, `QUOTA`, `FreeUsageLimitError`)? */
export const esErrorCuota = (texto: string): boolean => /\bQUOTA\b|FreeUsageLimitError|Free usage limit|provider\.free-limit|\b429\b\s*[:\-]\s*(?:\{|Too Many|rate|quota|free)|(?:HTTP|status|code)\W{0,3}429\b/i.test(texto);

/** Qué decirle a la persona cuando OpenCode corta por cuota: sin clave propia es el cupo gratis COMPARTIDO de la clave pública. */
export const mensajeCuotaOpencode = (conClave: boolean): string =>
  conClave
    ? "OpenCode: tu clave llegó al límite de uso. Esperá un rato o revisá tu plan en opencode.ai, o probá con otro modelo."
    : "OpenCode: se terminó el uso gratis de la clave pública. Creá una clave gratis en opencode.ai (Console → Settings → API keys / Service accounts, con permiso de sólo lectura) y pegala en Ajustes → DeepSeek Harness.";

const ejecutable = (f: string) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * El `--prefix` con el que se instala dsh (`~/.local`, la casa del usuario + `.local`). Es el mismo en Linux y Windows, pero en Windows npm
 * deja `dsh.cmd` en la RAÍZ del prefijo (`<casa>\.local\dsh.cmd`), no en `bin\`: por eso se busca ahí también.
 */
export const prefijoDsh = (home: string, plat: Plataforma = plataformaActual()): string => caminoDe(plat).join(home, ".local");

/** El binario `dsh`: `HILOS_DSH`, el PATH, `~/.local/bin`, el prefijo de la instalación de Trama (en Windows, su raíz) y el prefijo global de npm (`npm_config_prefix`, `%APPDATA%\npm`, `~/.npm-global`, `/usr/local`, la carpeta de node). Sin nada: `dsh` pelado. */
export function resolverDsh(env: Env = process.env, home: string = os.homedir(), esEjecutable: (f: string) => boolean = ejecutable, plat: Plataforma = plataformaActual()): string {
  if (env.HILOS_DSH) return env.HILOS_DSH;
  const extra = [caminoDe(plat).join(home, ".local", "bin"), ...(plat === "win32" ? [prefijoDsh(home, plat)] : [])];
  return resolverNpm("dsh", env, home, extra, esEjecutable, plat);
}
