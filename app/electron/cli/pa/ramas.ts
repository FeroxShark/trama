// `pa <proyecto> --ramas | --integrar <id> [--tests] | --descartar <id>` y `pa --descartar <id>`: port de cmd_ramas, cmd_integrar,
// cmd_descartar y cmd_descartar_id de motor/bin/pa (mismos mensajes, mismos códigos, mismo integradas.tsv y eventos.jsonl).
// Integrar = rebase de la rama del worker sobre el HEAD del tree principal adentro de un puesto de pa, y ff-only en el tree
// principal; nunca fuerza nada (79 lo sucio del tree principal choca, 80 el rebase choca, 83 symlink peligroso, 86 la corrida dejó
// trabajo sin commitear, 93 los tests dieron rojo, 75 algo ocupado).
//
// Los candados son los de base/lock.ts con las mismas rutas de `lock/` que el bash como clave: interoperan entre `pa` de TS, no con
// el flock del bash (la etapa 11 cambia todo junto).
import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { agregarLinea } from "../base/archivo.ts";
import { esEjecutable } from "../base/buscar.ts";
import { entornoCmd } from "../../binario.ts";
import { prefijoDe } from "./programas.ts";
import { esPrincipal } from "../base/principal.ts";
import { correr, matarArbol, vivo } from "../base/proc.ts";
import { tomar, type Lock } from "../base/lock.ts";
import { registroProyectos } from "../../rutas.ts";
import { resolverProyecto } from "../proyecto-ruta.ts";
import { prologo, Salida, salir, v, type Env, type Io, type Pa } from "./entorno.ts";
import {
  adoptarHuerfanas,
  archivosCon,
  asegurarWorktree,
  commitearHuerfano,
  commitsPendientes,
  comoQ,
  contar,
  desenlazarCaches,
  enlazarCaches,
  existeRama,
  fijarProyecto,
  g,
  gOk,
  gs,
  leerCampo,
  limpiarBuild,
  lockDePuesto,
  puestoDeCorrida,
  puestoDeRuta,
  puestoLibre,
  realpathM,
  rutaPorcelain,
  slugDe,
  suciosDe,
  tomarGit,
  tomarLock,
  wtDePuesto,
  wtDeRama,
  adentroDe,
  type Proy,
} from "./ramas-base.ts";

const soltar = async (...ls: (Lock | null | undefined)[]) => {
  for (const l of ls) await l?.liberar();
};

