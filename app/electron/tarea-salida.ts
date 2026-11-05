// La salida en vivo de una tarea de fondo del líder (src/hilo/Fondo.tsx): las últimas líneas del archivo que el resultado de la
// herramienta nombra en "Output is being written to: <ruta>". Va por un canal (`tarea:salida`), que también se llama desde la
// tailnet, así que NO lee lo que pida el cliente: sólo archivos de salida de tareas del harness, que viven en
// `<tmp>/claude[-<uid>]/<cwd>/<sid>/tasks/<id>.output` (Linux: /tmp/claude-<uid>/…; Windows: os.tmpdir()\claude\…). La ruta se
// resuelve (enlaces simbólicos incluidos) ANTES de validar: un enlace dentro de `tasks/` que apunta a otro lado no sirve.
// Lee sólo el FINAL (tope de bytes) aunque el archivo pese GB, descarta la línea que quedó cortada al principio y limpia ANSI.
// Nunca lanza: lo que no está o no es una salida de tarea es `null` ("sin salida todavía"). Lo prueba `tests/tarea-salida.test.ts`.
import { realpath as realpathNativo } from "node:fs";
import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Cuánto se lee del final del archivo (bytes). */
export const TOPE_SALIDA = 16 * 1024;
/** Cuántas líneas, a lo sumo, se devuelven (las últimas). */
export const LINEAS_SALIDA = 200;
const LARGO_RUTA = 1024;

export type SalidaTarea = { texto: string; recortado: boolean };

const real = (r: string): Promise<string> => new Promise((ok, no) => realpathNativo.native(r, (e, v) => (e ? no(e) : ok(v))));

/** Las raíces donde el harness deja sus archivos temporales en esta plataforma (sin resolver). */
function raicesTmp(plataforma: NodeJS.Platform, tmp: string): string[] {
  return plataforma === "win32" ? [tmp] : [...new Set([tmp, "/tmp"])];
}

/**
 * ¿`ruta` (ya resuelta, absoluta) es el archivo de salida de una tarea bajo alguna de `raices` (ya resueltas)? Puro y por texto.
 * `<raíz>/claude[-<uid>]/…/tasks/<id>.output`: al menos la carpeta del harness, una intermedia, `tasks` y el archivo.
 */
export function esSalidaDeTarea(ruta: string, raices: readonly string[], plataforma: NodeJS.Platform = process.platform): boolean {
  const win = plataforma === "win32";
  const p = win ? path.win32 : path.posix;
  const norm = (x: string) => (win ? x.toLowerCase() : x);
  if (!p.isAbsolute(ruta) || !/\.output$/i.test(ruta)) return false;
  for (const raiz of raices) {
    const rel = p.relative(norm(p.resolve(raiz)), norm(p.resolve(ruta)));
    if (!rel || rel.startsWith("..") || p.isAbsolute(rel)) continue;
    const partes = rel.split(p.sep);
    if (partes.length >= 4 && /^claude(-\d+)?$/.test(partes[0]) && partes[partes.length - 2] === "tasks") return true;
  }
  return false;
}

// CSI (colores, cursor), OSC (título, enlaces) y los escapes sueltos de una letra.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]/g;
// Lo de control que no es tabulador ni salto (el \r lo trata `limpiarSalida`).
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Quita las secuencias ANSI y los controles; en una línea con `\r` (barras de progreso) queda lo último que se escribió. */
export function limpiarSalida(x: string): string {
  return x
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.replace(/\r+$/, "").split("\r").pop() ?? "")
    .join("\n")
    .replace(CONTROL, "");
}

/** Los últimos bytes de `b` como texto: si el archivo seguía antes, la primera línea (cortada) se descarta. */
export function colaDeBytes(b: Buffer, hayAntes: boolean): string {
  let desde = 0;
  if (hayAntes) {
    const nl = b.indexOf(0x0a);
    if (nl >= 0) desde = nl + 1;
    else while (desde < b.length && (b[desde] & 0xc0) === 0x80) desde++; // una sola línea gigante: sólo no empezar a mitad de un carácter
  }
  const lineas = limpiarSalida(b.subarray(desde).toString("utf8")).replace(/\n+$/, "").split("\n");
  return lineas.slice(-LINEAS_SALIDA).join("\n");
}

/** Las últimas líneas de la salida de la tarea cuya ruta es `x`; `null` si no es una salida de tarea, no está o no se pudo leer. */
export async function leerSalidaTarea(x: unknown, plataforma: NodeJS.Platform = process.platform, tmp: string = os.tmpdir()): Promise<SalidaTarea | null> {
  if (typeof x !== "string" || !x || x.length > LARGO_RUTA || /[\u0000-\u001f]/.test(x)) return null;
  const p = plataforma === "win32" ? path.win32 : path.posix;
  if (!p.isAbsolute(x) || x.split(/[\\/]/).includes("..")) return null;
  try {
    const verdadera = await real(x);
    const raices: string[] = [];
    for (const r of raicesTmp(plataforma, tmp)) raices.push(await real(r).catch(() => r));
    if (!esSalidaDeTarea(verdadera, raices, plataforma)) return null;
    const f = await open(verdadera, "r");
    try {
      const s = await f.stat();
      if (!s.isFile()) return null;
      const largo = Math.min(s.size, TOPE_SALIDA);
      const b = Buffer.alloc(largo);
      const { bytesRead } = largo ? await f.read(b, 0, largo, s.size - largo) : { bytesRead: 0 };
      const hayAntes = s.size > largo;
      return { texto: colaDeBytes(b.subarray(0, bytesRead), hayAntes), recortado: hayAntes };
    } finally {
      await f.close();
    }
  } catch {
    return null;
  }
}
