// El lector incremental de los transcripts (.jsonl) del panel de contexto: por archivo guarda lo que ya leyó (las líneas completas y el
// resto que quedó a medias) y en cada pedido lee sólo lo que el archivo sumó desde entonces. Si se achicó o cambió de inodo (lo
// reescribieron), empieza de cero. Los pedidos de un mismo archivo van en fila: dos lecturas a la vez no duplican líneas. Lo prueba
// `tests/contexto-jsonl.test.ts`.
import { open, stat } from "node:fs/promises";

type Lectura = { pos: number; ino: number; completas: string[]; resto: Buffer; tam: number; mtime: number };

/** Cuántos transcripts quedan leídos en memoria (el panel mira un líder y unos pocos workers). Se saca el más viejo. */
const TOPE = 6;
const NL = 0x0a;
const leidos = new Map<string, Lectura>();
const enFila = new Map<string, Promise<unknown>>();

export type Transcript = {
  /** Las líneas no vacías: las completas y, si el archivo no termina en salto de línea, la última a medias (como antes). */
  lineas: string[];
  /** Tamaño y fecha del archivo al leerlo: con eso se sabe si cambió desde el último pedido. */
  tam: number;
  mtime: number;
};

async function leerNuevo(ruta: string, st: { size: number; ino: number; mtimeMs: number }): Promise<Lectura> {
  let l = leidos.get(ruta);
  if (!l || st.size < l.pos || (l.ino && st.ino && l.ino !== st.ino)) l = { pos: 0, ino: st.ino, completas: [], resto: Buffer.alloc(0), tam: 0, mtime: 0 };
  if (st.size > l.pos) {
    const fh = await open(ruta, "r");
    try {
      const buf = Buffer.alloc(st.size - l.pos);
      const { bytesRead } = await fh.read(buf, 0, buf.length, l.pos);
      const datos = Buffer.concat([l.resto, buf.subarray(0, bytesRead)]);
      const corte = datos.lastIndexOf(NL);
      if (corte >= 0) {
        for (const linea of datos.subarray(0, corte).toString("utf8").split("\n")) if (linea) l.completas.push(linea);
        l.resto = Buffer.from(datos.subarray(corte + 1));
      } else l.resto = Buffer.from(datos);
      l.pos += bytesRead;
    } finally {
      await fh.close();
    }
  }
  l.tam = st.size;
  l.mtime = st.mtimeMs;
  leidos.delete(ruta);
  leidos.set(ruta, l);
  if (leidos.size > TOPE) leidos.delete(leidos.keys().next().value as string);
  return l;
}

async function leerUno(ruta: string): Promise<Transcript | null> {
  const st = await stat(ruta).catch(() => null);
  if (!st) {
    leidos.delete(ruta);
    return null;
  }
  const l = await leerNuevo(ruta, st);
  const cola = l.resto.length ? [l.resto.toString("utf8")] : [];
  return { lineas: [...l.completas, ...cola].filter(Boolean), tam: l.tam, mtime: l.mtime };
}

/** Las líneas de un transcript (`null` si no hay ruta o no existe), leyendo sólo lo nuevo desde la última vez que se pidió. */
export function leerTranscript(ruta: string | null): Promise<Transcript | null> {
  if (!ruta) return Promise.resolve(null);
  const antes = enFila.get(ruta) ?? Promise.resolve();
  const p = antes.then(() => leerUno(ruta));
  const fin = p.catch(() => {});
  enFila.set(ruta, fin);
  void fin.then(() => {
    if (enFila.get(ruta) === fin) enFila.delete(ruta);
  });
  return p;
}