/** `date -Iseconds` (hora local con su desvío, `+00:00`). */
export function isoSegundos(d = new Date()): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${off < 0 ? "-" : "+"}${p(Math.trunc(off / 60))}:${p(off % 60)}`
  );
}

// ---------------------------------------------------------------- registry

type FilaRegistry = Record<string, unknown>;
const jqR = (v: unknown) => (v === undefined || v === null || v === false ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** `registry_por_slug`: el campo del proyecto del registry cuyo path da ese slug ("" si no está). */
export function registryPorSlug(pa: Pa, slug: string, campo: string): string {
  const reg = registroProyectos(pa.env, pa.home, pa.plat);
  let ps: FilaRegistry[] = [];
  try {
    const j = JSON.parse(readFileSync(reg, "utf8")) as { projects?: unknown };
    if (Array.isArray(j?.projects)) ps = j.projects as FilaRegistry[];
  } catch {
    return "";
  }
  for (const p of ps) {
    let r = jqR(p?.path);
    if (!r) continue;
    if (r.startsWith("~")) r = pa.home + r.slice(1);
    if (esArchivo(r)) r = path.dirname(r);
    if (slugDe(realpathM(r)) === slug) return jqR(p?.[campo]);
  }
  return "";
}
function esArchivo(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `nombre_registry`: el nombre del registry de ese slug, o el slug. */
export const nombreRegistry = (pa: Pa, slug: string) => registryPorSlug(pa, slug, "name") || slug;
/** `tests_registry`: el `tests` del registry (un comando), o "". */
export const testsRegistry = (pa: Pa, slug: string) => registryPorSlug(pa, slug, "tests");

// ---------------------------------------------------------------- integradas.tsv y eventos.jsonl

export const INTEGRADAS_HEADER = "fecha\tid\tproyecto\trama\trama_ppal\thead_antes\thead_despues\tcommits\tauto\taccion";
const integradasDe = (pa: Pa) => path.join(pa.state, "integradas.tsv");

/** `evento`: una línea JSON en eventos.jsonl. Nunca rompe. */
export async function evento(pa: Pa, tipo: string, id: string, proyecto: string, rc?: string | number): Promise<void> {
  const o: Record<string, unknown> = { version: 1, ts: Math.floor(Date.now() / 1000), tipo, id, proyecto };
  if (rc !== undefined && rc !== "") o.rc = typeof rc === "number" ? rc : /^-?[0-9]+(\.[0-9]+)?$/.test(rc) ? Number(rc) : rc;
  try {
    await agregarLinea(path.join(pa.state, "eventos.jsonl"), JSON.stringify(o));
  } catch {
    /* nunca rompe a pa */
  }
}

/** `anotar_integrada`: una fila en integradas.tsv (y el evento de integrar / revertir). */
export async function anotarIntegrada(
  pa: Pa,
  f: { id: string; proyecto: string; rama: string; ramaPpal: string; antes: string; despues: string; commits: number | string; accion: string },
): Promise<void> {
  if (f.accion === "integrada") await evento(pa, "integrar", f.id, f.proyecto);
  else if (f.accion === "revertida") await evento(pa, "revertir", f.id, f.proyecto);
  const auto = pa.env.PA_AUTO === "1" ? "1" : "0";
  const arch = integradasDe(pa);
  mkdirSync(pa.state, { recursive: true });
  const l = await tomar(arch, { esperarMs: 10_000, plat: pa.plat, env: pa.env }).catch(() => null);
  try {
    if (!l) throw new Error("ocupado");
    let vacio = true;
    try {
      vacio = statSync(arch).size === 0;
    } catch {
      /* no existe */
    }
    if (vacio) appendFileSync(arch, INTEGRADAS_HEADER + "\n");
    appendFileSync(arch, [isoSegundos(), f.id, f.proyecto, f.rama, f.ramaPpal, f.antes, f.despues, String(f.commits), auto, f.accion].join("\t") + "\n");
  } catch {
    pa.io.err(`pa: OJO: no pude anotar ${f.id} en ${arch}.\n`);
  } finally {
    await l?.liberar();
  }
}

/** `fila_integrada`: la última fila de ese id (los campos), o null. */
export function filaIntegrada(pa: Pa, id: string): string[] | null {
  let t: string;
  try {
    t = readFileSync(integradasDe(pa), "utf8");
  } catch {
    return null;
  }
  let f: string[] | null = null;
  t.split("\n").forEach((l, i) => {
    if (i === 0 || !l) return;
    const c = l.split("\t");
    if (c[1] === id) f = c;
  });
  return f;
}

/** `ya_resuelta`: true si ya está integrada (lo dice por stdout); si se revirtió o descartó lo aclara por stderr y da false. */
export function yaResuelta(pa: Pa, id: string): boolean {
  const f = filaIntegrada(pa, id);
  if (!f) return false;
  const acc = f[9] ?? "";
  if (acc === "integrada") {
    pa.io.out(`pa: ${id} ya integrada (¿desde la app?): ${f[3] ?? ""} entró a ${f[4] ?? ""} el ${f[0] ?? ""}.\n`);
    return true;
  }
  if (acc === "revertida") pa.io.err(`pa: ${id} se integró y después se revirtió (pa --revertir); no hay rama que integrar.\n`);
  else if (acc === "descartada") pa.io.err(`pa: ${id} se descartó; no hay rama que integrar.\n`);
  return false;
}

// ---------------------------------------------------------------- tablero y empuje (nunca rompen ni demoran)

/** `decision_es_nada`. */
export function decisionEsNada(s: string): boolean {
  const d = s.replace(/\*/g, "").trim().replace(/\.$/, "");
  return d.toLowerCase() === "nada";
}

/** `tablero_mudo`: corre bin/tablero con tope, sin stdin ni stderr; con un PA_STATE de mentira y sin TABLERO_DIR no se llama. */
export async function tableroMudo(pa: Pa, topeS: number, args: string[]): Promise<boolean> {
  const tb = prefijoDe(pa, "tablero", pa.env.PA_TABLERO, pa.env.PA_TABLERO || path.join(pa.bin, "tablero"));
  if (!esEjecutable(tb[tb.length - 1]!, pa.plat)) return false;
  if (!pa.env.TABLERO_DIR && pa.env.PA_STATE) return false;
  const r = await correr(tb[0]!, [...tb.slice(1), ...args], { env: entornoCmd(tb, pa.env), timeoutMs: topeS * 1000, killAfterMs: 1000, plat: pa.plat });
  return r.codigo === 0;
}

/** `sigue_al_tablero`: el SIGUE de la corrida (o de sus --seguir) que acaba de entrar, al tablero. */
export async function sigueAlTablero(x: Proy, id: string, head: string): Promise<void> {
  let r = "";
  for (const h of archivosCon(x.dir, ".hilo")) {
    let t: string;
    try {
      t = readFileSync(h, "utf8");
    } catch {
      continue;
    }
    const f = path.basename(h).slice(0, -".hilo".length);
    let o = "";
    let sg = "";
    for (const l of t.split("\n")) {
      if (l.startsWith("origen=")) o = l.slice(7);
      else if (l.startsWith("sigue=")) sg = l.slice(6);
    }
    if (sg !== "" && (f === id || o === id)) r = sg;
  }
  if (r && !decisionEsNada(r)) await tableroMudo(x.pa, 5, ["sigue", x.slug, r, "--head", head]).catch(() => false);
}

/** `empujar_main`: después de integrar, `main` al remoto configurado por bin/repos-empujar (con tope; nunca frena). */
export async function empujarMain(x: Proy, ruta: string): Promise<void> {
  const { pa } = x;
  const emp = pa.env.PA_EMPUJAR || path.join(pa.bin, "repos-empujar");
  if (!esEjecutable(emp, pa.plat)) return;
  let remotos = v(pa.env, "PA_EMPUJE_REMOTOS");
  let etq = v(pa.env, "PA_EMPUJE_ETIQUETA");
  if (!remotos) {
    const cfg = pa.env.TRAMA_EMPUJE || path.join(pa.env.XDG_CONFIG_HOME || path.join(pa.home, ".config"), "trama", "empuje.json");
    let j: { remotos?: unknown; etiqueta?: unknown };
    try {
      j = JSON.parse(readFileSync(cfg, "utf8")) as typeof j;
    } catch {
      return;
    }
    remotos = (Array.isArray(j?.remotos) ? j.remotos : []).filter((r): r is string => typeof r === "string").join(" ");
    if (!etq && typeof j?.etiqueta === "string") etq = j.etiqueta;
  }
  if (!remotos) return;
  let tope = Number(v(pa.env, "PA_EMPUJE_MAX", "10"));
  if (!/^[0-9]+$/.test(v(pa.env, "PA_EMPUJE_MAX", "10")) || tope <= 0) tope = 10;
  const rs = new Set((await gs(x, ruta, ["remote"])).split("\n"));
  if (!remotos.split(/\s+/).some((r) => r && rs.has(r))) return;
  etq ||= "Remoto";
  // con un PA_STATE de mentira su estado cae ahí adentro y, sin TABLERO_DIR, no anota en el tablero (como tablero_mudo)
  const env: Env = { ...pa.env, REPOS_EMPUJAR_TABLERO: pa.env.PA_TABLERO || path.join(pa.bin, "tablero") };
  if (pa.env.PA_STATE) {
    env.REPOS_EMPUJAR_STATE = pa.env.REPOS_EMPUJAR_STATE || path.join(pa.state, "repos-empujar");
    if (!pa.env.TABLERO_DIR) env.REPOS_EMPUJAR_TABLERO = "/no-hay-tablero";
  }
  const r = await correr(emp, ["--repo", ruta, "--tope", String(tope)], { env, timeoutMs: (tope + 5) * 1000, killAfterMs: 2000, plat: pa.plat });
  if (r.codigo === 124 || r.codigo === 137) {
    pa.io.out(`— ${etq}: el empuje de main no terminó en ${tope}s; queda para la próxima pasada de repos-empujar.\n`);
    return;
  }
  for (const l of (r.salida + r.errores).split("\n")) if (l) pa.io.out(`— ${etq}: ${l}\n`);
}

// ---------------------------------------------------------------- --ramas

export type RamaPendiente = { id: string; rama: string; n: number; subject: string };

/** `ramas_sin_integrar`: las corridas con rama propia (sin `origen=`) que tienen commits que le faltan al tree principal. */
export async function ramasSinIntegrar(x: Proy, dir = x.dir): Promise<RamaPendiente[]> {
  const r: RamaPendiente[] = [];
  for (const c of archivosCon(dir, ".corrida")) {
    if (leerCampo(c, "origen")) continue;
    const rama = leerCampo(c, "rama");
    const repo = leerCampo(c, "ruta_trabajo");
    if (!rama || !repo || !existsSync(repo)) continue;
    if (!(await existeRama(x, repo, rama))) continue;
    const n = await commitsPendientes(x, repo, rama);
    if (n <= 0) continue;
    r.push({ id: path.basename(c).slice(0, -".corrida".length), rama, n, subject: await gs(x, repo, ["log", "-1", "--format=%s", rama]) });
  }
  return r;
}

/** `podar_integradas`: borra (con `branch -d`) las ramas que ya están enteras en el tree principal. */
export async function podarIntegradas(x: Proy): Promise<void> {
  const lg = await tomarGit(x);
  if (!lg) return;
  try {
    for (const c of archivosCon(x.dir, ".corrida")) {
      if (leerCampo(c, "origen")) continue;
      const r = leerCampo(c, "rama");
      const b = leerCampo(c, "base");
      const repo = leerCampo(c, "ruta_trabajo");
      if (!r || !b || !repo || !existsSync(repo)) continue;
      if (!(await existeRama(x, repo, r))) continue;
      if ((await contar(x, repo, `${b}..${r}`)) <= 0) continue;
      if ((await commitsPendientes(x, repo, r)) !== 0) continue;
      const wr = await wtDeRama(x, r);
      if (wr) {
        const p = puestoDeRuta(x, wr);
        if (p === "aca") continue;
        if (!(await puestoLibre(x, p))) continue;
        await g(x, wr, ["checkout", "-q", "--detach"]);
      }
      if (await gOk(x, x.ruta, ["branch", "-q", "-d", r])) {
        rmSync(c, { force: true });
        x.pa.io.out(`pa: borré ${r}: ya estaba entera en el tree principal.\n`);
      } else {
        x.pa.io.err(`pa: ${r} parece integrada pero \`git branch -d\` se negó a borrarla. No la fuerzo: mirala a mano.\n`);
      }
    }
  } finally {
    await lg.liberar();
  }
}

