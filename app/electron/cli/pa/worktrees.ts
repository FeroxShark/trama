// Worktrees y cachés de `pa` (etapa 7 del port, motor/docs/port-windows-plan.md): el worktree fijo de cada puesto, su rama
// `pa/<slug>/<ts>`, el trabajo huérfano que dejó un worker muerto, los cachés compartidos con el tree principal (node_modules,
// .venv, .env, el target de cargo) y los dirs de build que se borran al soltar el puesto. Copia de motor/bin/pa (enlazar_caches,
// desenlazar_caches, excluir_symlinks_externos, dirs_de_build, limpiar_build, compartir_memoria, wt_de_puesto, puesto_de_corrida,
// puesto_de_ruta, wt_de_rama, tomar_git, corrida_de_huerfana, adoptar_huerfanas, commitear_huerfano, asegurar_worktree,
// preparar_worktree, puesto_para_retomar, sucios_de); los comentarios largos de por qué están allá.
//
// Diferencias con el bash, por Windows:
// - los enlaces de carpeta son junctions y los de archivo hardlink o copia (base/enlaces.ts). Un hardlink o una copia de `.env`
//   no es un symlink, así que `desenlazarCaches` los reconoce comparándolos con el del tree principal (mismo inodo o mismo
//   contenido) y sólo si git no los trackea.
// - los worktrees van en `%LOCALAPPDATA%\trama\wt\<slug>\<k>` (rutas cortas, MAX_PATH) salvo que PA_STATE mande; en Linux siguen
//   en `$STATE/worktrees/<slug>[@k]`.
// - el candado de git es un lock por socket (base/lock.ts) con la ruta de siempre como clave; no se ve con el `flock` del bash.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { raizWindows } from "../../rutas.ts";
import { enlazarArchivo, enlazarDir, borrarSinSeguir, esLink } from "../base/enlaces.ts";
import { git, parsearWorktrees } from "../base/git.ts";
import { tomar, type Lock } from "../base/lock.ts";
import type { Pa } from "./entorno.ts";

/** Lo que `pa <proyecto>` deja armado antes de tocar puestos y worktrees. */
export interface Proyecto {
  pa: Pa;
  /** Como lo nombró el jefe (`$proyecto`). */
  proyecto: string;
  /** El tree principal (`$ruta`, la ruta real). */
  ruta: string;
  /** La clave de estado (`slug_de`). */
  slug: string;
  /** `$STATE/<slug>`: las `.corrida`, `.puesto`, `.cola`… de este proyecto. */
  dir: string;
  /** El id de esta corrida (`AAAAMMDD-HHMMSS-pid`). */
  ts: string;
  /** El motor del worker (claude, ollama, agy, codex, dsh). Vacío = claude (--integrar y compañía). */
  motor?: string;
}

const camino = (pa: Pa) => (pa.plat === "win32" ? path.win32 : path.posix);

// ---------------------------------------------------------------- nombres

/** `escapar`: ~/llama.cpp -> -home-<usuario>-llama-cpp (como hace Claude Code con la carpeta de proyecto). */
export const escapar = (s: string) => s.replace(/[^A-Za-z0-9]/g, "-");

/** `slug_de`: ruta real -> clave de estado (basename, lo raro a `-`, en minúscula: `pa miapp` y `pa MiApp` comparten). */
export const slugDe = (ruta: string) => path.basename(ruta).replace(/[^A-Za-z0-9._-]/g, "-").toLowerCase();

/** Sufijo de estado/lock de un puesto: 1 -> "" (los nombres de siempre), k -> "@k", aca -> "@aca". */
export const sufPuesto = (p: string | number = "1") => (String(p || "1") === "1" ? "" : `@${p}`);

/** Usa la disposición corta de Windows (`%LOCALAPPDATA%\trama\wt\<slug>\<k>`)? Sólo en win32 y sin PA_STATE (los tests lo fijan). */
const wtCorto = (pa: Pa) => pa.plat === "win32" && !pa.env.PA_STATE;

/** La carpeta donde viven los worktrees de pa: nada fuera de ella se trata como worktree de pa (dirs_de_build). */
export const raizWorktrees = (pa: Pa) => (wtCorto(pa) ? path.win32.join(raizWindows(pa.env, pa.home), "wt") : camino(pa).join(pa.state, "worktrees"));

