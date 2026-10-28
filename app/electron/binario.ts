// Dónde está `pa` y con qué PATH correrlo. Abierta desde el menú de apps, la
// sesión gráfica no trae ~/.local/bin en el PATH: `pa` daba "spawn pa ENOENT"
// (2026-10-03), y aunque se encuentre, `pa` necesita `claude` y `proyecto-ruta`,
// que viven ahí. Puro (sin `electron` ni imports locales): lo prueba
// `tests/binario.test.ts` con `node --test`.
import { execFile, execFileSync, spawn, type ChildProcess, type ExecFileException, type ExecFileOptions, type ExecFileSyncOptions, type SpawnOptions } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { caminoDe, carpetaApp, carpetaBin, delimitadorDe, homeDe, nodeWindows, plataformaActual, type Plataforma } from "./rutas.ts";

type Env = Record<string, string | undefined>;

const ejecutable = (f: string) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** La clave del PATH en un entorno: en Windows suele ser `Path` y un objeto común distingue las mayúsculas. */
export const clavePath = (env: Env, plat: Plataforma = plataformaActual()) => (plat === "win32" ? Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH" : "PATH");
const dirsDelPath = (env: Env, plat: Plataforma) => (env[clavePath(env, plat)] ?? "").split(delimitadorDe(plat));

/** El PATH con la carpeta de binarios de trama (`~/.local/bin`) adelante (sin repetirla). */
export function pathConLocal(env: Env, home: string, plat: Plataforma = plataformaActual()): string {
  const local = carpetaBin(env, home, plat);
  const resto = dirsDelPath(env, plat).filter((d) => d && d !== local);
  return [local, ...resto].join(delimitadorDe(plat));
}

/** El entorno para correr `pa`: el de la app con `~/.local/bin` adelante en el PATH. */
export function entornoPa(env: Env, home: string, plat: Plataforma = plataformaActual()): Env {
  return { ...env, [clavePath(env, plat)]: pathConLocal(env, home, plat) };
}

/**
 * El entorno para correr `agy` (y las herramientas de comandos que él lanza, donde el líder de Gemini llama a `pa`): `~/.local/bin`
 * adelante y la carpeta del `pa` encontrado (`HILOS_PA`, o el del PATH de la app) justo después, para que `pa` no quede en
 * "command not found" aunque viva fuera del PATH que hereda el proceso (unidad de systemd, menú de apps, WSL).
 */
export function entornoAgy(env: Env, home: string, esEjecutable: (f: string) => boolean = ejecutable, plat: Plataforma = plataformaActual()): Env {
  const pa = resolverPa(env, home, esEjecutable, plat);
  const dirPa = caminoDe(plat).isAbsolute(pa) ? caminoDe(plat).dirname(pa) : "";
  const base = pathConLocal(env, home, plat).split(delimitadorDe(plat));
  const [local, ...resto] = base;
  const dirs = [local, ...(dirPa && dirPa !== local ? [dirPa] : []), ...resto.filter((d) => d !== dirPa)];
  return { ...env, [clavePath(env, plat)]: dirs.join(delimitadorDe(plat)) };
}

/**
 * La variable de entorno si está; si no, el binario del PATH (el de la app, tal cual vino); si no,
 * `~/.local/bin/<nombre>`. Si no aparece en ningún lado queda el nombre pelado: el error de spawn
 * dice qué falta. En Windows el binario es `<nombre>.exe` (o el nombre tal cual): nunca un `.cmd`.
 */
export function resolverBinario(
  nombre: string,
  variable: string,
  env: Env,
  home: string,
  esEjecutable: (f: string) => boolean = ejecutable,
  plat: Plataforma = plataformaActual(),
): string {
  if (env[variable]) return env[variable];
  const c = caminoDe(plat);
  const nombres = plat === "win32" ? [`${nombre}.exe`, nombre] : [nombre];
  for (const d of dirsDelPath(env, plat)) {
    if (!d) continue;
    for (const n of nombres) if (esEjecutable(c.join(d, n))) return c.join(d, n);
  }
  const bin = carpetaBin(env, home, plat);
  for (const n of nombres) if (esEjecutable(c.join(bin, n))) return c.join(bin, n);
  return nombre;
}

/** `pa`: `HILOS_PA`, el del PATH o `~/.local/bin/pa`. */
export function resolverPa(env: Env, home: string, esEjecutable: (f: string) => boolean = ejecutable, plat: Plataforma = plataformaActual()): string {
  return resolverBinario("pa", "HILOS_PA", env, home, esEjecutable, plat);
}

const ESCRIPTO_JS = /\.[cm]?js$/i;

/**
 * Qué se lanza para correr una herramienta de trama (`pa`, `tablero`, `reparto`): el principio de la línea de comandos, **sin sus
 * argumentos**. Linux: `[<binario>]`, el de siempre. Windows: `[node.exe, <script>.js]` y nunca un `.cmd` (Node ≥ 18.20.2 no lanza
 * un `.cmd`/`.bat` sin shell: EINVAL). El script es el de la variable si apunta a un `.js`, o `<nombre>.js` en la carpeta de binarios o en
 * la app; si no está, el nombre pelado y el error de spawn dice qué falta. Usar con `lanzarCmd` / `entornoCmd`.
 */
export function resolverComando(
  nombre: string,
  variable: string,
  env: Env,
  home: string,
  esEjecutable: (f: string) => boolean = ejecutable,
  plat: Plataforma = plataformaActual(),
): string[] {
  if (plat !== "win32") return [resolverBinario(nombre, variable, env, home, esEjecutable, plat)];
  const node = esEjecutable(nodeWindows(env, home)) ? nodeWindows(env, home) : process.execPath;
  const v = env[variable];
  if (v) return ESCRIPTO_JS.test(v) ? [node, v] : [v];
  const c = path.win32;
  const bin = carpetaBin(env, home, plat);
  const app = carpetaApp(env, home, plat);
  // El CLI compilado vive en `<app>\dist-electron\cli\<nombre>.js` (así lo arma el payload nativo); el `.cmd` de bin\ sólo lo usa quien tipea en una terminal.
  const propio = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli", `${nombre}.js`);
  const candidatos = [c.join(app, "dist-electron", "cli", `${nombre}.js`), propio, c.join(bin, `${nombre}.js`), c.join(app, `${nombre}.js`), c.join(app, "bin", `${nombre}.js`)];
  for (const js of candidatos) if (esEjecutable(js)) return [node, js];
  const exe = resolverBinario(nombre, variable, env, home, esEjecutable, plat);
  return [exe];
}

/** Las herramientas propias de trama y la variable que fija su ruta (las de `cli/`; `gate` y `clasificar` aún no tienen CLI en TS y quedan por su nombre). */
export const HERRAMIENTAS_PROPIAS: Readonly<Record<string, string>> = {
  pa: "HILOS_PA",
  reparto: "HILOS_REPARTO",
  tablero: "HILOS_TABLERO",
  cuentas: "HILOS_CUENTAS",
  workers: "HILOS_WORKERS",
  "trama-estado": "HILOS_TRAMA_ESTADO",
  gate: "HILOS_GATE",
  clasificar: "HILOS_CLASIFICAR",
};

/**
 * EL ayudante para lanzar una herramienta propia: el principio de la línea de comandos, sin sus argumentos. Linux/mac: `[<binario>]`, el de
 * siempre. Windows: `[node.exe, <app>\dist-electron\cli\<nombre>.js]` directo, nunca un `.cmd` ni `cmd.exe` (sin problemas de comillas ni de
 * `spawn pa ENOENT`: node no resuelve `.cmd` sin shell). Usar con `lanzarPropio` / `lanzarPropioSync` / `spawnPropio` o con `entornoCmd`.
 */
export function comandoPropio(
  nombre: string,
  env: Env = process.env,
  home: string = homeDe(env),
  esEjecutable: (f: string) => boolean = ejecutable,
  plat: Plataforma = plataformaActual(),
): string[] {
  return resolverComando(nombre, HERRAMIENTAS_PROPIAS[nombre] ?? `HILOS_${nombre.toUpperCase().replace(/-/g, "_")}`, env, home, esEjecutable, plat);
}

/** El entorno para lanzar `prefijo`: si el "node" es el propio ejecutable de la app (Electron), le pide que se porte como node. */
export function entornoCmd(prefijo: string[], env: Env): Env {
  if (prefijo.length > 1 && prefijo[0] === process.execPath && process.versions.electron) return { ...env, ELECTRON_RUN_AS_NODE: "1" };
  return env;
}

/** `execFile` de un comando armado por `resolverComando`: el prefijo y después los argumentos. Sin shell. */
export function lanzarCmd(
  prefijo: string[],
  args: string[],
  opciones: ExecFileOptions,
  fin: (err: ExecFileException | null, stdout: string, stderr: string) => void,
) {
  return execFile(prefijo[0], [...prefijo.slice(1), ...args], { ...opciones, env: entornoCmd(prefijo, (opciones.env ?? process.env) as Env) as NodeJS.ProcessEnv, encoding: "utf8" }, (e, o, r) => fin(e, String(o), String(r)));
}

/**
 * `agy` (Antigravity CLI): lo de `resolverBinario` y, si no aparece, las carpetas donde sus instaladores lo dejan fuera del PATH de una
 * unidad de systemd o de WSL (`/usr/local/bin`, `/usr/bin`, `~/.antigravity/bin`…). Si no está en ningún lado queda `agy` pelado.
 */
export function resolverAgy(env: Env, home: string, esEjecutable: (f: string) => boolean = ejecutable, plat: Plataforma = plataformaActual()): string {
  const r = resolverBinario("agy", "HILOS_AGY", env, home, esEjecutable, plat);
  if (r !== "agy" || plat === "win32") return r;
  const donde = ["/usr/local/bin", "/usr/bin", path.join(home, ".antigravity", "bin"), path.join(home, ".antigravity-cli", "bin"), path.join(home, ".gemini", "antigravity-cli", "bin")];
  for (const d of donde) if (esEjecutable(path.join(d, "agy"))) return path.join(d, "agy");
  return r;
}

/**
 * `tailscale`: lo de `resolverBinario` y, en Windows (el instalador no lo pone en el PATH de un servicio), el `tailscale.exe` de
 * `Program Files\Tailscale` (también el x86). Si no aparece queda `tailscale` pelado.
 */
export function resolverTailscale(env: Env, home: string, esEjecutable: (f: string) => boolean = ejecutable, plat: Plataforma = plataformaActual()): string {
  const r = resolverBinario("tailscale", "HILOS_TAILSCALE", env, home, esEjecutable, plat);
  if (r !== "tailscale" || plat !== "win32") return r;
  const dato = (k: string) => env[k] ?? env[Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase()) ?? ""];
  const bases = [dato("ProgramFiles"), dato("ProgramW6432"), dato("ProgramFiles(x86)"), "C:\\Program Files", "C:\\Program Files (x86)"].filter((b): b is string => !!b);
  for (const b of new Set(bases)) {
    const exe = path.win32.join(b, "Tailscale", "tailscale.exe");
    if (esEjecutable(exe)) return exe;
  }
  return r;
}

