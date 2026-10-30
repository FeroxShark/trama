// Dónde vive cada cosa, por plataforma. Un solo lugar para lo que antes eran `path.join(home, ".config", …)` sueltos.
// Node puro (sin `electron`); en Linux da exactamente lo de siempre (XDG), en Windows lo de `%LOCALAPPDATA%\trama\…`
// (el mismo árbol donde `pa` guarda su estado y está su `pa.js`).
// Lo prueba tests/rutas.test.ts con la plataforma inyectada.
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export type Plataforma = "linux" | "win32" | "darwin";
type Env = Record<string, string | undefined>;

export const plataformaActual = (): Plataforma => (process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux");
export const esWindows = (plat: Plataforma = plataformaActual()) => plat === "win32";

/** El `path` de esa plataforma (para armar rutas de Windows desde Linux en los tests). */
export const caminoDe = (plat: Plataforma = plataformaActual()) => (plat === "win32" ? path.win32 : path.posix);
/** El separador del PATH. */
export const delimitadorDe = (plat: Plataforma = plataformaActual()) => (plat === "win32" ? ";" : ":");

export function homeDe(env: Env = process.env, plat: Plataforma = plataformaActual()): string {
  if (plat === "win32") return env.USERPROFILE || env.HOME || os.homedir();
  return env.HOME || os.homedir();
}

/** `%LOCALAPPDATA%\trama` (sólo Windows). */
export function raizWindows(env: Env = process.env, home = homeDe(env, "win32")): string {
  return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "trama");
}

/** El estado propio de la app (`HILOS_STATE` manda). */
export function estadoHilos(env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): string {
  if (env.HILOS_STATE) return env.HILOS_STATE;
  const h = home ?? homeDe(env, plat);
  return plat === "win32" ? path.win32.join(raizWindows(env, h), "estado", "hilos") : path.posix.join(h, ".local", "state", "hilos");
}

/** El estado de `pa` (`PA_STATE` manda). */
export function estadoPa(env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): string {
  if (env.PA_STATE) return env.PA_STATE;
  const h = home ?? homeDe(env, plat);
  return plat === "win32" ? path.win32.join(raizWindows(env, h), "estado", "pa") : path.posix.join(h, ".local", "state", "pa");
}

/** La carpeta de configuración de trama (`~/.config/trama`; `XDG_CONFIG_HOME` la mueve, como siempre en este repo). */
export function configTrama(env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): string {
  const h = home ?? homeDe(env, plat);
  if (plat === "win32") return path.win32.join(raizWindows(env, h), "config");
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(h, ".config"), "trama");
}

/** `registry.json` de los proyectos (`PROYECTOS_REGISTRY` manda). Linux: `~/.config/proyectos/registry.json`, sin XDG (como siempre). */
export function registroProyectos(env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): string {
  if (env.PROYECTOS_REGISTRY) return env.PROYECTOS_REGISTRY;
  const h = home ?? homeDe(env, plat);
  return plat === "win32" ? path.win32.join(configTrama(env, h, plat), "proyectos", "registry.json") : path.posix.join(h, ".config", "proyectos", "registry.json");
}

/** `vista.json` del tablero cuando no la fija `TABLERO_VISTA` ni `TABLERO_DIR`. */
export function vistaTablero(env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): string {
  const h = home ?? homeDe(env, plat);
  const c = caminoDe(plat);
  if (env.TABLERO_VISTA) return env.TABLERO_VISTA;
  if (env.TABLERO_DIR) return c.join(env.TABLERO_DIR, "vista.json");
  return plat === "win32" ? path.win32.join(raizWindows(env, h), "estado", "tablero", "vista.json") : path.posix.join(h, ".local", "state", "tablero", "vista.json");
}

/** Donde viven los ejecutables de trama (`pa`, `tablero`, `claude`…): `~/.local/bin` o `%LOCALAPPDATA%\trama\bin`. */
export function carpetaBin(env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): string {
  const h = home ?? homeDe(env, plat);
  return plat === "win32" ? path.win32.join(raizWindows(env, h), "bin") : path.posix.join(h, ".local", "bin");
}

/** La carpeta de la app instalada (Windows: `%LOCALAPPDATA%\trama\app`, donde está `pa.js`). */
export function carpetaApp(env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): string {
  const h = home ?? homeDe(env, plat);
  if (env.TRAMA_APP) return env.TRAMA_APP;
  return plat === "win32" ? path.win32.join(raizWindows(env, h), "app") : path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(h, ".config"), "trama", "app");
}

