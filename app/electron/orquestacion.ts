// La orquestación de `pa` que la app muestra y dispara (motor/bin/pa, "Orquestación 2026-10-26"): las lecciones de un proyecto
// que pasaron el tope (`lecciones.necesita-poda`), la auditoría de una rama (`--auditar`) y la plantilla de AGENTS.md.
// Node puro, como paneles.ts. Todo lo que toca disco o corre `pa` recibe sus dependencias, para probarlo con un `pa` falso.
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorT } from "./errores.ts";
import { ID } from "./pa.js";

/** Los topes de `pa` (LECCIONES_LINEAS / LECCIONES_CARS): pasados, el proyecto "necesita poda". */
export const LECCIONES_LINEAS = 30;
export const LECCIONES_CARS = 3000;
/** Lo más largo que se acepta guardar a mano: el tope duro de `pa` son 45 líneas; esto es sólo para no escribir cualquier cosa. */
const LECCIONES_MAX_CARS = 40_000;

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MODELO = /^[A-Za-z0-9][\w.\[\]-]*$/;

export type LeccionesPendiente = { proyecto: string; motivo: string };
export type Corrida = (args: string[]) => Promise<{ rc: number; out: string; dijo: string }>;

/** El nombre del registry que va como `pa <proyecto>`: no vacío, sin saltos y sin "-" adelante (sería un flag). */
const nombreOk = (nombre: string): void => {
  if (!nombre || nombre.startsWith("-") || /[\n\r\0]/.test(nombre)) throw errorT("main.proyectoRaro", { v: nombre });
};

const slugDe = (x: unknown): string => {
  const s = String(x ?? "");
  if (!SLUG.test(s)) throw errorT("main.proyectoRaro", { v: s });
  return s;
};

/** Los proyectos cuyas lecciones pasaron el tope: una carpeta del estado de `pa` con `lecciones.necesita-poda` (su texto es el porqué). */
export async function leccionesPendientes(estado: string): Promise<LeccionesPendiente[]> {
  let nombres: string[];
  try {
    nombres = await readdir(estado);
  } catch {
    return [];
  }
  const r: LeccionesPendiente[] = [];
  for (const n of nombres.sort()) {
    if (!SLUG.test(n)) continue;
    try {
      const motivo = (await readFile(path.join(estado, n, "lecciones.necesita-poda"), "utf8")).trim();
      r.push({ proyecto: n, motivo });
    } catch {
      /* sin marca: no necesita poda */
    }
  }
  return r;
}

/** Lo que `pa <proy> --lecciones-podar` le dice a un agente (la instrucción para reescribir lecciones.md); rechaza con lo que dijo `pa`. */
export async function textoPoda(nombre: string, correr: Corrida): Promise<string> {
  nombreOk(nombre);
  const r = await correr([nombre, "--lecciones-podar"]);
  if (r.rc !== 0 || !r.out.trim()) throw new Error(r.dijo || `pa --lecciones-podar: salió ${r.rc}`);
  return r.out.trim();
}

export async function leerLecciones(estado: string, slug: unknown): Promise<string> {
  try {
    return await readFile(path.join(estado, slugDe(slug), "lecciones.md"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

/** Lo que `pa` pone en la marca `necesita-poda` (lecciones_revisar), y cuándo corresponde. */
export const marcaPoda = (texto: string): string | null => {
  const l = texto === "" ? 0 : texto.split("\n").length - (texto.endsWith("\n") ? 1 : 0);
  const c = [...texto].length;
  return l > LECCIONES_LINEAS || c > LECCIONES_CARS ? `${l} líneas, ${c} caracteres (tope ${LECCIONES_LINEAS} / ${LECCIONES_CARS})\n` : null;
};

/** Guarda lecciones.md y pone o saca la marca igual que `pa` (así el aviso se va al podar a mano). Devuelve si todavía necesita poda. */
export async function guardarLecciones(estado: string, slug: unknown, texto: unknown): Promise<{ necesitaPoda: boolean }> {
  const s = slugDe(slug);
  if (typeof texto !== "string" || texto.length > LECCIONES_MAX_CARS) throw errorT("main.leccionesTexto");
  const dir = path.join(estado, s);
  try {
    if (!(await stat(dir)).isDirectory()) throw new Error("no es una carpeta");
  } catch {
    throw errorT("main.proyectoRaro", { v: s });
  }
  const limpio = texto.replace(/\r\n/g, "\n");
  const f = path.join(dir, "lecciones.md");
  const tmp = `${f}.trama-${process.pid}.tmp`;
  await writeFile(tmp, limpio);
  await rename(tmp, f);
  const marca = marcaPoda(limpio);
  const m = path.join(dir, "lecciones.necesita-poda");
  if (marca) await writeFile(m, marca);
  else await rm(m, { force: true });
  return { necesitaPoda: marca !== null };
}

// --- Auditar una rama ---------------------------------------------------------------

/** `--auditar` sólo corre con la familia Claude (alias o id `claude-…`): dsh, opencode y los demás motores no. */
export const modeloAuditable = (m: unknown): boolean => typeof m === "string" && MODELO.test(m) && (/^claude-/.test(m) || /^(opus|sonnet|haiku)(\[[\w]+\])?$/.test(m));

export type PedidoAuditar = { id: string; proyecto: string; modelo: string };

/** `pa <proy> --auditar <id> -m <modelo> --async`: un revisor de sólo lectura sobre la rama de ese worker. Valida todo: va como argumento. */
export function argvAuditar(x: PedidoAuditar, nombre: string): string[] {
  if (!ID.test(String(x?.id))) throw errorT("main.idRaro", { v: String(x?.id) });
  nombreOk(nombre);
  if (!modeloAuditable(x.modelo)) throw errorT("main.auditarModelo", { v: String(x.modelo) });
  return [nombre, "--auditar", x.id, "-m", x.modelo, "--async"];
}

// --- AGENTS.md ----------------------------------------------------------------------

/** Lo que `pa <proy> --agents-md` dijo: la plantilla (stdout) si falta el archivo, o el aviso (stderr) si ya existe. */
export type DatosAgentsMd = { existe: boolean; plantilla: string | null; aviso: string };

export async function datosAgentsMd(nombre: string, correr: Corrida): Promise<DatosAgentsMd> {
  nombreOk(nombre);
  const r = await correr([nombre, "--agents-md"]);
  if (r.rc !== 0) throw new Error(r.dijo || `pa --agents-md: salió ${r.rc}`);
  const plantilla = r.out.trim();
  // Con el archivo ya hecho `pa` no imprime plantilla: sólo avisa por stderr.
  return { existe: plantilla === "", plantilla: plantilla || null, aviso: r.dijo };
}
