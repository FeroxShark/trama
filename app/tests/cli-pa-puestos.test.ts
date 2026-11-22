// cli/pa/puestos.ts: admisión de una corrida (lugar global, puesto, RAM, cola) con los locks de Node. Lo que el bash prueba con
// flock acá se prueba tomando el lock con el módulo de Node (motor/docs/port-windows.md, trampa 2): el mismo proceso que ya tiene
// un lock lo ve ocupado si lo vuelve a pedir, así que dos `Admision` en el mismo proceso se estorban como dos `pa`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prologo, Salida, type Env } from "../electron/cli/pa/entorno.ts";
import { Admision, describirPuestos, memDisponibleMb, otrosWriters, puestoLibre, ramAlcanza, ramReservadaMb, workersSueltos } from "../electron/cli/pa/puestos.ts";
import type { Proyecto } from "../electron/cli/pa/worktrees.ts";

function armar(extra: Env = {}, conGit = true) {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-puestos-"));
  const state = path.join(raiz, "estado");
  const ruta = path.join(raiz, "demo");
  mkdirSync(ruta, { recursive: true });
  if (conGit) {
    const git = (...a: string[]) => spawnSync("git", ["-C", ruta, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "init");
  }
  let err = "";
  const env: Env = { HOME: raiz, PA_STATE: state, PA_PROJ: path.join(raiz, "proj"), PA_MEMINFO: path.join(raiz, "no-hay-meminfo"), ...extra };
  const pa = prologo([], env, { out: () => {}, err: (s) => (err += s) });
  const proy = (ts: string): Proyecto => ({ pa, proyecto: "demo", ruta, slug: "demo", dir: path.join(state, "demo"), ts });
  return { raiz, state, ruta, pa, proy, err: () => err };
}

const sale = async (f: () => Promise<unknown>, codigo: number) => {
  await assert.rejects(f, (e: unknown) => e instanceof Salida && e.codigo === codigo);
};

test("puestos: el primero toma el 1, el segundo el 2, y con los dos tomados el tercero sale 75 diciendo qué corre", async () => {
  const s = armar({ PA_PUESTOS: "2" });
  const a = new Admision(s.proy("20261028-100000-1"));
  const b = new Admision(s.proy("20261028-100000-2"));
  await a.tomarPuesto();
  await b.tomarPuesto();
  assert.equal(a.puesto, "1");
  assert.equal(b.puesto, "2");
  assert.equal(readFileSync(path.join(s.state, "demo", "20261028-100000-1.puesto"), "utf8"), "1");
  assert.equal(path.basename(b.run), "demo@2.running");
  assert.equal(await puestoLibre(s.proy("x"), "1"), false);
  writeFileSync(a.run, `id=20261028-100000-1\npid=${process.pid}\njefe=jefa\ntarea=hacer algo largo\n`);
  const c = new Admision(s.proy("20261028-100000-3"));
  await sale(() => c.tomarPuesto(), 75);
  assert.match(s.err(), /ya hay un worker corriendo en cada uno de los 2 puesto\(s\) de 'demo':/);
  assert.match(s.err(), /    puesto 1: id 20261028-100000-1 · jefe jefa · hacer algo largo\n    puesto 2: tomado \(arrancando\)\n/);
  assert.match(s.err(), /pa --esperar 'demo' --id <id>/);
  // el que salió 75 no se quedó con un lugar del tope
  await a.soltarTodo();
  assert.equal(await puestoLibre(s.proy("x"), "1"), true);
  await b.soltarTodo();
});

test("puestos: --aca usa el tree principal (`@aca`) y uno solo a la vez; sin git es siempre el puesto 1", async () => {
  const s = armar();
  const a = new Admision(s.proy("t1"), { aca: true });
  await a.tomarPuesto();
  assert.equal(a.puesto, "aca");
  assert.equal(path.basename(a.run), "demo@aca.running");
  await sale(() => new Admision(s.proy("t2"), { aca: true }).tomarPuesto(), 75);
  assert.match(s.err(), /ya hay un worker corriendo en el tree principal de 'demo' \(--aca o sin worktree\):\n    tree principal: tomado \(arrancando\)/);
  // los worktrees siguen libres en paralelo
  const b = new Admision(s.proy("t3"));
  await b.tomarPuesto();
  assert.equal(b.puesto, "1");
  await a.soltarTodo();
  await b.soltarTodo();

  const sg = armar({}, false);
  const c = new Admision(sg.proy("t1"));
  await c.tomarPuesto();
  assert.equal(c.puesto, "1");
  await sale(() => new Admision(sg.proy("t2")).tomarPuesto(), 75);
  assert.match(sg.err(), /ya hay un worker corriendo en el puesto 1 de 'demo'/);
  await c.soltarTodo();
});

test("puestos: el .running de un worker muerto del puesto que se toma se limpia", async () => {
  const s = armar();
  mkdirSync(s.state, { recursive: true });
  writeFileSync(path.join(s.state, "demo.running"), "id=viejo\npid=999999999\n");
  writeFileSync(path.join(s.state, "demo.heartbeat"), "x");
  const a = new Admision(s.proy("t1"));
  await a.tomarPuesto();
  assert.equal(existsSync(path.join(s.state, "demo.running")), false);
  assert.equal(existsSync(path.join(s.state, "demo.heartbeat")), false);
  await a.soltarTodo();
});

test("tope global: con PA_TOPE=1 y un worker vivo, el segundo sale 75 con el motivo y los vivos; al soltar entra", async () => {
  const s = armar({ PA_TOPE: "1" });
  const a = new Admision(s.proy("t1"));
  await a.tomarPuesto();
  assert.equal(a.lugar, "1");
  writeFileSync(path.join(s.state, "demo.running"), `id=t1\nproyecto=demo\npid=${process.pid}\npuesto=1\njefe=j\ntarea=algo\n`);
  const b = new Admision(s.proy("t2"));
  assert.equal(await b.tomarLugar(), false);
  assert.equal(b.motivoTope, "tope global: 1 workers vivos");
  await sale(() => b.tomarPuesto(), 75);
  assert.match(s.err(), /tope global: ya hay 1 worker\(s\) vivos entre todos los proyectos y el tope es 1 \(PA_TOPE\):\n    demo \(puesto 1\): id t1 · jefe j · algo\n/);
  await a.soltarTodo();
  const c = new Admision(s.proy("t3"));
  await c.tomarPuesto();
  assert.equal(c.puesto, "1");
  await c.soltarTodo();
});

test("tope global: los lugares @tope@k de un PA_TOPE más alto también cuentan", async () => {
  const s = armar({ PA_TOPE: "3" });
  const a = new Admision(s.proy("t1"));
  await a.esperarLugar();
  const s2 = { ...s.proy("t2"), pa: { ...s.pa, tope: 1 } };
  const b = new Admision(s2);
  // con tope 1 el barrido llega hasta @tope@3 (los archivos que dejó el de tope 3) y ve el 1 ocupado
  assert.equal(await b.tomarLugar(), false);
  assert.equal(b.ocupadosTope, 1);
  await a.soltarTodo();
});

test("--leer: toma lugar pero no puesto; con el tope lleno sale 75 en primer plano", async () => {
  const s = armar({ PA_TOPE: "1" });
  const a = new Admision(s.proy("t1"), { leer: true });
  await a.esperarLugar();
  assert.equal(a.puesto, "");
  assert.equal(await puestoLibre(s.proy("x"), "1"), true);
  await sale(() => new Admision(s.proy("t2"), { leer: true }).esperarLugar(), 75);
  await a.soltarTodo();
});

test("cola: con --async espera, deja <ts>.cola con el motivo y arranca solo cuando se libera el puesto", async () => {
  const s = armar({ PA_PUESTOS: "1" });
  const a = new Admision(s.proy("t1"));
  await a.tomarPuesto();
  const b = new Admision(s.proy("t2"), { async: true });
  const espera = b.tomarPuesto();
  const cola = path.join(s.state, "demo", "t2.cola");
  for (let i = 0; i < 100 && !existsSync(cola); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(readFileSync(cola, "utf8"), "los 1 puestos ocupados");
  await a.soltarTodo();
  await espera;
  assert.equal(b.puesto, "1");
  assert.equal(existsSync(cola), false);
  assert.equal(readFileSync(path.join(s.state, "demo", "t2.puesto"), "utf8"), "1");
  await b.soltarTodo();
});

test("cola: se reescribe sólo al cambiar de clase o cada 5 s", () => {
  const s = armar();
  const a = new Admision(s.proy("t1"));
  mkdirSync(path.join(s.state, "demo"), { recursive: true });
  const f = path.join(s.state, "demo", "t1.cola");
  a.escribirCola("RAM: disponible 10 MB");
  a.escribirCola("RAM: disponible 20 MB");
  assert.equal(readFileSync(f, "utf8"), "RAM: disponible 10 MB");
  a.escribirCola("los 3 puestos ocupados");
  assert.equal(readFileSync(f, "utf8"), "los 3 puestos ocupados");
});

test("RAM: MemAvailable de PA_MEMINFO en MB, -1 sin dato; fuera de Linux sale de la memoria libre inyectada (por defecto os.freemem())", () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "pa-meminfo-"));
  const f = path.join(d, "meminfo");
  writeFileSync(f, "MemTotal:       32000000 kB\nMemFree:          100000 kB\nMemAvailable:    4096000 kB\n");
  assert.equal(memDisponibleMb({ PA_MEMINFO: f }), 4000);
  assert.equal(memDisponibleMb({ PA_MEMINFO: path.join(d, "no") }), -1);
  writeFileSync(f, "MemTotal: 1 kB\n");
  assert.equal(memDisponibleMb({ PA_MEMINFO: f }), -1);
  // la memoria libre se inyecta: os.freemem() cambia entre dos llamadas y el test no puede depender de eso
  assert.equal(memDisponibleMb({}, "win32", () => 3 * 1048576 + 5), 3);
  assert.ok(memDisponibleMb({}, "win32") >= 0);
});

