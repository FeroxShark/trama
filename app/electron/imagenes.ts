// Imágenes en un mensaje a un líder (B26): El usuario las pega (Ctrl+V), las suelta
// sobre el chat o las elige con el clip. El renderer las achica (src/hilo/adjuntos.ts)
// y acá se validan antes de ir al stdin de `claude` como bloques `image` (base64)
// del mensaje de usuario del stream-json, delante del texto, como Claude Code.
// Puro: lo prueba tests/imagenes.test.ts.
import { errorT } from "./errores.ts";

export type Imagen = { tipo: string; datos: string };

/** Las que acepta la API de Anthropic. */
export const TIPOS_IMAGEN = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
/** El lado más largo, en px: lo que pasa se achica en el renderer (la API rechaza más de 8000; más de ~1600 lo achica ella). */
export const LADO_MAX = 2000;
/** El tope de la API por imagen (5 MB), contado en caracteres de base64. */
export const BASE64_MAX = 5 * 1024 * 1024;
/** Por mensaje. */
export const IMAGENES_MAX = 20;
/** Cuántas imágenes pegadas se guardan en disco por borrador (lo que pasa no se guarda, sólo se avisa). */
export const BORRADOR_IMAGENES_MAX = 4;
/** Cuánto pesan, en total y contado en caracteres de base64, las imágenes guardadas de un borrador. */
export const BORRADOR_IMAGENES_BASE64 = 8 * 1024 * 1024;

/**
 * Las imágenes de un borrador que entran en el guardado (en orden: las primeras; una que no cabe se salta y las
 * que le siguen pueden entrar si caben) y cuántas se quedan afuera.
 */
export function acotarImagenes<T extends { datos: string }>(l: readonly T[]): { entran: T[]; sobran: number } {
  const entran: T[] = [];
  let resta = BORRADOR_IMAGENES_BASE64;
  for (const i of l) {
    if (entran.length >= BORRADOR_IMAGENES_MAX || i.datos.length > resta) continue;
    entran.push(i);
    resta -= i.datos.length;
  }
  return { entran, sobran: l.length - entran.length };
}

/** Por archivo que no es imagen (electron/archivos.ts). */
export const ARCHIVO_MAX = 25 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Ancho y alto para que el lado más largo no pase de `max` (sin agrandar). */
export function escala(ancho: number, alto: number, max = LADO_MAX): { ancho: number; alto: number } {
  const lado = Math.max(ancho, alto);
  if (lado <= max) return { ancho, alto };
  const f = max / lado;
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) };
}

/** Las imágenes de un envío (lo que llega por IPC), validadas; sin ninguna, `[]`. */
export function imagenesDe(x: unknown): Imagen[] {
  if (x == null) return [];
  if (!Array.isArray(x)) throw errorT("main.imagenRara");
  if (x.length > IMAGENES_MAX) throw errorT("main.imagenesMuchas", { n: IMAGENES_MAX });
  return x.map((i) => {
    const tipo = String(i?.tipo ?? "");
    const datos = String(i?.datos ?? "");
    if (!(TIPOS_IMAGEN as readonly string[]).includes(tipo)) throw errorT("main.imagenTipo", { v: tipo });
    if (datos.length > BASE64_MAX) throw errorT("main.imagenGrande");
    if (!datos || datos.length % 4 !== 0 || !BASE64.test(datos)) throw errorT("main.imagenRara");
    return { tipo, datos };
  });
}

/** El `content` del mensaje de usuario: texto solo, o las imágenes y después el texto (si hay). */
export function contenidoUsuario(texto: string, imagenes: readonly Imagen[] = []) {
  if (!imagenes.length) return texto;
  return [
    ...imagenes.map((i) => ({ type: "image", source: { type: "base64", media_type: i.tipo, data: i.datos } })),
    ...(texto.trim() ? [{ type: "text", text: texto }] : []),
  ];
}

/** Las imágenes de un `content` del transcript (bloques `image` con base64 de un tipo conocido). */
export function imagenesDeContenido(c: unknown): Imagen[] {
  if (!Array.isArray(c)) return [];
  const r: Imagen[] = [];
  for (const b of c)
    if (b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string" && (TIPOS_IMAGEN as readonly string[]).includes(b.source.media_type))
      r.push({ tipo: b.source.media_type, datos: b.source.data });
  return r;
}

/** Una imagen que llegó por IPC sin validar (la de un archivo local: `imagen:leer`); `null` si no tiene forma de imagen. */
export function imagenDe(x: unknown): Imagen | null {
  const o = x as { tipo?: unknown; datos?: unknown } | null;
  if (typeof o?.tipo !== "string" || typeof o.datos !== "string" || !/^image\/[a-z0-9.+-]+$/.test(o.tipo) || !o.datos) return null;
  return { tipo: o.tipo, datos: o.datos };
}