/** `wt_de_puesto`: el worktree fijo del puesto k. */
export function wtDePuesto(x: Proyecto, p: string | number): string {
  if (wtCorto(x.pa)) return path.win32.join(raizWorktrees(x.pa), x.slug, String(p || "1"));
  return camino(x.pa).join(raizWorktrees(x.pa), `${x.slug}${sufPuesto(p)}`);
}

/** Igualdad de rutas: Windows no distingue mayúsculas ni barras. */
const mismaRuta = (pa: Pa, a: string, b: string) =>
  pa.plat === "win32" ? path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase() : a === b;

/** `puesto_de_ruta`: worktrees/<slug> -> 1, worktrees/<slug>@k -> k, cualquier otra -> aca (el tree principal). */
export function puestoDeRuta(x: Proyecto, r: string): string {
  if (wtCorto(x.pa)) {
    const base = path.win32.join(raizWorktrees(x.pa), x.slug);
    if (mismaRuta(x.pa, path.win32.dirname(r), base)) {
      const k = path.win32.basename(r);
      if (/^[0-9]+$/.test(k)) return k;
    }
    return "aca";
  }
  const base = camino(x.pa).join(raizWorktrees(x.pa), x.slug);
  if (mismaRuta(x.pa, r, base)) return "1";
  if (r.startsWith(`${base}@`)) return r.slice(r.lastIndexOf("@") + 1);
  if (x.pa.plat === "win32" && r.toLowerCase().startsWith(`${base}@`.toLowerCase())) return r.slice(r.lastIndexOf("@") + 1);
  return "aca";
}

/** `leer_campo`: el valor de la primera línea `campo=…` de un archivo de estado (vacío si no está). */
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

/** `puesto_de_corrida`: el `puesto=` de la `.corrida`, o deducido de su `ruta_trabajo` (las de antes de los puestos). */
export function puestoDeCorrida(x: Proyecto, corrida: string): string {
  const p = leerCampo(corrida, "puesto");
  if (p) return p;
  return puestoDeRuta(x, leerCampo(corrida, "ruta_trabajo"));
}

// ---------------------------------------------------------------- git

const g = (x: Proyecto, cwd: string, args: string[]) => git(args, { cwd, env: x.pa.env });

/** `git rev-parse -q --verify <ref>`: ¿existe? */
const verifica = async (x: Proyecto, repo: string, ref: string) => (await g(x, repo, ["rev-parse", "-q", "--verify", ref])).codigo === 0;

/** ¿El tree principal tiene git y al menos un commit? (sin eso todo corre en el tree principal, un solo puesto). */
export const tieneHead = (x: Proyecto) => verifica(x, x.ruta, "HEAD");

/** `wt_de_rama`: el worktree donde está checkouteada una rama, o "". */
export async function wtDeRama(x: Proyecto, rama: string): Promise<string> {
  const r = await g(x, x.ruta, ["worktree", "list", "--porcelain"]);
  if (r.codigo !== 0) return "";
  return parsearWorktrees(r.salida, x.pa.plat).find((w) => w.rama === `refs/heads/${rama}`)?.ruta ?? "";
}

/** Toca el archivo del candado (el bash lo crea con `exec N>`; el barrido de `@tope@k` cuenta los que existen). */
export function tocar(archivo: string): void {
  try {
    mkdirSync(path.dirname(archivo), { recursive: true });
    if (!existsSync(archivo)) writeFileSync(archivo, "");
  } catch {
    /* sin el archivo el lock anda igual: la clave es la ruta */
  }
}

/** `tomar_git`: el candado de git del proyecto (`lock/<slug>@git`), siempre CORTO. `esperarMs` 0 = `-n`. null si sigue tomado. */
export async function tomarGit(x: Proyecto, esperarMs: number): Promise<Lock | null> {
  const f = camino(x.pa).join(x.pa.lockdir, `${x.slug}@git`);
  tocar(f);
  return tomar(f, { esperarMs, plat: x.pa.plat, env: x.pa.env });
}

// ---------------------------------------------------------------- archivos sin commitear

/** `ruta_porcelain`: la ruta de una línea de `git status --porcelain` (en un rename, el destino; sin comillas). */
export function rutaPorcelain(l: string): string {
  let r = l.slice(3);
  if (r.includes(" -> ")) r = r.slice(r.lastIndexOf(" -> ") + 4);
  if (r.endsWith('"')) r = r.slice(0, -1);
  if (r.startsWith('"')) r = r.slice(1);
  return r;
}

/** `readlink -f`: la ruta real, o "" si no resuelve. */
const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return "";
  }
};

