// Puntos de control por turno del líder (#1787): antes de cada turno se guarda cómo está la carpeta del proyecto y, al
// terminar, otra vez; de ahí salen los archivos que tocó el turno, su diff y «Volver a antes de este turno».
//
// Cómo: el árbol de trabajo se fotografía con git, sin tocar el índice, la rama ni el stash del usuario: un índice
// temporal (`GIT_INDEX_FILE`) parte de HEAD, `git add -A` le suma lo cambiado y lo sin seguir (respeta `.gitignore`) y
// `git write-tree` da el id del árbol. Cada foto se ancla con una referencia `refs/trama/puntos/<sid>/…` para que
// `git gc` no la barra. Una carpeta que no es un repo de git (o el home) no tiene puntos: se dice y ya.
// Linux y Windows igual: sólo `git` con array de args (electron/cli/base/git.ts), sin shell.
// Sin `electron`: lo prueba tests/puntos.test.ts contra repos reales en carpetas temporales.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, unlink, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git, gitOk } from "./cli/base/git.ts";

/** Un archivo que tocó el turno. `A` nuevo, `M` cambiado, `D` borrado. */
export type ArchivoPunto = { ruta: string; estado: "A" | "M" | "D"; mas: number; menos: number };
export type Punto = {
  id: string;
  /** Epoch (ms) de cuando salió el mensaje del usuario. */
  ts: number;
  /** Epoch (ms) de cuando terminó el turno; `null` mientras corre (o si trama se cerró a mitad). */
  fin: number | null;
  /** Árbol de git de la carpeta antes del turno, y después (`null` mientras corre). */
  antes: string;
  despues: string | null;
  /** Lo que tocó el turno; vacío si no cambió nada. */
  archivos: ArchivoPunto[];
  /** Si se volvió a antes de este turno: cuándo. */
  vuelto?: number;
};
type Guardado = { version: 1; raiz: string; puntos: Punto[] };

/** Cuántos puntos se guardan por conversación: los más viejos se sueltan. */
export const MAX_PUNTOS = 40;
/** Lo que se espera a una foto o a un diff de git. */
const TOPE_GIT_MS = 60_000;
/** Un diff más grande que esto se corta (la vista lo dice). */
export const MAX_DIF = 512 * 1024;

const IDENTIDAD = { GIT_AUTHOR_NAME: "trama", GIT_AUTHOR_EMAIL: "trama@localhost", GIT_COMMITTER_NAME: "trama", GIT_COMMITTER_EMAIL: "trama@localhost" };

/** Las operaciones de una misma conversación van de a una (la foto de «después» no pisa a la de la que sigue). */
const colas = new Map<string, Promise<unknown>>();
function enCola<T>(sid: string, f: () => Promise<T>): Promise<T> {
  const r = (colas.get(sid) ?? Promise.resolve()).catch(() => {}).then(f);
  const marca = r.catch(() => {});
  colas.set(sid, marca);
  void marca.then(() => {
    if (colas.get(sid) === marca) colas.delete(sid);
  });
  return r;
}

const archivoDe = (estado: string, sid: string) => path.join(estado, "puntos", `${sid.replace(/[^\w.-]/g, "_")}.json`);

function leer(estado: string, sid: string): Guardado | null {
  try {
    const j = JSON.parse(readFileSync(archivoDe(estado, sid), "utf8")) as Partial<Guardado> | null;
    if (j?.version !== 1 || typeof j.raiz !== "string" || !Array.isArray(j.puntos)) return null;
    return { version: 1, raiz: j.raiz, puntos: j.puntos.filter((p) => p && typeof p.id === "string" && typeof p.antes === "string") };
  } catch {
    return null;
  }
}

