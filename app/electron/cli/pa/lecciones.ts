// Lecciones del proyecto (`pa <proyecto> --leccion "<texto>" | --lecciones | --lecciones-podar`): port de lecciones_revisar,
// leccion_agregar, lecciones_bloque y lecciones_de_medicion de motor/bin/pa. `$STATE/<slug>/lecciones.md`, una línea por lección.
// Tope blando de 30 líneas / 3000 caracteres (pasado eso queda `lecciones.necesita-poda`, que leen `pa --estado` y la app) y tope
// duro de 45 líneas.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tomar } from "../base/lock.ts";
import type { Pa } from "./entorno.ts";
import { leerCampo, type Proy } from "./ramas-base.ts";

export const LECCIONES_LINEAS = 30;
export const LECCIONES_CARS = 3000;
export const LECCIONES_DURO = 45;

/** `date +%F` en hora local. */
export function fechaLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const leer = (f: string): string | null => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};
/** `wc -l`: los `\n`. */
const lineas = (t: string) => (t.match(/\n/g) ?? []).length;
/** `wc -m`: caracteres (no bytes). */
const caracteres = (t: string) => [...t].length;

/** `lecciones_revisar`: pone o saca la marca necesita-poda. */
export function leccionesRevisar(dir: string): void {
  const f = path.join(dir, "lecciones.md");
  const m = path.join(dir, "lecciones.necesita-poda");
  const t = leer(f);
  if (t === null) {
    rmSync(m, { force: true });
    return;
  }
  const l = lineas(t);
  const c = caracteres(t);
  if (l > LECCIONES_LINEAS || c > LECCIONES_CARS) writeFileSync(m, `${l} líneas, ${c} caracteres (tope ${LECCIONES_LINEAS} / ${LECCIONES_CARS})\n`);
  else rmSync(m, { force: true });
}

/** `leccion_agregar`: una línea `- AAAA-MM-DD texto` si la clave (por defecto el texto) no está ya. false si el texto queda vacío. */
export async function leccionAgregar(dir: string, texto: string, clave?: string, plat?: Pa["plat"]): Promise<boolean> {
  let t = texto.replace(/[\n\t]/g, " ").replace(/^\s+/, "").replace(/\s+$/, "");
  t = [...t].slice(0, 240).join("");
  if (!t) return false;
  const k = clave || t;
  const f = path.join(dir, "lecciones.md");
  mkdirSync(dir, { recursive: true });
  const lock = await tomar(path.join(dir, ".lecciones.lock"), { esperarMs: 30_000, plat });
  try {
    const actual = leer(f) ?? "";
    if (!actual.split("\n").some((l) => l.includes(k))) {
      appendFileSync(f, `- ${fechaLocal()} ${t}\n`);
      const nuevo = leer(f) ?? "";
      if (lineas(nuevo) > LECCIONES_DURO) {
        const ls = nuevo.replace(/\n$/, "").split("\n");
        writeFileSync(f, ls.slice(-LECCIONES_DURO).join("\n") + "\n");
      }
    }
  } finally {
    await lock?.liberar();
  }
  leccionesRevisar(dir);
  return true;
}

/** `lecciones_bloque`: lo que va al contrato (las últimas 12 líneas, hasta 1500 caracteres), o "". */
export function leccionesBloque(dir: string): string {
  const todo = leer(path.join(dir, "lecciones.md"));
  if (!todo) return "";
  // `$(tail -n 12 f)`: las últimas 12 líneas, sin los `\n` del final
  let t = todo.replace(/\n$/, "").split("\n").slice(-12).join("\n").replace(/\n+$/, "");
  if (t.length > 1500) {
    t = t.slice(-1500);
    const i = t.indexOf("\n");
    if (i >= 0) t = t.slice(i + 1);
  }
  if (!t) return "";
  return `\nLecciones de corridas anteriores en este proyecto (no repitas esos errores):\n${t}`;
}

