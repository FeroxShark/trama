// La conversación de un líder, leída de su transcript sin releerlo entero en cada cambio: por sesión se
// recuerda el estado armado y hasta qué byte se leyó, y cada vez se lee sólo la cola que creció (como
// `temaDe`, electron/tema.ts). Si el archivo se achicó, cambió de inodo o ya no empieza igual (compactación,
// rotación, reescritura), se relee entero una vez.
import { open } from "node:fs/promises";
import { avanzarConv, convNueva, type EstadoConv } from "./lider-arma.ts";

type Archivo = Awaited<ReturnType<typeof open>>;

/** Más de esto por lectura: un transcript enorme se lee de a pedazos, sin cargarlo entero. */
const PEDAZO = 1 << 22;
/** Los últimos bytes leídos: si ya no están donde estaban, el archivo se reescribió. */
const HUELLA = 64;
/** Sesiones con su estado en memoria (las más usadas): lo demás se arma de nuevo al abrirlo. */
export const MAX_SESIONES = 8;

type Entrada = { archivo: string; ino: number; bytes: number; huella: Buffer; est: EstadoConv };

const entradas = new Map<string, Entrada>();
/** Una lectura por sesión a la vez: dos juntas avanzarían el mismo estado dos veces. */
const turnos = new Map<string, Promise<unknown>>();

/** Cuántas veces se leyó desde cero y cuántas sólo la cola (para los tests y la medición). */
export const lecturas = { completas: 0, incrementales: 0 };

/** El estado de la conversación de `sid` al día con su transcript. Nunca rechaza: sin archivo, vacío. */
export function convDe(sid: string, archivo: string | null): Promise<EstadoConv> {
  if (!archivo) return Promise.resolve(convNueva());
  const antes = turnos.get(sid) ?? Promise.resolve();
  const esta = antes.catch(() => {}).then(() => avanzar(sid, archivo));
  turnos.set(sid, esta);
  void esta.finally(() => {
    if (turnos.get(sid) === esta) turnos.delete(sid);
  });
  return esta;
}

/** Suelta lo recordado (de una sesión, o de todas). */
export function olvidarConv(sid?: string) {
  if (sid === undefined) entradas.clear();
  else entradas.delete(sid);
}

async function avanzar(sid: string, archivo: string): Promise<EstadoConv> {
  let f: Archivo;
  try {
    f = await open(archivo, "r");
  } catch {
    entradas.delete(sid);
    return convNueva();
  }
  try {
    const { size, ino } = await f.stat();
    let e = entradas.get(sid);
    if (e && (e.archivo !== archivo || e.ino !== ino || size < e.bytes || !(await igualHuella(f, e)))) e = undefined;
    if (!e) {
      e = { archivo, ino, bytes: 0, huella: Buffer.alloc(0), est: convNueva() };
      lecturas.completas++;
    } else lecturas.incrementales++;
    entradas.delete(sid);
    entradas.set(sid, e);
    while (entradas.size > MAX_SESIONES) entradas.delete(entradas.keys().next().value!);
    if (size > e.bytes) {
      try {
        await leerCola(f, e, size);
      } catch (err) {
        // A medias: el estado puede tener una mitad sumada. Se descarta y se arma de nuevo la próxima.
        entradas.delete(sid);
        throw err;
      }
    }
    return e.est;
  } catch {
    return convNueva();
  } finally {
    await f.close().catch(() => {});
  }
}

async function igualHuella(f: Archivo, e: Entrada): Promise<boolean> {
  if (!e.huella.length) return true;
  const b = Buffer.alloc(e.huella.length);
  const { bytesRead } = await f.read(b, 0, b.length, e.bytes - e.huella.length);
  return bytesRead === b.length && b.equals(e.huella);
}

/** Suma al estado lo que hay entre `e.bytes` y `size`, sólo por líneas completas. */
async function leerCola(f: Archivo, e: Entrada, size: number): Promise<void> {
  let pos = e.bytes;
  let resto: Buffer = Buffer.alloc(0);
  const chunk = Buffer.alloc(Math.min(PEDAZO, size - pos));
  while (pos < size) {
    const { bytesRead } = await f.read(chunk, 0, Math.min(chunk.length, size - pos), pos);
    if (bytesRead <= 0) break;
    pos += bytesRead;
    const buf = resto.length ? Buffer.concat([resto, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
    // Corta en el último salto de línea: un carácter de varios bytes no queda partido.
    const fin = buf.lastIndexOf(10);
    if (fin < 0) {
      resto = Buffer.from(buf);
      continue;
    }
    avanzarConv(e.est, buf.toString("utf8", 0, fin + 1));
    e.bytes = pos - (buf.length - (fin + 1));
    resto = Buffer.from(buf.subarray(fin + 1));
  }
  // Una última línea sin salto que ya es un JSON entero cuenta (un objeto no es prefijo de otro).
  if (resto.length && pos === size) {
    const txt = resto.toString("utf8");
    let entera = false;
    try {
      entera = JSON.parse(txt) !== undefined;
    } catch {}
    if (entera) {
      avanzarConv(e.est, txt);
      e.bytes = size;
    }
  }
  const n = Math.min(HUELLA, e.bytes);
  const h = Buffer.alloc(n);
  if (n) await f.read(h, 0, n, e.bytes - n);
  e.huella = h;
}
