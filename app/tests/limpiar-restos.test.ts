// `pa --limpiar` cierra los restos que `pa --estado` muestra: un `.running` sin proceso vivo y las corridas muertas en cola o antes de
// arrancar, de más de 1 día. Sin --si sólo muestra; con --si los cierra (como `pa --parar` y `pa --archivar`) y deja los `.log`.
// Estado temporal (PA_STATE); las edades se fijan con utimes, nada espera por reloj.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { cmdEstado } from "../electron/cli/pa/async.ts";
import { prologo } from "../electron/cli/pa/entorno.ts";
import { cmdLimpiar } from "../electron/cli/pa/limpiar.ts";

const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pa-limpiar-restos-")));
after(() => rmSync(raiz, { recursive: true, force: true }));

let n = 0;
/** Un estado nuevo por prueba, con `salida()` para lo que `pa` fue diciendo. */
function entorno() {
  const estado = path.join(raiz, `estado-${++n}`);
  let o = "";
  const env = { HOME: raiz, USERPROFILE: raiz, PA_STATE: estado, PA_JEFE: "", PA_JEFE_ID: "", PATH: process.env.PATH };
  const pa = prologo([], env, { out: (s) => (o += s), err: () => {} });
  const dir = path.join(estado, "demo");
  mkdirSync(dir, { recursive: true });
  return { pa, estado, dir, salida: () => o, borrar: () => (o = "") };
}
const haceDias = (f: string, d: number) => {
  const t = new Date(Date.now() - d * 86_400_000);
  utimesSync(f, t, t);
};
/** Un `.running` de un worker cuyo claude y cuyo pa ya no existen. */
function runningMuerto(estado: string, nombre: string, id: string, dias: number) {
  const f = path.join(estado, `${nombre}.running`);
  writeFileSync(f, `proyecto=demo\nid=${id}\npuesto=1\ninicio=1\npid=999999999\npa_pid=999999998\n`);
  writeFileSync(path.join(estado, `${nombre}.heartbeat`), "epoch=1\ntool=Read\n");
  haceDias(f, dias);
  haceDias(path.join(estado, `${nombre}.heartbeat`), dias);
  return f;
}
/** Una corrida async que nunca tomó puesto y cuyo proceso ya no existe. */
function colaMuerta(dir: string, id: string, dias: number, leer = false) {
  writeFileSync(path.join(dir, `${id}.pid`), "999999999");
  writeFileSync(path.join(dir, `${id}.log`), "pa: algo salió mal\n");
  writeFileSync(path.join(dir, `${id}.jefe`), "jefe=x\njefe_id=y\n");
  if (leer) writeFileSync(path.join(dir, `${id}.leer`), "");
  haceDias(path.join(dir, `${id}.pid`), dias);
}

test("limpiar sin --si: muestra los restos de más de 1 día y no toca nada", async () => {
  const { pa, estado, dir, salida } = entorno();
  const viejo = runningMuerto(estado, "demo", "20261020-100000-1", 35);
  const reciente = runningMuerto(estado, "demo@2", "20261125-100000-2", 0);
  colaMuerta(dir, "20261101-100000-3", 3);
  colaMuerta(dir, "20261001-100000-4", 40);
  colaMuerta(dir, "20261125-110000-5", 0);
  assert.equal(await cmdLimpiar(pa, []), 0);
  const o = salida();
  assert.match(o, /huérfano demo \(id 20261020-100000-1\): \.running sin proceso, de hace 35 días/);
  assert.match(o, /corrida demo\/20261101-100000-3: murió en cola, de hace 3 días/);
  assert.match(o, /corrida demo\/20261001-100000-4: murió en cola, de hace 40 días/);
  assert.doesNotMatch(o, /20261125-/);
  assert.match(o, /se cerrarían 1 \.running sin proceso y 2 corrida\(s\) muerta\(s\) \(dry-run; con --si se borra\)/);
  assert.ok(existsSync(viejo) && existsSync(reciente));
  assert.ok(!existsSync(path.join(dir, "20261101-100000-3.hilo")));
});

