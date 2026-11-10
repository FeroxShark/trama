// Actualizar seguro, las reglas (electron/arranque-seguro.ts): una versión nueva a prueba vuelve a la anterior si se cierra sola
// dos veces seguidas o no llega a ventana lista a tiempo; una buena no se deshace; sin copia de la anterior no hay a dónde volver.
// Y el cableado (electron/version-anterior.ts): una señal o una instalación en curso no cuentan como «se cerró sola».
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { atenderSenales, carpetaCopias, crearVersionAnterior, type Instalacion } from "../electron/version-anterior.ts";
import {
  alArrancar,
  alSalirAProposito,
  alTiempoAgotado,
  alVentanaLista,
  alVolver,
  conRespaldo,
  crearAlmacen,
  estadoDesde,
  estadoVacio,
  instalandoAhora,
  instalandoSegun,
  resumen,
  sinAviso,
  type Copia,
} from "../electron/arranque-seguro.ts";

const copia = (version: string): Copia => ({ version, tipo: "carpeta", ruta: path.join(os.tmpdir(), `trama-copia-${version}`), cuando: 1 });
/** Una instalación que andaba bien en 0.2.25, con su respaldo, y arranca por primera vez la 0.2.26. */
const recienActualizada = () => {
  let e = alArrancar(estadoVacio(), "0.2.25", 1).estado;
  e = conRespaldo(alVentanaLista(e), copia("0.2.25"));
  return alArrancar(e, "0.2.26", 10).estado;
};

test("la primera vez que se arranca no hay nada que deshacer", () => {
  const { estado, decision } = alArrancar(estadoVacio(), "0.2.25", 5);
  assert.deepEqual(decision, { accion: "seguir" });
  assert.equal(estado.actual, "0.2.25");
  assert.equal(estado.arrancando, 5);
  assert.equal(estado.buena, false);
});

test("una versión nueva toma el respaldo de la que corría como anterior", () => {
  const e = recienActualizada();
  assert.equal(e.actual, "0.2.26");
  assert.equal(e.anterior?.version, "0.2.25");
  assert.equal(e.respaldo, null);
  assert.equal(e.buena, false);
});

test("un respaldo de otra versión que la que corría no cuenta como anterior", () => {
  const base = alArrancar(estadoVacio(), "0.2.20", 1).estado;
  const e = alArrancar(conRespaldo(base, copia("0.2.10")), "0.2.26", 2).estado;
  assert.equal(e.anterior, null);
});

test("se cierra sola dos veces seguidas: vuelve a la anterior", () => {
  const e1 = recienActualizada(); // primer arranque de la nueva, nunca llegó
  const r = alArrancar(e1, "0.2.26", 20); // el segundo: una falla
  assert.equal(r.estado.fallas, 1);
  assert.deepEqual(r.decision, { accion: "seguir" });
  const r2 = alArrancar(r.estado, "0.2.26", 30); // el tercero: dos fallas
  assert.equal(r2.estado.fallas, 2);
  assert.equal(r2.decision.accion, "volver");
  if (r2.decision.accion === "volver") {
    assert.equal(r2.decision.a.version, "0.2.25");
    assert.equal(r2.decision.motivo, "cierres");
  }
});

test("llegar a ventana lista entre medio borra la cuenta y deja la versión como buena", () => {
  let e = alArrancar(recienActualizada(), "0.2.26", 20).estado;
  assert.equal(e.fallas, 1);
  e = alVentanaLista(e);
  assert.equal(e.fallas, 0);
  assert.equal(e.buena, true);
  // Una versión buena que después se cierra sola no se deshace: no es culpa de la actualización.
  for (let i = 0; i < 5; i++) e = alArrancar(e, "0.2.26", 30 + i).estado;
  assert.equal(alArrancar(e, "0.2.26", 99).decision.accion, "seguir");
});

test("salir a propósito antes de terminar de arrancar no suma una falla", () => {
  let e = alSalirAProposito(recienActualizada());
  e = alSalirAProposito(alArrancar(e, "0.2.26", 20).estado);
  const r = alArrancar(e, "0.2.26", 30);
  assert.equal(r.estado.fallas, 0);
  assert.equal(r.decision.accion, "seguir");
});

test("sin copia de la anterior no hay a dónde volver, ni por cierres ni por lento", () => {
  let e = alArrancar(estadoVacio(), "0.2.26", 1).estado;
  for (let i = 0; i < 4; i++) e = alArrancar(e, "0.2.26", 2 + i).estado;
  assert.equal(e.fallas, 4);
  assert.equal(alArrancar(e, "0.2.26", 9).decision.accion, "seguir");
  assert.equal(alTiempoAgotado(e).accion, "seguir");
});

test("no llegar a ventana lista a tiempo vuelve a la anterior; llegar, no", () => {
  const e = recienActualizada();
  const d = alTiempoAgotado(e);
  assert.equal(d.accion, "volver");
  if (d.accion === "volver") assert.equal(d.motivo, "lento");
  assert.equal(alTiempoAgotado(alVentanaLista(e)).accion, "seguir");
  assert.equal(alTiempoAgotado(alSalirAProposito(e)).accion, "seguir");
});

