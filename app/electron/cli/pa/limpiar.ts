// `pa --limpiar [--ver|--si] [--dias N] [--json]` (cmd_limpiar de motor/bin/pa): lo viejo y seguro de borrar de los worktrees de TODOS
// los proyectos. Sólo puestos libres (se toma su candado, exclusivo y sin esperar, mientras se borra: ningún worker arranca a la mitad).
// Tres cosas, todas con N días de antigüedad (--dias, o PA_LIMPIAR_DIAS, default 7):
//  · el puesto entero (k ≥ 2; el 1 nunca) si está libre, en HEAD suelto sin commits que no estén en ninguna rama o tag, sin nada sin
//    commitear (salvo los enlaces y dirs de build que puso pa) y su HEAD no se movió hace N días: pa lo vuelve a armar cuando lo necesita;
//  · los dirs de build (dirsDeBuild) de los demás puestos libres sin ningún archivo tocado en N días (el mtime del dir solo no dice nada);
//  · las ramas `pa/<slug>/<id>` de una corrida con el id de hace N días o más que ya están enteras en el tree principal (`branch -d`,
//    nunca -D) y no están checkouteadas en ningún worktree. Una rama con commits sin integrar no se toca jamás.
// Sin --si es sólo ver (--ver es lo mismo, explícito). --json deja el plan (o lo hecho) en una línea para la app.
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { borrarSinSeguir, esLink } from "../base/enlaces.ts";
import { git } from "../base/git.ts";
import { tomar } from "../base/lock.ts";
import { esCarpeta, leerCampo, listar, runningVivo } from "./corridas.ts";
import { v, type Pa } from "./entorno.ts";
import { dirsDeBuild, raizWorktrees, rutaPorcelain, sufPuesto, tomarGit, wtDePuesto, type Proyecto } from "./worktrees.ts";

const esDirReal = (p: string) => {
  try {
    const st = lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
};

/** `find d -mtime -N -print -quit`: ¿algo adentro de `d` (o él mismo) se tocó hace menos de N días? Sin seguir enlaces. */
function tocadoReciente(d: string, dias: number, ahora = Date.now()): boolean {
  const limite = dias * 86_400_000;
  const reciente = (p: string) => {
    try {
      return ahora - lstatSync(p).mtimeMs < limite;
    } catch {
      return false;
    }
  };
  const caminar = (p: string): boolean => {
    if (reciente(p)) return true;
    if (!esDirReal(p)) return false;
    let ns: string[];
    try {
      ns = readdirSync(p);
    } catch {
      return false;
    }
    return ns.some((n) => caminar(path.join(p, n)));
  };
  return caminar(d);
}

/** `du -sb`: el tamaño aparente de los archivos que cuelgan de `d` (cada inodo una vez, enlaces sin seguir). */
function tamanoDe(d: string): number {
  const vistos = new Set<string>();
  const caminar = (p: string): number => {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      return 0;
    }
    const clave = `${st.dev}:${st.ino}`;
    let n = 0;
    if (st.ino && st.nlink > 1) {
      if (vistos.has(clave)) return 0;
      vistos.add(clave);
    }
    // du -sb (coreutils 9) no cuenta el tamaño de los directorios mismos
    if (!st.isDirectory()) n += st.size;
    else {
      try {
        for (const x of readdirSync(p)) n += caminar(path.join(p, x));
      } catch {
        /* ilegible */
      }
    }
    return n;
  };
  return caminar(d);
}

/** `numfmt --to=iec`: 1500 → 1.5K, 4096 → 4.0K, 10240 → 10K (siempre redondea para arriba). */
export function numfmtIec(n: number): string {
  const u = ["", "K", "M", "G", "T", "P", "E"];
  if (n < 1024) return String(n);
  let x = n;
  let i = 0;
  while (x >= 1024 && i < u.length - 1) {
    x /= 1024;
    i++;
  }
  const r = x < 10 ? Math.ceil(x * 10 - 1e-9) / 10 : Math.ceil(x - 1e-9);
  if (r >= 1024 && i < u.length - 1) return `1.0${u[i + 1]}`;
  return x < 10 ? `${r.toFixed(1)}${u[i]}` : `${r}${u[i]}`;
}

