// Lo que dejó un worker que se cayó, para decir por qué: el final de su `.err` y el `result` de su `.json` (en
// `$PA_STATE/<proyecto>/<id>.*`, como los lee cola-pa.ts). Sólo lectura, acotado, y lo que falte es texto vacío.
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ID = /^\d{8}-\d{6}-\d+$/;
const SLUG = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
/** Del `.err` sólo importa el final (un proceso largo escribe mucho). */
const TOPE_ERR = 4096;
/** El `.json` de resultado es un objeto: más de esto no se parsea (no es un resultado, o es enorme). */
const TOPE_JSON = 512 * 1024;

async function finalDe(archivo: string, bytes: number): Promise<string> {
  const fd = await open(archivo, "r").catch(() => null);
  if (!fd) return "";
  try {
    const { size } = await fd.stat();
    const desde = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - desde);
    await fd.read(buf, 0, buf.length, desde);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    await fd.close().catch(() => {});
  }
}

/** El texto para entender por qué murió `h`: el final del `.err` y el `result` del `.json`. */
export async function rastroDeWorker(raiz: string, h: { id: string; proyecto: string }): Promise<string> {
  if (!ID.test(h.id) || !SLUG.test(h.proyecto)) return "";
  const base = path.join(raiz, h.proyecto, h.id);
  const err = await finalDe(`${base}.err`, TOPE_ERR);
  let resultado = "";
  const json = `${base}.json`;
  if (((await stat(json).catch(() => null))?.size ?? Infinity) <= TOPE_JSON) {
    try {
      const j = JSON.parse(await readFile(json, "utf8"));
      if (typeof j?.result === "string") resultado = j.result.slice(-TOPE_ERR);
    } catch {}
  }
  return [err, resultado].filter(Boolean).join("\n");
}
