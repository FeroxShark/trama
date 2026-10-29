// Antes de lanzar otro motor: ¿está el programa, la sesión, la key, el servidor local? Cada `chequear` devuelve el motivo de la
// caída (vacío = va), como `motivo_cae` en motor/bin/pa (gemini_chequear, codex_chequear, dsh_chequear, opencode_chequear,
// plugin_cargado, dsh_clave, dsh_bin, opencode_bin, local_de, local_estado). El cupo no se mira acá: lo elige reparto.
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { paraLanzar } from "../../../binario.ts";
import { caminoDe, carpetaApp, configTrama, homeDe, plataformaActual, type Plataforma } from "../../../rutas.ts";
import { enPath, esEjecutable } from "../../base/buscar.ts";
import { instalarPluginAgy } from "../../plugin-agy.ts";
import { rutaReal, resolverProyecto } from "../../proyecto-ruta.ts";
import type { Env } from "../entorno.ts";
import { carpetaMotor } from "../entorno.ts";
import { calza, dshGratis, dshModeloDe, dshProveedor, esNvidia, esOpencode, OC_MODELOS } from "./modelos.ts";
import { privacidad } from "./privacidad.ts";

/** Las rutas de los runners y los shims (PA_DSH_CORRER, PA_OPENCODE_CORRER, PA_CODEX_SHIMS o los de motor/). */
export const dshCorrer = (env: Env) => env.PA_DSH_CORRER || path.join(carpetaMotor(env), "dsh", "correr.mjs");
export const opencodeCorrer = (env: Env) => env.PA_OPENCODE_CORRER || path.join(carpetaMotor(env), "opencode", "correr.mjs");
export const codexShims = (env: Env) => env.PA_CODEX_SHIMS || path.join(carpetaMotor(env), "codex", "bin");
/** `$TRAMA_CLAVES` o `$XDG_CONFIG_HOME/trama/claves.env` (el contrato con la app). */
export const clavesEnv = (env: Env, plat: Plataforma = plataformaActual()) => env.TRAMA_CLAVES || path.join(configTrama(env, homeDe(env, plat), plat), "claves.env");

/** La key de un proveedor: el entorno primero y, si no, claves.env (NOMBRE=valor, sin `source`, con o sin comillas). */
export function dshClave(nombre: string, env: Env, plat: Plataforma = plataformaActual()): string {
  if (nombre !== "OPENCODE_API_KEY" && nombre !== "DEEPSEEK_API_KEY" && nombre !== "NVIDIA_API_KEY") return "";
  let v = env[nombre] ?? "";
  const f = clavesEnv(env, plat);
  if (!v && existsSync(f)) {
    let txt = "";
    try {
      txt = readFileSync(f, "utf8");
    } catch {
      txt = "";
    }
    const ls = txt.split("\n");
    if (ls[ls.length - 1] === "") ls.pop();
    const re = new RegExp(`^[ \\t\\n\\v\\f\\r]*(export[ \\t\\n\\v\\f\\r]+)?${nombre}[ \\t\\n\\v\\f\\r]*=[ \\t\\n\\v\\f\\r]*(.*)$`);
    for (let l of ls) {
      l = l.replace(/\r$/, "");
      const m = re.exec(l);
      if (!m) continue;
      v = m[2]!.replace(/[ \t\n\v\f\r]+$/, "");
      const q = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v);
      if (q) v = q[1]!;
    }
    if (!/^[A-Za-z0-9._~+/=:-]+$/.test(v)) v = "";
  }
  return v;
}

/** Un binario: la variable que lo fija (si está, sólo ella), el PATH y después las carpetas de instalación de siempre. */
function binario(nombre: string, fijo: string | undefined, extra: string[], env: Env, plat: Plataforma): string {
  if (fijo) return esEjecutable(fijo, plat) ? fijo : "";
  return enPath(nombre, extra, env, plat) ?? "";
}
const carpetasNpm = (env: Env, home: string, plat: Plataforma = plataformaActual()) => {
  const c = caminoDe(plat);
  return [c.join(home, ".local", "bin"), ...(env.npm_config_prefix ? [c.join(env.npm_config_prefix, "bin")] : []), c.join(home, ".npm-global", "bin"), "/usr/local/bin"];
};
/**
 * Las carpetas donde buscar dsh además del PATH. Linux: `~/.local/bin` y el prefijo global de npm. Windows: también la raíz del prefijo de
 * la instalación (`<casa>\.local\dsh.cmd`) y `%APPDATA%\npm`: npm no deja los `.cmd` en `bin\`.
 */
