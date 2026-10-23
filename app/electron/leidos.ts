// Qué hilos ya abrió el usuario: `~/.local/state/hilos/leidos.json`, archivo propio
// de la app (`pa` no tiene "leído"). id → epoch en que se abrió; lo que
// terminó después de esa marca vuelve a ser novedad.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ESTADO, escribirAtomico } from "./pa.js";
import { silencio } from "./log.js";

const ARCHIVO = path.join(ESTADO, "leidos.json");
const VERSION = 1;
/** Las marcas más viejas que esto se tiran al guardar. */
const OLVIDO_S = 60 * 86400;
const DEBOUNCE_MS = 300;

let leidos: Record<string, number> | null = null;
let timer: NodeJS.Timeout | null = null;

export async function leerLeidos(): Promise<Record<string, number>> {
  if (leidos) return leidos;
  try {
    const j = JSON.parse(await readFile(ARCHIVO, "utf8"));
    leidos = j.version === VERSION && j.leidos && typeof j.leidos === "object" ? j.leidos : {};
  } catch {
    leidos = {};
  }
  return leidos!;
}

export async function marcarLeido(id: string, ts: number) {
  const l = await leerLeidos();
  if (typeof id !== "string" || !Number.isFinite(ts)) return;
  l[id] = ts;
  if (timer) clearTimeout(timer);
  timer = setTimeout(guardar, DEBOUNCE_MS);
}

function texto() {
  const corte = Date.now() / 1000 - OLVIDO_S;
  for (const [id, ts] of Object.entries(leidos!)) if (ts < corte) delete leidos![id];
  return JSON.stringify({ version: VERSION, leidos });
}

function guardar() {
  timer = null;
  if (leidos) void escribirAtomico(ARCHIVO, texto()).catch(silencio("leidos"));
}

/** Al salir: lo que quedó esperando el debounce se escribe ya (sincrónico). */
export function guardarYa() {
  if (!timer || !leidos) return;
  clearTimeout(timer);
  timer = null;
  try {
    mkdirSync(ESTADO, { recursive: true });
    writeFileSync(`${ARCHIVO}.tmp`, texto());
    renameSync(`${ARCHIVO}.tmp`, ARCHIVO);
  } catch {}
}
