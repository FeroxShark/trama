// Actualizar seguro, las reglas (electron/arranque-seguro.ts): una versión nueva a prueba vuelve a la anterior si se cierra sola
// dos veces seguidas o no llega a ventana lista a tiempo; una buena no se deshace; sin copia de la anterior no hay a dónde volver.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("el archivo de estado: va y vuelve, y uno roto o con basura es el estado vacío", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "trama-arr-"));
  const archivo = path.join(dir, "sub", "arranque.json");
  const a = crearAlmacen(archivo);
  assert.deepEqual(a.leer(), estadoVacio());
  const e = a.cambiar(() => recienActualizada());
  assert.deepEqual(a.leer(), e);
  assert.equal(JSON.parse(readFileSync(archivo, "utf8")).version, 1);
  writeFileSync(archivo, "{no es json");
  assert.deepEqual(a.leer(), estadoVacio());
  assert.deepEqual(estadoDesde({ actual: 7, fallas: "x", anterior: { version: "1", tipo: "raro", ruta: "/x" }, aviso: { de: "a" } }), estadoVacio());
  assert.equal(estadoDesde({ anterior: { version: "1", tipo: "carpeta", ruta: "relativa" } }).anterior, null);
});
