// Leer una imagen local que un líder nombró en su texto, para que la interfaz la muestre (en la ventana, en
// Windows y en el celular por igual: va por un canal, no por `file://`, que la página no puede abrir).
// Sólo lectura, sólo rutas absolutas de imágenes (imagen-ruta.ts), de a lo más IMAGEN_LOCAL_MAX bytes y que por
// dentro sean de verdad una imagen. Nunca lanza: lo que no se puede leer es `null` ("Imagen no disponible").
import { readFile, stat } from "node:fs/promises";
import { rutaImagen, rutaWsl, tipoPorBytes } from "./imagen-ruta.ts";
import type { Imagen } from "./imagenes.ts";

/** El tope por archivo, en bytes. */
export const IMAGEN_LOCAL_MAX = 10 * 1024 * 1024;

/** Dónde buscarla en esta plataforma: una ruta de Windows sólo se lee en Windows (y, por `/mnt`, en WSL); una de Linux, no en Windows. */
export function candidatas(x: unknown, plataforma: NodeJS.Platform = process.platform): string[] {
  const r = rutaImagen(x);
  if (!r) return [];
  if (r.estilo === "win32") return plataforma === "win32" ? [r.ruta] : plataforma === "linux" ? [rutaWsl(r.ruta)] : [];
  return plataforma === "win32" ? [] : [r.ruta];
}

/** La imagen de `x` (una ruta absoluta), como la lleva un mensaje; `null` si no existe, no es una imagen o pesa de más. */
export async function leerImagenLocal(x: unknown, plataforma: NodeJS.Platform = process.platform): Promise<Imagen | null> {
  for (const ruta of candidatas(x, plataforma)) {
    try {
      const s = await stat(ruta);
      if (!s.isFile() || s.size > IMAGEN_LOCAL_MAX) continue;
      const b = await readFile(ruta);
      const tipo = tipoPorBytes(b);
      if (tipo) return { tipo, datos: b.toString("base64") };
    } catch {
      /* no está, no se puede leer: la siguiente candidata */
    }
  }
  return null;
}
