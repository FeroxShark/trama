// El session id de una corrida para `pa --hilo`: lo que dice su `<id>.sid` y, si no, el `session_id` de su `<id>.json`.
import { readFileSync } from "node:fs";
import path from "node:path";

export function leerLineaSid(dir: string, id: string): string {
  try {
    const s = readFileSync(path.join(dir, `${id}.sid`), "utf8").replace(/\n+$/, "");
    if (s) return s;
  } catch {
    /* sin .sid */
  }
  try {
    const j = JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8")) as { session_id?: unknown } | null;
    const v = j?.session_id;
    if (typeof v === "string") return v;
    if (v !== undefined && v !== null && v !== false) return JSON.stringify(v);
  } catch {
    /* sin json */
  }
  return "";
}
