// `pidDeCorrida` (cli/base/proc.ts): el pid de `<id>.pid` es de verdad esa corrida y no el TID de un hilo ajeno ni un pid reciclado.
// `pa --parar` no puede señalar a esos dos (regresión del port: `kill -0` y /proc/<n>/stat dan "vivo" con un TID).
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { esperarHasta } from "./esperar.ts";
import { testPosix } from "./plataforma.ts";
import { MARGEN_PID_MS, inicioMsDe, pidDeCorrida } from "../electron/cli/base/proc.ts";
import { main } from "../electron/cli/pa/cli.ts";
import { corridaEnCola } from "../electron/cli/pa/corridas.ts";
import type { Env, Io } from "../electron/cli/pa/entorno.ts";
import { deps as depsReales } from "../electron/cli/pa.ts";

const node = process.execPath;
const hijos: ChildProcess[] = [];
test.after(() => {
  for (const h of hijos) h.kill("SIGKILL");
});
const vivoNode = (codigo = "setInterval(()=>{},1000)"): ChildProcess => {
  const h = spawn(node, ["-e", codigo], { stdio: ["ignore", "pipe", "ignore"] });
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

/** Un proceso de node con un Worker vivo: devuelve el proceso y el TID del hilo del worker (un número que `kill -0` ve como vivo). */
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

function carpeta() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pid-de-corrida-")));
  return { dir, pid: (id: string) => path.join(dir, `${id}.pid`) };
}
const escribirPid = (f: string, pid: number, haceMs = 0) => {
  writeFileSync(f, String(pid));
  if (haceMs) utimesSync(f, new Date(Date.now() - haceMs), new Date(Date.now() - haceMs));
};

testPosix("pidDeCorrida: una corrida genuina (el .pid se escribe DESPUÉS de lanzar) es de la corrida", async () => {
  const { pid } = carpeta();
  const h = vivoNode();
  await esperarHasta(() => inicioMsDe(h.pid!) !== undefined, { tope: 5000 });
  escribirPid(pid("a"), h.pid!);
  assert.equal(pidDeCorrida(pid("a")), h.pid);
});

testPosix("pidDeCorrida: el TID de un hilo vivo de otro programa NO es de la corrida", async () => {
  const { pid } = carpeta();
  const { h, tid } = await conHilo();
  assert.ok(viva(tid), "kill -0 lo ve vivo: justo lo que engañaba");
  escribirPid(pid("t"), tid, 3_600_000); // aunque el archivo sea viejo o nuevo
  assert.equal(pidDeCorrida(pid("t")), null);
  escribirPid(pid("t2"), tid);
  assert.equal(pidDeCorrida(pid("t2")), null);
  assert.equal(pidDeCorrida(pid("t3")), null, "sin archivo");
  assert.equal(h.exitCode, null);
});

testPosix("pidDeCorrida: un pid reciclado (proceso propio que arrancó después del .pid) NO es de la corrida", async () => {
  const { pid } = carpeta();
  const h = vivoNode();
  await esperarHasta(() => inicioMsDe(h.pid!) !== undefined, { tope: 5000 });
  escribirPid(pid("r"), h.pid!, MARGEN_PID_MS + 60_000); // el .pid es de hace un minuto largo: el proceso es de ahora
  assert.equal(pidDeCorrida(pid("r")), null);
  // y con los datos inyectados: dentro del margen sí, fuera no
  const mtime = 1_000_000;
  const o = (ini: number) => ({ mtimeMs: () => mtime, inicioMs: () => ini });
  assert.equal(pidDeCorrida(pid("r"), o(mtime + MARGEN_PID_MS)), h.pid);
  assert.equal(pidDeCorrida(pid("r"), o(mtime + MARGEN_PID_MS + 1)), null);
});

testPosix("pidDeCorrida: un zombie, un pid muerto y basura en el archivo no son de la corrida", async () => {
  const { pid } = carpeta();
  const h = vivoNode("process.exit(0)");
  const muerto = h.pid!;
  await new Promise((r) => h.once("exit", r));
  escribirPid(pid("m"), muerto);
  assert.equal(pidDeCorrida(pid("m")), null);
  writeFileSync(pid("x"), "no-es-un-pid");
  assert.equal(pidDeCorrida(pid("x")), null);
  writeFileSync(pid("v"), "");
  assert.equal(pidDeCorrida(pid("v")), null);
});

