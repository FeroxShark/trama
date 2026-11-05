// `pidDeRunning` y todo lo que lee un `<proyecto>.running`: un `.running` huérfano (pa matado con -9, cuota agotada, reinicio) lleva un
// pid que ya no existe, que otro programa reciclo o que hoy es el TID de un hilo ajeno. Eso NO es un worker vivo: la fila debe decir
// `murio` (no `trabajando` para siempre), `pa --parar` cierra el rastro y NUNCA se señala a un proceso que no es de la corrida.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { esperarHasta } from "./esperar.ts";
import { testPosix } from "./plataforma.ts";
import { MARGEN_PID_MS, inicioMsDe, pidDeCampoRunning, pidDeRunning } from "../electron/cli/base/proc.ts";
import { main } from "../electron/cli/pa/cli.ts";
import { runningVivo } from "../electron/cli/pa/corridas.ts";
import type { Env, Io } from "../electron/cli/pa/entorno.ts";
import { deps as depsReales } from "../electron/cli/pa.ts";

const hijos: ChildProcess[] = [];
test.after(() => {
  for (const h of hijos) h.kill("SIGKILL");
});
const vivoNode = (codigo = "setInterval(()=>{},1000)"): ChildProcess => {
  const h = spawn(process.execPath, ["-e", codigo], { stdio: ["ignore", "pipe", "ignore"] });
  hijos.push(h);
  return h;
};
const viva = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function conArranque(): Promise<ChildProcess> {
  const h = vivoNode();
  await esperarHasta(() => inicioMsDe(h.pid!) !== undefined, { tope: 5000 });
  return h;
}
async function muerto(): Promise<number> {
  const h = vivoNode("process.exit(0)");
  await new Promise((r) => h.once("exit", r));
  return h.pid!;
}
/** Un proceso de node con un Worker vivo: el TID del hilo es un número que `kill -0` ve como vivo y que no es un proceso. */
async function conHilo(): Promise<{ h: ChildProcess; tid: number }> {
  const h = vivoNode(`
    const { Worker } = require("node:worker_threads");
    const w = new Worker("setInterval(()=>{},1000)", { eval: true });
    w.on("online", () => { console.log(require("fs").readdirSync("/proc/self/task").join(",")); });
    setInterval(()=>{},1000);`);
  let salida = "";
  h.stdout!.on("data", (b) => (salida += String(b)));
  await esperarHasta(() => salida.includes("\n"), { tope: 10_000 });
  const tid = salida.trim().split(",").map(Number).filter((n) => n !== h.pid).pop()!;
  assert.ok(tid > 0 && tid !== h.pid);
  return { h, tid };
}

const ID = "20261105-010000-4242";
function escribirRunning(f: string, campos: Record<string, string | number>, haceMs = 0) {
  writeFileSync(f, Object.entries(campos).map(([k, v]) => `${k}=${v}\n`).join(""));
  if (haceMs) utimesSync(f, new Date(Date.now() - haceMs), new Date(Date.now() - haceMs));
}
const VIEJO = MARGEN_PID_MS + 600_000; // el `.running` es de hace diez minutos largos