export async function cmdRamas(x: Proy): Promise<number> {
  await adoptarHuerfanas(x);
  await podarIntegradas(x);
  const pend = await ramasSinIntegrar(x);
  for (const p of pend) x.pa.io.out(`${p.id}  ${p.n} commit(s) sin integrar  ${p.subject}  (integrar: pa ${comoQ(x.proyecto)} --integrar ${p.id})\n`);
  if (!pend.length) x.pa.io.out(`pa: '${x.slug}' no tiene ramas sin integrar.\n`);
  let vacias = "";
  for (const c of archivosCon(x.dir, ".corrida")) {
    if (leerCampo(c, "origen")) continue;
    const r = leerCampo(c, "rama");
    const b = leerCampo(c, "base");
    const repo = leerCampo(c, "ruta_trabajo");
    if (!r || !b || !repo || !existsSync(repo)) continue;
    if (!(await existeRama(x, repo, r))) continue;
    if ((await gs(x, repo, ["rev-list", "--count", `${b}..${r}`])) === "0") vacias += ` ${path.basename(c).slice(0, -".corrida".length)}`;
  }
  if (vacias) x.pa.io.out(`pa: además hay rama(s) sin commits (no cambiaron nada); se tiran con pa '${x.proyecto}' --descartar <id>:${vacias}\n`);
  return 0;
}

