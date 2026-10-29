"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ErrorPaso, parsearEstado, ultimasLineas } = require("../src/pasos-comun");

test("trama-estado: versión desconocida y basura", () => {
  assert.throws(() => parsearEstado('{"version":2}'), /versión/);
  assert.throws(() => parsearEstado("no es json"), ErrorPaso);
  const e = parsearEstado('aviso\n{"version":1,"claude":{"instalado":true,"logueado":true}}');
  assert.equal(e.claude.logueado, true);
  assert.equal(e.motor.url, "http://localhost:8791");
});

test("ultimasLineas se queda con el final del texto", () => {
  assert.equal(ultimasLineas("a\nb\nc\nd", 2), "c\nd");
});