export function dirsDsh(env: Env, home: string, plat: Plataforma = plataformaActual()): string[] {
  if (plat !== "win32") return carpetasNpm(env, home, plat);
  const c = path.win32;
  return [c.join(home, ".local", "bin"), c.join(home, ".local"), ...(env.npm_config_prefix ? [env.npm_config_prefix] : []), c.join(env.APPDATA || c.join(home, "AppData", "Roaming"), "npm")];
}
/** El binario dsh: HILOS_DSH, el PATH y `dirsDsh`. "" si no está. */
export const dshBin = (env: Env, plat: Plataforma = plataformaActual()) => binario("dsh", env.HILOS_DSH, dirsDsh(env, homeDe(env, plat), plat), env, plat);
/** El binario opencode: HILOS_OPENCODE, el PATH, ~/.opencode/bin (su instalador), y los de dsh. "" si no está. */
export const opencodeBin = (env: Env, plat: Plataforma = plataformaActual()) => {
  const home = homeDe(env, plat);
  return binario("opencode", env.HILOS_OPENCODE, [path.join(home, ".opencode", "bin"), ...carpetasNpm(env, home, plat)], env, plat);
};

// ---------------------------------------------------------------- Ollama

export interface Local {
  id: string;
  url: string;
  modelo: string;
  nombre?: string;
}
/** Un id ollama:… → url, modelo y nombre: de `locales` de modelos.json o, si no está, el Ollama de siempre (OLLAMA_HOST). */
export function localDe(id: string, locales: Local[] | null, env: Env): { url: string; modelo: string; nombre: string } {
  const l = locales?.find((x) => x.id === id);
  // `${r%/}` del bash: le saca una barra al final de la línea (el nombre), no a la url.
  if (l) return { url: l.url, modelo: l.modelo, nombre: (l.nombre || l.modelo).replace(/\/$/, "") };
  let u = env.OLLAMA_HOST || "http://localhost:11434";
  if (!u.startsWith("http")) u = `http://${u}`;
  const m = id.startsWith("ollama:") ? id.slice("ollama:".length) : id;
  return { url: u, modelo: m, nombre: m.replace(/\/$/, "") };
}

/** `<url>/api/tags` (null si no contesta o no es 2xx). */
export async function localTags(url: string, env: Env): Promise<string | null> {
  const s = Number(env.PA_LOCAL_CHEQUEO_S) > 0 ? Number(env.PA_LOCAL_CHEQUEO_S) : 3;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(s * 1000) });
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}
/** "ok" o el motivo de por qué el servidor no sirve (no contesta, no tiene el modelo). */
export async function localEstado(url: string, modelo: string, env: Env): Promise<string> {
  const t = await localTags(url, env);
  if (t === null) return `el servidor ${url} no responde (${url}/api/tags)`;
  let j: unknown;
  try {
    j = JSON.parse(t);
  } catch {
    return "ok";
  }
  const ms = (j as { models?: unknown } | null)?.models;
  if (Array.isArray(ms)) {
    const nombres = ms.flatMap((x) => [(x as Record<string, unknown> | null)?.name, (x as Record<string, unknown> | null)?.model]);
    if (!nombres.some((n) => n === modelo || n === `${modelo}:latest`)) return `el servidor ${url} no tiene el modelo '${modelo}' (ollama pull ${modelo})`;
  }
  return "ok";
}

// ---------------------------------------------------------------- privacidad + programa