function sandbox() {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "running-obsoleto-")));
  const home = path.join(raiz, "home");
  const proyecto = path.join(raiz, "demo");
  const estado = path.join(raiz, "estado");
  mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
  mkdirSync(path.join(estado, "demo"), { recursive: true });
  mkdirSync(proyecto, { recursive: true });
  const reg = path.join(home, ".config", "proyectos", "registry.json");
  writeFileSync(reg, JSON.stringify({ projects: [{ name: "demo", path: proyecto }] }));
  const env: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|REPARTO_|CLAUDE)/.test(k)) env[k] = v;
  Object.assign(env, { HOME: home, USER: "gonza", XDG_CONFIG_HOME: path.join(home, ".config"), PA_STATE: estado, PROYECTOS_REGISTRY: reg, PA_JEFE: "", PA_JEFE_ID: "" });
  const dir = path.join(estado, "demo");
  writeFileSync(path.join(dir, `${ID}.hilo`), `tarea=probar\nmodelo=m\ninicio=${Math.floor(Date.now() / 1000) - 3600}\nproyecto=demo\n`);
  return { env, raiz, dir, running: path.join(estado, "demo.running") };
}
async function pa(env: Env, ...args: string[]) {
  const io: Io & { o: string; e: string } = { o: "", e: "", out(s) { this.o += s; }, err(s) { this.e += s; } };
  const rc = await main(args, env, io, { ...depsReales });
  return { rc, o: io.o, e: io.e };
}
const estadoDe = async (env: Env) => {
  const r = await pa(env, "--hilos");
  const l = r.o.split("\n").find((x) => x.startsWith(`${ID}\t`));
  return l?.split("\t")[1];
};

testPosix("pidDeRunning: un worker genuino (el .running se escribe DESPUÉS de lanzar) es de la corrida; sin pid vale el de pa", async () => {
  const h = await conArranque();
  const f = path.join(mkdtempSync(path.join(os.tmpdir(), "run-")), "demo.running");
  escribirRunning(f, { pid: h.pid!, pa_pid: 1, id: ID });
  assert.equal(pidDeRunning(f), h.pid);
  escribirRunning(f, { pid: "", pa_pid: h.pid!, id: ID }); // antes del fork
  assert.equal(pidDeRunning(f), h.pid);
  assert.equal(runningVivo(f), true);
  assert.equal(pidDeRunning(f + ".no-existe"), null);
});

testPosix("pidDeRunning: pid muerto, pid reciclado e hilo ajeno NO son de la corrida", async () => {
  const f = path.join(mkdtempSync(path.join(os.tmpdir(), "run-")), "demo.running");
  // muerto
  escribirRunning(f, { pid: await muerto(), pa_pid: await muerto(), id: ID });
  assert.equal(pidDeRunning(f), null);
  assert.equal(runningVivo(f), false);
  // reciclado: hay un proceso vivo con ese número, pero arrancó mucho DESPUÉS de que se escribió el .running
  const otro = await conArranque();
  escribirRunning(f, { pid: otro.pid!, pa_pid: otro.pid!, id: ID }, VIEJO);
  assert.equal(pidDeRunning(f), null);
  assert.equal(pidDeCampoRunning(f, "pid"), null);
  assert.equal(pidDeCampoRunning(f, "pa_pid"), null);
  assert.equal(runningVivo(f), false);
  // hilo ajeno: kill -0 lo ve vivo, pero no es un proceso
  const { h, tid } = await conHilo();
  assert.ok(viva(tid), "kill -0 lo ve vivo: justo lo que engañaba");
  escribirRunning(f, { pid: tid, pa_pid: tid, id: ID });
  assert.equal(pidDeRunning(f), null);
  assert.equal(runningVivo(f), false);
  assert.equal(h.exitCode, null);
  // un campo vale por separado: el pa real con el claude reciclado
  escribirRunning(f, { pid: tid, pa_pid: otro.pid!, id: ID });
  assert.equal(pidDeCampoRunning(f, "pid"), null);
  assert.equal(pidDeCampoRunning(f, "pa_pid"), otro.pid);
});

test("pidDeRunning en Windows: la hora de arranque sale de inicioDe y un pid reciclado no cuenta (sin verificar en una Windows real)", () => {
  const unix = 1_800_000_000_000;
  const ft = (ms: number) => String((ms + 11_644_473_600_000) * 10_000);
  const base = { plat: "win32" as const, kill: () => undefined, leerArchivo: () => "pid=77\npa_pid=5\nid=x\n", mtimeMs: () => unix };
  assert.equal(pidDeRunning("x.running", { ...base, inicioDe: () => ft(unix) }), 77);
  assert.equal(pidDeRunning("x.running", { ...base, inicioDe: () => ft(unix + MARGEN_PID_MS + 5000) }), null);
  assert.equal(pidDeCampoRunning("x.running", "pa_pid", { ...base, inicioDe: () => ft(unix) }), 5);
  assert.equal(pidDeRunning("x.running", { ...base, kill: () => { throw Object.assign(new Error("x"), { code: "ESRCH" }); }, inicioDe: () => ft(unix) }), null);
});

