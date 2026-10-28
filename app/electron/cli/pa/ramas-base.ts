// Lo que comparten --ramas, --integrar y --descartar (motor/bin/pa): el proyecto ya resuelto (`fijar_proyecto`), los campos de una
// `.corrida`, los nombres de puestos y sus candados, lo sucio de un repo, los symlinks de caché, los dirs de build y los huérfanos.
// Todo git va por base/git.ts (sin shell) y los candados por base/lock.ts (las mismas rutas de `lock/` que el flock del bash, como clave).
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git, parsearWorktrees, type ResultadoGit } from "../base/git.ts";
import { borrarSinSeguir, enlazarArchivo, enlazarDir, esLink } from "../base/enlaces.ts";
import { probar, tomar, type Lock } from "../base/lock.ts";
import { rutaReal } from "../proyecto-ruta.ts";
import type { Pa } from "./entorno.ts";

/** Un proyecto ya resuelto (lo que deja `fijar_proyecto` del bash): nombre como lo dijo el que llama, ruta real, slug y su carpeta de estado. */
export interface Proy {
  pa: Pa;
  proyecto: string;
  ruta: string;
  slug: string;
  dir: string;
}

/** `slug_de`: el basename con lo raro a `-`, en minúsculas. */
export const slugDe = (ruta: string) => path.basename(ruta).replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();

export function fijarProyecto(pa: Pa, proyecto: string, ruta: string): Proy {
  const slug = slugDe(ruta);
  const dir = path.join(pa.state, slug);
  mkdirSync(dir, { recursive: true });
  return { pa, proyecto, ruta, slug, dir };
}

/** `leer_campo`: el valor de la primera línea `campo=` del archivo ("" si no está o no se puede leer). */
export function leerCampo(archivo: string, campo: string): string {
  let t: string;
  try {
    t = readFileSync(archivo, "utf8");
  } catch {
    return "";
  }
  for (const l of t.split("\n")) if (l.startsWith(campo + "=")) return l.slice(campo.length + 1);
  return "";
}

/** `%q` de bash para un argumento: tal cual si es seguro, si no con `\` delante de cada carácter especial. */
export function comoQ(s: string): string {
  if (s === "") return "''";
  return s.replace(/[^A-Za-z0-9_\/.,:+@%=^-]/g, (c) => (c.charCodeAt(0) < 0x80 ? `\\${c}` : c));
}

/** La glob `"$dir"/*.<ext>` en el orden del bash (por nombre). */
export function archivosCon(dir: string, ext: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(ext) && n.length > ext.length)
      .sort()
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- git

/** `git -C cwd …` sin tirar. */
export const g = (x: Proy, cwd: string, args: string[], env?: Record<string, string | undefined>): Promise<ResultadoGit> =>
  git(args, { cwd, env: env ?? x.pa.env });

/** `$(git -C cwd …)`: stdout sin los `\n` del final; "" si falló. */
export async function gs(x: Proy, cwd: string, args: string[]): Promise<string> {
  if (!existsSync(cwd)) return "";
  const r = await g(x, cwd, args);
  return r.codigo === 0 ? r.salida.replace(/\n+$/, "") : "";
}

/** ¿El comando git sale 0? */
export async function gOk(x: Proy, cwd: string, args: string[]): Promise<boolean> {
  if (!existsSync(cwd)) return false;
  return (await g(x, cwd, args)).codigo === 0;
}

export const existeRama = (x: Proy, repo: string, rama: string) => gOk(x, repo, ["rev-parse", "-q", "--verify", `refs/heads/${rama}`]);

/** `git worktree list --porcelain` ya parseado (en Windows con `\\`, como las rutas que arma pa). */
const worktrees = async (x: Proy, repo: string) => parsearWorktrees(await gs(x, repo, ["worktree", "list", "--porcelain"]), x.pa.plat);

/** `tree_principal`: el primer worktree que lista git. */
export async function treePrincipal(x: Proy, repo: string): Promise<string> {
  return (await worktrees(x, repo))[0]?.ruta ?? "";
}