// ---------------------------------------------------------------- --integrar

/** `symlinks_peligrosos`: los symlinks que la rama agrega o modifica con destino absoluto, fuera del repo o encima de un dir ignorado. */
export async function symlinksPeligrosos(x: Proy, ruta: string, base: string, rama: string): Promise<string[]> {
  const r: string[] = [];
  for (const l of (await gs(x, ruta, ["diff", "--raw", base, rama])).split("\n")) {
    const tab = l.indexOf("\t");
    if (tab < 0) continue;
    const p = l.slice(tab + 1);
    if (!p) continue;
    const [, modoNew, , hashNew, status] = l.slice(0, tab).split(/\s+/);
    if (modoNew !== "120000" || (status !== "A" && status !== "M")) continue;
    const destino = await gs(x, ruta, ["cat-file", "-p", hashNew ?? ""]);
    if (destino.startsWith("/") || path.isAbsolute(destino)) {
      r.push(`${p}\tdestino absoluto (${destino})`);
      continue;
    }
    const abs = realpathM(path.join(ruta, path.dirname(p), destino));
    if (!abs || !adentroDe(abs, ruta)) {
      r.push(`${p}\tsale del repo (${destino})`);
      continue;
    }
    let esDirP = false;
    try {
      esDirP = statSync(path.join(ruta, p)).isDirectory();
    } catch {
      /* no existe */
    }
    if (esDirP && (await gOk(x, ruta, ["check-ignore", "-q", "--", p]))) r.push(`${p}\tpisaría un directorio gitignoreado del tree principal`);
  }
  return r;
}

/** Corre `cmd` (el `tests` del registry) en `cwd` con la salida a `log`. Linux/macOS: `bash -c` (como el original); Windows: cmd.exe. Devuelve el rc (124 si se pasó). */
export function correrTests(cmd: string, cwd: string, log: string, topeS: number, env: Env, plat: Pa["plat"]): Promise<number> {
  return new Promise((resolve) => {
    let fd: number;
    try {
      fd = openSync(log, "w");
    } catch {
      return resolve(1);
    }
    const [exe, args] = plat === "win32" ? [env.ComSpec || env.COMSPEC || "cmd.exe", ["/d", "/s", "/c", cmd]] : ["bash", ["-c", cmd]];
    let agotado = false;
    let t: NodeJS.Timeout | undefined;
    const fin = (rc: number) => {
      clearTimeout(t);
      try {
        closeSync(fd);
      } catch {
        /* ya cerrado */
      }
      resolve(agotado ? 124 : rc);
    };
    const h = spawn(exe!, args as string[], { cwd, env: env as NodeJS.ProcessEnv, stdio: ["ignore", fd, fd], detached: plat !== "win32", windowsHide: true, windowsVerbatimArguments: plat === "win32" });
    h.once("error", () => fin(127));
    h.once("close", (code, senal) => fin(code ?? (senal === "SIGTERM" ? 143 : 128)));
    if (h.pid) {
      const pid = h.pid;
      t = setTimeout(() => {
        agotado = true;
        matarArbol(pid, "SIGTERM", { plat });
      }, topeS * 1000);
    }
  });
}

function ultimasLineas(archivo: string, n: number): string[] {
  try {
    const ls = readFileSync(archivo, "utf8").replace(/\n$/, "").split("\n");
    return ls.slice(-n);
  } catch {
    return [];
  }
}

/** `cmd_integrar`. */
/**
 * Un repo con app/ (Trama) recompila su dist-electron al integrar: así los pa de la línea de comandos (motor/bin/pa, reparto, tablero,
 * cuentas) corren ya lo que entró. Sin app/tsconfig.electron.json no hace nada. Es silenciosa si anda; si tsc falla, scripts/
 * asegurar-cli.mjs lo avisa por stderr y el --integrar sigue (lo integrado ya está en la rama principal).
 */
