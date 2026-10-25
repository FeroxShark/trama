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
  const esWin = process.platform === "win32" || (env.PATH && env.PATH.includes(";")) || home.includes("\\");
  const p = esWin ? path.win32 : path;
  const local = p.join(home, ".local", "bin");
  const sep = esWin ? ";" : (env.PATH && !env.PATH.includes(path.delimiter) && env.PATH.includes(":") ? ":" : path.delimiter);
  const resto = (env.PATH ?? "").split(sep).filter((d) => d && d !== local);
  return [local, ...resto].join(sep);
}

/** El entorno para correr `pa`: el de la app con `~/.local/bin` adelante en el PATH. */
export function entornoPa(env: Env, home: string): Env {
  return { ...env, PATH: pathConLocal(env, home) };
}

/**
 * La variable de entorno si está; si no, el binario del PATH (el de la app, tal cual vino); si no,
 * `~/.local/bin/<nombre>`. Si no aparece en ningún lado queda el nombre pelado: el error de spawn
 * dice qué falta. En Windows busca también extensiones ejecutables (.cmd, .bat, .ps1, .exe).
 */
export function resolverBinario(
  nombre: string,
  variable: string,
  env: Env,
  home: string,
  esEjecutable: (f: string) => boolean = ejecutable,
): string {
  if (env[variable]) return env[variable];
  const sep = env.PATH && !env.PATH.includes(path.delimiter) && env.PATH.includes(":") ? ":" : path.delimiter;
  const exts = process.platform === "win32" ? ["", ".cmd", ".bat", ".ps1", ".exe"] : [""];
  for (const d of (env.PATH ?? "").split(sep)) {
    if (!d) continue;
    for (const ext of exts) {
      const p = path.join(d, nombre + ext);
      if (esEjecutable(p)) return p;
    }
  }
  for (const ext of exts) {
    const local = path.join(home, ".local", "bin", nombre + ext);
    if (esEjecutable(local)) return local;
  }
  return nombre;
}

/** `pa`: `HILOS_PA`, el del PATH o `~/.local/bin/pa`. */
export function resolverPa(env: Env, home: string, esEjecutable: (f: string) => boolean = ejecutable): string {
  return resolverBinario("pa", "HILOS_PA", env, home, esEjecutable);
}
