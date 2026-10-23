// Archivos que no son imágenes en un mensaje a un líder (.md, .pdf, código, lo
// que sea): la API sólo acepta imágenes como bloque, así que el renderer manda
// los bytes al adjuntar, se guardan en `adjuntos/` del estado propio y el
// mensaje lleva la ruta absoluta para que Claude los lea con Read.
// Puro salvo `guardarArchivo`: lo prueba tests/archivos.test.ts.
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { errorT } from "./errores.ts";
import { ARCHIVO_MAX } from "./imagenes.ts";

/** El nombre sin carpetas ni caracteres que molesten en una ruta; vacío → "archivo". */
export function nombreSeguro(nombre: string): string {
  const base = String(nombre).split(/[\\/]/).pop() ?? "";
  const limpio = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/^\.+/, "");
  return limpio.slice(0, 200) || "archivo";
}

/** Lo que llega por IPC, validado. */
export function archivoDe(x: unknown): { nombre: string; datos: Uint8Array } {
  const o = x as { nombre?: unknown; datos?: unknown } | null;
  const datos = o?.datos;
  if (!(datos instanceof Uint8Array)) throw errorT("main.archivoRaro");
  if (datos.byteLength > ARCHIVO_MAX) throw errorT("main.archivoGrande", { n: ARCHIVO_MAX / 1024 / 1024 });
  return { nombre: nombreSeguro(String(o?.nombre ?? "")), datos };
}

/** Lo guarda en `<dir>/<uuid>/<nombre>` (el nombre original, para que Claude lo vea) y devuelve la ruta absoluta. */
export async function guardarArchivo(dir: string, x: unknown): Promise<string> {
  const { nombre, datos } = archivoDe(x);
  const carpeta = path.join(dir, randomUUID());
  await mkdir(carpeta, { recursive: true });
  const ruta = path.join(carpeta, nombre);
  await writeFile(ruta, datos);
  return ruta;
}
