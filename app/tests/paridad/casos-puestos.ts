// Casos de paridad de la etapa 7 (puestos, tope global, admisión por RAM, cola, worktrees y huérfanos): app/electron/cli/pa/
// puestos.ts y worktrees.ts. Mismo formato que casos.ts. Para tener un worker vivo se lanza uno con --async cuya tarea dice
// «comando largo»: el `claude` del sandbox se cambia por uno que con eso tarda unos segundos antes de ser el claude falso (que en
// `-p` contesta en el acto). Antes de mirar los puestos, un `--esperar` con timeout de 1 s le da tiempo a escribir su `.running`
// (si no, el 75 dice «tomado (arrancando)» o no lo cuenta, según el momento).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto, Paso } from "./arnes.ts";

const M = "claude-sonnet-5-5";
const FALSO = path.join(import.meta.dirname, "..", "..", "scripts", "claude-falso.mjs");
/** El `claude` del sandbox tarda 6 s si la tarea dice «comando largo» (el worker queda vivo ese rato). */
function lento(c: Contexto) {
  const shim = path.join(c.raiz, "shim", "claude");
  writeFileSync(shim, `#!/bin/sh\ncase "$*" in *"comando largo"*) sleep 6 ;; esac\nexec "${process.execPath}" "${FALSO}" "$@"\n`);
  chmodSync(shim, 0o755);
}
/** Un worker vivo un rato: el claude falso corre un Bash largo antes de contestar. */
const vivo = (...extra: string[]): Paso => ({ args: ["demo", "--sin-jefe", "--async", "-m", M, ...extra, "comando largo"], rc: 0 });
/** Le da tiempo al worker de arriba a escribir su .running (sale por timeout). */
const respiro: Paso = { args: ["--esperar", "demo", "--timeout", "1"] };
const esperarTodo: Paso = { args: ["--esperar", "demo", "--timeout", "60"] };

const meminfo = (c: Contexto) => path.join(c.aux, "meminfo");

/** El worktree del puesto 1 ya existe (en HEAD suelto) con lo que dejó un worker que murió sin commitear. */
function conHuerfano(c: Contexto) {
  const wt = path.join(c.estado, "worktrees", path.basename(c.proyecto)); // el slug es el de la carpeta
  mkdirSync(path.dirname(wt), { recursive: true });
  spawnSync("git", ["-C", c.proyecto, "worktree", "add", "-q", "--detach", wt, "HEAD"], { encoding: "utf8" });
  writeFileSync(path.join(wt, "medio-hecho.txt"), "a medias\n");
  mkdirSync(path.join(wt, "target", "debug"), { recursive: true });
  writeFileSync(path.join(wt, "target", "debug", "app"), "binario");
  symlinkSync(c.aux, path.join(wt, "afuera"));
}

export const casosPuestos: Caso[] = [
  {
    nombre: "puestos: dos corridas seguidas reusan el worktree del puesto 1",
    pasos: [
      { args: ["demo", "--sin-jefe", "-m", M, "primera"], rc: 78 },
      { args: ["demo", "--sin-jefe", "-m", M, "segunda"], rc: 78 },
    ],
  },
  {
    nombre: "puestos: con el único puesto ocupado sale 75 y dice qué corre",
    preparar: lento,
    env: { PA_PUESTOS: "1" },
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "-m", M, "otra"], rc: 75 }, esperarTodo],
  },
  {
    nombre: "puestos: el segundo writer va al puesto 2 y avisa que corre en paralelo",
    preparar: lento,
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "-m", M, "otra"], rc: 78 }, esperarTodo],
  },
  {
    nombre: "puestos: --aca con el tree principal ocupado sale 75",
    preparar: lento,
    pasos: [vivo("--aca"), respiro, { args: ["demo", "--sin-jefe", "--aca", "-m", M, "otra"], rc: 75 }, esperarTodo],
  },
  {
    nombre: "tope: con PA_TOPE=1 y un worker vivo sale 75 con la lista de vivos",
    preparar: lento,
    env: { PA_TOPE: "1" },
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "-m", M, "otra"], rc: 75 }, esperarTodo],
  },
  {
    nombre: "tope: un --leer también ocupa lugar (75 con el tope lleno)",
    preparar: lento,
    env: { PA_TOPE: "1" },
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "--leer", "-m", M, "¿qué hay?"], rc: 75 }, esperarTodo],
  },
  {
    nombre: "ram: sin RAM para un segundo worker sale 75 con el motivo",
    preparar: (c) => {
      lento(c);
      writeFileSync(meminfo(c), "MemTotal:       16000000 kB\nMemAvailable:    4096000 kB\n");
    },
    env: (c) => ({ PA_MEMINFO: meminfo(c) }),
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "-m", M, "otra"], rc: 75 }, esperarTodo],
  },
  {
    nombre: "ram: con 0 vivos entra aunque no alcance (piso de uno)",
    preparar: (c) => writeFileSync(meminfo(c), "MemAvailable:    1024 kB\n"),
    env: (c) => ({ PA_MEMINFO: meminfo(c) }),
    args: ["demo", "--sin-jefe", "-m", M, "hacé algo"],
    rc: 78,
  },
  {
    nombre: "cola: --async con el puesto ocupado hace cola y arranca solo",
    preparar: lento,
    env: { PA_PUESTOS: "1" },
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "--async", "-m", M, "en cola"], rc: 0 }, esperarTodo, esperarTodo],
  },
  {
    nombre: "huérfano: el worktree del puesto 1 tenía trabajo sin commitear",
    preparar: conHuerfano,
    // con identidad de git: si no, el commit del huérfano falla callado y el trabajo queda sucio en la rama nueva
    env: { GIT_AUTHOR_NAME: "x", GIT_AUTHOR_EMAIL: "a@b", GIT_COMMITTER_NAME: "x", GIT_COMMITTER_EMAIL: "a@b" },
    args: ["demo", "--sin-jefe", "-m", M, "hacé algo"],
    rc: 78,
  },
];
