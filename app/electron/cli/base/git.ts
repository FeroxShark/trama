// git con los `-c` fijos de Windows, siempre con array de args (nunca shell) y helpers de worktree.
// Los `-c core.longpaths=true -c core.autocrlf=false` van por GIT_CONFIG_COUNT/KEY_n/VALUE_n (git ≥ 2.31): valen para TODOS los git que
// lance este git (hooks, submódulos) y no ensucian el argv. Si el entorno ya trae GIT_CONFIG_COUNT, se agrega a continuación.
import { ejecutar } from "./proc.ts";
import { plataformaActual, type Plataforma } from "../../rutas.ts";

type Env = Record<string, string | undefined>;

export const CONFIG_FIJA: readonly [string, string][] = [
  ["core.longpaths", "true"],
  ["core.autocrlf", "false"],
];

/** El entorno con la config fija agregada. Puro. */
export function entornoGit(base: Env = process.env): Env {
  const n0 = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10);
  const n = Number.isFinite(n0) && n0 > 0 ? n0 : 0;
  const env: Env = { ...base, GIT_CONFIG_COUNT: String(n + CONFIG_FIJA.length) };
  CONFIG_FIJA.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${n + i}`] = k;
    env[`GIT_CONFIG_VALUE_${n + i}`] = v;
  });
  return env;
}

export type ResultadoGit = { codigo: number; salida: string; errores: string; error?: Error };
export type OpcionesGit = { cwd?: string; env?: Env; input?: string; timeoutMs?: number };

/** Corre `git <args>` y devuelve el resultado SIN tirar (mirar `codigo`). La salida se recorta de un `\n` final no: se devuelve tal cual. */
export function git(args: string[], o: OpcionesGit = {}): Promise<ResultadoGit> {
  return ejecutar("git", args, { cwd: o.cwd, env: entornoGit(o.env ?? process.env), input: o.input, timeoutMs: o.timeoutMs });
}

/** Como `git` pero tira (Error con el stderr) si el código no es 0. Devuelve stdout sin el `\n` final. */
export async function gitOk(args: string[], o: OpcionesGit = {}): Promise<string> {
  const r = await git(args, o);
  if (r.codigo !== 0) throw new Error(`git ${args.join(" ")} falló (${r.codigo}): ${r.errores.trim() || r.error?.message || ""}`);
  return r.salida.replace(/\r?\n$/, "");
}

export type Worktree = {
  ruta: string;
  head?: string;
  /** Rama completa (`refs/heads/x`) o undefined si está en HEAD suelto. */
  rama?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
};

/** Parsea `git worktree list --porcelain`: bloques separados por línea en blanco, tolerante a `\r\n`. En Windows git da `C:/x/y`: con `plat` win32 se pasa a `C:\x\y`. */
export function parsearWorktrees(texto: string, plat: Plataforma = plataformaActual()): Worktree[] {
  const r: Worktree[] = [];
  let w: Worktree | null = null;
  for (const cruda of texto.split("\n")) {
    const l = cruda.replace(/\r$/, "");
    if (l === "") {
      if (w) r.push(w);
      w = null;
      continue;
    }
    const sp = l.indexOf(" ");
    const k = sp < 0 ? l : l.slice(0, sp);
    const v = sp < 0 ? "" : l.slice(sp + 1);
    if (k === "worktree") {
      if (w) r.push(w);
      w = { ruta: plat === "win32" ? v.replace(/\//g, "\\") : v, detached: false, bare: false, locked: false, prunable: false };
    } else if (w) {
      if (k === "HEAD") w.head = v;
      else if (k === "branch") w.rama = v;
      else if (k === "detached") w.detached = true;
      else if (k === "bare") w.bare = true;
      else if (k === "locked") w.locked = true;
      else if (k === "prunable") w.prunable = true;
    }
  }
  if (w) r.push(w);
  return r;
}

export async function worktreeList(repo: string, o: { plat?: Plataforma; env?: Env } = {}): Promise<Worktree[]> {
  return parsearWorktrees(await gitOk(["worktree", "list", "--porcelain"], { cwd: repo, env: o.env }), o.plat);
}

export type OpcionesWorktreeAdd = {
  /** Rama a crear (`-b`) o a sacar. */
  rama?: string;
  /** Con `rama`: crearla (`-b`). Sin `nueva`, `rama` tiene que existir. */
  nueva?: boolean;
  /** Commit/rama de partida. */
  desde?: string;
  /** HEAD suelto (`--detach`). */
  detach?: boolean;
  env?: Env;
};

/** El argv de `git worktree add`. Puro (lo prueban los tests). */
export function argvWorktreeAdd(ruta: string, o: OpcionesWorktreeAdd = {}): string[] {
  const a = ["worktree", "add"];
  if (o.detach) a.push("--detach");
  if (o.rama && o.nueva) a.push("-b", o.rama);
  a.push(ruta);
  if (o.rama && !o.nueva && !o.detach) a.push(o.rama);
  else if (o.desde) a.push(o.desde);
  return a;
}

export async function worktreeAdd(repo: string, ruta: string, o: OpcionesWorktreeAdd = {}): Promise<void> {
  await gitOk(argvWorktreeAdd(ruta, o), { cwd: repo, env: o.env });
}

export async function worktreeRemove(repo: string, ruta: string, o: { force?: boolean; env?: Env } = {}): Promise<void> {
  await gitOk(["worktree", "remove", ...(o.force ? ["--force"] : []), ruta], { cwd: repo, env: o.env });
}

export async function worktreePrune(repo: string, o: { env?: Env } = {}): Promise<void> {
  await gitOk(["worktree", "prune"], { cwd: repo, env: o.env });
}