/** Las carpetas donde `npm i -g` deja sus binarios: Linux `<prefijo>/bin`; Windows el prefijo mismo (`%APPDATA%\npm`), donde quedan los `.cmd`. */
export function carpetasNpm(env: Env, home: string, plat: Plataforma = plataformaActual()): string[] {
  const c = caminoDe(plat);
  const prefijo = env.npm_config_prefix;
  if (plat === "win32") return [...new Set([prefijo, env.APPDATA ? c.join(env.APPDATA, "npm") : "", c.join(home, "AppData", "Roaming", "npm")].filter((d): d is string => !!d))];
  return [prefijo ? c.join(prefijo, "bin") : "", c.join(home, ".npm-global", "bin"), "/usr/local/bin"].filter(Boolean);
}

/**
 * Un binario instalado con npm (`dsh`, `opencode`): el PATH, las `extra` (como `~/.local/bin`), el prefijo global de npm y la carpeta de node.
 * En Windows npm deja `<nombre>.cmd` (y `.exe` en algunos): se prueban en ese orden y se devuelve la ruta tal cual; para lanzarla hay que pasarla
 * por `paraLanzar`. Sin nada: el nombre pelado.
 */
export function resolverNpm(nombre: string, env: Env, home: string, extra: string[], esEjecutable: (f: string) => boolean = ejecutable, plat: Plataforma = plataformaActual()): string {
  const c = caminoDe(plat);
  const nombres = plat === "win32" ? [`${nombre}.cmd`, `${nombre}.exe`, nombre] : [nombre];
  const dirs = [...dirsDelPath(env, plat), ...extra, ...carpetasNpm(env, home, plat), c.dirname(process.execPath)].filter(Boolean);
  for (const d of dirs) for (const n of nombres) if (esEjecutable(c.join(d, n))) return c.join(d, n);
  return nombre;
}