test("RAM: con 0 vivos entra siempre; con uno, hace falta costo + reserva por encima de lo reservado", async () => {
  const s = armar({ PA_RAM_WORKER_MB: "1000", PA_RAM_RESERVA_MB: "2500" });
  writeFileSync(s.pa.env.PA_MEMINFO!, "MemAvailable:    4096000 kB\n");
  const x = s.proy("t1");
  assert.equal(ramAlcanza(x, 0).motivo, "");
  assert.equal(ramAlcanza(x, 1).motivo, ""); // 4000 >= 3500
  // un worker recién admitido (pa vivo, hace 10 s) reserva su costo entero
  mkdirSync(path.join(s.pa.lockdir, "@ram"), { recursive: true });
  writeFileSync(path.join(s.pa.lockdir, "@ram", String(process.pid)), String(Math.floor(Date.now() / 1000) - 10));
  // uno vencido y uno de un pa muerto se borran
  writeFileSync(path.join(s.pa.lockdir, "@ram", "999999999"), String(Math.floor(Date.now() / 1000)));
  assert.equal(ramReservadaMb(x), 1000);
  assert.equal(existsSync(path.join(s.pa.lockdir, "@ram", "999999999")), false);
  const r = ramAlcanza(x, 1);
  assert.equal(r.motivo, "RAM: disponible 4000 MB, reservada 1000 MB (workers recién admitidos), hacen falta 3500 MB (costo 1000 + reserva 2500)");

  // y tomarLugar lo usa como motivo del tope
  writeFileSync(path.join(s.state, "otro.running"), `id=o\nproyecto=otro\npid=${process.pid}\n`);
  const a = new Admision(s.proy("t2"));
  const b = new Admision(s.proy("t3"));
  assert.equal(await a.tomarLugar(), true); // 0 vivos con lugar: entra (deja su reserva)
  await a.soltarTope();
  assert.equal(await b.tomarLugar(), false);
  assert.match(b.motivoTope, /^RAM: disponible 4000 MB, reservada 1000 MB/);
  await sale(async () => b.topeLleno75(), 75);
  assert.match(s.err(), /pa: sin RAM para otro worker \(1 vivos entre todos los proyectos\): RAM: disponible/);
  await a.soltarTodo();
});