/** `rev-list --count` (0 si falla). */
export async function contar(x: Proy, repo: string, rango: string): Promise<number> {
  const n = await gs(x, repo, ["rev-list", "--count", rango]);
  return /^[0-9]+$/.test(n) ? Number(n) : 0;
}

/** `commits_pendientes`: cuántos commits de la rama le faltan al HEAD del tree principal. */
export async function commitsPendientes(x: Proy, repo: string, rama: string): Promise<number> {
  const ppal = (await treePrincipal(x, repo)) || repo;
  return contar(x, ppal, `HEAD..${rama}`);
}

/** `wt_de_rama`: el worktree donde está checkouteada la rama, o "". */
export async function wtDeRama(x: Proy, rama: string): Promise<string> {
  return (await worktrees(x, x.ruta)).find((w) => w.rama === `refs/heads/${rama}`)?.ruta ?? "";
}

// ---------------------------------------------------------------- puestos y candados

export const sufPuesto = (p: string) => (p === "" || p === "1" ? "" : `@${p}`);
export const wtDePuesto = (x: Proy, p: string) => path.join(x.pa.state, "worktrees", x.slug + sufPuesto(p));
export const lockDePuesto = (x: Proy, p: string) => path.join(x.pa.lockdir, x.slug + sufPuesto(p));

/** `puesto_de_ruta`: 1, k o `aca` (cualquier ruta que no sea un puesto de pa). */
export function puestoDeRuta(x: Proy, r: string): string {
  const base = path.join(x.pa.state, "worktrees", x.slug);
  if (r === base) return "1";
  if (r.startsWith(base + "@")) return r.slice(r.lastIndexOf("@") + 1);
  return "aca";
}

/** `puesto_de_corrida`: el `puesto=` de la corrida o, en las viejas, el que se deduce de `ruta_trabajo`. */
export function puestoDeCorrida(x: Proy, c: string): string {
  return leerCampo(c, "puesto") || puestoDeRuta(x, leerCampo(c, "ruta_trabajo"));
}

/** `puesto_libre`: nadie lo tiene tomado. */
export const puestoLibre = async (x: Proy, p: string) => !(await probar(lockDePuesto(x, p), { plat: x.pa.plat, env: x.pa.env }));

/** `tomar_git`: el candado corto de git del proyecto (`-n` sin `esperarMs`, `-w N` con `esperarMs`). */
export const tomarGit = (x: Proy, esperarMs?: number): Promise<Lock | null> =>
  tomar(path.join(x.pa.lockdir, `${x.slug}@git`), { esperarMs, plat: x.pa.plat, env: x.pa.env });

export const tomarLock = (x: Proy, ruta: string, esperarMs?: number): Promise<Lock | null> =>
  tomar(ruta, { esperarMs, plat: x.pa.plat, env: x.pa.env });

// ---------------------------------------------------------------- rutas

/** `realpath -m`: resuelve los symlinks de lo que existe y deja lo que falta tal cual (normalizado). */
export function realpathM(p: string): string {
  let r = path.resolve(p);
  for (let vueltas = 0; vueltas < 40; vueltas++) {
    const partes = r.split(path.sep);
    let hecho = partes[0] || path.sep;
    let cambio = false;
    for (let i = 1; i < partes.length; i++) {
      const sig = path.join(hecho, partes[i]!);
      let st;
      try {
        st = lstatSync(sig);
      } catch {
        return path.join(sig, ...partes.slice(i + 1));
      }
      if (st.isSymbolicLink()) {
        const destino = readlinkSync(sig);
        r = path.resolve(path.dirname(sig), destino, ...partes.slice(i + 1));
        cambio = true;
        break;
      }
      hecho = sig;
    }
    if (!cambio) return hecho;
  }
  return r;
}

