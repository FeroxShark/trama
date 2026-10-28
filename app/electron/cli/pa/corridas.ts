// Lo que comparten los subcomandos que miran corridas sin lanzarlas (--estado, --esperar, --parar, --matar): leer los archivos
// `clave=valor` del estado, el slug de un proyecto, el id de una corrida, `eventos.jsonl`, el `.hilo`, ¿vive el pid? y la admisión
// por RAM. Copia de los helpers de motor/bin/pa con el mismo nombre (leer_campo, slug_de, evento, hilo_poner, anotar_fin,
// proyecto_de_id, nombre_registry, usar_id, workers_sueltos, mem_disponible_mb, ram_reservada_mb, ram_alcanza).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registroProyectos, type Plataforma } from "../../rutas.ts";
import { agregarLinea } from "../base/archivo.ts";
import { tomar } from "../base/lock.ts";
import { vivo as vivoProc } from "../base/proc.ts";
import { resolverProyecto, rutaReal } from "../proyecto-ruta.ts";
import { salir, type Pa } from "./entorno.ts";

export const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const ahoraS = () => Math.floor(Date.now() / 1000);

/** `leer_campo archivo campo`: el valor de la primera línea `campo=…` (vacío si no hay o no se puede leer). */
export function leerCampo(archivo: string, campo: string): string {
  let t: string;
  try {
    t = readFileSync(archivo, "utf8");
  } catch {
    return "";
  }
  for (const l of t.split("\n")) if (l.startsWith(`${campo}=`)) return l.slice(campo.length + 1);
  return "";
}

/** `$(cat archivo)`: el contenido sin los `\n` del final; vacío si no existe. */
export function leerTexto(archivo: string): string {
  try {
    return readFileSync(archivo, "utf8").replace(/\n+$/, "");
  } catch {
    return "";
  }
}

export const esArchivo = (f: string) => {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
};
export const esCarpeta = (f: string) => {
  try {
    return statSync(f).isDirectory();
  } catch {
    return false;
  }
};

/**
 * El orden de un glob de bash (y de `sort`): el de la colación del locale. Con C/POSIX (o sin locale) es por bytes; con un locale
 * UTF-8 de glibc la puntuación no cuenta en la primera pasada (`proy@2.running` va antes que `proy.running`), que es lo que hace
 * ICU con `ignorePunctuation`.
 */
