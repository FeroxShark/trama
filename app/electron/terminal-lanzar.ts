// Qué terminal abrir para correr una orden que pide contraseña o muestra algo (Actualizar): la que dice `HILOS_TERMINAL`,
// después `$TERMINAL` y, si no, la primera que haya de las conocidas. Cada una pide la orden de una forma distinta
// (`-e`, `--`, o nada). Node puro: lo prueba tests/terminal-lanzar.test.ts con un PATH de mentira.
import { accessSync, constants } from "node:fs";
import path from "node:path";

/** Cómo le pasa la orden cada terminal conocida: la bandera que va antes (vacía: la orden sigue directo). */
const BANDERA: Record<string, string[]> = {
  "x-terminal-emulator": ["-e"],
  "gnome-terminal": ["--"],
  konsole: ["-e"],
  kitty: [],
  alacritty: ["-e"],
  foot: [],
  xterm: ["-e"],
  "xfce4-terminal": ["-x"],
  wezterm: ["start", "--"],
};

/** En el orden en que se prueban cuando nadie eligió. */
export const CONOCIDAS = ["x-terminal-emulator", "gnome-terminal", "konsole", "kitty", "alacritty", "foot", "xterm"];

const ejecutable = (f: string) => {
  try {
    accessSync(f, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

function enElPath(nombre: string, env: NodeJS.ProcessEnv, esEjecutable: (f: string) => boolean): string | null {
  if (nombre.includes("/")) return esEjecutable(nombre) ? nombre : null;
  for (const d of (env.PATH ?? "").split(":")) if (d && esEjecutable(path.join(d, nombre))) return path.join(d, nombre);
  return null;
}

/** El ejecutable y lo que va antes de la orden (`[<terminal>, ...bandera]`), o `null` si no hay ninguna terminal. */
export function resolverTerminal(env: NodeJS.ProcessEnv = process.env, esEjecutable: (f: string) => boolean = ejecutable): string[] | null {
  // Lo elegido a mano va tal cual, haya o no (si no existe, el error dice cuál era); no se cae a otra en silencio.
  const elegida = env.HILOS_TERMINAL?.trim();
  if (elegida) return [elegida, ...(BANDERA[path.basename(elegida)] ?? [])];
  const candidatas = [env.TERMINAL?.trim(), ...CONOCIDAS].filter((t): t is string => !!t);
  for (const c of candidatas) {
    const ruta = enElPath(c, env, esEjecutable);
    if (ruta) return [ruta, ...(BANDERA[path.basename(c)] ?? [])];
  }
  return null;
}