/** ¿`p` está adentro de `dir` (no es `dir`)? */
const adentro = (pa: Pa, p: string, dir: string) => {
  const sep = pa.plat === "win32" ? "\\" : "/";
  return pa.plat === "win32" ? p.toLowerCase().startsWith((dir + sep).toLowerCase()) : p.startsWith(dir + sep);
};

/**
 * `sucios_de`: las líneas de `git status --porcelain` que son trabajo, sin los symlinks sueltos que apuntan fuera del repo (cachés
 * enlazados) ni, en un worktree de pa, los dirs de build sueltos.
 */
export async function suciosDe(x: Proyecto, ruta: string): Promise<string[]> {
  const build = await dirsDeBuild(x, ruta);
  const r = await g(x, ruta, ["status", "--porcelain"]);
  const out: string[] = [];
  for (const l of r.codigo === 0 ? r.salida.split("\n") : []) {
    if (!l) continue;
    const p = rutaPorcelain(l);
    if (build.length && l.startsWith("??") && build.includes(p.replace(/\/$/, ""))) continue;
    if (l.startsWith("??") && esLink(path.join(ruta, p.replace(/\/$/, "")))) {
      const resuelto = real(path.join(ruta, p.replace(/\/$/, "")));
      if (resuelto && !adentro(x.pa, resuelto, ruta)) continue;
    }
    out.push(l);
  }
  return out;
}

// ---------------------------------------------------------------- cachés

/** Los archivos y carpetas sueltos que se comparten con el tree principal (además de los node_modules). */
const COMPARTIDOS_CLAUDE = [".venv", ".env", "CLAUDE.local.md", ".claude/settings.local.json"];

/** Los node_modules del tree principal hasta profundidad 3 (`find -maxdepth 3 -type d -name node_modules -prune`), relativos. */
function nodeModules(raiz: string, tipo: "dir" | "link"): string[] {
  const out: string[] = [];
  const caminar = (d: string, rel: string, prof: number) => {
    if (prof > 3) return;
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === "node_modules" && (tipo === "dir" ? e.isDirectory() : e.isSymbolicLink())) {
        out.push(r);
        continue;
      }
      if (e.isDirectory()) caminar(path.join(d, e.name), r, prof + 1);
    }
  };
  caminar(raiz, "", 1);
  return out;
}

/** Existe algo en `p` (aunque sea un enlace roto: el bash con `-e` lo vería ausente y el `ln` fallaría; acá se deja estar). */
const hayAlgo = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * `enlazar_caches`: los node_modules (hasta profundidad 3), `.venv` y, sólo para workers que corren el binario `claude` (claude u
 * ollama), `.env` y las instrucciones locales. Crea sólo lo que falta. Devuelve el `CARGO_TARGET_DIR` a exportar si es un
 * proyecto de cargo (el target se comparte por env, no por enlace).
 */
export function enlazarCaches(x: Proyecto, ppal: string, wt: string, motor = x.motor): { cargoTargetDir?: string } {
  const o = { plat: x.pa.plat };
  for (const rel of nodeModules(ppal, "dir")) {
    const dest = path.join(wt, rel);
    if (hayAlgo(dest)) continue;
    try {
      enlazarDir(path.join(ppal, rel), dest, o);
    } catch {
      /* como el `ln -s` del bash: si no se puede, sigue */
    }
  }
  const m = motor || "claude";
  const lista = m === "claude" || m === "ollama" ? COMPARTIDOS_CLAUDE : [".venv"];
  for (const f of lista) {
    const de = path.join(ppal, f);
    const a = path.join(wt, f);
    if (!existsSync(de) || hayAlgo(a)) continue;
    try {
      if (statSync(de).isDirectory()) enlazarDir(de, a, o);
      else enlazarArchivo(de, a, o);
    } catch {
      /* idem */
    }
  }
  return existsSync(path.join(ppal, "Cargo.toml")) ? { cargoTargetDir: path.join(ppal, "target") } : {};
}

/** ¿`a` es la copia/hardlink que dejó enlazarCaches de `de`? (Windows: no son symlinks). */
function esCopiaDe(de: string, a: string): boolean {
  try {
    const sa = statSync(a);
    const sd = statSync(de);
    if (!sa.isFile() || !sd.isFile()) return false;
    if (sa.ino && sa.ino === sd.ino && sa.dev === sd.dev) return true;
    return sa.size === sd.size && readFileSync(a).equals(readFileSync(de));
  } catch {
    return false;
  }
}

