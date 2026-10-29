// Las imágenes locales que un líder nombra en su texto (`![](C:\ruta\x.png)`, `/tmp/x.png`, `file:///…`):
// qué ruta vale y de qué tipo es el archivo. Puro y sin Node (lo importa también la interfaz): el que lee del
// disco es imagen-local.ts. Sólo rutas absolutas de un archivo con extensión de imagen; nunca una carpeta de red.

/** La extensión → el tipo que sirve el `<img>`. */
export const TIPO_POR_EXT: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

export type RutaImagen = {
  /** `win32`: empieza con una unidad (`C:\`); `posix`: con `/`. */
  estilo: "win32" | "posix";
  ruta: string;
};

const LARGO_MAX = 1024;

/** Lo que va después de `file://` → la ruta (`/C:/a%20b.png` → `C:/a b.png`); `null` si apunta a otra máquina. */
function deUrlArchivo(s: string): string | null {
  let r = s.slice("file://".length);
  if (r.toLowerCase().startsWith("localhost/")) r = r.slice("localhost".length);
  // `file://servidor/recurso` es una carpeta de red, no un archivo de acá.
  if (!r.startsWith("/")) return null;
  try {
    r = decodeURIComponent(r);
  } catch {
    return null;
  }
  return /^\/[A-Za-z]:[\\/]/.test(r) ? r.slice(1) : r;
}

/** La ruta absoluta de una imagen local en `x` (con comillas, `<>` o `file://`), o `null` si no vale. */
export function rutaImagen(x: unknown): RutaImagen | null {
  if (typeof x !== "string") return null;
  let s = x.trim();
  if (/^<.*>$/.test(s) || /^(["']).*\1$/.test(s)) s = s.slice(1, -1).trim();
  if (!s || s.length > LARGO_MAX || /[\u0000-\u001f]/.test(s)) return null;
  if (/^file:\/\//i.test(s)) {
    const r = deUrlArchivo(s);
    if (r === null) return null;
    s = r;
  }
  const estilo = /^[A-Za-z]:[\\/]/.test(s) ? "win32" : s.startsWith("/") && !s.startsWith("//") ? "posix" : null;
  if (!estilo) return null;
  // Sin `..`: la ruta dice a dónde va, no por dónde sube.
  if (s.split(/[\\/]/).includes("..")) return null;
  const ext = /\.([A-Za-z0-9]+)$/.exec(s)?.[1].toLowerCase();
  if (!ext || !(ext in TIPO_POR_EXT)) return null;
  return { estilo, ruta: s };
}

/** El nombre del archivo de una ruta de Windows o de Linux. */
export const nombreDe = (ruta: string): string => ruta.split(/[\\/]/).filter(Boolean).pop() ?? ruta;

/** Una ruta de Windows como la ve WSL (`C:\a\x.png` → `/mnt/c/a/x.png`). */
export const rutaWsl = (ruta: string): string => `/mnt/${ruta[0].toLowerCase()}/${ruta.slice(3).replace(/\\/g, "/")}`;

/** El tipo de imagen por los primeros bytes (la extensión sola no alcanza: un enlace simbólico puede apuntar a cualquier cosa). */
export function tipoPorBytes(b: Uint8Array): string | null {
  const es = (...v: number[]) => v.every((x, i) => b[i] === x);
  if (es(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (es(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (es(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (es(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (es(0x42, 0x4d)) return "image/bmp";
  return null;
}