test("limpiar --si: cierra el .running como --parar (fin=, sin .running ni .heartbeat), archiva las muertas y deja los .log", async () => {
  const { pa, estado, dir, salida, borrar } = entorno();
  const id = "20261020-100000-1";
  writeFileSync(path.join(dir, `${id}.pid`), "999999999"); // anotarFin pide que la corrida exista
  writeFileSync(path.join(dir, `${id}.puesto`), "1"); // y como tomó puesto, no es una corrida muerta en cola
  const viejo = runningMuerto(estado, "demo", id, 35);
  const reciente = runningMuerto(estado, "demo@2", "20261125-100000-2", 0);
  colaMuerta(dir, "20261101-100000-3", 3);
  colaMuerta(dir, "20261001-100000-4", 40, true);
  colaMuerta(dir, "20261125-110000-5", 0);
  haceDias(path.join(dir, `${id}.pid`), 35);

  assert.equal(await cmdLimpiar(pa, ["--si"]), 0);
  assert.match(salida(), /cerrados 1 \.running sin proceso y 2 corrida\(s\) muerta\(s\)\./);
  assert.ok(!existsSync(viejo));
  assert.ok(!existsSync(path.join(estado, "demo.heartbeat")));
  assert.match(readFileSync(path.join(dir, `${id}.hilo`), "utf8"), /^fin=\d+$/m);
  assert.ok(existsSync(reciente), "el reciente se queda");
  assert.ok(existsSync(path.join(estado, "demo@2.heartbeat")));
  for (const i of ["20261101-100000-3", "20261001-100000-4"]) {
    assert.match(readFileSync(path.join(dir, `${i}.hilo`), "utf8"), /^archivado=\d{4}-\d\d-\d\dT/m);
    assert.ok(existsSync(path.join(dir, `${i}.log`)), "el .log no se borra");
  }
  assert.ok(!existsSync(path.join(dir, "20261125-110000-5.hilo")), "la reciente no se toca");

  // --estado ya no los lista: ni el huérfano, ni las muertas, y el contador de más de 7 días queda en 0 (no sale la línea)
  borrar();
  await cmdEstado(pa);
  const e = salida();
  assert.equal(e.match(/HUÉRFANO/g)?.length, 1, "queda sólo el de hoy");
  assert.match(e, /rm \S*demo@2\.running/);
  assert.doesNotMatch(e, /20261101-100000-3|20261001-100000-4/);
  assert.doesNotMatch(e, /hace más de 7 días/);
  assert.match(e, /MURIÓ EN COLA demo\s+\(id: 20261125-110000-5,/, "lo reciente sigue a la vista");

  // una segunda pasada no encuentra nada más de lo viejo
  borrar();
  await cmdLimpiar(pa, ["--ver"]);
  assert.doesNotMatch(salida(), /huérfano|murió en cola/);
});

test("limpiar --json suma huerfanos y muertas", async () => {
  const { pa, estado, dir, salida } = entorno();
  runningMuerto(estado, "demo.leer-20261020-100000-9", "20261020-100000-9", 5);
  colaMuerta(dir, "20261101-100000-3", 3);
  colaMuerta(dir, "20261001-100000-4", 40, true);
  assert.equal(await cmdLimpiar(pa, ["--ver", "--json"]), 0);
  const j = JSON.parse(salida().trim()) as { aplicado: boolean; huerfanos: { proyecto: string; id: string; dias: number }[]; muertas: { proyecto: string; id: string; leer: boolean; dias: number }[] };
  assert.equal(j.aplicado, false);
  assert.deepEqual(j.huerfanos.map((h) => [h.proyecto, h.id, h.dias]), [["demo", "20261020-100000-9", 5]]);
  assert.deepEqual(j.muertas.map((m) => [m.id, m.leer]).sort(), [["20261001-100000-4", true], ["20261101-100000-3", false]]);
});

test("limpiar sin restos: el mensaje de siempre", async () => {
  const { pa, salida } = entorno();
  await cmdLimpiar(pa, []);
  assert.match(salida(), /nada con más de 7 días: ni build, ni worktrees, ni ramas ya integradas/);
});
