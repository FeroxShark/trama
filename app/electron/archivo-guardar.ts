// «Guardar como…» una imagen del visor (canal `archivo:guardarComo`, sólo de la ventana): el main pregunta dónde con el diálogo del
// sistema y copia el archivo original ahí. La ruta tiene que ser absoluta, existir como archivo de esta máquina y ser una imagen:
// lo que llega por IPC no es de fiar. El destino lo elige la persona en el diálogo, nunca viene del pedido.
import { copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { candidatasArchivo } from "./archivo-candidatas.ts";
import { tipoDeArchivo } from "./archivo-ruta.ts";

export type ResultadoGuardar = "guardado" | "cancelado" | "fallo";

/** Lo que hace falta del sistema: el diálogo (devuelve el destino o `null` si se canceló) y la copia. */
export type PuertosGuardar = {
  elegir: (nombreSugerido: string, carpeta: string | null) => Promise<string | null>;
  copiar?: (de: string, a: string) => Promise<void>;
};

/** El archivo de imagen que `x` nombra en esta máquina, o `null`. */
async function imagenLocal(x: unknown, plataforma: NodeJS.Platform): Promise<string | null> {
  for (const ruta of candidatasArchivo(x, plataforma)) {
    try {
      if (tipoDeArchivo(ruta).tipo === "imagen" && (await stat(ruta)).isFile()) return ruta;
    } catch {
      /* no está: la siguiente */
    }
  }
  return null;
}

/** Guarda una copia de la imagen `x` donde elija la persona. Nunca lanza: `cancelado` si cerró el diálogo, `fallo` si no se pudo. */
export async function guardarComo(x: unknown, p: PuertosGuardar, plataforma: NodeJS.Platform = process.platform): Promise<ResultadoGuardar> {
  const origen = await imagenLocal(x, plataforma);
  if (!origen) return "fallo";
  const mod = plataforma === "win32" ? path.win32 : path.posix;
  try {
    const destino = await p.elegir(mod.basename(origen), mod.dirname(origen));
    if (!destino) return "cancelado";
    if (mod.resolve(destino) === mod.resolve(origen)) return "guardado";
    await (p.copiar ?? copyFile)(origen, destino);
    return "guardado";
  } catch {
    return "fallo";
  }
}
