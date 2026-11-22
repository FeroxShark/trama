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

test("esPropio: file: y el origen exacto del motor; ni un prefijo ni un host parecido", () => {
  const { esPropio } = require("../src/pasos-comun");
  assert.equal(esPropio("file:///C:/trama/ui/asistente.html"), true);
  assert.equal(esPropio("http://localhost:8791"), true);
  assert.equal(esPropio("http://localhost:8791/#/chat?x=1"), true);
  assert.equal(esPropio("http://localhost:87910/"), false);
  assert.equal(esPropio("http://localhost:8791.sitio-ajeno.com/"), false);
  assert.equal(esPropio("http://localhost:8791@ajeno.com/"), false);
  assert.equal(esPropio("https://localhost:8791/"), false);
  assert.equal(esPropio(""), false);
  assert.equal(esPropio(undefined), false);
});

test("main.js decide la confianza con esPropio, no con startsWith del motor", () => {
  const main = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "main.js"), "utf8");
  assert.doesNotMatch(main, /startsWith\(MOTOR_URL\)/);
});
