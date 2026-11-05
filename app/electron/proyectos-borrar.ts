// «Borrar proyecto…» (menú del proyecto en el riel): dos niveles, los dos con guardas en el main.
//  · Quitar de Trama (por defecto): el registry lo marca `estado: "retirado"` con `retirado_el` (y `estado_antes`, para reactivarlo igual que estaba).
//    Sale del riel y de los selectores; la carpeta no se toca. Se puede reactivar (`reactivarProyecto`).
//  · Además, mandar la carpeta a la papelera del sistema (`papeleraProyecto`): exige escribir el nombre, nunca borra de forma definitiva, y no
//    corre desde el celular (SOLO_PC_TAILNET). Sin papelera disponible no borra nada: el proyecto queda quitado y se dice.
// Se niega si el proyecto tiene líderes con proceso vivo o workers de `pa` vivos. Lo que ya corrió queda en el historial y los chats sin proceso
// no se tocan. El registry se escribe por la misma vía que `renombrarProyecto` (`escribir`: temporal + `.bak`), nunca un JSON suelto.
// Todo lo que toca el disco, `git` y la papelera entra por `Deps`, así los tests no mandan nada real a ningún lado.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import { errorT, textoT } from "./errores.ts";
import { claveRuta, esCarpetaDeSistema } from "./proyectos-auto.ts";
import { entradas, escribir, listarProyectos, SLUG, type Cruda, type ProyectoNombre } from "./proyectos-alias.ts";
import { plataformaActual, type Plataforma } from "./rutas.ts";
import { real } from "./registro.ts";
import { esWorktreePa } from "./worktrees-pa.ts";

export type Vivos = { lideres: number; workers: number };
export type GitInfo = { sinCommitear: number; sinEmpujar: number };
export type ResultadoPapelera = "ok" | "sin" | "fallo";

export type Deps = {
  /** Cuántos líderes con proceso y workers vivos tiene el proyecto. */
  vivos: (p: { slug: string; ruta: string }) => Promise<Vivos>;
  /** Corre `git <args>` en la carpeta y devuelve su salida; `null` si no es un repo o falla. */
  git?: (ruta: string, args: string[]) => Promise<string | null>;
  /** Manda la carpeta a la papelera del sistema. */
  papelera?: (ruta: string) => Promise<ResultadoPapelera>;
  /** El home de la persona (default: el del sistema). */
  casa?: string;
  ahora?: () => Date;
  plat?: Plataforma;
};

// --- Quién está vivo ---------------------------------------------------------------------------------------------------

const VIVO = new Set(["trabajando", "colgado"]);

/**
 * Cuántos líderes (con proceso) corren dentro de la carpeta del proyecto y cuántos workers de `pa` suyos están vivos (`hilos`: la lista de
 * `pa --hilos`; el `proyecto` de un worker es el slug de `pa`). Un líder cuenta si su `cwd` es la carpeta o está adentro.
 */
export async function contarVivos(
  p: { slug: string; ruta: string },
  lideres: readonly { cwd?: string }[],
  hilos: readonly { proyecto?: unknown; estado?: unknown; en_cola?: unknown }[],
  plat: Plataforma = plataformaActual(),
): Promise<Vivos> {
  const raiz = claveRuta(p.ruta, plat);
  const sep = plat === "win32" ? "\\" : "/";
  let n = 0;
  for (const l of lideres) {
    if (!l.cwd) continue;
    const c = claveRuta(await real(l.cwd), plat);
    if (c === raiz || c.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep)) n++;
  }
  const workers = hilos.filter((h) => h.proyecto === p.slug && (VIVO.has(String(h.estado)) || h.en_cola === true)).length;
  return { lideres: n, workers };
}

// --- Guardas de la ruta ------------------------------------------------------------------------------------------------

/**
 * ¿Se puede mandar esta carpeta a la papelera? `null` si sí; si no, el motivo (texto de i18n codificado). Se resuelve con `realpath` (un enlace
 * no engaña) y se niega si es el home, la raíz o una carpeta del sistema, si el home está adentro, si contiene a otros proyectos del registry
 * o si es un worktree de `pa`.
 */
export function motivoPapelera(ruta: string, otros: readonly { nombre: string; ruta: string }[], casa: string, plat: Plataforma = plataformaActual()): string | null {
  const k = claveRuta(ruta, plat);
  const sep = plat === "win32" ? "\\" : "/";
  const dentro = (hijo: string, padre: string) => hijo === padre || hijo.startsWith(padre.endsWith(sep) ? padre : padre + sep);
  if (esCarpetaDeSistema(ruta, casa, plat) || dentro(claveRuta(casa, plat), k)) return textoT("main.borrar.casa");
  if (esWorktreePa(ruta)) return textoT("main.borrar.worktree");
  const otro = otros.find((o) => dentro(claveRuta(o.ruta, plat), k) && claveRuta(o.ruta, plat) !== k);
  if (otro) return textoT("main.borrar.contiene", { otro: otro.nombre });
  return null;
}

