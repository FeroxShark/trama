// Lo que dejó un worker que se cayó, para decir por qué: el final de su `.err` y el `result` de su `.json` (en
// `$PA_STATE/<proyecto>/<id>.*`, como los lee cola-pa.ts). Sólo lectura, acotado, y lo que falte es texto vacío.
// Y si el proceso sigue vivo (su `.running` con el pid vivo, o su `.json` vacío recién creado): lo que decide que un
// worker listado como `murio` todavía no se cortó.
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ID = /^\d{8}-\d{6}-\d+$/;
const SLUG = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
/** Del `.err` sólo importa el final (un proceso largo escribe mucho). */
const TOPE_ERR = 4096;
/** El `.json` de resultado es un objeto: más de esto no se parsea (no es un resultado, o es enorme). */
const TOPE_JSON = 512 * 1024;
/** pa crea el `.json` vacío al lanzar y lo llena al terminar: uno vacío de menos de esto es de un worker recién lanzado. */
const JSON_RECIEN_MS = 2 * 60_000;

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

/** Un pid que responde: vivo (o de otro usuario, EPERM). `pid` vacío o no numérico, no. */
function pidVivo(pid: string | undefined): boolean {
  const n = Number(pid);
  if (!/^\d+$/.test(pid ?? "") || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * ¿Sigue corriendo `h`? Su `.running` (en la raíz, `<slug>*.running`, con `id=` de la corrida) con el pid vivo (el del claude;
 * sin él, el de pa, como `pid_vivo` de pa), o su `.json` vacío recién creado. Sin nada de eso, no: se cortó.
 */
export async function procesoVivoDe(raiz: string, h: { id: string; proyecto: string }, ahoraMs = Date.now()): Promise<boolean> {
  if (!ID.test(h.id) || !SLUG.test(h.proyecto)) return false;
  const json = await stat(path.join(raiz, h.proyecto, `${h.id}.json`)).catch(() => null);
  if (json?.size === 0 && ahoraMs - json.mtimeMs < JSON_RECIEN_MS) return true;
  for (const f of await readdir(raiz).catch(() => [] as string[])) {
    if (!f.endsWith(".running")) continue;
    const campos = new Map<string, string>();
    for (const l of (await readFile(path.join(raiz, f), "utf8").catch(() => "")).split("\n")) {
      const i = l.indexOf("=");
      if (i > 0) campos.set(l.slice(0, i), l.slice(i + 1));
    }
    if (campos.get("id") === h.id && pidVivo(campos.get("pid") || campos.get("pa_pid"))) return true;
  }
  return false;
}