/** `pa <proy> --leccion "<texto>"`. */
export async function cmdLeccion(x: Proy, texto: string): Promise<number> {
  const { io } = x.pa;
  if (!(await leccionAgregar(x.dir, texto, undefined, x.pa.plat))) {
    io.err("pa: --leccion quiere un texto corto (una línea).\n");
    return 2;
  }
  const f = path.join(x.dir, "lecciones.md");
  io.out(`pa: lección anotada en ${f} (${lineas(leer(f) ?? "")} líneas).\n`);
  if (existsSync(path.join(x.dir, "lecciones.necesita-poda"))) io.err(`pa: las lecciones de '${x.slug}' necesitan poda: pa '${x.proyecto}' --lecciones-podar.\n`);
  return 0;
}

/** `pa <proy> --lecciones`. */
export function cmdLecciones(x: Proy): number {
  const { io } = x.pa;
  leccionesRevisar(x.dir);
  const t = leer(path.join(x.dir, "lecciones.md"));
  if (t) io.out(t);
  else io.out(`pa: '${x.slug}' no tiene lecciones todavía.\n`);
  const m = leer(path.join(x.dir, "lecciones.necesita-poda"));
  if (m !== null) io.err(`pa: necesita poda (${m.replace(/\n+$/, "")}): pa '${x.proyecto}' --lecciones-podar.\n`);
  return 0;
}

/** `pa <proy> --lecciones-podar`: la instrucción para que un agente las reescriba (no abre nada). */
export function cmdLeccionesPodar(x: Proy): number {
  leccionesRevisar(x.dir);
  x.pa.io.out(
    `Podá las lecciones de '${x.slug}' (no abre nada: lo hace un agente). Releé ${path.join(x.dir, "lecciones.md")} y reescribilo más corto: máximo ${LECCIONES_LINEAS} líneas y ${LECCIONES_CARS} caracteres, una lección por línea con el formato "- AAAA-MM-DD texto". Juntá las repetidas en una, sacá las obsoletas y las que fueron de una corrida puntual, y conservá lo durable (trampas del proyecto, comandos que andan, cosas que no se tocan). Después corré: pa '${x.proyecto}' --lecciones (debe dejar de pedir poda).\n`,
  );
  return 0;
}

/**
 * `lecciones_de_medicion` (de `pa --bien-auto`): las corridas de los últimos PA_LECCION_DIAS días (7) que se descartaron o se
 * retrabajaron dejan una lección en su proyecto, sin repetirse (clave `[id]`), hasta 5 por pasada.
 */
export async function leccionesDeMedicion(pa: Pa, medicion: string, ahora = new Date()): Promise<number> {
  let dias = Number(pa.env.PA_LECCION_DIAS ?? "7");
  if (!/^[0-9]+$/.test(pa.env.PA_LECCION_DIAS ?? "7")) dias = 7;
  const desde = fechaLocal(new Date(ahora.getTime() - dias * 86_400_000));
  const t = leer(medicion);
  if (!t) return 0;
  const filas = t.split("\n");
  const col: Record<string, number> = {};
  (filas[0] ?? "").split("\t").forEach((k, i) => (col[k] = i));
  let n = 0;
  if (col.integrada === undefined) return 0;
  for (const l of filas.slice(1)) {
    if (!l) continue;
    const f = l.split("\t");
    if (f[5] === "1" || (f[0] ?? "").slice(0, 10) < desde) continue;
    let mot = "";
    if (col.retrabajo !== undefined && f[col.retrabajo] === "1") mot = "se retrabajó o se revirtió después de integrarla";
    else if (f[col.integrada] === "0") mot = "se descartó o quedó sin integrar";
    if (!mot) continue;
    const [sl, id, md, tp] = [f[2] ?? "", f[1] ?? "", f[3] ?? "", col.tipo !== undefined ? f[col.tipo] ?? "" : ""];
    const dir = path.join(pa.state, sl);
    if (!id || !sl || !existsSync(dir)) continue;
    if (n >= 5) break;
    const tarea = [...leerCampo(path.join(dir, `${id}.hilo`), "tarea")].slice(0, 100).join("");
    if (await leccionAgregar(dir, `[${id}] ${tp || "sin tipo"} con ${md || "?"}: ${mot}. Tarea: ${tarea}`, `[${id}]`, pa.plat)) n++;
  }
  return n;
}
