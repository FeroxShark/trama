"use strict";
// Los canales que atiende la carcasa (main.js + ventana.js) contra el contrato único de app/electron/canales/contrato.ts
// (windows/src/canales.json): lo de la pantalla de la PC es del contrato y lo propio de la carcasa (asistente, actualizador,
// restos) no pisa ningún nombre del contrato. Sin Electron.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = (f) => fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8");
const json = JSON.parse(src("canales.json"));
const manejadosEnMain = [...src("main.js").matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((m) => m[1]);
const PROPIOS = /^(asistente|restos|actualizar|ventana|app):/;

test("main.js: los canales propios de la carcasa no se llaman como uno del contrato (no hay dos handlers con el mismo nombre)", () => {
  const delContrato = new Set([...json.ventana, ...json.soloVentana]);
  assert.ok(manejadosEnMain.length > 10);
  for (const c of manejadosEnMain) {
    assert.ok(!delContrato.has(c), `main.js atiende ${c}, que es del contrato`);
    assert.match(c, PROPIOS, `canal de la carcasa fuera de su espacio de nombres: ${c}`);
  }
  assert.equal(new Set(manejadosEnMain).size, manejadosEnMain.length, "canales repetidos en main.js");
});

test("main.js: todo lo que la página pide por el preload (invocar) tiene su handler, y el preload sólo pide eso o lo del contrato", () => {
  const preload = src("preload.js");
  const pedidos = [...preload.matchAll(/\binvocar\("([^"]+)"/g)].map((m) => m[1]);
  assert.ok(pedidos.length > 10);
  for (const c of pedidos) assert.ok(manejadosEnMain.includes(c), `el preload pide ${c} y main.js no lo atiende`);
  for (const c of manejadosEnMain) if (c !== "ventana:titulo") assert.ok(pedidos.includes(c), `main.js atiende ${c} y el preload no lo expone`);
});

test("lo que el contrato reserva a la ventana y la carcasa no atiende es sólo lo que el motor de la carcasa ya sabe hacer (consumo y borradores)", () => {
  const faltan = json.soloVentana.filter((c) => !json.ventana.includes(c)).sort();
  assert.deepEqual(faltan, ["borradores:guardar", "borradores:imagen", "borradores:leer", "consumo:mirar", "consumo:soltar"]);
});

test("main.js: los canales que actúan (asistente:* salvo pasos, actualizar:instalar/buscar, restos:*) pasan por `protegido`", () => {
  const main = src("main.js");
  const debenIr = ["asistente:avanzar", "asistente:conectar", "asistente:saltarLogin", "asistente:continuarLogin", "asistente:cuentas", "asistente:saltarOllama", "actualizar:instalar", "actualizar:buscar", "restos:plan", "restos:quitar"];
  for (const c of debenIr) assert.match(main, new RegExp(`ipcMain\\.handle\\("${c}", protegido\\(`), `${c} no pasa por protegido`);
});

test("main.js: una segunda instancia antes de que termine el arranque no abre la ventana (se anota y se abre después)", () => {
  const main = src("main.js");
  assert.match(main, /app\.on\("second-instance", \(\) => \(arranqueListo \? mostrarVentana\(\) : \(ventanaPedida = true\)\)\)/);
  assert.match(main, /arranqueListo = true;\s*\n\s*if \(ventanaPedida\) mostrarVentana\(\);/);
  assert.doesNotMatch(main, /app\.on\("second-instance", \(\) => mostrarVentana\(\)\)/);
});
