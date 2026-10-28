// Casos de paridad de la etapa 7 (puestos, tope global, admisión por RAM, cola, worktrees y huérfanos): app/electron/cli/pa/
// puestos.ts y worktrees.ts. Mismo formato que casos.ts. Para tener un worker vivo se lanza uno con --async que corre un
// «comando largo» en el claude falso (TRAMA_FALSO_LARGO_MS) y, antes de mirar los puestos, un `--esperar` con timeout de 1 s le da
// tiempo a escribir su `.running` (si no, el 75 dice «tomado (arrancando)» o no lo cuenta, según el momento).
import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto, Paso } from "./arnes.ts";

const M = "claude-sonnet-5-5";
const LARGO = { TRAMA_FALSO_LARGO_MS: "6000" };
/** Un worker vivo un rato: el claude falso corre un Bash largo antes de contestar. */
const vivo = (...extra: string[]): Paso => ({ args: ["demo", "--sin-jefe", "--async", "-m", M, ...extra, "comando largo"], rc: 0 });
/** Le da tiempo al worker de arriba a escribir su .running (sale por timeout). */
const respiro: Paso = { args: ["--esperar", "demo", "--timeout", "1"] };
const esperarTodo: Paso = { args: ["--esperar", "demo", "--timeout", "60"] };

const meminfo = (c: Contexto) => path.join(c.aux, "meminfo");

/** El worktree del puesto 1 ya existe (en HEAD suelto) con lo que dejó un worker que murió sin commitear. */
function conHuerfano(c: Contexto) {
  const wt = path.join(c.estado, "worktrees", "demo");
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
    env: { ...LARGO, PA_PUESTOS: "1" },
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "-m", M, "otra"], rc: 75 }, esperarTodo],
  },
  {
    nombre: "puestos: el segundo writer va al puesto 2 y avisa que corre en paralelo",
    env: LARGO,
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "-m", M, "otra"], rc: 78 }, esperarTodo],
  },
  {
    nombre: "puestos: --aca con el tree principal ocupado sale 75",
    env: LARGO,
    pasos: [vivo("--aca"), respiro, { args: ["demo", "--sin-jefe", "--aca", "-m", M, "otra"], rc: 75 }, esperarTodo],
  },
  {
    nombre: "tope: con PA_TOPE=1 y un worker vivo sale 75 con la lista de vivos",
    env: { ...LARGO, PA_TOPE: "1" },
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "-m", M, "otra"], rc: 75 }, esperarTodo],
  },
  {
    nombre: "tope: un --leer también ocupa lugar (75 con el tope lleno)",
    env: { ...LARGO, PA_TOPE: "1" },
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "--leer", "-m", M, "¿qué hay?"], rc: 75 }, esperarTodo],
  },
  {
    nombre: "ram: sin RAM para un segundo worker sale 75 con el motivo",
    preparar: (c) => writeFileSync(meminfo(c), "MemTotal:       16000000 kB\nMemAvailable:    4096000 kB\n"),
    env: (c) => ({ ...LARGO, PA_MEMINFO: meminfo(c) }),
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
    env: { ...LARGO, PA_PUESTOS: "1" },
    pasos: [vivo(), respiro, { args: ["demo", "--sin-jefe", "--async", "-m", M, "en cola"], rc: 0 }, esperarTodo, esperarTodo],
  },
  {
    nombre: "huérfano: el worktree del puesto 1 tenía trabajo sin commitear",
    preparar: conHuerfano,
    args: ["demo", "--sin-jefe", "-m", M, "hacé algo"],
    rc: 78,
  },
];