/** La carpeta real del proyecto (`realpath -m "$(proyecto-ruta X)"`), o "" si no se encuentra. */
function rutaProyecto(proyecto: string, env: Env): string {
  try {
    const r = resolverProyecto(proyecto, env);
    return r.ok ? (rutaReal(r.ruta) ?? path.resolve(r.ruta)) : "";
  } catch {
    return "";
  }
}
const privacidadDe = (proyecto: string, tarea: string, destino: string, env: Env) => {
  const r = rutaProyecto(proyecto, env);
  return r ? privacidad(r, tarea, destino) : "";
};

/** ¿El json de `agy -p /hooks` dice que el hook pa-worker está cargado y habilitado (con su PreToolUse)? */
export function pluginCargado(json: string): boolean {
  try {
    const hooks = (JSON.parse(json) as { command?: { data?: { hooks?: unknown } } } | null)?.command?.data?.hooks;
    if (!Array.isArray(hooks)) return false;
    return hooks.some(
      (h) => h?.name === "pa-worker" && h.enabled !== false && Array.isArray(h.actions) && h.actions.some((a: { event?: unknown } | null) => a?.event === "PreToolUse"),
    );
  } catch {
    return false;
  }
}

/** Datos comunes de un chequeo: el proyecto y la tarea (privacidad), el entorno y el de la cuenta (agy corre /hooks con su HOME). */
export interface DatosChequeo {
  proyecto: string;
  tarea: string;
  env: Env;
  /** El entorno del proceso del worker con la cuenta aplicada (default: `env`). */
  envCuenta?: Env;
  plat?: Plataforma;
  /** `spawnSync` y `enPath` (los tests los reemplazan). */
  spawn?: typeof spawnSync;
  buscar?: (nombre: string) => string | null;
  /** Windows: deja el plugin pa-worker de agy en su lugar (default: `instalarPluginAgy` con los hooks de la app instalada). */
  repararPlugin?: () => void;
}

/**
 * Corre un programa del PATH (agy, codex) sin el `shell` de Node (DEP0190: con args se pegan sin escapar). Un `.exe` va directo; el `.cmd`
 * de npm en Windows va por `cmd.exe /d /s /c "…"` con los argumentos entre comillas (`paraLanzar`).
 */
function correr(bin: string, args: string[], opciones: SpawnSyncOptions, d: DatosChequeo, plat: Plataforma): SpawnSyncReturns<string | Buffer> {
  const l = paraLanzar(bin, args, d.envCuenta ?? d.env, plat);
  return (d.spawn ?? spawnSync)(l.file, l.args, { ...opciones, ...(l.verbatim ? { windowsVerbatimArguments: true } : {}), windowsHide: true });
}

/** Windows: al no estar el plugin se intenta dejarlo (agy pudo instalarse después de Trama); nunca tira. */
function repararPluginAgy(d: DatosChequeo, plat: Plataforma): void {
  try {
    if (d.repararPlugin) return d.repararPlugin();
    const home = homeDe(d.env, plat);
    instalarPluginAgy({ hooks: path.join(carpetaApp(d.env, home, plat), "hooks"), home });
  } catch {
    /* si no se pudo, el chequeo sigue diciendo que falta */
  }
}

/** Gemini (agy): privacidad, agy en el PATH y el plugin pa-worker cargado. */
export function chequearAgy(d: DatosChequeo): string {
  const plat = d.plat ?? plataformaActual();
  const m = privacidadDe(d.proyecto, d.tarea, "Google", d.env);
  if (m) return m;
  const bin = (d.buscar ?? ((n) => enPath(n, [], d.env, plat)))("agy");
  if (!bin) return "agy no está en el PATH";
  const s = Number(d.env.PA_AGY_CHEQUEO_S) > 0 ? Number(d.env.PA_AGY_CHEQUEO_S) : 40;
  const hooks = () => String(correr(bin, ["-p", "/hooks", "--output-format", "json"], { env: d.envCuenta ?? d.env, encoding: "utf8", timeout: s * 1000, stdio: ["ignore", "pipe", "ignore"] }, d, plat).stdout ?? "");
  let json = hooks();
  if (!pluginCargado(json) && plat === "win32") {
    repararPluginAgy(d, plat);
    json = hooks();
  }
  if (!pluginCargado(json))
    return plat === "win32"
      ? "el plugin pa-worker de agy no está cargado (sin él no hay guardias; reabrí o reinstalá Trama para que lo deje en su lugar)"
      : "el plugin pa-worker de agy no está cargado (sin él no hay guardias: correr motor/scripts/instalar-producto.sh)";
  return "";
}