/**
 * `desenlazar_caches`: saca del worktree los enlaces que puso enlazarCaches, SIEMPRE antes de tocar HEAD (commit huérfano,
 * checkout). En Windows, los `.env` y compañía que quedaron como hardlink o copia también se sacan si son iguales a los del tree
 * principal y git no los trackea (`ppal` hace falta para eso).
 */
export async function desenlazarCaches(x: Proyecto, wt: string, ppal = x.ruta): Promise<void> {
  for (const rel of nodeModules(wt, "link")) {
    try {
      borrarSinSeguir(path.join(wt, rel));
    } catch {
      /* rm -f */
    }
  }
  for (const f of COMPARTIDOS_CLAUDE) {
    const p = path.join(wt, f);
    if (esLink(p)) {
      try {
        borrarSinSeguir(p);
      } catch {
        /* rm -f */
      }
    } else if (x.pa.plat === "win32" && esCopiaDe(path.join(ppal, f), p)) {
      const t = await g(x, wt, ["ls-files", "--", f]);
      if (t.codigo === 0 && !t.salida.trim()) {
        try {
          unlinkSync(p);
        } catch {
          /* rm -f */
        }
      }
    }
  }
}

/** `excluir_symlinks_externos`: saca del staging todo symlink que resuelva FUERA del worktree, venga de donde venga. */
export async function excluirSymlinksExternos(x: Proyecto, wt: string): Promise<void> {
  const r = await g(x, wt, ["diff", "--cached", "--name-only"]);
  for (const p of r.codigo === 0 ? r.salida.split("\n").filter(Boolean) : []) {
    const modo = (await g(x, wt, ["ls-files", "-s", "--", p])).salida.split(" ")[0];
    if (modo !== "120000") continue;
    const resuelto = real(path.join(wt, p));
    if (!resuelto || !adentro(x.pa, resuelto, wt)) {
      await g(x, wt, ["reset", "-q", "--", p]);
      x.pa.io.err(`pa: OJO: '${p}' es un symlink que apunta fuera del worktree (${resuelto}); no lo commiteo.\n`);
    }
  }
}

const NOMBRES_BUILD = new Set(["target", "target-wt", "node_modules", ".venv", "dist", "__pycache__"]);

/**
 * `dirs_de_build`: los dirs de build/cache de un worktree de pa (relativos), por nombre o por tener CACHEDIR.TAG; nunca enlaces ni
 * uno con archivos trackeados, y sólo adentro de la carpeta de worktrees. Con `borrar`, un CACHEDIR.TAG que no es de cargo
 * (.rustc_info.json) no cuenta (huggingface también lo pone).
 */
export async function dirsDeBuild(x: Proyecto, wt: string, borrar = false): Promise<string[]> {
  if (!adentro(x.pa, wt, raizWorktrees(x.pa)) || !existsSync(path.join(wt, ".git"))) return [];
  const cands: string[] = [];
  const caminar = (d: string, rel: string, prof: number) => {
    if (prof > 4) return;
    let ents;
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name === ".git" || !e.isDirectory()) continue;
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (NOMBRES_BUILD.has(e.name) || existsSync(path.join(abs, "CACHEDIR.TAG"))) {
        if (!borrar || NOMBRES_BUILD.has(e.name) || existsSync(path.join(abs, ".rustc_info.json"))) cands.push(r);
        continue;
      }
      caminar(abs, r, prof + 1);
    }
  };
  caminar(wt, "", 1);
  const out: string[] = [];
  for (const rel of cands) {
    const t = await g(x, wt, ["ls-files", "--", rel]);
    if (t.salida.trim()) continue;
    out.push(rel);
  }
  return out;
}

/** `limpiar_build`: borra los dirs de build de un worktree de pa sin atravesar enlaces. El que llama tiene el puesto. */
export async function limpiarBuild(x: Proyecto, wt: string): Promise<void> {
  for (const rel of await dirsDeBuild(x, wt, true)) {
    try {
      borrarSinSeguir(path.join(wt, rel));
    } catch {
      /* `|| true` */
    }
  }
}

/** La carpeta de proyectos de Claude (`$PROJ`). */
export const carpetaProyectosClaude = (pa: Pa) => pa.env.PA_PROJ || camino(pa).join(pa.home, ".claude", "projects");