/** Los puestos de worktree de pa: `{ nombre (slug[@k], el del candado), ruta }`, en el orden del glob. */
function puestos(pa: Pa): { nombre: string; ruta: string }[] {
  const raiz = raizWorktrees(pa);
  const r: { nombre: string; ruta: string }[] = [];
  if (pa.plat === "win32" && !pa.env.PA_STATE) {
    // %LOCALAPPDATA%\trama\wt\<slug>\<k>
    for (const s of listar(raiz, (n) => esCarpeta(path.join(raiz, n)))) {
      for (const k of listar(path.join(raiz, s))) r.push({ nombre: `${s}${sufPuesto(k)}`, ruta: path.join(raiz, s, k) });
    }
  } else for (const n of listar(raiz)) r.push({ nombre: n, ruta: path.join(raiz, n) });
  return r.filter((w) => esDirReal(w.ruta));
}


type Build = { puesto: string; dir: string; bytes: number };
type WtViejo = { puesto: string; dias: number; bytes: number };
type RamaVieja = { proyecto: string; rama: string; dias: number; commits: number };

const proy = (pa: Pa, slug: string): Proyecto => ({ pa, proyecto: "", ruta: "", slug, dir: "", ts: "" });
const gi = (pa: Pa, cwd: string, args: string[]) => git(args, { cwd, env: pa.env });
const linea = (r: { salida: string }) => r.salida.replace(/\r?\n$/, "");

/** El tree principal de un repo: el padre de su `.git` común (desde cualquier worktree suyo). "" si no se puede (bare, raro). */
async function arbolPrincipal(pa: Pa, desde: string): Promise<string> {
  const r = await gi(pa, desde, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.codigo !== 0) return "";
  const comun = linea(r);
  return /[\\/]\.git$/.test(comun) ? comun.slice(0, -5) : "";
}