test("volver deja la anterior como la que corre, desecha la mala y deja el aviso", () => {
  const e = alVolver(recienActualizada(), copia("0.2.25"), "cierres");
  assert.equal(e.actual, "0.2.25");
  assert.equal(e.buena, true);
  assert.equal(e.anterior, null);
  assert.equal(e.rechazada, "0.2.26");
  assert.deepEqual(e.aviso, { de: "0.2.26", a: "0.2.25", motivo: "cierres" });
  assert.equal(sinAviso(e).aviso, null);
  // Al arrancar de nuevo la 0.2.25 es la misma que quedó: ni falla ni nueva.
  const r = alArrancar(e, "0.2.25", 50);
  assert.equal(r.estado.fallas, 0);
  assert.equal(r.decision.accion, "seguir");
});

test("el archivo de estado: va y vuelve, y uno roto o con basura es el estado vacío", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "trama-arr-"));
  const archivo = path.join(dir, "sub", "arranque.json");
  const a = crearAlmacen(archivo);
  assert.deepEqual(a.leer(), estadoVacio());
  const e = await a.cambiar(() => recienActualizada());
  assert.deepEqual(a.leer(), e);
  assert.equal(JSON.parse(readFileSync(archivo, "utf8")).version, 1);
  writeFileSync(archivo, "{no es json");
  assert.deepEqual(a.leer(), estadoVacio());
  assert.deepEqual(estadoDesde({ actual: 7, fallas: "x", anterior: { version: "1", tipo: "raro", ruta: "/x" }, aviso: { de: "a" } }), estadoVacio());
  assert.equal(estadoDesde({ anterior: { version: "1", tipo: "carpeta", ruta: "relativa" } }).anterior, null);
});

test("salir a propósito sólo limpia el arranque propio; mientras se instala un arranque sin terminar no suma falla", () => {
  const e = recienActualizada();
  assert.equal(alSalirAProposito(e, 999).arrancando, 10, "otro proceso que se va no le borra la cuenta al que arranca");
  assert.equal(alSalirAProposito(e, null).arrancando, 10);
  assert.equal(alSalirAProposito(e, 10).arrancando, null);
  const r = alArrancar(e, "0.2.26", 20, { instalando: true });
  assert.equal(r.estado.fallas, 0);
  assert.equal(r.estado.arrancando, 20, "igual queda anotado: si el próximo se cae solo, cuenta");
  assert.equal(alArrancar(r.estado, "0.2.26", 30).estado.fallas, 1);
  assert.match(resumen(r.estado, 5020), /^0\.2\.26, fallas 0, buena no, arrancó hace 5 s sin llegar a ventana lista$/);
});

test("instalando: en fase instalando siempre; recién escrito con otra fase, sólo dentro del tope; esperando no", () => {
  assert.equal(instalandoSegun({ fase: "instalando", version: "0.2.26" }, 0, 10_000_000), true);
  assert.equal(instalandoSegun({ fase: "hecho", version: "0.2.26" }, 1000, 1000 + 59_000), true);
  assert.equal(instalandoSegun({ fase: "hecho", version: "0.2.26" }, 1000, 1000 + 61_000), false);
  assert.equal(instalandoSegun({ fase: "esperando", version: "0.2.26" }, 1000, 1001), false);
  assert.equal(instalandoSegun(null, 1000, 1001), false);
  const dir = mkdtempSync(path.join(os.tmpdir(), "trama-inst-"));
  const archivo = path.join(dir, "trama-actualizacion.json");
  assert.equal(instalandoAhora(archivo, Date.now()), false, "sin archivo no se instala");
  writeFileSync(archivo, JSON.stringify({ version: 1, fase: "nada" }));
  utimesSync(archivo, 1, 1);
  assert.equal(instalandoAhora(archivo, Date.now()), false, "un nada viejo no es una instalación");
});

/**
 * Una instalación de mentira (carpeta) que andaba en 0.2.25 y acaba de pasar a 0.2.26. `arrancar` es un proceso nuevo de la 0.2.26:
 * atiende las señales (como main.ts, antes de alArrancar) sobre un `process` falso y devuelve si volvió a la anterior.
 */
