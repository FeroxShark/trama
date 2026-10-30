// "Abrir con la app del sistema" un archivo que nombra la actividad de un worker, de un subagente o de un líder
// (canal `archivo:abrir`, sólo de la ventana). La ruta tiene que ser absoluta, existir como archivo de esta máquina y ser de un
// tipo que no se ejecuta (archivo-ruta.ts `abribleConSistema`): lo que llega por IPC no es de fiar.
import { stat } from "node:fs/promises";
import { candidatasArchivo } from "./archivo-candidatas.ts";
import { abribleConSistema } from "./archivo-ruta.ts";

/** Abre `x` con `abrir` (en Electron, `shell.openPath`: devuelve "" si pudo o el motivo); `true` si se abrió. Nunca lanza. */
export async function abrirArchivo(x: unknown, abrir: (ruta: string) => Promise<string>, plataforma: NodeJS.Platform = process.platform): Promise<boolean> {
  for (const ruta of candidatasArchivo(x, plataforma)) {
    try {
      if (!abribleConSistema(ruta) || !(await stat(ruta)).isFile()) continue;
      return (await abrir(ruta)) === "";
    } catch {
      /* no está: la siguiente */
    }
  }
  return false;
}
