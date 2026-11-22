// cli/pa/puestos.ts: admisión de una corrida (lugar global, puesto, RAM, cola) con los locks de Node. Lo que el bash prueba con
// flock acá se prueba tomando el lock con el módulo de Node (motor/docs/port-windows.md, trampa 2): el mismo proceso que ya tiene
// un lock lo ve ocupado si lo vuelve a pedir, así que dos `Admision` en el mismo proceso se estorban como dos `pa`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { esperarHasta } from "./esperar.ts";
import { prologo, Salida, type Env } from "../electron/cli/pa/entorno.ts";
import { Admision, describirPuestos, grupoDeTope, memDisponibleMb, otrosWriters, puestoLibre, ramAlcanza, ramReservadaMb, workersSueltos } from "../electron/cli/pa/puestos.ts";
import { Modelos, problemaModelos, topeDeGrupo, type TopeVivos } from "../electron/cli/pa/modelos.ts";
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

test("puestos: un .running con el hijo vivo (murió su pa, sobrevive el worker) deja el puesto ocupado y no se borra (B078)", async () => {
  const s = armar({ PA_PUESTOS: "1" });
  mkdirSync(s.state, { recursive: true });
  const run = path.join(s.state, "demo.running");
  writeFileSync(run, `id=viejo\npid=${process.pid}\npa_pid=999999999\njefe=j\ntarea=sigue vivo\n`);
  const a = new Admision(s.proy("t1"));
  await sale(() => a.tomarPuesto(), 75);
  assert.equal(existsSync(run), true, "el .running del worker vivo se conserva");
  assert.equal(existsSync(path.join(s.state, "demo", "t1.puesto")), false, "no tomó el puesto");
  assert.equal(await puestoLibre(s.proy("x"), "1"), true, "soltó el lock del puesto");
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
  rmSync(path.join(s.state, "demo.running")); // el worker terminó y limpió su .running
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

// ---------------------------------------------------------------- tope de workers vivos por grupo de cupo (tope_vivos, B144)

/** Un grupo por prefijo, como `grupoDeModelo` de reparto pero sin cargarlo. */
const grupoFalso = (m: string): string | null => (m.startsWith("claude-") ? "claude-oficial" : m.startsWith("codex:") ? "codex" : m.startsWith("dsh:ollama/") ? "dsh-ollama" : null);
const cupoDe = (topes: TopeVivos, modelo: string, cuenta = "") => ({
  topes,
  grupoDe: (m: string, c: string) => grupoDeTope(m, c, grupoFalso),
  actual: () => ({ modelo, cuenta }),
});

test("tope_vivos: cuatro al mismo grupo dejan tres corriendo y el cuarto en cola o 75; otro grupo no se frena", async () => {
  const s = armar({ PA_TOPE: "10" });
  const topes: TopeVivos = { defecto: 3, porGrupo: {} };
  const claude = [1, 2, 3].map((i) => new Admision(s.proy(`t${i}`), { cupo: cupoDe(topes, "claude-sonnet-5-5") }));
  for (const a of claude) {
    assert.equal(await a.tomarLugar(), true);
    await a.soltarTope();
  }
  assert.deepEqual(claude.map((a) => a.lugar), ["1", "2", "3"]);
  // el cuarto, del mismo grupo: sin lugar, con el motivo del grupo (hay lugares libres: no es el tope global)
  const cuarto = new Admision(s.proy("t4"), { cupo: cupoDe(topes, "claude-opus-5-5") });
  assert.equal(await cuarto.tomarLugar(), false);
  assert.equal(cuarto.motivoTope, "cupo: 3 workers vivos en claude-oficial (tope 3)");
  await sale(() => cuarto.tomarPuesto(), 75);
  assert.match(s.err(), /cupo: 3 workers vivos en claude-oficial \(tope 3\)\. Entre todos los proyectos/);
  // otro grupo entra aunque el de Claude esté lleno
  const codex = new Admision(s.proy("t5"), { cupo: cupoDe(topes, "codex:gpt") });
  assert.equal(await codex.tomarLugar(), true);
  await codex.soltarTope();
  // al soltar uno de Claude, el cuarto entra
  await claude[0]!.soltarTodo();
  assert.equal(await cuarto.tomarLugar(), true);
  await cuarto.soltarTope();
  for (const a of [...claude, cuarto, codex]) await a.soltarTodo();
});

test("tope_vivos: con --async el cuarto hace cola con el motivo del grupo y entra cuando se libera uno", async () => {
  const s = armar({ PA_TOPE: "10" });
  const topes: TopeVivos = { defecto: 2, porGrupo: {} };
  const a = new Admision(s.proy("t1"), { cupo: cupoDe(topes, "claude-sonnet-5-5") });
  const b = new Admision(s.proy("t2"), { cupo: cupoDe(topes, "claude-sonnet-5-5") });
  await a.tomarPuesto();
  await b.tomarPuesto();
  const c = new Admision(s.proy("t3"), { cupo: cupoDe(topes, "claude-sonnet-5-5"), async: true });
  const espera = c.tomarPuesto();
  await esperarHasta(() => existsSync(path.join(s.state, "demo", "t3.cola")));
  assert.equal(readFileSync(path.join(s.state, "demo", "t3.cola"), "utf8"), "cupo: 2 workers vivos en claude-oficial (tope 2)");
  await a.soltarTodo();
  await espera;
  assert.ok(c.puesto !== "");
  assert.equal(existsSync(path.join(s.state, "demo", "t3.cola")), false);
  await b.soltarTodo();
  await c.soltarTodo();
});

test("tope_vivos: 0 apaga el tope; un objeto manda por grupo, por proveedor y con `*` para el resto", async () => {
  const s = armar({ PA_TOPE: "10" });
  const sinTope: TopeVivos = { defecto: 0, porGrupo: {} };
  const libres = [1, 2, 3, 4, 5].map((i) => new Admision(s.proy(`t${i}`), { cupo: cupoDe(sinTope, "claude-sonnet-5-5") }));
  for (const a of libres) {
    assert.equal(await a.tomarLugar(), true);
    await a.soltarTope();
  }
  for (const a of libres) await a.soltarTodo();

  assert.equal(topeDeGrupo({ defecto: 3, porGrupo: { claude: 2 } }, "claude-oficial"), 2);
  assert.equal(topeDeGrupo({ defecto: 3, porGrupo: { claude: 2 } }, "codex"), 3);
  assert.equal(topeDeGrupo({ defecto: 3, porGrupo: { "claude-oficial": 1, claude: 2 } }, "claude-oficial@otra"), 1);
  assert.equal(topeDeGrupo({ defecto: 3, porGrupo: { codex: 0 } }, "codex"), null);
  assert.equal(topeDeGrupo({ defecto: 3, porGrupo: {} }, null), null);

  const topes: TopeVivos = { defecto: 3, porGrupo: { claude: 1 } };
  const a = new Admision(s.proy("u1"), { cupo: cupoDe(topes, "claude-sonnet-5-5") });
  assert.equal(await a.tomarLugar(), true);
  await a.soltarTope();
  const b = new Admision(s.proy("u2"), { cupo: cupoDe(topes, "claude-sonnet-5-5") });
  assert.equal(await b.tomarLugar(), false);
  assert.equal(b.motivoTope, "cupo: 1 workers vivos en claude-oficial (tope 1)");
  // el resto de los grupos usa `*` (3)
  const cs = [1, 2, 3].map((i) => new Admision(s.proy(`v${i}`), { cupo: cupoDe(topes, "codex:gpt") }));
  for (const c of cs) {
    assert.equal(await c.tomarLugar(), true);
    await c.soltarTope();
  }
  const c4 = new Admision(s.proy("v4"), { cupo: cupoDe(topes, "codex:gpt") });
  assert.equal(await c4.tomarLugar(), false);
  assert.equal(c4.motivoTope, "cupo: 3 workers vivos en codex (tope 3)");
  for (const x of [a, b, ...cs, c4]) await x.soltarTodo();
});

test("tope_vivos: --leer cuenta; Ollama no tiene tope; la cuenta agregada es otro grupo; un cambio de modelo reescribe el grupo", async () => {
  const s = armar({ PA_TOPE: "10" });
  const topes: TopeVivos = { defecto: 1, porGrupo: {} };
  const lector = new Admision(s.proy("t1"), { leer: true, cupo: cupoDe(topes, "claude-sonnet-5-5") });
  await lector.esperarLugar();
  assert.equal(readFileSync(path.join(s.pa.lockdir, "@tope@1.grupo"), "utf8"), "claude-oficial");
  const otro = new Admision(s.proy("t2"), { cupo: cupoDe(topes, "claude-sonnet-5-5") });
  assert.equal(await otro.tomarLugar(), false);
  assert.match(otro.motivoTope, /^cupo: 1 workers vivos en claude-oficial/);
  // otra cuenta del mismo proveedor: su propia ventana, otro grupo
  const agregada = new Admision(s.proy("t3"), { cupo: cupoDe(topes, "claude-sonnet-5-5", "mia") });
  assert.equal(await agregada.tomarLugar(), true);
  await agregada.soltarTope();
  // Ollama: sin grupo, sin tope
  const o1 = new Admision(s.proy("t4"), { cupo: cupoDe(topes, "dsh:ollama/x") });
  const o2 = new Admision(s.proy("t5"), { cupo: cupoDe(topes, "dsh:ollama/x") });
  for (const o of [o1, o2]) {
    assert.equal(await o.tomarLugar(), true);
    await o.soltarTope();
  }
  // el lector pasa a Codex (un relanzamiento por cupo): libera el grupo de Claude
  await lector.cambiarGrupo("codex:gpt", "");
  assert.equal(await otro.tomarLugar(), true);
  await otro.soltarTope();
  for (const x of [lector, otro, agregada, o1, o2]) await x.soltarTodo();
});

test("tope_vivos: un worker suelto (su pa ya no está) cuenta para su grupo por el modelo de su .running", async () => {
  const s = armar({ PA_TOPE: "10" });
  mkdirSync(s.state, { recursive: true });
  writeFileSync(path.join(s.state, "otro.running"), `id=x\nproyecto=otro\npid=${process.pid}\npa_pid=999999999\nmodelo=claude-sonnet-5-5\ncuenta=claude\n`);
  const a = new Admision(s.proy("t1"), { cupo: cupoDe({ defecto: 1, porGrupo: {} }, "claude-opus-5-5") });
  assert.equal(await a.tomarLugar(), false);
  assert.equal(a.motivoTope, "cupo: 1 workers vivos en claude-oficial (tope 1)");
  const b = new Admision(s.proy("t2"), { cupo: cupoDe({ defecto: 1, porGrupo: {} }, "codex:gpt") });
  assert.equal(await b.tomarLugar(), true);
  await b.soltarTodo();
});

test("tope_vivos: modelos.json lo valida y lo lee (número, objeto con `*`, default 3, 0 = apagado)", () => {
  const leer = (extra: Record<string, unknown>) => {
    const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-tope-"));
    const archivo = path.join(raiz, "modelos.json");
    writeFileSync(archivo, JSON.stringify({ version: 1, ...extra }));
    return new Modelos({ TRAMA_MODELOS: archivo }, { out: () => {}, err: () => {} }, raiz).topeVivos();
  };
  assert.deepEqual(leer({}), { defecto: 3, porGrupo: {} });
  assert.deepEqual(leer({ tope_vivos: 5 }), { defecto: 5, porGrupo: {} });
  assert.deepEqual(leer({ tope_vivos: 0 }), { defecto: 0, porGrupo: {} });
  assert.deepEqual(leer({ tope_vivos: { "*": 4, claude: 2 } }), { defecto: 4, porGrupo: { claude: 2 } });
  assert.deepEqual(leer({ tope_vivos: { claude: 2 } }), { defecto: 3, porGrupo: { claude: 2 } });
  // PA_TOPE_VIVOS (el arnés de paridad) lo pisa
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pa-tope-"));
  assert.deepEqual(new Modelos({ PA_TOPE_VIVOS: "0" }, { out: () => {}, err: () => {} }, raiz).topeVivos(), { defecto: 0, porGrupo: {} });
  assert.match(problemaModelos({ version: 1, tope_vivos: -1 }), /^tope_vivos -1/);
  assert.match(problemaModelos({ version: 1, tope_vivos: "tres" }), /^tope_vivos "tres"/);
  assert.match(problemaModelos({ version: 1, tope_vivos: { claude: 1.5 } }), /^tope_vivos/);
  assert.equal(problemaModelos({ version: 1, tope_vivos: { "*": 3 } }), "");
});