async function instalacionNueva() {
  const casa = mkdtempSync(path.join(os.tmpdir(), "trama-cable-"));
  const app = path.join(casa, ".local", "share", "trama", "app");
  for (const p of ["dist", "dist-electron"]) mkdirSync(path.join(app, p), { recursive: true });
  const poner = (v: string) => {
    writeFileSync(path.join(app, "dist", "index.html"), `web ${v}`);
    writeFileSync(path.join(app, "dist-electron", "motor.js"), `main ${v}`);
    writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: v }));
  };
  poner("0.2.25");
  const inst: Instalacion = { tipo: "carpeta", app };
  const estado = path.join(casa, "estado");
  const almacen = crearAlmacen(path.join(estado, "arranque.json"));
  const actualizacion = path.join(estado, "trama-actualizacion.json");
  const reinicios: string[] = [];
  const registro: string[] = [];
  let reloj = 1_000_000;
  const armar = (version: string) =>
    crearVersionAnterior({
      almacen,
      version,
      inst,
      base: carpetaCopias(casa),
      reiniciar: () => void reinicios.push(version),
      despues: () => ({ cancelar() {} }),
      ahora: () => (reloj += 1000),
      instalando: () => instalandoAhora(actualizacion, Date.now()),
      log: (m) => void registro.push(m),
    });
  const v1 = armar("0.2.25");
  await v1.alArrancar();
  await v1.alVentanaLista();
  poner("0.2.26");
  /** Un proceso de la 0.2.26 que arranca; `proc` es su `process` (para mandarle señales). */
  async function arrancar() {
    const proc = new EventEmitter();
    const va = armar("0.2.26");
    const idas: string[] = [];
    atenderSenales(proc as unknown as NodeJS.Process, (s) => va.alSalir(s), (s) => void idas.push(s));
    const volvio = await va.alArrancar();
    return { volvio, proc, idas };
  }
  return { almacen, actualizacion, reinicios, registro, arrancar, app };
}

test("cableado: tres arranques cortados por SIGTERM mientras se instala no vuelven a la anterior", async () => {
  const c = await instalacionNueva();
  mkdirSync(path.dirname(c.actualizacion), { recursive: true });
  writeFileSync(c.actualizacion, JSON.stringify({ version: 1, fase: "instalando" }));
  for (let i = 0; i < 3; i++) {
    const p = await c.arrancar();
    assert.equal(p.volvio, false);
    p.proc.emit("SIGTERM");
    assert.deepEqual(p.idas, ["SIGTERM"], "la señal también cierra el proceso");
    assert.equal(c.almacen.leer().arrancando, null, "la señal limpió el arranque");
  }
  // Y un cuarto que arranca y anda: sigue en la 0.2.26, sin fallas.
  const ultimo = await c.arrancar();
  assert.equal(ultimo.volvio, false);
  assert.deepEqual(c.reinicios, []);
  assert.equal(c.almacen.leer().actual, "0.2.26");
  assert.equal(c.almacen.leer().fallas, 0);
  assert.equal(readFileSync(path.join(c.app, "dist-electron", "motor.js"), "utf8"), "main 0.2.26");
  assert.ok(c.registro.some((m) => /^salgo a propósito \(SIGTERM, pid \d+\): 0\.2\.26, fallas 0, buena no, arrancó hace \d+ s$/.test(m)), c.registro.join("\n"));
  assert.ok(c.registro.some((m) => /^arranco la 0\.2\.26 .*se está instalando: un arranque sin terminar no cuenta$/.test(m)), c.registro.join("\n"));
});

test("cableado: sin señal, un instalador que mata de golpe tampoco cuenta mientras está en instalando", async () => {
  const c = await instalacionNueva();
  mkdirSync(path.dirname(c.actualizacion), { recursive: true });
  writeFileSync(c.actualizacion, JSON.stringify({ version: 1, fase: "instalando" }));
  for (let i = 0; i < 3; i++) assert.equal((await c.arrancar()).volvio, false); // SIGKILL: nadie anota nada
  assert.deepEqual(c.reinicios, []);
  assert.equal(c.almacen.leer().fallas, 0);
});

test("cableado: SIGTERM fuera de una instalación tampoco es un cierre solo", async () => {
  const c = await instalacionNueva();
  for (let i = 0; i < 3; i++) {
    const p = await c.arrancar();
    assert.equal(p.volvio, false);
    p.proc.emit("SIGTERM");
  }
  assert.deepEqual(c.reinicios, []);
});

test("cableado: tres cierres solos de verdad (sin señal ni instalación) sí vuelven a la anterior", async () => {
  const c = await instalacionNueva();
  assert.equal((await c.arrancar()).volvio, false); // se cae solo
  assert.equal((await c.arrancar()).volvio, false); // otra vez
  assert.equal((await c.arrancar()).volvio, true, "el tercero ya no abre: vuelve");
  assert.deepEqual(c.reinicios, ["0.2.26"]);
  assert.equal(c.almacen.leer().actual, "0.2.25");
  assert.equal(readFileSync(path.join(c.app, "dist-electron", "motor.js"), "utf8"), "main 0.2.25");
  assert.ok(c.registro.some((m) => /^arranco la 0\.2\.26 .*arrancó hace \d+ s sin llegar a ventana lista; ahora: fallas 2/.test(m)), c.registro.join("\n"));
});

test("el candado: dos cambios a la vez no se pisan", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "trama-cand-"));
  const a = crearAlmacen(path.join(dir, "arranque.json"));
  const b = crearAlmacen(path.join(dir, "arranque.json"));
  await a.cambiar(() => recienActualizada());
  await Promise.all([a.cambiar((e) => ({ ...e, fallas: e.fallas + 1 })), b.cambiar((e) => ({ ...e, fallas: e.fallas + 1 })), a.cambiar((e) => ({ ...e, fallas: e.fallas + 1 }))]);
  assert.equal(a.leer().fallas, 3);
});
