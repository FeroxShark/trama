// Lo que sigue corriendo de fondo, sacado de los mensajes del líder.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Herramienta, Mensaje } from "../src/datos/contrato.ts";
import { salidaDe, tareasDeFondo } from "../src/hilo/fondo-logica.ts";

const TS = "2026-11-05T10:00:00.000Z";
const msj = (rol: Mensaje["rol"], texto: string, det?: Herramienta[], extra: Partial<Mensaje> = {}): Mensaje => ({ i: 0, rol, texto, herramientas: [], ts: TS, modelo: null, det, ...extra });
const bash = (texto: string, entrada: Record<string, unknown> = {}, error = false): Herramienta => ({ nombre: "Bash", entrada: { command: "npm test", ...entrada }, resultado: { texto, error } });
const aviso = (id: string) => `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`;
const LANZADO = "Command running in background with ID: b1. Output is being written to: /tmp/x.output.";

test("un Bash de fondo queda abierto hasta su aviso", () => {
  const lanzado = msj("assistant", "", [bash(LANZADO, { run_in_background: true, description: "Corre los tests" })]);
  assert.deepEqual(tareasDeFondo([lanzado]), [{ id: "b1", que: "Corre los tests", comando: "npm test", desde: Date.parse(TS), salida: "/tmp/x.output" }]);
  assert.deepEqual(tareasDeFondo([lanzado, msj("user", aviso("otro"), undefined, { origen: "task-notification" })]).map((x) => x.id), ["b1"]);
  assert.deepEqual(tareasDeFondo([lanzado, msj("user", aviso("b1"), undefined, { origen: "task-notification" })]), []);
});

test("un Bash que pasó solo a segundo plano también cuenta; uno común o con error, no", () => {
  const solo = bash("Command did not complete within its 400s timeout and was moved to the background (ID: b2). Output is being written");
  assert.deepEqual(tareasDeFondo([msj("assistant", "", [solo])]).map((x) => x.id), ["b2"]);
  assert.deepEqual(tareasDeFondo([msj("assistant", "", [bash("listo")])]), []);
  assert.deepEqual(tareasDeFondo([msj("assistant", "", [bash(LANZADO, {}, true)])]), []);
  assert.deepEqual(tareasDeFondo([msj("assistant", "", [{ nombre: "Bash", entrada: { command: "x", run_in_background: true }, resultado: null }])]), []);
});

test("un Agent sólo si fue en segundo plano; TaskStop lo cierra", () => {
  const ag = (fondo: boolean): Herramienta => ({ nombre: "Agent", entrada: { description: "Audita", run_in_background: fondo }, resultado: { texto: "agentId: a9 (corre)", error: false } });
  assert.deepEqual(tareasDeFondo([msj("assistant", "", [ag(false)])]), []);
  const uno = msj("assistant", "", [ag(true)]);
  assert.deepEqual(tareasDeFondo([uno]), [{ id: "a9", que: "Audita", comando: null, desde: Date.parse(TS), salida: null }]);
  assert.deepEqual(tareasDeFondo([uno, msj("assistant", "", [{ nombre: "TaskStop", entrada: { task_id: "a9" }, resultado: { texto: "ok", error: false } }])]), []);
});

test("lo que escribió una persona citando un aviso no cierra nada", () => {
  const lanzado = msj("assistant", "", [bash(LANZADO)]);
  assert.equal(tareasDeFondo([lanzado, msj("user", aviso("b1"), undefined, { origen: "human" })]).length, 1);
});

test("la ruta de la salida sale del resultado (con espacios incluidos); sin ruta, null", () => {
  const ruta = "C:\\Users\\Ana Perez\\AppData\\Local\\Temp\\claude\\C--p\\s\\tasks\\b3.output";
  const lanzado = (texto: string) => tareasDeFondo([msj("assistant", "", [bash(texto, { run_in_background: true })])])[0]?.salida;
  assert.equal(lanzado(`Command running in background with ID: b3. Output is being written to: ${ruta}`), ruta);
  assert.equal(lanzado(`Command running in background with ID: b3. Output is being written to: ${ruta}.`), ruta);
  assert.equal(lanzado("Command running in background with ID: b3."), null);
});

test("salidaDe valida lo que cruzó el canal", () => {
  assert.deepEqual(salidaDe({ texto: "a\nb", recortado: true }), { texto: "a\nb", recortado: true });
  assert.deepEqual(salidaDe({ texto: "" }), { texto: "", recortado: false });
  for (const raro of [null, undefined, "x", 3, {}, { texto: 5 }]) assert.equal(salidaDe(raro), null);
});