const ES_CMD = /\.(cmd|bat)$/i;

/** Un argumento para la línea de `cmd.exe`: entre comillas si lleva espacios o caracteres que cmd interpreta; tira si lleva `"`, `%` o un salto de línea (no hay forma segura de pasarlos). */
function argParaCmd(a: string): string {
  if (/["%\r\n]/.test(a)) throw new Error(`argumento no apto para cmd.exe: ${JSON.stringify(a.slice(0, 40))}`);
  return a === "" || /[\s&|<>^()!,;=]/.test(a) ? `"${a}"` : a;
}

/** Cómo se lanza un comando: el ejecutable, sus argumentos y si Node debe pasarlos tal cual (`windowsVerbatimArguments`). */
export type Lanzar = { file: string; args: string[]; verbatim: boolean };

/**
 * `cmd args` listo para `spawn`/`execFile`. Linux y los `.exe`: tal cual. Un `.cmd`/`.bat` (los binarios de npm en Windows) no se puede lanzar
 * directo (Node ≥ 18.20.2: EINVAL): va por `cmd.exe /d /s /c "<cmd> <args>"` con los argumentos verbatim. Sin shell de Node.
 */
export function paraLanzar(cmd: string, args: string[], env: Env = process.env, plat: Plataforma = plataformaActual()): Lanzar {
  if (plat !== "win32" || !ES_CMD.test(cmd)) return { file: cmd, args, verbatim: false };
  const linea = [cmd, ...args].map(argParaCmd).join(" ");
  return { file: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${linea}"`], verbatim: true };
}

/** `execFile` de una herramienta propia (`comandoPropio` + `lanzarCmd`). */
export function lanzarPropio(
  nombre: string,
  args: string[],
  opciones: ExecFileOptions,
  fin: (err: ExecFileException | null, stdout: string, stderr: string) => void,
) {
  return lanzarCmd(comandoPropio(nombre, (opciones.env ?? process.env) as Env), args, opciones, fin);
}

/** `execFileSync` de una herramienta propia: devuelve su stdout. */
export function lanzarPropioSync(nombre: string, args: string[], opciones: ExecFileSyncOptions = {}, home?: string): string {
  const env = (opciones.env ?? process.env) as Env;
  const p = comandoPropio(nombre, env, home);
  return String(execFileSync(p[0], [...p.slice(1), ...args], { ...opciones, env: entornoCmd(p, env) as NodeJS.ProcessEnv, encoding: "utf8" }));
}

/** `spawn` de una herramienta propia. */
export function spawnPropio(nombre: string, args: string[], opciones: SpawnOptions = {}): ChildProcess {
  const env = (opciones.env ?? process.env) as Env;
  const p = comandoPropio(nombre, env);
  return spawn(p[0], [...p.slice(1), ...args], { ...opciones, env: entornoCmd(p, env) as NodeJS.ProcessEnv });
}
