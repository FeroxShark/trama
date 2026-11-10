// `npm run check:changed` (scripts/check-changed.mjs): la elección de qué correr, sin git ni disco. Un grafo chico de archivos
// inventados: qué test entra por import, por nombre, por mención, y cuándo la paridad o todo el suite.
import assert from "node:assert/strict";
import { test } from "node:test";
import { elegir } from "../scripts/check-changed.mjs";

/** Un archivo de app/ del grafo: ruta, texto y lo que importa. */
const f = (ruta: string, importa: string[] = [], texto = "") => ({ ruta, texto, importa });
const grafo = [
  f("electron/cola.ts"),
  f("electron/nucleo.ts", ["electron/cola.ts"]),
  f("tests/cola.test.ts", ["electron/cola.ts"]),
  f("tests/nucleo.test.ts", ["electron/nucleo.ts"]),
  f("tests/otro.test.ts"),
  f("tests/ajustes-barra.test.ts"),
  f("tests/fixture.test.ts", [], "lee src/tokens.css del repo"),
  f("tests/paridad/casos.ts"),
  f("tests/paridad/paridad.test.ts", ["tests/paridad/casos.ts", "tests/plataforma.ts"]),
  f("tests/plataforma.ts"),
  f("electron/cli/pa.ts", ["electron/cli/pa/rinde.ts"]),
  f("electron/cli/pa/rinde.ts", ["electron/cli/base/git.ts"]),
  f("electron/cli/base/git.ts"),
  f("electron/cli/tablero.ts", ["electron/cli/base/git.ts"]),
  f("electron/cli/instalar-nativo.ts"),
  f("tests/usa-plataforma.test.ts", ["tests/plataforma.ts"]),
];

test("un cambio en un archivo trae los tests que lo importan, directo y por cadena", () => {
  const r = elegir(["app/electron/cola.ts"], grafo);
  assert.deepEqual(r.pruebas.sort(), ["cola.test.ts", "nucleo.test.ts"]);
  assert.equal(r.paridad, null);
  assert.equal(r.windows, false);
  assert.equal(r.completo, false);
});

test("por nombre: el test de una palabra del archivo cambiado entra aunque no lo importe", () => {
  const r = elegir(["app/src/barra/Barra.tsx"], grafo);
  assert.deepEqual(r.pruebas, ["ajustes-barra.test.ts"]);
});

test("por mención: un test que escribe la ruta del archivo cambiado entra", () => {
  const r = elegir(["app/src/tokens.css"], grafo);
  assert.deepEqual(r.pruebas, ["fixture.test.ts"]);
});

test("un cambio que no toca nada del grafo no elige pruebas", () => {
  const r = elegir(["app/electron/sin-tests.ts"], grafo);
  assert.deepEqual(r.pruebas, []);
});

test("la paridad sale de la herramienta del motor que cambió", () => {
  assert.deepEqual(elegir(["motor/bin/pa"], grafo).paridad, ["motores", "pa", "pa-async", "pa-cli"]);
  assert.deepEqual(elegir(["motor/bin/tablero"], grafo).paridad, ["tablero"]);
  assert.deepEqual(elegir(["motor/hooks/latido.mjs"], grafo).paridad, ["latido"]);
  assert.deepEqual(elegir(["app/electron/cli/workers-formato.ts"], grafo).paridad, ["workers"]);
});

test("la documentación del motor no corre paridad", () => {
  assert.equal(elegir(["motor/docs/traspaso.md"], grafo).paridad, null);
});

test("un archivo de cli/pa/ corre sólo la paridad de las herramientas que lo importan, no toda", () => {
  assert.deepEqual(elegir(["app/electron/cli/pa/rinde.ts"], grafo).paridad, ["pa", "pa-async", "pa-cli"]);
  assert.deepEqual(elegir(["app/electron/cli/base/git.ts"], grafo).paridad, ["pa", "pa-async", "pa-cli", "tablero"]);
});

test("lo del motor que ninguna herramienta usa no corre paridad y queda anotado en sinTabla", () => {
  const motor = elegir(["motor/bin/clasificar"], grafo);
  assert.equal(motor.paridad, null);
  assert.deepEqual(motor.sinTabla, ["motor/bin/clasificar"]);
  const suelto = elegir(["app/electron/cli/instalar-nativo.ts"], grafo);
  assert.equal(suelto.paridad, null);
  assert.deepEqual(suelto.sinTabla, ["app/electron/cli/instalar-nativo.ts"]);
  assert.deepEqual(elegir(["app/electron/cli/pa/rinde.ts"], grafo).sinTabla, []);
});

test("toda la paridad sólo con paridadCompleta o tocando tests/paridad", () => {
  assert.equal(elegir(["app/electron/cli/pa/rinde.ts"], grafo, { paridadCompleta: true }).paridad, "todas");
  assert.equal(elegir([], grafo, { paridadCompleta: true }).paridad, "todas");
  assert.equal(elegir(["app/tests/paridad/casos.ts"], grafo).paridad, "todas");
  assert.equal(elegir(["app/tests/plataforma.ts"], grafo).paridad, "todas");
});

test("tocar la casa de las pruebas corre todos los tests, pero no toda la paridad", () => {
  const r = elegir(["app/scripts/test.mjs"], grafo);
  assert.equal(r.completo, true);
  assert.equal(r.paridad, null);
  assert.equal(r.pruebas.length, grafo.filter((x) => /^tests\/[^/]+\.test\.ts$/.test(x.ruta)).length);
});

test("sin contra qué comparar (null) corre todo", () => {
  const r = elegir(null, grafo);
  assert.equal(r.completo, true);
  assert.equal(r.windows, true);
});

test("windows/ aparte: sólo marca la carcasa", () => {
  assert.equal(elegir(["windows/src/main.js"], grafo).windows, true);
  assert.equal(elegir(["app/electron/cola.ts"], grafo).windows, false);
});