test("pidDeCorrida en Windows: la hora de arranque sale de inicioDe (FILETIME) y un pid reciclado no cuenta; sin lanzar nada para un pid muerto", () => {
  const unix = 1_800_000_000_000;
  const filetime = String((unix + 11_644_473_600_000) * 10_000);
  assert.equal(inicioMsDe(77, { plat: "win32", inicioDe: () => filetime }), unix);
  const base = { plat: "win32" as const, kill: () => undefined, leerArchivo: () => "77", mtimeMs: () => unix };
  assert.equal(pidDeCorrida("x.pid", { ...base, inicioDe: () => filetime }), 77);
  assert.equal(pidDeCorrida("x.pid", { ...base, inicioDe: () => String((unix + MARGEN_PID_MS + 5000 + 11_644_473_600_000) * 10_000) }), null);
  let llamadas = 0;
  const muerto = { ...base, kill: () => { throw Object.assign(new Error("x"), { code: "ESRCH" }); }, inicioDe: () => (llamadas++, filetime) };
  assert.equal(pidDeCorrida("x.pid", muerto), null);
  assert.equal(llamadas, 0, "no consulta la hora de arranque de un pid muerto");
});

testPosix("corridaEnCola: .listo o .entregado la dan por terminada aunque el número lo ocupe un proceso", async () => {
  const { dir, pid } = carpeta();
  const h = vivoNode();
  await esperarHasta(() => inicioMsDe(h.pid!) !== undefined, { tope: 5000 });
  escribirPid(pid("c"), h.pid!);
  assert.equal(corridaEnCola(dir, "c"), true);
  writeFileSync(path.join(dir, "c.listo"), "");
  assert.equal(corridaEnCola(dir, "c"), false);
  escribirPid(pid("d"), h.pid!);
  writeFileSync(path.join(dir, "d.entregado"), "");
  assert.equal(corridaEnCola(dir, "d"), false);
});

// ---------------------------------------------------------------- pa --parar

function sandbox() {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pid-parar-")));
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
  return { env, raiz, dir: path.join(estado, "demo") };
}
async function parar(env: Env, id: string) {
  const io: Io & { o: string; e: string } = { o: "", e: "", out(s) { this.o += s; }, err(s) { this.e += s; } };
  const rc = await main(["--parar", id], env, io, { ...depsReales });
  return { rc, o: io.o, e: io.e };
}

testPosix("pa --parar: no señala al TID de un hilo ajeno ni a un pid reciclado; sí baja una en cola genuina", async () => {
  const s = sandbox();
  try {
    const { h: ajeno, tid } = await conHilo();
    writeFileSync(path.join(s.dir, "20261101-100000-1.corrida"), "rama=x\n");
    escribirPid(path.join(s.dir, "20261101-100000-1.pid"), tid);
    const a = await parar(s.env, "20261101-100000-1");
    assert.equal(a.rc, 1, a.e);
    assert.match(a.e, /no está corriendo ni en cola/);
    assert.equal(ajeno.exitCode, null);
    assert.ok(viva(ajeno.pid!), "el programa ajeno sigue vivo");

    const reciclado = vivoNode();
    await esperarHasta(() => inicioMsDe(reciclado.pid!) !== undefined, { tope: 5000 });
    escribirPid(path.join(s.dir, "20261101-100000-2.pid"), reciclado.pid!, 3_600_000);
    const b = await parar(s.env, "20261101-100000-2");
    assert.equal(b.rc, 1, b.e);
    assert.ok(viva(reciclado.pid!), "el pid reciclado no se señaló");

    const real = vivoNode();
    await esperarHasta(() => inicioMsDe(real.pid!) !== undefined, { tope: 5000 });
    escribirPid(path.join(s.dir, "20261101-100000-3.pid"), real.pid!);
    const c = await parar(s.env, "20261101-100000-3");
    assert.equal(c.rc, 0, c.e);
    assert.match(c.o, /bajada \(estaba en cola\)/);
    await esperarHasta(() => !viva(real.pid!), { tope: 5000 });
  } finally {
    rmSync(s.raiz, { recursive: true, force: true });
  }
});