/** ¿`p` está adentro de `raiz` (`"$p" == "$raiz"/*`)? */
export const adentroDe = (p: string, raiz: string) => p.startsWith(raiz.endsWith(path.sep) ? raiz : raiz + path.sep);

// ---------------------------------------------------------------- lo sucio

/** `ruta_porcelain`: la ruta de una línea de `status --porcelain` (en un rename, el destino; sin las comillas). */
export function rutaPorcelain(l: string): string {
  let r = l.slice(3);
  const i = r.lastIndexOf(" -> ");
  if (i >= 0) r = r.slice(i + 4);
  if (r.endsWith('"')) r = r.slice(0, -1);
  if (r.startsWith('"')) r = r.slice(1);
  return r;
}

/** `sucios_de`: las líneas porcelain sin los dirs de build sueltos ni los symlinks sueltos que apuntan fuera del repo. */
export async function suciosDe(x: Proy, ruta: string): Promise<string[]> {
  const build = new Set(dirsDeBuild(x, ruta));
  const st = await gs(x, ruta, ["status", "--porcelain"]);
  const r: string[] = [];
  for (const l of st.split("\n")) {
    if (!l) continue;
    const p = rutaPorcelain(l);
    if (build.size && l.startsWith("??") && build.has(p.replace(/\/$/, ""))) continue;
    if (l.startsWith("??") && esLink(path.join(ruta, p))) {
      const resuelto = rutaReal(path.join(ruta, p));
      if (resuelto && !adentroDe(resuelto, ruta)) continue;
    }
    r.push(l);
  }
  return r;
}

// ---------------------------------------------------------------- dirs de build

const NOMBRES_BUILD = new Set(["target", "target-wt", "node_modules", ".venv", "dist", "__pycache__"]);