/** ChatGPT (codex): privacidad, codex en el PATH y sesión iniciada. */
export function chequearCodex(d: DatosChequeo): string {
  const plat = d.plat ?? plataformaActual();
  const m = privacidadDe(d.proyecto, d.tarea, "OpenAI", d.env);
  if (m) return m;
  const bin = (d.buscar ?? ((n) => enPath(n, [], d.env, plat)))("codex");
  if (!bin) return "codex no está en el PATH (npm install -g @openai/codex)";
  const s = Number(d.env.PA_CODEX_CHEQUEO_S) > 0 ? Number(d.env.PA_CODEX_CHEQUEO_S) : 20;
  const r = correr(bin, ["login", "status"], { env: d.envCuenta ?? d.env, timeout: s * 1000, stdio: "ignore" }, d, plat);
  if (r.status !== 0) return "codex no tiene sesión iniciada (codex login)";
  return "";
}

/** opencode (el programa): modelo bien armado, privacidad, node, el runner y opencode instalado. El login no se mira. */
export function chequearOpencode(modelo: string, d: DatosChequeo): string {
  const plat = d.plat ?? plataformaActual();
  if (!calza(OC_MODELOS, modelo)) return `'${modelo}' no es un modelo de opencode (opencode:<proveedor>/<modelo>)`;
  const m = privacidadDe(d.proyecto, d.tarea, "OpenCode", d.env);
  if (m) return m;
  if (!enPath("node", [], d.env, plat)) return "node no está en el PATH (opencode lo necesita)";
  if (esNvidia(modelo) && !dshClave("NVIDIA_API_KEY", d.env, plat))
    return `falta NVIDIA_API_KEY para '${modelo}' (NVIDIA NIM, gratis: sacala en build.nvidia.com y ponela en ${clavesEnv(d.env, plat)} como NVIDIA_API_KEY=…, o en el entorno)`;
  if (!existsSync(opencodeCorrer(d.env))) return `falta ${opencodeCorrer(d.env)}`;
  if (!opencodeBin(d.env, plat)) return "opencode no está instalado (npm i -g opencode-ai; después `opencode` → /connect → OpenCode Console para los gratis)";
  return "";
}

/** dsh: privacidad (salvo ollama, que es local), node, el runner, dsh, la key y (ollama) el servidor con el modelo. */
export async function chequearDsh(modelo: string, d: DatosChequeo & { locales?: Local[] | null }): Promise<string> {
  if (esOpencode(modelo)) return chequearOpencode(modelo, d);
  const plat = d.plat ?? plataformaActual();
  const prov = dshProveedor(modelo);
  const mod = dshModeloDe(modelo);
  if (prov !== "ollama") {
    const m = privacidadDe(d.proyecto, d.tarea, prov, d.env);
    if (m) return m;
  }
  if (!enPath("node", [], d.env, plat)) return "node no está en el PATH (dsh lo necesita)";
  if (!existsSync(dshCorrer(d.env))) return `falta ${dshCorrer(d.env)}`;
  if (!dshBin(d.env, plat)) return "dsh no está instalado (npm i -g --prefix ~/.local @deepseek-ai/dsh, o motor/scripts/instalar-producto.sh)";
  if (prov === "ollama") {
    const l = localDe(`ollama:${mod}`, d.locales ?? null, d.env);
    const e = await localEstado(l.url, mod, d.env);
    return e === "ok" ? "" : e;
  }
  if (prov === "opencode" && !dshGratis(modelo) && !dshClave("OPENCODE_API_KEY", d.env, plat))
    return `falta OPENCODE_API_KEY (en el entorno o en ${clavesEnv(d.env, plat)}) para '${mod}', que no es gratis`;
  if (prov === "deepseek" && !dshClave("DEEPSEEK_API_KEY", d.env, plat)) return `falta DEEPSEEK_API_KEY (en el entorno o en ${clavesEnv(d.env, plat)})`;
  return "";
}
