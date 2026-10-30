// Leer un archivo local que la actividad de un worker, un subagente o un líder nombra (lo que leyó, escribió o editó),
// para mostrarlo en el visor (src/hilo/VerArchivo.tsx). Va por un canal (`archivo:ver`) y no por `file://`, que la
// página no puede abrir: así se ve igual en Linux, en Windows y en el celular. Sólo lectura, sólo rutas absolutas
// (archivo-ruta.ts), con tope de tamaño por tipo y comprobando por dentro que el archivo sea de verdad lo que dice
// su extensión. Nunca lanza: lo que no está (el worktree de un worker ya borrado), no se puede leer o es un secreto es `null`
// ("archivo ya no disponible"). Lo que no se puede mostrar (un .zip, un .docx) no se lee: la interfaz lo abre con la app del sistema.
import { open, stat } from "node:fs/promises";
import { candidatasArchivo } from "./archivo-candidatas.ts";
import { tipoDeArchivo, type ArchivoVisto } from "./archivo-ruta.ts";
import { tipoPorBytes } from "./imagen-ruta.ts";

/** Los topes por archivo, en bytes (lo que cruza el IPC en base64 pesa un tercio más). */
export const TOPES_ARCHIVO = { imagen: 10 * 1024 * 1024, pdf: 30 * 1024 * 1024, audio: 40 * 1024 * 1024, video: 40 * 1024 * 1024, texto: 512 * 1024 } as const;

/** Archivos que no se muestran aunque el modelo los haya leído: claves y credenciales (las claves nunca se pegan en pantalla). */
export function esSecreto(ruta: string): boolean {
  const partes = ruta.toLowerCase().split(/[\\/]/).filter(Boolean);
  const nombre = partes[partes.length - 1] ?? "";
  if (partes.some((p) => p === ".ssh" || p === ".gnupg" || p === ".aws" || p === ".kube")) return true;
  return (
    nombre === "claves.env" ||
    nombre === ".env" ||
    nombre.startsWith(".env.") ||
    /^id_(rsa|dsa|ecdsa|ed25519)/.test(nombre) ||
    /\.(pem|key|p12|pfx|ppk)$/.test(nombre) ||
    /^(credentials?|secrets?)(\.|$)/.test(nombre)
  );
}

const ES = (b: Uint8Array, ...v: number[]) => v.every((x, i) => b[i] === x);

/** Por dentro: el tipo de imagen real (o `null` si no es una). */
function imagenPorDentro(b: Buffer, mimeExt: string): string | null {
  const t = tipoPorBytes(b);
  if (t) return t;
  if (mimeExt === "image/x-icon" && ES(b, 0, 0, 1, 0)) return mimeExt;
  if (mimeExt === "image/avif" && b.length > 12 && b.subarray(4, 8).toString("latin1") === "ftyp") return mimeExt;
  if (mimeExt === "image/svg+xml" && /<svg[\s>]/i.test(b.subarray(0, 4096).toString("utf8"))) return mimeExt;
  return null;
}

/** Los primeros `tope` bytes de un archivo (y cuántos pesa). */
async function leerHasta(ruta: string, tope: number): Promise<{ b: Buffer; tam: number }> {
  const f = await open(ruta, "r");
  try {
    const tam = (await f.stat()).size;
    const b = Buffer.alloc(Math.min(tam, tope));
    const { bytesRead } = await f.read(b, 0, b.length, 0);
    return { b: b.subarray(0, bytesRead), tam };
  } finally {
    await f.close();
  }
}

/** El archivo de `x` (una ruta absoluta de Windows o de Linux) para el visor; `null` si no está, no es lo que dice su extensión, pesa de más o no se muestra. */
export async function leerArchivoVisto(x: unknown, plataforma: NodeJS.Platform = process.platform): Promise<ArchivoVisto | null> {
  for (const ruta of candidatasArchivo(x, plataforma)) {
    try {
      if (esSecreto(ruta)) return null;
      const { tipo, mime } = tipoDeArchivo(ruta);
      if (tipo === "otro") continue;
      const s = await stat(ruta);
      if (!s.isFile()) continue;
      if (tipo === "texto" || tipo === "markdown") {
        const { b, tam } = await leerHasta(ruta, TOPES_ARCHIVO.texto);
        // Un binario con extensión de texto no es texto.
        if (b.subarray(0, 8192).includes(0)) continue;
        return { tipo, texto: b.toString("utf8"), recortado: tam > b.length };
      }
      if (s.size > TOPES_ARCHIVO[tipo]) continue;
      const { b } = await leerHasta(ruta, TOPES_ARCHIVO[tipo]);
      if (tipo === "imagen") {
        const real = imagenPorDentro(b, mime);
        if (real) return { tipo, mime: real, datos: b.toString("base64") };
        continue;
      }
      if (tipo === "pdf" && b.subarray(0, 1024).toString("latin1").includes("%PDF-")) return { tipo, mime, datos: b.toString("base64") };
      if (tipo === "audio" || tipo === "video") return { tipo, mime, datos: b.toString("base64") };
    } catch {
      /* no está, no se puede leer: la siguiente candidata */
    }
  }
  return null;
}