/** `compartir_memoria`: la memoria de proyecto de Claude del worktree apunta a la del tree principal. */
export function compartirMemoria(x: Proyecto, ppal: string, wt: string): void {
  const proj = carpetaProyectosClaude(x.pa);
  const de = path.join(proj, escapar(ppal), "memory");
  const a = path.join(proj, escapar(wt));
  mkdirSync(de, { recursive: true });
  mkdirSync(a, { recursive: true });
  if (!hayAlgo(path.join(a, "memory"))) {
    try {
      enlazarDir(de, path.join(a, "memory"), { plat: x.pa.plat });
    } catch {
      /* como el ln */
    }
  }
}

// ---------------------------------------------------------------- huérfanos

/** La hora local como `date +%Y%m%d-%H%M%S`. */
const fechaId = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** `corrida_de_huerfana`: la `.corrida` mínima de una rama huérfana, para que --ramas/--integrar/--descartar la vean. */
export async function corridaDeHuerfana(x: Proyecto, rama: string, repo: string, base?: string): Promise<void> {
  const id = rama.slice(rama.lastIndexOf("/") + 1);
  const f = path.join(x.dir, `${id}.corrida`);
  if (existsSync(f)) return;
  let b = base ?? "";
  if (!b) {
    const r = await g(x, repo, ["merge-base", "HEAD", rama]);
    b = r.codigo === 0 ? r.salida.replace(/\n$/, "") : "";
  }
  try {
    writeFileSync(f, `ruta_trabajo=${repo}\nrama=${rama}\nbase=${b}\nproyecto=${x.proyecto}\norigen=\nleer=0\npuesto=\njefe=\njefe_id=\n`);
  } catch {
    /* || true */
  }
}

/** `adoptar_huerfanas`: las ramas `pa/<slug>/huerfano-*` que quedaron sin su `.corrida`. */
export async function adoptarHuerfanas(x: Proyecto): Promise<void> {
  const r = await g(x, x.ruta, ["branch", "--list", `pa/${x.slug}/huerfano-*`, "--format=%(refname:short)"]);
  for (const rama of r.codigo === 0 ? r.salida.split("\n").filter(Boolean) : []) await corridaDeHuerfana(x, rama, x.ruta);
}

/**
 * `commitear_huerfano`: lo que quedó sin commitear en un worktree de pa (un worker que murió) se commitea entero en la rama que
 * estaba (o en `pa/<slug>/huerfano-<ts>` si estaba en HEAD suelto), sin dirs de build ni symlinks externos. Requiere el candado
 * de git.
 */
export async function commitearHuerfano(x: Proyecto, wt: string): Promise<void> {
  await desenlazarCaches(x, wt);
  if (!(await suciosDe(x, wt)).length) return;
  let anterior = (await g(x, wt, ["rev-parse", "--abbrev-ref", "HEAD"])).salida.replace(/\n$/, "");
  let baseH = "";
  if (anterior === "HEAD") {
    baseH = (await g(x, wt, ["rev-parse", "HEAD"])).salida.replace(/\n$/, "");
    anterior = `pa/${x.slug}/huerfano-${x.ts || `${fechaId()}-${process.pid}`}`;
    await g(x, wt, ["checkout", "-qB", anterior]);
  }
  const fuera = await dirsDeBuild(x, wt);
  await g(x, wt, ["add", "-A", "--", ".", ...fuera.map((r) => `:(exclude,literal)${r}`)]);
  if (fuera.length) x.pa.io.err(`pa: no commiteo artefactos de build del huérfano: ${fuera.join(" ")}\n`);
  await excluirSymlinksExternos(x, wt);
  if ((await g(x, wt, ["diff", "--cached", "--quiet"])).codigo !== 0) {
    await g(x, wt, ["commit", "-qm", `pa: huérfano de ${anterior}`]);
    x.pa.io.err(`pa: el worktree ${path.basename(wt)} tenía trabajo huérfano; quedó commiteado en '${anterior}'.\n`);
  }
  if (baseH) await corridaDeHuerfana(x, anterior, x.ruta, baseH);
}

// ---------------------------------------------------------------- crear / reusar

/** `asegurar_worktree`: el worktree de un puesto, creado (en HEAD suelto) si no existe. Requiere el candado de git. */
export async function asegurarWorktree(x: Proyecto, wt: string): Promise<boolean> {
  if (existsSync(path.join(wt, ".git"))) return true;
  mkdirSync(path.dirname(wt), { recursive: true });
  // si alguien borró el directorio a mano, git lo sigue teniendo registrado y el `add` falla
  await g(x, x.ruta, ["worktree", "prune"]);
  const r = await g(x, x.ruta, ["worktree", "add", "--detach", wt, "HEAD"]);
  if (r.codigo !== 0) {
    x.pa.io.err(`pa: no pude crear el worktree en ${wt}.\n`);
    return false;
  }
  return true;
}