/** ¿El puesto se puede quitar entero? Devuelve los días desde que se movió su HEAD, o null si no (o si algo no se pudo comprobar). */
async function puestoViejo(pa: Pa, w: { nombre: string; ruta: string }, dias: number, ahoraS: number): Promise<number | null> {
  if (!w.nombre.includes("@") || !existsSync(path.join(w.ruta, ".git"))) return null; // el puesto 1 no se quita nunca
  if ((await gi(pa, w.ruta, ["symbolic-ref", "-q", "HEAD"])).codigo === 0) return null; // en una rama: puede ser trabajo sin integrar
  const gd = await gi(pa, w.ruta, ["rev-parse", "--absolute-git-dir"]);
  if (gd.codigo !== 0) return null;
  let mt: number;
  try {
    mt = statSync(path.join(linea(gd), "HEAD")).mtimeMs / 1000;
  } catch {
    return null;
  }
  const edad = ahoraS - mt;
  if (edad < dias * 86400) return null;
  // el commit donde está parado tiene que estar en alguna rama o tag (si no, soltar el puesto lo perdería)
  const alcanza = await gi(pa, w.ruta, ["for-each-ref", "--contains", "HEAD", "--count=1", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"]);
  if (alcanza.codigo !== 0 || !alcanza.salida.trim()) return null;
  // nada sin commitear salvo lo que puso pa (enlaces de cachés y dirs de build sin trackear)
  const st = await gi(pa, w.ruta, ["status", "--porcelain"]);
  if (st.codigo !== 0) return null;
  const builds = await dirsDeBuild(proy(pa, w.nombre.split("@")[0]!), w.ruta);
  for (const l of st.salida.split("\n")) {
    if (!l) continue;
    const p = rutaPorcelain(l).replace(/\/$/, "");
    if (l.startsWith("??") && (builds.includes(p) || esLink(path.join(w.ruta, p)))) continue;
    return null;
  }
  return Math.floor(edad / 86400);
}

/** El id `AAAAMMDD-HHMMSS-pid` de una rama de corrida → segundos de epoch (hora local), o null si la rama no es de una corrida. */
function nacimientoDeRama(rama: string): number | null {
  const m = /^pa\/[^/]+\/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-\d+$/.exec(rama);
  if (!m) return null;
  const [a, mes, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return new Date(a, mes - 1, d, h, mi, s).getTime() / 1000;
}

/** Los argumentos de `--limpiar`: `{ aplicar, dias, json }` o el mensaje de error. */
function leerArgs(pa: Pa, args: string[]): { aplicar: boolean; dias: number; diasTxt: string; json: boolean } | string {
  let aplicar = false;
  let ver = false;
  let json = false;
  let diasTxt = v(pa.env, "PA_LIMPIAR_DIAS", "7");
  if (!/^[1-9][0-9]*$/.test(diasTxt)) diasTxt = "7";
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--si") aplicar = true;
    else if (a === "--ver") ver = true;
    else if (a === "--json") json = true;
    else if (a === "--dias") {
      diasTxt = args[++i] ?? "";
      if (!/^[1-9][0-9]*$/.test(diasTxt)) return "pa --limpiar: --dias necesita un número entero mayor que 0.";
    } else return `pa --limpiar: no entiendo '${a}'. Uso: pa --limpiar [--ver|--si] [--dias N] [--json]`;
  }
  if (aplicar && ver) return "pa --limpiar: --ver y --si no van juntos.";
  return { aplicar, dias: Number(diasTxt), diasTxt, json };
}

export async function cmdLimpiar(pa: Pa, args: string[]): Promise<number> {
  const { io } = pa;
  const o = leerArgs(pa, args);
  if (typeof o === "string") {
    io.err(`${o}\n`);
    return 2;
  }
  const { aplicar, dias, diasTxt, json } = o;
  const ahoraS = Date.now() / 1000;
  const dec = (s: string) => {
    if (!json) io.out(s);
  };
  mkdirSync(pa.lockdir, { recursive: true });
  let total = 0;
  const enUso: string[] = [];
  const builds: Build[] = [];
  const worktrees: WtViejo[] = [];
  const ramas: RamaVieja[] = [];
  for (const w of puestos(pa)) {
    // el candado no lo ve el flock del bash: un `.running` vivo de ese puesto también lo marca en uso
    const lg = runningVivo(path.join(pa.state, `${w.nombre}.running`)) ? null : await tomar(path.join(pa.lockdir, w.nombre), { plat: pa.plat, env: pa.env });
    if (!lg) {
      enUso.push(w.nombre);
      dec(`  ${w.nombre}: puesto en uso, no lo toco\n`);
      continue;
    }
    try {
      const slug = w.nombre.split("@")[0]!;
      const x = proy(pa, slug);
      const edad = await puestoViejo(pa, w, dias, ahoraS);
      if (edad !== null) {
        const arbol = await arbolPrincipal(pa, w.ruta);
        const n = tamanoDe(w.ruta);
        let hecho = !aplicar;
        if (aplicar && arbol) {
          const lgit = await tomarGit(x, 0);
          if (lgit) {
            try {
              const r = await gi(pa, arbol, ["worktree", "remove", "--force", w.ruta]);
              hecho = r.codigo === 0;
              if (!hecho) io.err(`pa: no pude quitar el worktree ${w.nombre}: ${r.errores.trim().split("\n")[0] ?? ""}\n`);
            } finally {
              await lgit.liberar();
            }
          }
        }
        if (hecho && arbol) {
          total += n;
          worktrees.push({ puesto: w.nombre, dias: edad, bytes: n });
          dec(`  ${w.nombre}  worktree sin uso hace ${edad} días  ${numfmtIec(n)}\n`);
          continue;
        }
      }
      for (const rel of await dirsDeBuild(x, w.ruta, true)) {
        const d = path.join(w.ruta, rel);
        if (tocadoReciente(d, dias)) continue;
        const n = tamanoDe(d);
        total += n;
        builds.push({ puesto: w.nombre, dir: rel, bytes: n });
        dec(`  ${w.nombre}/${rel}  ${numfmtIec(n)}\n`);
        if (aplicar) borrarSinSeguir(d);
      }
    } finally {
      await lg.liberar();
    }
  }
  // las ramas de corridas que ya están enteras en el tree principal
  const vistas = new Set<string>();
  for (const slug of listar(pa.state, (n) => n !== "worktrees" && n !== "lock" && esCarpeta(path.join(pa.state, n)))) {
    const dir = path.join(pa.state, slug);
    for (const f of listar(dir, (n) => n.endsWith(".corrida"))) {
      const c = path.join(dir, f);
      if (leerCampo(c, "origen")) continue;
      const rama = leerCampo(c, "rama");
      const base = leerCampo(c, "base");
      const nacio = nacimientoDeRama(rama);
      if (nacio === null || ahoraS - nacio < dias * 86400) continue;
      // el repo: el worktree de la corrida o, si ya se quitó, el puesto 1 del proyecto
      let repo = leerCampo(c, "ruta_trabajo");
      if (!repo || !esCarpeta(repo)) repo = wtDePuesto(proy(pa, slug), 1);
      if (!esCarpeta(repo)) continue;
      const arbol = await arbolPrincipal(pa, repo);
      if (!arbol || vistas.has(`${arbol}\0${rama}`)) continue;
      if ((await gi(pa, arbol, ["rev-parse", "-q", "--verify", `refs/heads/${rama}`])).codigo !== 0) continue;
      if ((await gi(pa, arbol, ["merge-base", "--is-ancestor", rama, "HEAD"])).codigo !== 0) continue; // sin integrar: jamás
      const wl = await gi(pa, arbol, ["worktree", "list", "--porcelain"]);
      if (wl.salida.split("\n").some((l) => l.replace(/\r$/, "") === `branch refs/heads/${rama}`)) continue; // checkouteada: en curso
      vistas.add(`${arbol}\0${rama}`);
      const cm = base ? await gi(pa, arbol, ["rev-list", "--count", `${base}..${rama}`]) : null;
      const commits = cm && cm.codigo === 0 ? Number(linea(cm)) || 0 : 0;
      if (aplicar) {
        const lgit = await tomarGit(proy(pa, slug), 0);
        if (!lgit) continue;
        try {
          if ((await gi(pa, arbol, ["branch", "-q", "-d", rama])).codigo !== 0) continue;
          // como podar_integradas: con commits propios la .corrida ya no sirve; la de una rama vacía se queda (un --seguir vuelve por ella)
          if (commits > 0) rmSync(c, { force: true });
        } finally {
          await lgit.liberar();
        }
      }
      const d = Math.floor((ahoraS - nacio) / 86400);
      ramas.push({ proyecto: slug, rama, dias: d, commits });
      dec(`  rama ${rama}  ${commits > 0 ? "ya integrada" : "sin commits"}, de hace ${d} días\n`);
    }
  }
  const gb = (total / 1073741824).toFixed(2);
  if (json) {
    io.out(`${JSON.stringify({ dias, aplicado: aplicar, enUso, builds, worktrees, ramas, bytes: total })}\n`);
    return 0;
  }
  const cuenta = `${worktrees.length} worktree(s) y ${ramas.length} rama(s)`;
  if (!builds.length && !worktrees.length && !ramas.length) io.out(`pa --limpiar: nada con más de ${diasTxt} días: ni build, ni worktrees, ni ramas ya integradas.\n`);
  else if (aplicar) io.out(`pa --limpiar: liberados ${gb} GB; quitados ${cuenta}.\n`);
  else io.out(`pa --limpiar: se liberarían ${gb} GB; se quitarían ${cuenta} (dry-run; con --si se borra).\n`);
  return 0;
}
