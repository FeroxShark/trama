"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearGuardiaFoco } = require("../src/foco");

test("con una consola de login abierta, Trama no se trae al frente", () => {
  let t = 1000;
  const g = crearGuardiaFoco({ ahora: () => t, topeMs: 600 });
  assert.equal(g.puedeTraer(), true);
  g.consolaAbierta();
  assert.equal(g.puedeTraer(), false);
  t += 599;
  assert.equal(g.puedeTraer(), false);
  t += 1;
  assert.equal(g.puedeTraer(), true, "pasado el tope vuelve a poder");
});

test("si la persona vuelve a Trama por su cuenta, se levanta la guardia", () => {
  const g = crearGuardiaFoco({ ahora: () => 0, topeMs: 600 });
  g.consolaAbierta();
  g.volvio();
  assert.equal(g.puedeTraer(), true);
});