function esDir(p: string): boolean {
  try {
    const st = lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Los dirs de build de un árbol (el `find -maxdepth 4 … -print -prune`), rutas absolutas. */
function buscarBuild(raiz: string): string[] {
  const r: string[] = [];
  const caminar = (d: string, prof: number) => {
    if (prof > 4) return;
    let ns: string[];
    try {
      ns = readdirSync(d);
    } catch {
      return;
    }
    for (const n of ns) {
      if (n === ".git") continue;
      const p = path.join(d, n);
      if (!esDir(p)) continue;
      if (NOMBRES_BUILD.has(n) || existsSync(path.join(p, "CACHEDIR.TAG"))) {
        r.push(p);
        continue;
      }
      caminar(p, prof + 1);
    }
  };
  caminar(raiz, 1);
  return r;
}

/** ¿Tiene algo trackeado adentro? */
const trackeados = (x: Proy, wt: string, rel: string) => git(["ls-files", "--", rel], { cwd: wt, env: x.pa.env }).then((r) => r.salida.trim() !== "");

/**
 * `dirs_de_build`: rutas relativas de los dirs de build/cache de un worktree de pa (nunca del tree principal). Con `borrar`, uno con CACHEDIR.TAG que no está en la lista de nombres sólo vale si es de cargo.
 * Ésta es la búsqueda (síncrona); el filtro de trackeados lo agrega `dirsDeBuildOk`. Para `sucios_de` alcanza con ésta: un `??` nunca
 * tiene nada trackeado.
 */
export function dirsDeBuild(x: Proy, wt: string, borrar = false): string[] {
  if (!adentroDe(wt, path.join(x.pa.state, "worktrees")) || !existsSync(path.join(wt, ".git"))) return [];
  return buscarBuild(wt)
    .filter((d) => !borrar || NOMBRES_BUILD.has(path.basename(d)) || existsSync(path.join(d, ".rustc_info.json")))
    .map((d) => path.relative(wt, d).split(path.sep).join("/"));
}

/** `dirs_de_build` completo: sin los que tienen archivos trackeados (un `dist/` versionado es del proyecto). */
export async function dirsDeBuildOk(x: Proy, wt: string, borrar = false): Promise<string[]> {
  const r: string[] = [];
  for (const rel of dirsDeBuild(x, wt, borrar)) if (!(await trackeados(x, wt, rel))) r.push(rel);
  return r;
}

/** `limpiar_build`: borra los dirs de build del worktree (sin atravesar enlaces). El que llama tiene el puesto. */
export async function limpiarBuild(x: Proy, wt: string): Promise<void> {
  for (const rel of await dirsDeBuildOk(x, wt, true)) {
    try {
      borrarSinSeguir(path.join(wt, rel));
    } catch {
      /* como el `|| true` del bash */
    }
  }
}

// ---------------------------------------------------------------- cachés enlazadas

const CACHES_CLAUDE = [".venv", ".env", "CLAUDE.local.md", ".claude/settings.local.json"];

/** Los `node_modules` hasta profundidad 3 (`find -maxdepth 3 -name node_modules -prune`), de un tipo (dir real o enlace). */
function nodeModules(raiz: string, enlaces: boolean): string[] {
  const r: string[] = [];
  const caminar = (d: string, prof: number) => {
    let ns: string[];
    try {
      ns = readdirSync(d);
    } catch {
      return;
    }
    for (const n of ns) {
      const p = path.join(d, n);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (n === "node_modules") {
        if (enlaces ? st.isSymbolicLink() : st.isDirectory()) r.push(p);
        if (st.isDirectory()) continue; // -prune
      }
      if (st.isDirectory() && !st.isSymbolicLink() && prof < 3) caminar(p, prof + 1);
    }
  };
  caminar(raiz, 1);
  return r;
}

/** `enlazar_caches`: node_modules, .venv (y .env y las instrucciones locales para los motores que corren `claude`) del tree principal. */
export function enlazarCaches(x: Proy, ppal: string, wt: string, motor = "claude"): void {
  try {
    for (const d of nodeModules(ppal, false)) {
      const rel = path.relative(ppal, d);
      const e = path.join(wt, rel);
      if (!existsSync(e) && !esLink(e)) enlazarDir(d, e, { plat: x.pa.plat });
    }
    const lista = motor === "claude" || motor === "ollama" ? CACHES_CLAUDE : [".venv"];
    for (const f of lista) {
      const de = path.join(ppal, f);
      const a = path.join(wt, f);
      if (!existsSync(de) || existsSync(a) || esLink(a)) continue;
      if (esDir(de)) enlazarDir(de, a, { plat: x.pa.plat });
      else enlazarArchivo(de, a, { plat: x.pa.plat });
    }
  } catch {
    /* enlazar nunca rompe a pa */
  }
}

/** ¿`a` es el mismo archivo que `b` (un hardlink de Windows)? */
function mismoArchivo(a: string, b: string): boolean {
  try {
    const x = statSync(a);
    const y = statSync(b);
    return x.ino !== 0 && x.ino === y.ino && x.dev === y.dev;
  } catch {
    return false;
  }
}

/** `desenlazar_caches`: saca esos enlaces del worktree (en Windows también los hardlinks de archivo al tree principal). */
export function desenlazarCaches(wt: string, ppal?: string): void {
  try {
    for (const f of nodeModules(wt, true)) borrarSinSeguir(f);
    for (const f of CACHES_CLAUDE) {
      const a = path.join(wt, f);
      if (esLink(a) || (ppal && mismoArchivo(a, path.join(ppal, f)))) borrarSinSeguir(a);
    }
  } catch {
    /* nunca rompe */
  }
}

/** `excluir_symlinks_externos`: lo staged que es un symlink que resuelve fuera del worktree sale del staging. */
export async function excluirSymlinksExternos(x: Proy, wt: string): Promise<void> {
  for (const p of (await gs(x, wt, ["diff", "--cached", "--name-only"])).split("\n")) {
    if (!p) continue;
    const modo = (await gs(x, wt, ["ls-files", "-s", "--", p])).split(" ")[0];
    if (modo !== "120000") continue;
    const resuelto = rutaReal(path.join(wt, p)) ?? "";
    if (!resuelto || !adentroDe(resuelto, wt)) {
      await g(x, wt, ["reset", "-q", "--", p]);
      x.pa.io.err(`pa: OJO: '${p}' es un symlink que apunta fuera del worktree (${resuelto}); no lo commiteo.\n`);
    }
  }
}

// ---------------------------------------------------------------- huérfanos y worktrees

/** `date +%Y%m%d-%H%M%S` en hora local. */
export function marcaLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** `corrida_de_huerfana`: la `.corrida` mínima de una rama `pa/<slug>/huerfano-<ts>` para que --ramas/--integrar/--descartar la vean. */
export async function corridaDeHuerfana(x: Proy, rama: string, repo: string, base?: string): Promise<void> {
  const id = rama.slice(rama.lastIndexOf("/") + 1);
  const c = path.join(x.dir, `${id}.corrida`);
  if (existsSync(c)) return;
  const b = base || (await gs(x, repo, ["merge-base", "HEAD", rama]));
  try {
    writeFileSync(c, `ruta_trabajo=${repo}\nrama=${rama}\nbase=${b}\nproyecto=${x.proyecto}\norigen=\nleer=0\npuesto=\njefe=\njefe_id=\n`);
  } catch {
    /* || true */
  }
}

/** `adoptar_huerfanas`: las huérfanas que quedaron sin su `.corrida`. */
export async function adoptarHuerfanas(x: Proy): Promise<void> {
  const t = await gs(x, x.ruta, ["branch", "--list", `pa/${x.slug}/huerfano-*`, "--format=%(refname:short)"]);
  for (const r of t.split("\n")) if (r) await corridaDeHuerfana(x, r, x.ruta);
}

/** `commitear_huerfano`: lo que quedó sin commitear en un worktree de pa se commitea entero (sin build ni symlinks externos). Requiere el candado de git. */
export async function commitearHuerfano(x: Proy, wt: string, ts = ""): Promise<void> {
  desenlazarCaches(wt, x.ruta);
  if ((await suciosDe(x, wt)).length === 0) return;
  let anterior = await gs(x, wt, ["rev-parse", "--abbrev-ref", "HEAD"]);
  let baseH = "";
  if (anterior === "HEAD") {
    baseH = await gs(x, wt, ["rev-parse", "HEAD"]);
    anterior = `pa/${x.slug}/huerfano-${ts || `${marcaLocal()}-${process.pid}`}`;
    await g(x, wt, ["checkout", "-qB", anterior]);
  }
  const fuera = await dirsDeBuildOk(x, wt);
  await g(x, wt, ["add", "-A", "--", ".", ...fuera.map((r) => `:(exclude,literal)${r}`)]);
  if (fuera.length) x.pa.io.err(`pa: no commiteo artefactos de build del huérfano: ${fuera.join(" ")}\n`);
  await excluirSymlinksExternos(x, wt);
  if (!(await gOk(x, wt, ["diff", "--cached", "--quiet"]))) {
    await g(x, wt, ["commit", "-qm", `pa: huérfano de ${anterior}`]);
    x.pa.io.err(`pa: el worktree ${path.basename(wt)} tenía trabajo huérfano; quedó commiteado en '${anterior}'.\n`);
  }
  if (baseH) await corridaDeHuerfana(x, anterior, x.ruta, baseH);
}

/** `asegurar_worktree`: el worktree del puesto, creado si no existe. Requiere el candado de git. */
export async function asegurarWorktree(x: Proy, wt: string): Promise<boolean> {
  if (existsSync(path.join(wt, ".git"))) return true;
  mkdirSync(path.dirname(wt), { recursive: true });
  await g(x, x.ruta, ["worktree", "prune"]);
  if ((await g(x, x.ruta, ["worktree", "add", "--detach", wt, "HEAD"])).codigo === 0) return true;
  x.pa.io.err(`pa: no pude crear el worktree en ${wt}.\n`);
  return false;
}