export function recompilarDistElectron(ruta: string): Promise<void> {
  const helper = path.join(ruta, "app", "scripts", "asegurar-cli.mjs");
  if (!existsSync(path.join(ruta, "app", "tsconfig.electron.json")) || !existsSync(helper)) return Promise.resolve();
  return new Promise((resolver) => {
    // process.execPath puede ser Electron (pa --integrar desde la app): ELECTRON_RUN_AS_NODE lo hace correr como node
    const h = spawn(process.execPath, [helper, "--recompilar"], { cwd: ruta, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
    h.once("error", () => resolver());
    h.once("close", () => resolver());
  });
}

export async function cmdIntegrar(x: Proy, t: string, o: { tests?: boolean } = {}): Promise<number> {
  const { pa } = x;
  const { io } = pa;
  const c = path.join(x.dir, `${t}.corrida`);
  if (t.startsWith("huerfano-")) await adoptarHuerfanas(x);
  if (!existsSync(c)) {
    if (yaResuelta(pa, t)) return 0;
    io.err(`pa: no hay corrida '${t}' de '${x.slug}' (falta ${c}).\n`);
    return 1;
  }
  const r = leerCampo(c, "rama");
  if (!r) {
    io.err(`pa: la corrida '${t}' corrió en el tree principal, no hay rama que integrar.\n`);
    return 1;
  }
  if (!(await existeRama(x, x.ruta, r))) {
    rmSync(c, { force: true });
    if (yaResuelta(pa, t)) return 0;
    io.err(`pa: la rama ${r} ya no existe (¿ya integrada o descartada?).\n`);
    return 1;
  }
  let cmdTests = "";
  if (o.tests) {
    cmdTests = testsRegistry(pa, x.slug);
    if (!cmdTests) {
      io.err(`pa: '${x.slug}' no tiene \`tests\` en el registry: --integrar --tests no tiene qué correr. Agregalo, o integrá sin --tests.\n`);
      return 2;
    }
  }
  let lg = await tomarGit(x, 60_000);
  if (!lg) {
    io.err(`pa: el candado de git de '${x.slug}' sigue ocupado después de 60s (otro --integrar/--descartar o un worker arrancando). Reintentá.\n`);
    return 75;
  }
  // El tree principal se toma mientras dure: ningún --aca arranca a mitad del ff-only.
  let l7 = await tomarLock(x, lockDePuesto(x, "aca"));
  if (!l7) {
    await soltar(lg);
    io.err(`pa: hay un worker --aca corriendo en el tree principal de '${x.slug}'; integrar le movería los archivos abajo. Esperalo y volvé a correr --integrar.\n`);
    return 75;
  }
  // --- el puesto donde rebasear
  const wr = await wtDeRama(x, r);
  let p = "";
  let l9: Lock | null = null;
  let prestado = false;
  if (wr) {
    p = puestoDeRuta(x, wr);
    if (p === "aca") {
      await soltar(l7, lg);
      io.err(`pa: la rama ${r} está checkouteada en ${wr}, fuera de los puestos de pa. No la toco: sacala de ahí (git -C '${wr}' checkout --detach) y volvé a correr --integrar.\n`);
      return 1;
    }
    l9 = await tomarLock(x, lockDePuesto(x, p));
    if (!l9) {
      await soltar(l7, lg);
      io.err(`pa: la rama ${r} la está usando un worker en el puesto ${p} (¿un --seguir o --actualizar?). Esperalo y volvé a correr --integrar.\n`);
      return 75;
    }
  } else {
    const candidatos = [puestoDeCorrida(x, c), ...Array.from({ length: pa.puestos }, (_, i) => String(i + 1))];
    for (const k of candidatos) {
      if (k === "aca") continue;
      l9 = await tomarLock(x, lockDePuesto(x, k));
      if (l9) {
        p = k;
        break;
      }
    }
    if (!p) {
      await soltar(l7, lg);
      io.err(`pa: los ${pa.puestos} puestos de '${x.slug}' están ocupados y --integrar necesita uno libre para rebasear. Esperá uno y volvé a correr.\n`);
      return 75;
    }
    prestado = true;
  }
  const wt = wtDePuesto(x, p);
  if (!(await asegurarWorktree(x, wt))) {
    await soltar(l9, l7, lg);
    return 1;
  }
  // suelta el puesto y el candado de git; deja los symlinks de cache puestos
  const finIntegrar = async () => {
    enlazarCaches(x, x.ruta, wt);
    await soltar(l9, l7, lg);
    l9 = l7 = lg = null;
  };
  const detachSiPrestado = async () => {
    if (prestado) await g(x, wt, ["checkout", "-q", "--detach"]);
  };

  const headPpal = await gs(x, x.ruta, ["rev-parse", "HEAD"]);
  const ramaPpal = await gs(x, x.ruta, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const mb = await g(x, x.ruta, ["merge-base", headPpal, r]);
  if (mb.codigo !== 0) {
    await finIntegrar();
    io.err(`pa: la rama ${r} no comparte historia con ${ramaPpal}. No la integro.\n`);
    return 1;
  }
  const b = mb.salida.replace(/\n+$/, "");
  const n = await contar(x, x.ruta, `${b}..${r}`);
  if (n === 0) {
    const bc = leerCampo(c, "base");
    if (bc && (await contar(x, x.ruta, `${bc}..${r}`)) !== 0) {
      // tiene commits propios y están todos en main: alguien la integró a mano
      if (wr) await g(x, wr, ["checkout", "-q", "--detach"]);
      await finIntegrar();
      await anotarIntegrada(pa, { id: t, proyecto: x.slug, rama: r, ramaPpal, antes: headPpal, despues: headPpal, commits: 0, accion: "integrada" });
      await sigueAlTablero(x, t, headPpal);
      if (await gOk(x, x.ruta, ["branch", "-q", "-d", r])) rmSync(c, { force: true });
      io.out(`pa: ${r} ya estaba entera en ${ramaPpal} de '${x.slug}'; no había nada que integrar.\n`);
      await empujarMain(x, x.ruta);
      return 0;
    }
    await finIntegrar();
    io.err(`pa: la rama ${r} no tiene commits; no hay nada que integrar. Tirala con: pa '${x.proyecto}' --descartar ${t}\n`);
    return 1;
  }
  // 0. lo que la corrida dejó sin commitear en su worktree
  desenlazarCaches(wt, x.ruta);
  const estadoWt = await suciosDe(x, wt);
  if (wr && estadoWt.length) {
    const sucioWt = estadoWt
      .slice(0, 5)
      .map((l) => rutaPorcelain(l) + " ")
      .join("");
    await finIntegrar();
    io.err(`pa: NO integro: la corrida ${t} dejó trabajo SIN COMMITEAR en su worktree (${wt}): ${sucioWt}\n`);
    io.err(`    Cerrala con: pa '${x.proyecto}' --seguir --id ${t} 'commiteá lo que hiciste y reportá'  (o tirala: --descartar ${t}).\n`);
    return 86;
  }
  // 1. lo sin commitear del tree principal no puede cruzarse con lo que trae la rama
  const tocados = await gs(x, x.ruta, ["diff", "--name-only", b, r]);
  const setTocados = new Set(tocados.split("\n"));
  const choque = (await suciosDe(x, x.ruta)).map(rutaPorcelain).filter((s) => setTocados.has(s));
  if (choque.length) {
    await finIntegrar();
    io.err(`pa: NO integro: el tree principal de '${x.slug}' tiene sin commitear archivos que la rama ${r} toca:\n`);
    for (const s of choque) io.err(`    ${s}\n`);
    io.err("    Commitealos, movelos o tiralos, y volvé a correr --integrar. No fuerzo nada.\n");
    return 79;
  }
  // 1b. la rama no puede traer un symlink peligroso
  const peligrosos = await symlinksPeligrosos(x, x.ruta, b, r);
  if (peligrosos.length) {
    await finIntegrar();
    io.err(`pa: NO integro: la rama ${r} trae symlink(s) peligrosos:\n`);
    for (const s of peligrosos) io.err(`    ${s.replace("\t", ": ")}\n`);
    io.err("    Suelen ser cache de pa (node_modules/.venv/.env): sacalos de la rama y volvé a correr --integrar. No toqué nada.\n");
    return 83;
  }
  // 2. rebase adentro del puesto (el tree principal no se toca)
  if (headPpal !== b) {
    if (prestado) await commitearHuerfano(x, wt);
    if (!(await gOk(x, wt, ["checkout", "-q", r]))) {
      await finIntegrar();
      io.err(`pa: no pude entrar a ${r} en ${wt}.\n`);
      return 1;
    }
    if ((await g(x, wt, ["rebase", "-q", headPpal], { ...pa.env, GIT_EDITOR: "true" })).codigo !== 0) {
      await g(x, wt, ["rebase", "--abort"]);
      await detachSiPrestado();
      await finIntegrar();
      io.err(`pa: el rebase de ${r} sobre ${ramaPpal} (${headPpal.slice(0, 7)}) tiene conflictos: otro cambio que ya entró toca lo mismo.\n`);
      io.err(`    Que lo resuelva un worker que entienda los dos cambios: pa '${x.proyecto}' --actualizar ${t}   (y después --integrar ${t} de nuevo).\n`);
      return 80;
    }
  }
  // 2b. --tests sobre la rama ya rebaseada; mientras corren se sueltan el candado de git y el del tree principal
  if (cmdTests) {
    if ((await gs(x, wt, ["rev-parse", "--abbrev-ref", "HEAD"])) !== r) {
      if (prestado) await commitearHuerfano(x, wt);
      if (!(await gOk(x, wt, ["checkout", "-q", r]))) {
        await finIntegrar();
        io.err(`pa: no pude entrar a ${r} en ${wt}.\n`);
        return 1;
      }
    }
    const logT = path.join(x.dir, `${t}.tests.log`);
    enlazarCaches(x, x.ruta, wt);
    await soltar(l7, lg);
    l7 = lg = null;
    const tope = Number(v(pa.env, "PA_TESTS_MAX", "1800")) || 1800;
    const envT: Env = { ...pa.env };
    if (existsSync(path.join(x.ruta, "Cargo.toml"))) envT.CARGO_TARGET_DIR = path.join(x.ruta, "target");
    const rcT = await correrTests(cmdTests, wt, logT, tope, envT, pa.plat);
    lg = await tomarGit(x, 60_000);
    if (!lg) {
      await soltar(l9);
      io.err(`pa: los tests terminaron (rc ${rcT}) pero el candado de git de '${x.slug}' sigue ocupado después de 60s. No integré nada; reintentá.\n`);
      return 75;
    }
    if (rcT !== 0) {
      await detachSiPrestado();
      await finIntegrar();
      io.err(`pa: NO integro: los tests de '${x.slug}' dieron rojo (rc ${rcT}${rcT === 124 ? `, se pasaron de ${v(pa.env, "PA_TESTS_MAX", "1800")}s` : ""}) sobre ${r}. ${ramaPpal} no se tocó. Log: ${logT}\n`);
      for (const l of ultimasLineas(logT, 15)) io.err(`    ${l}\n`);
      io.err(`    Que lo arregle el worker: pa '${x.proyecto}' --seguir --id ${t} 'los tests dan rojo: <qué>' (y después --integrar ${t} --tests).\n`);
      return 93;
    }
    l7 = await tomarLock(x, lockDePuesto(x, "aca"));
    if (!l7) {
      await detachSiPrestado();
      await finIntegrar();
      io.err(`pa: tests verdes, pero mientras corrían arrancó un worker --aca en el tree principal de '${x.slug}'. No integré; volvé a correr cuando termine.\n`);
      return 75;
    }
    io.out(`pa: tests verdes (${cmdTests}).\n`);
  }
  // 3. ff-only en el tree principal, y la rama se va
  if (!(await gOk(x, x.ruta, ["merge", "-q", "--ff-only", r]))) {
    await detachSiPrestado();
    await finIntegrar();
    io.err(`pa: el merge ff-only de ${r} en ${ramaPpal} falló (¿HEAD se movió mientras tanto?). Nada se tocó.\n`);
    return 1;
  }
  await g(x, wt, ["checkout", "-q", "--detach"]);
  if (wr && wr !== wt) await g(x, wr, ["checkout", "-q", "--detach"]);
  await limpiarBuild(x, wt);
  await finIntegrar();
  const headNuevo = await gs(x, x.ruta, ["rev-parse", "HEAD"]);
  await anotarIntegrada(pa, { id: t, proyecto: x.slug, rama: r, ramaPpal, antes: headPpal, despues: headNuevo, commits: n, accion: "integrada" });
  await sigueAlTablero(x, t, headNuevo);
  io.out(`pa: integrada ${r} en ${ramaPpal} de '${x.slug}' (${n} commit(s)).\n`);
  if (await gOk(x, x.ruta, ["branch", "-q", "-d", r])) rmSync(c, { force: true });
  else io.err(`pa: OJO: \`git branch -d ${r}\` se negó a borrarla (¿quedó algo sin mergear?). No la forcé: git -C '${x.ruta}' log ${ramaPpal}..${r}\n`);
  const entraron = await gs(x, x.ruta, ["diff", "--name-only", b, headPpal]);
  await solapamiento(x, t, [entraron, tocados].join("\n"), "entró a main");
  await empujarMain(x, x.ruta);
  await recompilarDistElectron(x.ruta);
  return 0;
}

/** `solapamiento`: otras ramas sin integrar del proyecto que tocan los mismos archivos (avisa, nunca frena). */
export async function solapamiento(x: Proy, propio: string, mios: string, verbo = "toca"): Promise<void> {
  if (!mios) return;
  const mis = new Set(mios.split("\n").filter(Boolean));
  for (const p of await ramasSinIntegrar(x)) {
    if (p.id === propio) continue;
    const mb = await g(x, x.ruta, ["merge-base", "HEAD", p.rama]);
    if (mb.codigo !== 0) continue;
    const suyos = (await gs(x, x.ruta, ["diff", "--name-only", mb.salida.replace(/\n+$/, ""), p.rama])).split("\n");
    const comun = suyos.filter((s) => mis.has(s)).slice(0, 5).join(" ");
    if (!comun) continue;
    if (verbo === "entró a main")
      x.pa.io.out(`— ojo: la corrida ${p.id} (sin integrar) toca lo mismo que acaba de entrar (${comun}): al integrarla puede chocar; si da 80, pa '${x.proyecto}' --actualizar ${p.id}.\n`);
    else x.pa.io.out(`— ojo: la corrida ${p.id} (sin integrar) también toca ${comun}: la que se integre segunda puede chocar.\n`);
  }
}

// ---------------------------------------------------------------- --descartar

/** `cmd_descartar`: tira la rama de esa corrida (`branch -D`), deja la punta en integradas.tsv. */
export async function cmdDescartar(x: Proy, t: string): Promise<number> {
  const { pa } = x;
  const { io } = pa;
  const c = path.join(x.dir, `${t}.corrida`);
  if (t.startsWith("huerfano-")) await adoptarHuerfanas(x);
  if (!existsSync(c)) {
    io.err(`pa: no hay corrida '${t}' de '${x.slug}'.\n`);
    return 1;
  }
  const r = leerCampo(c, "rama");
  if (!r) {
    io.err(`pa: la corrida '${t}' no tiene rama.\n`);
    return 1;
  }
  const lg = await tomarGit(x, 60_000);
  if (!lg) {
    io.err(`pa: el candado de git de '${x.slug}' sigue ocupado después de 60s. Reintentá.\n`);
    return 75;
  }
  try {
    const wr = await wtDeRama(x, r);
    if (wr) {
      const p = puestoDeRuta(x, wr);
      if (p === "aca") {
        io.err(`pa: la rama ${r} está checkouteada en ${wr}, fuera de los puestos de pa. No la toco.\n`);
        return 1;
      }
      // el puesto se TOMA (no sólo se sondea) mientras se limpia su build
      const l9 = await tomarLock(x, lockDePuesto(x, p));
      if (!l9) {
        io.err(`pa: la rama ${r} la está usando un worker en el puesto ${p}. Matalo o esperalo primero.\n`);
        return 75;
      }
      try {
        await g(x, wr, ["checkout", "-q", "--detach"]);
        await limpiarBuild(x, wr);
      } finally {
        await l9.liberar();
      }
    }
    const punta = await gs(x, x.ruta, ["rev-parse", "-q", "--verify", `refs/heads/${r}`]);
    const pend = await commitsPendientes(x, x.ruta, r);
    await g(x, x.ruta, ["branch", "-q", "-D", r]);
    await lg.liberar(); // antes de anotar, como el soltar_git del bash (liberar es idempotente)
    rmSync(c, { force: true });
    if (punta)
      await anotarIntegrada(pa, {
        id: t,
        proyecto: x.slug,
        rama: r,
        ramaPpal: await gs(x, x.ruta, ["rev-parse", "--abbrev-ref", "HEAD"]),
        antes: await gs(x, x.ruta, ["rev-parse", "HEAD"]),
        despues: punta,
        commits: pend,
        accion: "descartada",
      });
    await evento(pa, "descartar", t, x.slug);
    io.out(`pa: descartada ${r} de '${x.slug}'.\n`);
    return 0;
  } finally {
    await lg.liberar();
  }
}

// ---------------------------------------------------------------- por id (sin nombrar el proyecto)

/** `proyecto_de_id`: el slug de la corrida (por sus archivos de estado o por integradas.tsv), o "". */
export function proyectoDeId(pa: Pa, id: string): string {
  if (!/^[0-9A-Za-z._-]+$/.test(id)) return "";
  let dirs: string[] = [];
  try {
    dirs = readdirSorted(pa.state);
  } catch {
    dirs = [];
  }
  for (const ext of [".corrida", ".hilo", ".json", ".pid"]) {
    for (const d of dirs) {
      if (existsSync(path.join(pa.state, d, id + ext))) {
        if (d === "worktrees" || d === "lock") continue;
        return d;
      }
    }
  }
  return filaIntegrada(pa, id)?.[2] ?? "";
}
const readdirSorted = (d: string) => readdirSync(d).sort();

/** `usar_id`: el proyecto de una corrida por su id, como si hubieran dicho `pa <proyecto>`. Sale 1 si no lo encuentra. */
export function usarId(pa: Pa, id: string): Proy {
  const s = proyectoDeId(pa, id);
  if (!s) {
    pa.io.err(`pa: no encuentro la corrida '${id}' en ${pa.state}.\n`);
    salir(1);
  }
  const proyecto = nombreRegistry(pa, s);
  const r = resolverProyecto(proyecto, pa.env);
  if (!r.ok) {
    pa.io.err(`pa: la corrida '${id}' es de '${s}', y no encuentro ese proyecto en el registry.\n`);
    salir(1);
  }
  return fijarProyecto(pa, proyecto, (r as { ruta: string }).ruta);
}

/** El pid de un `.running` (`pid=` o, antes del fork, `pa_pid=`). */
const pidDe = (f: string) => Number(leerCampo(f, "pid") || leerCampo(f, "pa_pid")) || undefined;

/** `running_de_id`: el `.running` vivo de esa corrida, o "". */
export function runningDeId(x: Proy, id: string): string {
  const st = x.pa.state;
  let arr: string[] = [];
  try {
    arr = readdirSync(st).filter((n) => n.startsWith(`${x.slug}@`) && n.endsWith(".running")).sort();
  } catch {
    arr = [];
  }
  for (const r of [path.join(st, `${x.slug}.running`), ...arr.map((n) => path.join(st, n)), path.join(st, `${x.slug}.leer-${id}.running`)]) {
    if (existsSync(r) && leerCampo(r, "id") === id && vivo(pidDe(r))) return r;
  }
  return "";
}

/** `corrida_id_viva`: corriendo (su `.running`) o en cola (el pid de `$id.pid` vive). */
export function corridaIdViva(x: Proy, id: string): boolean {
  if (runningDeId(x, id)) return true;
  try {
    const pid = Number(readFileSync(path.join(x.dir, `${id}.pid`), "utf8").trim());
    return pid > 0 && vivo(pid);
  } catch {
    return false;
  }
}

/** `cmd_descartar_id`: `pa --descartar <id>`; se niega (92) con el worker vivo. */
export async function cmdDescartarId(pa: Pa, t = ""): Promise<number> {
  if (!t) {
    pa.io.err("uso: pa --descartar <id-de-corrida>   (o pa <proyecto> --descartar <id>)\n");
    return 2;
  }
  const x = usarId(pa, t);
  if (corridaIdViva(x, t)) {
    pa.io.err(`pa: la corrida ${t} de '${x.slug}' sigue viva (corriendo o en cola); no la descarto debajo de un worker. Paralo primero: pa --parar ${t}\n`);
    return 92;
  }
  return cmdDescartar(x, t);
}

// ---------------------------------------------------------------- entrada provisoria

/**
 * Entrada provisoria (hasta que esté el `pa` de TS completo): sólo los subcomandos de la etapa 9 que no lanzan un worker
 * (`--ramas`, `--integrar`, `--descartar`, `--leccion`, `--lecciones`, `--lecciones-podar`, y las validaciones de `--actualizar` y
 * `--auditar`). La usa la paridad (tests/paridad/casos-ramas.ts). Lo que falte (lanzar) sale 70 con un aviso.
 */
export async function main(argv: string[], env: Env = process.env, io: Io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }): Promise<number> {
  const { gestion } = await import("./gestion.ts");
  try {
    const pa = prologo(argv, env, io);
    return await gestion(pa, argv);
  } catch (e) {
    if (e instanceof Salida) return e.codigo;
    throw e;
  }
}

if (esPrincipal(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (c) => (process.exitCode = c),
    (e) => {
      process.stderr.write(`pa: ${(e as Error)?.stack ?? e}\n`);
      process.exitCode = 1;
    },
  );
}