export interface Trabajo {
  /** 0, o 87 si no se pudo preparar el worktree (nunca cae al tree principal). */
  codigo: 0 | 87;
  /** Dónde corre el worker: el worktree o el tree principal. */
  rutaTrabajo: string;
  rama: string;
  base: string;
  usaWorktree: boolean;
  /** El `CARGO_TARGET_DIR` a exportar al worker (proyectos de cargo con worktree). */
  cargoTargetDir?: string;
}

/**
 * `preparar_worktree`: deja el worktree del puesto (ya tomado) listo. Con `retomada` (el ts de una corrida) vuelve a ESA rama;
 * sin ella, rama nueva `pa/<slug>/<ts>` desde el HEAD del tree principal. --leer, el tree principal (`aca`) y los proyectos sin
 * git o sin commits corren en el tree principal. Si no puede, 87 (con el aviso ya dado).
 */
export async function prepararWorktree(x: Proyecto, retomada: string, puesto: string, o: { leer?: boolean } = {}): Promise<Trabajo> {
  const ppal: Trabajo = { codigo: 0, rutaTrabajo: x.ruta, rama: "", base: "", usaWorktree: false };
  if (o.leer || puesto === "aca") return ppal;
  if (!(await tieneHead(x))) return ppal;
  const wt = wtDePuesto(x, puesto);
  const candado = await tomarGit(x, 60_000);
  if (!candado) {
    x.pa.io.err(`pa: el candado de git de '${x.slug}' (${path.join(x.pa.lockdir, `${x.slug}@git`)}) sigue tomado después de 60s. No arranco.\n`);
    return { ...ppal, codigo: 87 };
  }
  const fallo = async (msg: string): Promise<Trabajo> => {
    await candado.liberar();
    enlazarCaches(x, x.ruta, wt);
    x.pa.io.err(msg);
    return { ...ppal, codigo: 87 };
  };
  try {
    if (!(await asegurarWorktree(x, wt))) {
      await candado.liberar();
      return { ...ppal, codigo: 87 };
    }
    await commitearHuerfano(x, wt);
    let rama: string;
    let base: string;
    if (retomada && retomada !== "-") {
      const c = path.join(x.dir, `${retomada}.corrida`);
      rama = leerCampo(c, "rama");
      base = leerCampo(c, "base");
      const r = await g(x, wt, ["checkout", "-q", rama]);
      if (r.codigo !== 0) {
        const err = r.errores.slice(0, 300).replace(/\n/g, " ");
        return await fallo(
          `pa: no pude volver a la rama ${rama} en ${wt}: ${err}\npa: NO corro en el tree principal. Mirá la rama con: git -C '${x.ruta}' worktree list\n`,
        );
      }
    } else {
      base = (await g(x, x.ruta, ["rev-parse", "HEAD"])).salida.replace(/\n$/, "");
      rama = `pa/${x.slug}/${x.ts}`;
      if ((await g(x, wt, ["checkout", "-qB", rama, base])).codigo !== 0)
        return await fallo(`pa: no pude sacar la rama ${rama} en ${wt}. NO corro en el tree principal.\n`);
    }
    await candado.liberar();
    const { cargoTargetDir } = enlazarCaches(x, x.ruta, wt);
    compartirMemoria(x, x.ruta, wt);
    return { codigo: 0, rutaTrabajo: wt, rama, base, usaWorktree: true, cargoTargetDir };
  } finally {
    await candado.liberar();
  }
}

/**
 * `puesto_para_retomar`: el puesto que le toca a un --seguir (el de la corrida que retoma: su transcript vive bajo ese cwd). Si
 * esa corrida corrió en el tree principal o su rama ya no existe, el tree principal (`aca`).
 */
export async function puestoParaRetomar(x: Proyecto, retomada: string): Promise<string> {
  if (retomada === "-") return "aca";
  const c = path.join(x.dir, `${retomada}.corrida`);
  if (!existsSync(c)) return "aca";
  const r = leerCampo(c, "rama");
  if (!r) return "aca";
  if (!(await verifica(x, x.ruta, `refs/heads/${r}`))) {
    x.pa.io.err(`pa: la rama ${r} de la corrida ${retomada} ya no existe (¿integrada o descartada?): la retomo en el tree principal.\n`);
    return "aca";
  }
  return puestoDeCorrida(x, c);
}
