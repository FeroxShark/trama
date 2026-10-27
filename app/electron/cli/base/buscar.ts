// Encontrar un ejecutable (`shutil.which` / `command -v`): por el PATH y, si no está, en carpetas extra.
// En Windows prueba las extensiones de PATHEXT (.exe, .cmd…); en el resto exige el bit de ejecución.
import { accessSync, constants, statSync } from "node:fs";
import { caminoDe, delimitadorDe, esWindows, plataformaActual, type Plataforma } from "../../rutas.ts";

type Env = Record<string, string | undefined>;

const esArchivo = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** ¿Es un archivo ejecutable? (Windows: basta con que exista y tenga una extensión de PATHEXT.) */
export function esEjecutable(p: string, plat: Plataforma = plataformaActual()): boolean {
  if (!esArchivo(p)) return false;
  if (esWindows(plat)) return true;
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function conExtensiones(p: string, env: Env, plat: Plataforma): string[] {
  if (!esWindows(plat)) return [p];
  const exts = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return [p, ...exts.map((e) => p + e)];
}

/** `shutil.which(nombre)`: un nombre con carpeta se mira tal cual; uno suelto se busca en el PATH. `extra`: carpetas a probar después. */
export function enPath(nombre: string, extra: string[] = [], env: Env = process.env, plat: Plataforma = plataformaActual()): string | null {
  const cam = caminoDe(plat);
  if (nombre.includes("/") || (esWindows(plat) && nombre.includes("\\"))) {
    for (const c of conExtensiones(nombre, env, plat)) if (esEjecutable(c, plat)) return c;
    return null;
  }
  const dirs = (env.PATH ?? env.Path ?? "").split(delimitadorDe(plat)).filter(Boolean);
  for (const d of [...dirs, ...extra]) {
    for (const c of conExtensiones(cam.join(d, nombre), env, plat)) if (esEjecutable(c, plat)) return c;
  }
  return null;
}