function escribir(estado: string, sid: string, g: Guardado) {
  const a = archivoDe(estado, sid);
  mkdirSync(path.dirname(a), { recursive: true });
  const tmp = `${a}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(g));
  renameSync(tmp, a);
}

/** La raíz del repo que contiene a `cwd`, o `null` (sin git, sin repo, sin carpeta o el home: ahí no se fotografía nada). */
export async function raizDe(cwd: string | undefined, home = os.homedir()): Promise<string | null> {
  if (!cwd || path.resolve(cwd) === path.resolve(home)) return null;
  const r = await git(["rev-parse", "--show-toplevel"], { cwd, timeoutMs: 10_000 });
  if (r.codigo !== 0) return null;
  const raiz = r.salida.trim();
  // Un repo que es el home o más arriba (el de los dotfiles) sería fotografiar medio disco.
  if (!raiz || path.resolve(raiz) === path.resolve(home) || path.resolve(home).startsWith(path.resolve(raiz) + path.sep)) return null;
  return raiz;
}

/** Corre `f` con un índice temporal que parte de HEAD (si hay) y lo borra después. */
async function conIndice<T>(raiz: string, f: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "trama-punto-"));
  const env = { GIT_INDEX_FILE: path.join(dir, "indice"), ...IDENTIDAD };
  try {
    await git(["read-tree", "HEAD"], { cwd: raiz, env: { ...process.env, ...env }, timeoutMs: TOPE_GIT_MS });
    return await f(env);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const entorno = (env: Record<string, string>) => ({ ...process.env, ...env });

/** Fotografía la carpeta: el id del árbol de git con todo lo que hay (menos lo ignorado). */
export function arbol(raiz: string): Promise<string> {
  return conIndice(raiz, async (env) => {
    await gitOk(["add", "-A", "--", "."], { cwd: raiz, env: entorno(env), timeoutMs: TOPE_GIT_MS });
    return gitOk(["write-tree"], { cwd: raiz, env: entorno(env), timeoutMs: TOPE_GIT_MS });
  });
}

/** Ancla un árbol con una referencia (un commit suelto que lo apunta) para que `git gc` no lo barra. */
async function anclar(raiz: string, sid: string, nombre: string, arb: string) {
  const c = await gitOk(["commit-tree", arb, "-m", `trama: punto ${nombre}`], { cwd: raiz, env: entorno(IDENTIDAD), timeoutMs: TOPE_GIT_MS });
  await gitOk(["update-ref", `refs/trama/puntos/${sid.replace(/[^\w.-]/g, "_")}/${nombre}`, c], { cwd: raiz, timeoutMs: TOPE_GIT_MS });
}

async function soltarRefs(raiz: string, sid: string, id: string) {
  for (const l of ["antes", "despues"]) await git(["update-ref", "-d", `refs/trama/puntos/${sid.replace(/[^\w.-]/g, "_")}/${id}-${l}`], { cwd: raiz, timeoutMs: 10_000 });
}

/** Los archivos que cambian de un árbol a otro, con sus líneas. */
export async function cambios(raiz: string, a: string, b: string): Promise<ArchivoPunto[]> {
  const estados = await gitOk(["diff-tree", "-r", "--no-renames", "--name-status", "-z", a, b], { cwd: raiz, timeoutMs: TOPE_GIT_MS });
  const cuentas = await gitOk(["diff-tree", "-r", "--no-renames", "--numstat", "-z", a, b], { cwd: raiz, timeoutMs: TOPE_GIT_MS });
  const lineas = new Map<string, [number, number]>();
  // numstat -z: «mas\tmenos\truta\0» (binario: «-\t-\truta\0»).
  for (const f of cuentas.split("\0")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(f);
    if (m) lineas.set(m[3], [m[1] === "-" ? 0 : Number(m[1]), m[2] === "-" ? 0 : Number(m[2])]);
  }
  const t = estados.split("\0").filter(Boolean);
  const out: ArchivoPunto[] = [];
  for (let i = 0; i + 1 < t.length; i += 2) {
    const e = t[i][0];
    const ruta = t[i + 1];
    const [mas, menos] = lineas.get(ruta) ?? [0, 0];
    out.push({ ruta, estado: e === "A" ? "A" : e === "D" ? "D" : "M", mas, menos });
  }
  return out.sort((x, y) => x.ruta.localeCompare(y.ruta));
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: "sinGit" | "sinPunto" | "ocupado" | "fallo"; detalle?: string };

/**
 * Antes de que salga el mensaje del usuario: fotografía la carpeta. Devuelve el punto, o `null` si la carpeta no es un repo (o
 * git falló: un punto que no se pudo sacar nunca frena un turno).
 */
export function antes(estado: string, sid: string, cwd: string | undefined, ahora = Date.now()): Promise<Punto | null> {
  return enCola(sid, async () => {
    try {
      const raiz = await raizDe(cwd);
      if (!raiz) return null;
      const arb = await arbol(raiz);
      const previo = leer(estado, sid);
      const g: Guardado = previo && previo.raiz === raiz ? previo : { version: 1, raiz, puntos: [] };
      // El anterior que quedó sin cerrar (trama se cerró a mitad, o el turno murió): se cierra acá.
      const ult = g.puntos.at(-1);
      if (ult && ult.fin === null) ult.fin = ahora;
      const p: Punto = { id: `${ahora.toString(36)}${g.puntos.length.toString(36)}`, ts: ahora, fin: null, antes: arb, despues: null, archivos: [] };
      await anclar(raiz, sid, `${p.id}-antes`, arb);
      g.puntos.push(p);
      while (g.puntos.length > MAX_PUNTOS) await soltarRefs(raiz, sid, g.puntos.shift()!.id);
      escribir(estado, sid, g);
      return p;
    } catch {
      return null;
    }
  });
}

/** Cuando termina el turno: fotografía otra vez y anota qué tocó. Sin punto abierto, no hace nada. */
export function despues(estado: string, sid: string, ahora = Date.now()): Promise<Punto | null> {
  return enCola(sid, async () => {
    try {
      const g = leer(estado, sid);
      const p = g?.puntos.at(-1);
      if (!g || !p || p.fin !== null) return null;
      const arb = await arbol(g.raiz);
      p.despues = arb;
      p.fin = ahora;
      p.archivos = arb === p.antes ? [] : await cambios(g.raiz, p.antes, arb);
      if (arb !== p.antes) await anclar(g.raiz, sid, `${p.id}-despues`, arb);
      escribir(estado, sid, g);
      return p;
    } catch {
      return null;
    }
  });
}

/** Los puntos de una conversación, del más viejo al más nuevo (sin git ni nada guardado: vacío). */
export function lista(estado: string, sid: string): Punto[] {
  return leer(estado, sid)?.puntos ?? [];
}

/** El diff (unificado) de un turno, de un archivo o de todos. Cortado a `MAX_DIF`. */
export function dif(estado: string, sid: string, id: string, ruta?: string): Promise<Resultado<{ texto: string; cortado: boolean }>> {
  return enCola(sid, async () => {
    const g = leer(estado, sid);
    const p = g?.puntos.find((x) => x.id === id);
    if (!g || !p) return { ok: false, motivo: "sinPunto" };
    if (p.despues === null) return { ok: false, motivo: "ocupado" };
    const args = ["diff-tree", "-p", "-r", "--no-renames", "--no-color", "--no-ext-diff", p.antes, p.despues, ...(ruta ? ["--", ruta] : [])];
    const r = await git(args, { cwd: g.raiz, timeoutMs: TOPE_GIT_MS });
    if (r.codigo !== 0) return { ok: false, motivo: "fallo", detalle: r.errores.trim().slice(-300) };
    // diff-tree con dos árboles imprime primero el id; el diff empieza en la primera línea `diff --git`.
    const i = r.salida.indexOf("diff --git");
    const texto = i < 0 ? "" : r.salida.slice(i);
    return { ok: true, valor: texto.length > MAX_DIF ? { texto: texto.slice(0, MAX_DIF), cortado: true } : { texto, cortado: false } };
  });
}

/** Una ruta que git dio, ya dentro de la raíz (nunca se borra ni escribe afuera). */
const dentro = (raiz: string, ruta: string) => {
  const r = path.resolve(raiz, ruta);
  return r.startsWith(path.resolve(raiz) + path.sep) ? r : null;
};

/**
 * «Volver a antes de este turno»: deja la carpeta como estaba cuando salió el mensaje. Lo cambiado o borrado en los turnos desde
 * entonces se restaura; lo creado después se borra. Antes se ancla una foto de cómo estaba (`refs/trama/puntos/<sid>/volver-…`)
 * para poder deshacerlo a mano con git. Quien llama se asegura de que el líder no esté trabajando.
 */
export function volver(estado: string, sid: string, id: string, ahora = Date.now()): Promise<Resultado<{ restaurados: number; borrados: number }>> {
  return enCola(sid, async () => {
    const g = leer(estado, sid);
    const p = g?.puntos.find((x) => x.id === id);
    if (!g || !p) return { ok: false, motivo: "sinPunto" };
    try {
      const hoy = await arbol(g.raiz);
      await anclar(g.raiz, sid, `volver-${ahora.toString(36)}`, hoy);
      const dist = await cambios(g.raiz, p.antes, hoy);
      const borrar = dist.filter((a) => a.estado === "A");
      const traer = dist.filter((a) => a.estado !== "A");
      if (traer.length) {
        await conIndice(g.raiz, async (env) => {
          await gitOk(["read-tree", p.antes], { cwd: g.raiz, env: entorno(env), timeoutMs: TOPE_GIT_MS });
          const r = await git(["checkout-index", "-f", "-z", "--stdin"], { cwd: g.raiz, env: entorno(env), input: traer.map((a) => a.ruta).join("\0") + "\0", timeoutMs: TOPE_GIT_MS });
          if (r.codigo !== 0) throw new Error(r.errores.trim().slice(-300));
        });
      }
      let borrados = 0;
      for (const a of borrar) {
        const f = dentro(g.raiz, a.ruta);
        if (!f) continue;
        await unlink(f).then(() => borrados++, () => {});
        // Las carpetas que quedaron vacías (las que creó el turno) se van también.
        for (let d = path.dirname(f); d !== path.resolve(g.raiz) && d.startsWith(path.resolve(g.raiz)); d = path.dirname(d)) {
          if (!(await rmdir(d).then(() => true, () => false))) break;
        }
      }
      p.vuelto = ahora;
      escribir(estado, sid, g);
      return { ok: true, valor: { restaurados: traer.length, borrados } };
    } catch (e) {
      return { ok: false, motivo: "fallo", detalle: String((e as Error)?.message ?? e).slice(-300) };
    }
  });
}
