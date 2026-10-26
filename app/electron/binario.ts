// Dónde está `pa` y con qué PATH correrlo. Abierta desde el menú de apps, la
// sesión gráfica no trae ~/.local/bin en el PATH: `pa` daba "spawn pa ENOENT"
// (2026-10-03), y aunque se encuentre, `pa` necesita `claude` y `proyecto-ruta`,
// que viven ahí. Puro (sin `electron` ni imports locales): lo prueba
// `tests/binario.test.ts` con `node --test`.
import { accessSync, constants } from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

const ejecutable = (f: string) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** El PATH con `~/.local/bin` adelante (sin repetirlo). */
export function pathConLocal(env: Env, home: string): string {
  const local = path.join(home, ".local", "bin");
  const resto = (env.PATH ?? "").split(":").filter((d) => d && d !== local);
  return [local, ...resto].join(":");
}

/** El entorno para correr `pa`: el de la app con `~/.local/bin` adelante en el PATH. */
export function entornoPa(env: Env, home: string): Env {
  return { ...env, PATH: pathConLocal(env, home) };
}

/**
 * El entorno para correr `agy` (y las herramientas de comandos que él lanza, donde el líder de Gemini llama a `pa`): `~/.local/bin`
 * adelante y la carpeta del `pa` encontrado (`HILOS_PA`, o el del PATH de la app) justo después, para que `pa` no quede en
 * "command not found" aunque viva fuera del PATH que hereda el proceso (unidad de systemd, menú de apps, WSL).
 */
export function entornoAgy(env: Env, home: string, esEjecutable: (f: string) => boolean = ejecutable): Env {
  const pa = resolverPa(env, home, esEjecutable);
  const dirPa = path.isAbsolute(pa) ? path.dirname(pa) : "";
  const base = pathConLocal(env, home).split(":");
  const [local, ...resto] = base;
  const dirs = [local, ...(dirPa && dirPa !== local ? [dirPa] : []), ...resto.filter((d) => d !== dirPa)];
  return { ...env, PATH: dirs.join(":") };
}

/**
 * La variable de entorno si está; si no, el binario del PATH (el de la app, tal cual vino); si no,
 * `~/.local/bin/<nombre>`. Si no aparece en ningún lado queda el nombre pelado: el error de spawn
 * dice qué falta.
 */
export function resolverBinario(
  nombre: string,
  variable: string,
  env: Env,
  home: string,
  esEjecutable: (f: string) => boolean = ejecutable,
): string {
  if (env[variable]) return env[variable];
  for (const d of (env.PATH ?? "").split(":")) {
    if (d && esEjecutable(path.join(d, nombre))) return path.join(d, nombre);
  }
  const local = path.join(home, ".local", "bin", nombre);
  return esEjecutable(local) ? local : nombre;
}

/** `pa`: `HILOS_PA`, el del PATH o `~/.local/bin/pa`. */
export function resolverPa(env: Env, home: string, esEjecutable: (f: string) => boolean = ejecutable): string {
  return resolverBinario("pa", "HILOS_PA", env, home, esEjecutable);
}

/**
 * `agy` (Antigravity CLI): lo de `resolverBinario` y, si no aparece, las carpetas donde sus instaladores lo dejan fuera del PATH de una
 * unidad de systemd o de WSL (`/usr/local/bin`, `/usr/bin`, `~/.antigravity/bin`…). Si no está en ningún lado queda `agy` pelado.
 */
export function resolverAgy(env: Env, home: string, esEjecutable: (f: string) => boolean = ejecutable): string {
  const r = resolverBinario("agy", "HILOS_AGY", env, home, esEjecutable);
  if (r !== "agy") return r;
  const donde = ["/usr/local/bin", "/usr/bin", path.join(home, ".antigravity", "bin"), path.join(home, ".antigravity-cli", "bin"), path.join(home, ".gemini", "antigravity-cli", "bin")];
  for (const d of donde) if (esEjecutable(path.join(d, "agy"))) return path.join(d, "agy");
  return r;
}