testPosix("la fila dice murio (no trabajando) con un .running de pid reciclado, de hilo ajeno o muerto; trabajando con uno real", async () => {
  const s = sandbox();
  try {
    const real = await conArranque();
    escribirRunning(s.running, { pid: real.pid!, pa_pid: real.pid!, id: ID, proyecto: "demo", inicio: 1 });
    assert.equal(await estadoDe(s.env), "trabajando");

    escribirRunning(s.running, { pid: real.pid!, pa_pid: real.pid!, id: ID, proyecto: "demo", inicio: 1 }, VIEJO);
    assert.equal(await estadoDe(s.env), "murio", "pid reciclado");

    const { tid } = await conHilo();
    escribirRunning(s.running, { pid: tid, pa_pid: tid, id: ID, proyecto: "demo", inicio: 1 });
    assert.equal(await estadoDe(s.env), "murio", "hilo ajeno");

    escribirRunning(s.running, { pid: await muerto(), pa_pid: await muerto(), id: ID, proyecto: "demo", inicio: 1 });
    assert.equal(await estadoDe(s.env), "murio", "pid muerto");
  } finally {
    rmSync(s.raiz, { recursive: true, force: true });
  }
});

testPosix("pa --parar y --matar con un .running huérfano: cierran el rastro y no señalan al pid reciclado ni al hilo ajeno", async () => {
  const s = sandbox();
  try {
    const reciclado = await conArranque();
    const { h: ajeno, tid } = await conHilo();
    for (const [pid, etiqueta] of [[reciclado.pid!, "reciclado"], [tid, "hilo"]] as const) {
      escribirRunning(s.running, { pid, pa_pid: pid, id: ID, proyecto: "demo", inicio: 1, puesto: 1 }, pid === tid ? 0 : VIEJO);
      writeFileSync(s.running.replace(/\.running$/, ".heartbeat"), "epoch=1\n");
      const r = await pa(s.env, "--parar", ID);
      assert.equal(r.rc, 0, `${etiqueta}: ${r.e}`);
      assert.match(r.o, /murió sin avisar/);
      assert.equal(existsSync(s.running), false, `${etiqueta}: el .running obsoleto ya no está`);
      assert.match(readFileSync(path.join(s.dir, `${ID}.hilo`), "utf8"), /^fin=\d+$/m, `${etiqueta}: la hora de muerte quedó anotada`);
      assert.equal(await estadoDe(s.env), "murio");
      assert.ok(viva(reciclado.pid!) && viva(tid) && ajeno.exitCode === null, `${etiqueta}: nadie ajeno fue señalado`);
      writeFileSync(path.join(s.dir, `${ID}.hilo`), `tarea=probar\nmodelo=m\ninicio=${Math.floor(Date.now() / 1000) - 3600}\nproyecto=demo\n`);
    }
    // --matar a secas: baja el rastro sin señalar a nadie
    escribirRunning(s.running, { pid: reciclado.pid!, pa_pid: reciclado.pid!, id: ID, proyecto: "demo", inicio: 1, puesto: 1 }, VIEJO);
    const m = await pa(s.env, "demo", "--matar");
    assert.equal(m.rc, 0, m.e);
    assert.equal(existsSync(s.running), false);
    assert.ok(viva(reciclado.pid!), "el pid reciclado no se señaló");
    // y un id sin nada: sigue siendo error
    assert.equal((await pa(s.env, "--parar", "20261105-010000-1")).rc, 1);
  } finally {
    rmSync(s.raiz, { recursive: true, force: true });
  }
});