export function comparadorGlob(env: Record<string, string | undefined> = process.env): (a: string, b: string) => number {
  const loc = env.LC_ALL || env.LC_COLLATE || env.LANG || "";
  if (!loc || loc === "C" || loc === "POSIX" || loc.startsWith("C.")) return (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return new Intl.Collator(undefined, { ignorePunctuation: true }).compare;
}
const COMPARAR = comparadorGlob();

/** Los nombres de una carpeta que cumplen `filtro`, en el orden del glob de bash. Vacío si la carpeta no está. */
export function listar(dir: string, filtro: (n: string) => boolean = () => true): string[] {
  try {
    return readdirSync(dir).filter(filtro).sort(COMPARAR);
  } catch {
    return [];
  }
}

/** Las carpetas de proyecto del estado (`$STATE/*\/` sin lock/ ni worktrees/). */
export const carpetasDeProyecto = (state: string) => listar(state, (n) => n !== "lock" && n !== "worktrees" && esCarpeta(path.join(state, n)));

/** `slug_de`: la clave de estado de una ruta real (el nombre de la carpeta, saneado y en minúsculas). */
export const slugDe = (ruta: string) => path.basename(ruta).replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();

/** El slug que escribió el usuario (`${proy,,}` saneado), sin pasar por el registry. */
export const slugCrudo = (proy: string) => proy.toLowerCase().replace(/[^A-Za-z0-9._-]/g, "-");

/** El id de una corrida: `AAAAMMDD-HHMMSS-<pid>` en hora local (el `$(date +%Y%m%d-%H%M%S)-$$` del bash). */
export function idCorrida(pid: number = process.pid, d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${pid}`;
}

// ---------------------------------------------------------------- ¿vive?

/** `kill -0 pid`: existe (un zombie también cuenta, como en bash). Nunca manda una señal real (en Windows tampoco mata). */
export function kill0(pid: string | number | undefined): boolean {
  const n = typeof pid === "number" ? pid : /^[0-9]+$/.test(pid ?? "") ? Number(pid) : 0;
  if (!n || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `vive pid`: existe y no es un zombie. */
export const vive = (pid: string | number | undefined, plat?: Plataforma): boolean => {
  const n = typeof pid === "number" ? pid : /^[0-9]+$/.test(pid ?? "") ? Number(pid) : 0;
  return vivoProc(n, undefined, { plat });
};

/** `pid_vivo`: el pid del claude de un `.running`, o el de su pa si todavía no lo tiene (el `.running` de antes del fork). */
export function pidVivo(running: string): string {
  return leerCampo(running, "pid") || leerCampo(running, "pa_pid");
}
/** `vivo`: el `.running` tiene a alguien vivo. */
export const runningVivo = (running: string) => kill0(pidVivo(running));

// ---------------------------------------------------------------- tiempo

/** `transcurrido`: segundos desde `inicio` como «42s», «3m05s» o «1h02m». */
export function transcurrido(inicio: string | number, ahora = ahoraS()): string {
  const s = ahora - (Number(inicio) || 0);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

/** `date -d @epoch '+%H:%M'` y `'+%Y-%m-%d %H:%M'` en la hora local (respeta TZ). */
const dd = (n: number) => String(n).padStart(2, "0");
export const horaMinuto = (d: Date) => `${dd(d.getHours())}:${dd(d.getMinutes())}`;
export const fechaHora = (d: Date) => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())} ${horaMinuto(d)}`;

/** `find f -maxdepth 0 -mmin +N`: el archivo se modificó hace más de N minutos. */
export function masViejoQue(f: string, minutos: number): boolean {
  try {
    return Date.now() - statSync(f).mtimeMs > minutos * 60_000;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- eventos y .hilo

/** `evento tipo id proyecto [rc]`: una línea en `$STATE/eventos.jsonl` (bajo lock). Nunca rompe a pa. */
export async function evento(pa: Pa, tipo: string, id: string, proyecto: string, rc?: string | number): Promise<void> {
  const l: Record<string, unknown> = { version: 1, ts: ahoraS(), tipo, id, proyecto };
  if (rc !== undefined && rc !== "") l.rc = typeof rc === "number" ? rc : /^-?[0-9]+(\.[0-9]+)?$/.test(rc) ? Number(rc) : rc;
  try {
    await agregarLinea(path.join(pa.state, "eventos.jsonl"), JSON.stringify(l));
  } catch {
    /* nunca rompe a pa */
  }
}

/** `hilo_poner`: deja `campo=valor` (aplanado a una línea) en el `.hilo` de la corrida, pisando el que hubiera. Mismo inodo, bajo lock. */
export async function hiloPoner(dir: string, id: string, campo: string, valor: string): Promise<void> {
  const h = path.join(dir, `${id}.hilo`);
  const lock = await tomar(h, { esperarMs: 10_000 });
  try {
    let previo = "";
    try {
      previo = readFileSync(h, "utf8");
    } catch {
      /* todavía no hay .hilo */
    }
    const lineas = previo.split("\n");
    if (lineas[lineas.length - 1] === "") lineas.pop();
    const quedan = lineas.filter((l) => !l.startsWith(`${campo}=`));
    writeFileSync(h, [...quedan, `${campo}=${valor.replace(/\n/g, " ")}`].join("\n") + "\n");
  } catch {
    /* `|| true` del bash */
  } finally {
    await lock?.liberar();
  }
}

/** `anotar_fin`: la hora en que pa vio terminar la corrida (`fin=` en su `.hilo`), si no estaba ya. */
export async function anotarFin(dir: string, id: string): Promise<void> {
  if (!id) return;
  if (!existsSync(path.join(dir, `${id}.hilo`)) && !existsSync(path.join(dir, `${id}.pid`))) return;
  if (leerCampo(path.join(dir, `${id}.hilo`), "fin")) return;
  await hiloPoner(dir, id, "fin", String(ahoraS()));
}

// ---------------------------------------------------------------- de id a proyecto

/** `fila_integrada`: la última fila de integradas.tsv de ese id, o "". */
export function filaIntegrada(state: string, id: string): string {
  let f = "";
  const lineas = leerTexto(path.join(state, "integradas.tsv")).split("\n");
  for (const l of lineas.slice(1)) if (l.split("\t")[1] === id) f = l;
  return f;
}

/** `proyecto_de_id`: el slug de la corrida (por sus archivos en el estado, o por integradas.tsv), o "". */
export function proyectoDeId(state: string, id: string): string {
  if (!/^[0-9A-Za-z._-]+$/.test(id)) return "";
  const dirs = carpetasDeProyecto(state);
  for (const ext of ["corrida", "hilo", "json", "pid"]) {
    for (const d of dirs) if (existsSync(path.join(state, d, `${id}.${ext}`))) return d;
  }
  return filaIntegrada(state, id).split("\t")[2] ?? "";
}

/** `nombre_registry`: el nombre del registry cuyo path tiene ese slug (lo que entiende `pa <proy>`), o el slug. */
export function nombreRegistry(pa: Pa, slug: string): string {
  const reg = registroProyectos(pa.env, pa.home, pa.plat);
  try {
    const ps = (JSON.parse(readFileSync(reg, "utf8")) as { projects?: Record<string, unknown>[] }).projects ?? [];
    for (const p of Array.isArray(ps) ? ps : []) {
      let r = typeof p.path === "string" ? p.path : "";
      if (!r) continue;
      if (r.startsWith("~")) r = pa.home + r.slice(1);
      if (esArchivo(r)) r = path.dirname(r);
      r = rutaReal(r) ?? path.resolve(r);
      if (slugDe(r) === slug) {
        const n = p.name;
        const v = n === undefined || n === null || n === false ? "" : typeof n === "string" ? n : JSON.stringify(n);
        return v || slug;
      }
    }
  } catch {
    /* sin registry */
  }
  return slug;
}

/** Lo que deja `fijar_proyecto`: las rutas de estado de un proyecto ya resuelto. */
export interface Proyecto {
  proyecto: string;
  ruta: string;
  slug: string;
  /** `$STATE/<slug>`. */
  dir: string;
}

/** `fijar_proyecto`: deja la carpeta de estado del proyecto creada. */
export function fijarProyecto(pa: Pa, proyecto: string, ruta: string): Proyecto {
  const slug = slugDe(ruta);
  const dir = path.join(pa.state, slug);
  mkdirSync(dir, { recursive: true });
  return { proyecto, ruta, slug, dir };
}

/** `proyecto-ruta <nombre>` con su mensaje de error tal cual (sale con su código si no resuelve). */
export function rutaDeProyecto(pa: Pa, proyecto: string, mudo = false): string | null {
  const r = resolverProyecto(proyecto, pa.env, registroProyectos(pa.env, pa.home, pa.plat));
  if (r.ok) return r.ruta;
  if (!mudo) pa.io.err(r.mensaje);
  return null;
}

/** `usar_id`: el proyecto de una corrida, como si hubieran dicho `pa <proyecto>`; sale 1 si no lo encuentra. */
export function usarId(pa: Pa, id: string): Proyecto {
  const s = proyectoDeId(pa.state, id);
  if (!s) {
    pa.io.err(`pa: no encuentro la corrida '${id}' en ${pa.state}.\n`);
    salir(1);
  }
  const proyecto = nombreRegistry(pa, s);
  const ruta = rutaDeProyecto(pa, proyecto, true);
  if (ruta === null) {
    pa.io.err(`pa: la corrida '${id}' es de '${s}', y no encuentro ese proyecto en el registry.\n`);
    salir(1);
  }
  return fijarProyecto(pa, proyecto, ruta!);
}

// ---------------------------------------------------------------- RAM (admisión, 2026-10-21)

/** `workers_sueltos`: claudes vivos cuyo pa ya no está (lo mataron con -9): no tienen lugar tomado pero ocupan RAM. */
export function workersSueltos(state: string): number {
  let n = 0;
  for (const f of listar(state, (x) => x.endsWith(".running"))) {
    const r = path.join(state, f);
    const c = leerCampo(r, "pid");
    const p = leerCampo(r, "pa_pid");
    if (!/^[0-9]+$/.test(c) || !/^[0-9]+$/.test(p)) continue;
    if (kill0(p)) continue;
    if (kill0(c)) n++;
  }
  return n;
}

/** `mem_disponible_mb`: MemAvailable en MB (PA_MEMINFO o /proc/meminfo; fuera de Linux, la memoria libre del sistema). -1 si no se sabe. */
export function memDisponibleMb(pa: Pick<Pa, "env" | "plat">): number {
  const f = pa.env.PA_MEMINFO || (pa.plat === "linux" ? "/proc/meminfo" : "");
  if (!f) return Math.floor(os.freemem() / 1048576);
  let t: string;
  try {
    t = readFileSync(f, "utf8");
  } catch {
    return -1;
  }
  for (const l of t.split("\n")) {
    const [k, v] = l.trim().split(/\s+/);
    if (k === "MemAvailable:") return /^[0-9]+$/.test(v ?? "") ? Math.floor(Number(v) / 1024) : -1;
  }
  return -1;
}

/** `ram_reservada_mb`: el costo de los workers recién admitidos (lock/@ram/<pid> con menos de RAM_RECIEN_MIN min y su pa vivo). Borra los vencidos. */
export function ramReservadaMb(pa: Pa): number {
  const dir = path.join(pa.lockdir, "@ram");
  const ahora = ahoraS();
  let n = 0;
  for (const p of listar(dir)) {
    const f = path.join(dir, p);
    if (!esArchivo(f)) continue;
    const t = (leerTexto(f).split("\n")[0] ?? "").trim();
    if (/^[0-9]+$/.test(t) && ahora - Number(t) < pa.ramRecienMin * 60 && kill0(p)) n += pa.ramWorkerMb;
    else rmSync(f, { force: true });
  }
  return n;
}

export interface Ram {
  disp: number;
  reservada: number;
  haceFalta: number;
  /** Vacío si alcanza. */
  motivo: string;
}

/** `ram_alcanza`: ¿hay RAM para un worker más con `vivos` corriendo? (con 0 vivos, o sin dato, entra siempre). */
export function ramAlcanza(pa: Pa, vivos: number): Ram {
  const disp = memDisponibleMb(pa);
  const reservada = ramReservadaMb(pa);
  const haceFalta = pa.ramWorkerMb + pa.ramReservaMb;
  const r: Ram = { disp, reservada, haceFalta, motivo: "" };
  if (vivos === 0 || disp < 0) return r;
  if (disp - reservada >= haceFalta) return r;
  r.motivo = `RAM: disponible ${disp} MB, reservada ${reservada} MB (workers recién admitidos), hacen falta ${haceFalta} MB (costo ${pa.ramWorkerMb} + reserva ${pa.ramReservaMb})`;
  return r;
}