/**
 * Las carpetas que el instalador reemplaza: la app (`pa.js`, el motor…) y, en Windows, el `node` propio y `bin\`. Lo que cuelga de
 * ellas (no `wt\`, `estado\`, `config\`: ésas son datos) no puede ser el cwd de nada que lancemos.
 */
export function carpetasDeInstalacion(env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): string[] {
  const h = home ?? homeDe(env, plat);
  const l = [carpetaApp(env, h, plat)];
  if (plat === "win32") l.push(path.win32.dirname(nodeWindows(env, h)), carpetaBin(env, h, plat));
  return l;
}

/**
 * ¿`ruta` está dentro de la carpeta de instalación? Un servidor MCP de terceros (o el CLI) que arranca con ese cwd crea ahí sus logs
 * y los deja abiertos: Windows no deja reemplazar esa carpeta mientras tanto, y la actualización falla. Sin distinguir mayúsculas
 * en Windows.
 */
export function dentroDeInstalacion(ruta: string, env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): boolean {
  const c = caminoDe(plat);
  const norm = (r: string) => {
    const x = c.resolve(r).replace(/[\\/]+$/, "");
    return plat === "win32" ? x.toLowerCase() : x;
  };
  const r = norm(ruta);
  return carpetasDeInstalacion(env, home, plat).some((d) => {
    const n = norm(d);
    return r === n || r.startsWith(n + c.sep);
  });
}

/** El cwd con el que lanzar algo: `cwd` (si viene) o el home, y el home si `cwd` cayera dentro de la carpeta de instalación. */
export function cwdSeguro(cwd: string | undefined, env: Env = process.env, home?: string, plat: Plataforma = plataformaActual()): string {
  const h = home ?? homeDe(env, plat);
  return cwd && !dentroDeInstalacion(cwd, env, h, plat) ? cwd : h;
}

/** Saca al proceso de la carpeta de instalación (el motor lo lanza el servicio o el arranque con cwd allí: lo heredarían todos sus hijos). */
export function salirDeLaInstalacion(env: Env = process.env, cwd: () => string = process.cwd, chdir: (d: string) => void = process.chdir): boolean {
  try {
    if (!dentroDeInstalacion(cwd(), env)) return false;
    chdir(homeDe(env));
    return true;
  } catch {
    return false;
  }
}

/** El `node` propio de Windows (trama no depende del que haya en el PATH). */
export function nodeWindows(env: Env = process.env, home?: string): string {
  return path.win32.join(raizWindows(env, home ?? homeDe(env, "win32")), "node", "node.exe");
}

/** La carpeta del socket del motor. `HILOS_LOCAL` la cambia (las pruebas). */
export function carpetaMotor(env: Env = process.env, plat: Plataforma = plataformaActual(), uid: number | string = os.userInfo().uid): string {
  if (env.HILOS_LOCAL) return env.HILOS_LOCAL;
  if (plat === "win32") return path.win32.join(raizWindows(env), "run");
  const base = env.XDG_RUNTIME_DIR || path.posix.join(os.tmpdir(), `trama-${uid}`);
  return path.posix.join(base, "trama");
}

/**
 * Dónde escucha el motor: en Linux `<carpeta>/motor.sock`; en Windows una named pipe `\\.\pipe\trama-motor-<usuario>`
 * (una pipe no es un archivo: no hay carpeta ni permisos que preparar, el nombre es el candado). Con una carpeta que no es la de
 * siempre (`HILOS_LOCAL` de las pruebas) el nombre lleva además la huella de la carpeta, así dos motores de prueba no se pisan.
 */
export function socketMotor(carpeta: string, env: Env = process.env, plat: Plataforma = plataformaActual()): string {
  if (plat !== "win32") return path.posix.join(carpeta, "motor.sock");
  const usuario = (env.USERNAME || env.USER || "usuario").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const propia = carpeta === carpetaMotor({ ...env, HILOS_LOCAL: undefined }, plat);
  const huella = propia ? "" : `-${createHash("sha1").update(carpeta).digest("hex").slice(0, 8)}`;
  return `\\\\.\\pipe\\trama-motor-${usuario}${huella}`;
}

/** ¿Es una named pipe de Windows? (no se le hace chmod ni se la borra). */
export const esPipe = (ruta: string) => ruta.startsWith("\\\\.\\pipe\\");
