"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { crearMotorNativo, buscarMotorJs, MOTOR_URL } = require("../src/nativo");

test("nativo: constantes y puertos por defecto", () => {
  assert.equal(MOTOR_URL, "http://127.0.0.1:8791");
});

test("nativo: buscarMotorJs encuentra candidato en repositorio si existe", () => {
  const ruta = buscarMotorJs(path.join(__dirname, "..", "payload"));
  // Si no está compilado dist-electron/motor.js todavía, devuelve null o una ruta válida
  if (ruta) {
    assert.ok(ruta.endsWith("motor.js"));
  }
});

test("nativo: crearMotorNativo tiene métodos arrancar, parar, estaVivo", () => {
  const motor = crearMotorNativo({
    payloadDir: path.join(__dirname, "..", "payload"),
    log: () => {},
  });
  assert.equal(typeof motor.arrancar, "function");
  assert.equal(typeof motor.parar, "function");
  assert.equal(typeof motor.estaVivo, "function");
  assert.equal(motor.activo, false);
});