test("workers sueltos: un claude vivo con su pa muerto cuenta; con el pa vivo no (ya tiene lugar)", () => {
  const s = armar();
  mkdirSync(s.state, { recursive: true });
  writeFileSync(path.join(s.state, "a.running"), `pid=${process.pid}\npa_pid=999999999\n`);
  writeFileSync(path.join(s.state, "b.running"), `pid=${process.pid}\npa_pid=${process.pid}\n`);
  writeFileSync(path.join(s.state, "c.running"), `pid=999999998\npa_pid=999999999\n`);
  assert.equal(workersSueltos(s.state), 1);
});

test("otros writers y describir puestos: los vivos del proyecto (sin el propio), con su puesto", () => {
  const s = armar();
  mkdirSync(s.state, { recursive: true });
  writeFileSync(path.join(s.state, "demo.running"), `id=t1\npid=${process.pid}\njefe=j\ntarea=uno\n`);
  writeFileSync(path.join(s.state, "demo@2.running"), `id=t2\npid=${process.pid}\npuesto=2\ntarea=dos\n`);
  writeFileSync(path.join(s.state, "demo@3.running"), `id=t3\npid=999999999\npuesto=3\n`);
  writeFileSync(path.join(s.state, "demolito.running"), `id=x\npid=${process.pid}\n`);
  assert.deepEqual(otrosWriters(s.proy("t2"), "t2"), [{ id: "t1", puesto: "1", jefe: "j", tarea: "uno" }]);
  assert.equal(otrosWriters(s.proy("t9"), "t9").length, 2);
  const largo = "ñ".repeat(50);
  writeFileSync(path.join(s.state, "demo@aca.running"), `id=t4\njefe=j\ntarea=${largo}\n`);
  // printf %.80s corta por bytes: 40 «ñ»
  assert.equal(describirPuestos(s.proy("t"), ["aca", "5"]), `    tree principal: id t4 · jefe j · ${"ñ".repeat(40)}\n    puesto 5: tomado (arrancando)\n`);
});
