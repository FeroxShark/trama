// Qué terminal abrir para correr una orden que pide contraseña o muestra algo (Actualizar): la que dice `HILOS_TERMINAL`,
// después `$TERMINAL` y, si no, la primera que haya de las conocidas. Cada una pide la orden de una forma distinta
// (`-e`, `--`, o nada). Node puro: lo prueba tests/terminal-lanzar.test.ts con un PATH de mentira.
import { accessSync, constants } from "node:fs";
import { caminoDe, delimitadorDe, type Plataforma, plataformaActual } from "./rutas.ts";

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

function enElPath(nombre: string, env: NodeJS.ProcessEnv, esEjecutable: (f: string) => boolean, plat: Plataforma): string | null {
  const c = caminoDe(plat);
  const nombres = plat === "win32" && !/\.(exe|cmd|bat)$/i.test(nombre) ? [`${nombre}.exe`, nombre] : [nombre];
  if (/[\\/]/.test(nombre) && (plat === "win32" || nombre.includes("/"))) return nombres.find((n) => esEjecutable(n)) ?? null;
  const clave = plat === "win32" ? Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH" : "PATH";
  for (const d of (env[clave] ?? "").split(delimitadorDe(plat)))
    if (d) for (const n of nombres) if (esEjecutable(c.join(d, n))) return c.join(d, n);
  return null;
}

/**
 * Windows: `wt.exe` (Windows Terminal, abre una pestaña con la orden que sigue) si está en el PATH; si no, `cmd.exe /d /c start "" /wait`
 * (una consola nueva de cmd; `/wait` hace que el proceso viva lo que la ventana). La orden que sigue es `cmd.exe /d /c <script>.cmd …`
 * (ver `envoltorioWindows`): nada de bash ni de PowerShell.
 */
const BANDERA_WINDOWS = ["/d", "/c", "start", "", "/wait"];
const CONOCIDAS_WINDOWS = ["wt.exe"];

/**
 * El script `.cmd` que hace de envoltorio en Windows (el equivalente del `sh -c` de Linux): corre `%*` (la orden), anota su rc en
 * `rc` (junto al script, por un `.tmp` y un `move` para que nadie lea a medias) y, si falló, deja la ventana esperando una tecla.
 */
export const envoltorioWindows = (): string =>
  [
    "@echo off",
    "call %*",
    "set rc=%errorlevel%",
    '>"%~dp0rc.tmp" echo %rc%',
    'move /y "%~dp0rc.tmp" "%~dp0rc" >nul',
    "if %rc% neq 0 (",
    "  echo.",
    "  echo [rc=%rc%] Enter para cerrar",
    "  pause >nul",
    ")",
    "exit /b %rc%",
    "",
  ].join("\r\n");

/** El ejecutable y lo que va antes de la orden (`[<terminal>, ...bandera]`), o `null` si no hay ninguna terminal. */
export function resolverTerminal(env: NodeJS.ProcessEnv = process.env, esEjecutable: (f: string) => boolean = ejecutable, plat: Plataforma = plataformaActual()): string[] | null {
  const base = caminoDe(plat).basename;
  // Lo elegido a mano va tal cual, haya o no (si no existe, el error dice cuál era); no se cae a otra en silencio.
  const elegida = env.HILOS_TERMINAL?.trim();
  if (elegida) return [elegida, ...(BANDERA[base(elegida)] ?? [])];
  if (plat === "win32") {
    const wt = [env.TERMINAL?.trim(), ...CONOCIDAS_WINDOWS].filter((t): t is string => !!t).map((t) => enElPath(t, env, esEjecutable, plat)).find(Boolean);
    return wt ? [wt] : [env.ComSpec || env.COMSPEC || "cmd.exe", ...BANDERA_WINDOWS];
  }
  const candidatas = [env.TERMINAL?.trim(), ...CONOCIDAS].filter((t): t is string => !!t);
  for (const c of candidatas) {
    const ruta = enElPath(c, env, esEjecutable, plat);
    if (ruta) return [ruta, ...(BANDERA[base(c)] ?? [])];
  }
  return null;
}
