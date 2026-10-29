"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ENTRADAS, comparar, vigente, muerta, validar } = require("../src/manifiesto");

test("el manifiesto es válido: ids únicos, versiones bien formadas, sólo lo seguro es automático", () => {
  assert.deepEqual(validar(), []);
});

test("validar encuentra un id repetido, un hasta anterior al desde, un automático que no es seguro y un ámbito que ya no existe", () => {
  const base = { ambito: "windows", grupo: "g", tipo: "carpeta", ruta: "%X%\\x", que: "x", desde: "0.2.0", hasta: null, quitar: "seguro", auto: false };
  const errores = validar([
    { ...base, id: "a" },
    { ...base, id: "a" },
    { ...base, id: "b", hasta: "0.1.0" },
    { ...base, id: "c", quitar: "datos", auto: true },
    { ...base, id: "d", ambito: "wsl" },
  ]);
  assert.equal(errores.length, 4);
});

test("comparar ordena por números, no por texto", () => {
  assert.ok(comparar("0.10.0", "0.9.0") > 0);
  assert.ok(comparar("1.0.0", "1.0.0") === 0);
  assert.ok(comparar("0.1.9", "0.2.0") < 0);
});

test("una entrada sin hasta sigue vigente; con hasta muere en esa versión, no antes", () => {
  const e = { desde: "0.1.0", hasta: "0.3.0" };
  assert.ok(vigente(e, "0.2.9") && !muerta(e, "0.2.9"));
  assert.ok(muerta(e, "0.3.0") && !vigente(e, "0.3.0"));
  assert.ok(!muerta({ desde: "0.1.0", hasta: null }, "9.9.9"));
});

test("hoy nada está muerto: la v0.1.x usa todo lo que instala", () => {
  assert.equal(ENTRADAS.filter((e) => muerta(e, "0.1.0")).length, 0);
});

test("lo del usuario y lo compartido nunca se quitan: ni siquiera pueden ser automáticos", () => {
  for (const e of ENTRADAS) {
    if (e.tipo === "gestionado" || e.tipo === "compartido" || e.quitar === "nunca") assert.notEqual(e.quitar, "seguro", e.id);
    if (e.auto) assert.equal(e.quitar, "seguro", e.id);
  }
});

test("el manifiesto no menciona WSL: la carcasa ya no lo usa", () => {
  assert.ok(ENTRADAS.every((e) => e.ambito === "windows" && !/wsl|Subsystem/i.test(e.ruta)));
});