// --- Lo que usa el diálogo ---------------------------------------------------------------------------------------------

export type VistaBorrar = {
  slug: string;
  /** Cómo se ve (el nombre para mostrar, o el del registry): lo que hay que escribir para confirmar la papelera. */
  nombre: string;
  ruta: string;
  existe: boolean;
  /** Ya está quitado de Trama. */
  quitado: boolean;
  /** Por qué no se puede quitar (texto de i18n codificado, para `textoMain`); `null`: se puede. */
  negado: string | null;
  /** Por qué no se puede mandar la carpeta a la papelera; `null`: se puede (ver `hayPapelera`). */
  papeleraNegada: string | null;
  /** Cambios sin commitear y commits sin empujar; `null`: la carpeta no es un repo (o no existe). */
  git: GitInfo | null;
};

const numero = (s: string | null) => {
  const n = Number.parseInt((s ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
};

/** `git status --porcelain` (líneas) y los commits de cualquier rama local que ningún remoto tiene. */
async function infoGit(ruta: string, git: NonNullable<Deps["git"]>): Promise<GitInfo | null> {
  const estado = await git(ruta, ["status", "--porcelain"]);
  if (estado === null) return null;
  const sinCommitear = estado.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  const sinEmpujar = numero(await git(ruta, ["rev-list", "--count", "--branches", "--not", "--remotes"])) ?? 0;
  return { sinCommitear, sinEmpujar };
}

/** `git` de verdad: sin consola en Windows, con tope de tiempo; cualquier falla es `null`. */
export const gitReal: NonNullable<Deps["git"]> = (ruta, args) =>
  new Promise((resolve) => {
    execFile("git", ["-C", ruta, ...args], { windowsHide: true, timeout: 15_000, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (e, out) => resolve(e ? null : String(out)));
  });

/**
 * La papelera del sistema, nunca borrado definitivo. Linux: `gio trash`. Windows: la Papelera de Reciclaje por PowerShell
 * (`Microsoft.VisualBasic.FileIO`), con la ruta por el entorno (sin armar comandos con texto de la persona). `sin`: no hay con qué.
 */
export const papeleraReal: NonNullable<Deps["papelera"]> = (ruta) =>
  new Promise((resolve) => {
    const plat = plataformaActual();
    if (plat === "darwin") return resolve("sin");
    const [cmd, args, env] =
      plat === "win32"
        ? ([
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:TRAMA_PAPELERA, 'OnlyErrorDialogs', 'SendToRecycleBin')",
            ],
            { ...process.env, TRAMA_PAPELERA: ruta },
          ] as const)
        : (["gio", ["trash", "--", ruta], process.env] as const);
    execFile(cmd, [...args], { windowsHide: true, timeout: 120_000, env: env as NodeJS.ProcessEnv }, (e) => {
      if (!e) return resolve("ok");
      resolve((e as NodeJS.ErrnoException).code === "ENOENT" ? "sin" : "fallo");
    });
  });

const nombreDe = (p: { titulo: string | null; nombre: string }) => p.titulo ?? p.nombre;

async function buscar(archivo: string, slug: unknown) {
  const s = String(slug ?? "");
  if (!SLUG.test(s)) throw errorT("main.proyectoRaro", { v: s });
  const proyectos = await listarProyectos(archivo);
  const p = proyectos.find((x) => x.slug === s.toLowerCase());
  if (!p) throw errorT("main.proyectoRaro", { v: s });
  const { json, lista } = await entradas(archivo);
  const propias = lista.filter((e) => e.slug === p.slug);
  const otros = lista.filter((e) => e.slug !== p.slug).map((e) => ({ nombre: e.titulo ?? e.nombre, ruta: e.ruta }));
  return { p, json, propias, otros };
}

async function negarSiVivos(p: ProyectoNombre, deps: Deps) {
  const v = await deps.vivos({ slug: p.slug, ruta: p.ruta });
  if (v.lideres || v.workers) throw errorT("main.borrar.vivos", { lideres: v.lideres, workers: v.workers });
}

/** Lo que el diálogo muestra antes de confirmar: la ruta, si ya está quitado, qué lo impide y el estado de `git`. No cambia nada. */
export async function vistaBorrar(archivo: string, slug: unknown, deps: Deps): Promise<VistaBorrar> {
  const { p, otros } = await buscar(archivo, slug);
  const casa = await real(deps.casa ?? os.homedir());
  let negado: string | null = null;
  try {
    if (p.estado === "retirado") throw errorT("main.borrar.yaQuitado");
    await negarSiVivos(p, deps);
  } catch (e) {
    negado = (e as Error).message;
  }
  const existe = !!(await stat(p.ruta).catch(() => null));
  const papeleraNegada = !existe ? textoT("main.borrar.noExiste") : motivoPapelera(p.ruta, otros, casa, deps.plat);
  const git = existe && !papeleraNegada ? await infoGit(p.ruta, deps.git ?? gitReal) : null;
  return { slug: p.slug, nombre: nombreDe(p), ruta: p.ruta, existe, quitado: p.estado === "retirado" && !!p.retiradoEl, negado, papeleraNegada, git };
}

function marcar(json: { projects: Record<string, unknown>[] }, propias: Cruda[], ahora: Date) {
  for (const e of propias) {
    const r = json.projects[e.i];
    if (typeof r.estado === "string" && r.estado.trim() && r.estado.trim().toLowerCase() !== "retirado") r.estado_antes = r.estado;
    r.estado = "retirado";
    r.retirado_el = ahora.toISOString();
  }
}

/** Quitar de Trama: `estado: "retirado"` + `retirado_el`. Rechaza (clave de i18n) si ya está quitado o tiene líderes o workers vivos. */
export async function quitarProyecto(archivo: string, slug: unknown, deps: Deps): Promise<ProyectoNombre> {
  const { p, json, propias } = await buscar(archivo, slug);
  if (p.estado === "retirado") throw errorT("main.borrar.yaQuitado");
  await negarSiVivos(p, deps);
  marcar(json, propias, (deps.ahora ?? (() => new Date()))());
  await escribir(archivo, json);
  return (await listarProyectos(archivo)).find((x) => x.slug === p.slug) as ProyectoNombre;
}

/** Deshacer el «quitar»: vuelve el `estado` de antes (o ninguno) y saca `retirado_el`. Sólo vale para lo que se quitó así. */
export async function reactivarProyecto(archivo: string, slug: unknown): Promise<ProyectoNombre> {
  const { p, json, propias } = await buscar(archivo, slug);
  if (p.estado !== "retirado" || !p.retiradoEl) throw errorT("main.borrar.noQuitado");
  for (const e of propias) {
    const r = json.projects[e.i];
    if (typeof r.estado_antes === "string" && r.estado_antes.trim()) r.estado = r.estado_antes;
    else delete r.estado;
    delete r.estado_antes;
    delete r.retirado_el;
  }
  await escribir(archivo, json);
  return (await listarProyectos(archivo)).find((x) => x.slug === p.slug) as ProyectoNombre;
}

export type ResultadoBorrar = {
  proyecto: ProyectoNombre;
  /** `ok`: la carpeta está en la papelera. `sin`: no hay papelera en este sistema. `fallo`: la papelera no pudo. En los dos últimos no se borró nada. */
  papelera: ResultadoPapelera;
};

/**
 * Quitar de Trama y mandar la carpeta a la papelera. Antes de tocar nada: el nombre escrito tiene que ser exacto, la carpeta tiene que existir y
 * pasar las guardas de ruta y no puede haber nada vivo. Después quita (aunque la papelera falle, el proyecto queda quitado) y manda la carpeta.
 */
export async function papeleraProyecto(archivo: string, slug: unknown, escrito: unknown, deps: Deps): Promise<ResultadoBorrar> {
  const { p, json, propias, otros } = await buscar(archivo, slug);
  if (typeof escrito !== "string" || escrito !== nombreDe(p)) throw errorT("main.borrar.nombre");
  const casa = await real(deps.casa ?? os.homedir());
  const existe = !!(await stat(p.ruta).catch(() => null));
  if (!existe) throw errorT("main.borrar.noExiste");
  const motivo = motivoPapelera(p.ruta, otros, casa, deps.plat);
  if (motivo) throw new Error(motivo);
  if (p.estado !== "retirado") await negarSiVivos(p, deps);
  if (p.estado !== "retirado") {
    marcar(json, propias, (deps.ahora ?? (() => new Date()))());
    await escribir(archivo, json);
  }
  const papelera = await (deps.papelera ?? papeleraReal)(p.ruta);
  return { proyecto: (await listarProyectos(archivo)).find((x) => x.slug === p.slug) as ProyectoNombre, papelera };
}
