"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { mantenerVivo } = require("../src/wsl");

// Un `wsl.exe -e sleep infinity` de mentira: vive hasta que alguien lo mata (como `wsl --terminate`).
function banco() {
  const b = { hijos: [], reloj: 0, pendientes: [] };
  b.lanzar = () => {
    const h = new EventEmitter();
    h.muerto = false;
    h.kill = () => b.morir(h);
    b.hijos.push(h);
    return h;
  };
  b.morir = (h, codigo = 1) => {
    if (h.muerto) return;
    h.muerto = true;
    h.emit("close", codigo);
  };
  b.programar = (fn, ms) => {
    const t = { fn, ms, cancelado: false };
    b.pendientes.push(t);
    return t;
  };
  b.cancelar = (t) => (t.cancelado = true);
  b.correr = () => {
    const t = b.pendientes.shift();
    assert.ok(t && !t.cancelado, "había un relanzamiento pendiente");
    b.reloj += t.ms;
    t.fn();
    return t.ms;
  };
  b.mv = mantenerVivo("Ubuntu-24.04", { lanzar: b.lanzar, programar: b.programar, cancelar: b.cancelar, ahora: () => b.reloj });
  return b;
}

test("mantenerVivo: se relanza solo después de un terminate o shutdown", () => {
  const b = banco();
  b.mv.iniciar();
  b.mv.iniciar(); // llamarlo de nuevo no duplica
  assert.equal(b.hijos.length, 1);
  assert.equal(b.mv.activo, true);

  b.reloj += 60000; // vivió un buen rato
  b.morir(b.hijos[0]); // wsl --terminate
  assert.equal(b.mv.activo, false);
  assert.equal(b.correr(), 1000);
  assert.equal(b.hijos.length, 2);
  assert.equal(b.mv.activo, true);

  b.reloj += 60000;
  b.morir(b.hijos[1]); // wsl --shutdown
  b.correr();
  assert.equal(b.hijos.length, 3);
});

test("mantenerVivo: si cae enseguida de nuevo espera cada vez más, con tope", () => {
  const b = banco();
  b.mv.iniciar();
  const esperas = [];
  for (let i = 0; i < 7; i++) {
    b.morir(b.hijos[b.hijos.length - 1]);
    esperas.push(b.correr());
  }
  assert.deepEqual(esperas, [2000, 4000, 8000, 15000, 15000, 15000, 15000]);
});

test("mantenerVivo: parar() lo mata y no se relanza; iniciar() vuelve a arrancarlo", () => {
  const b = banco();
  b.mv.iniciar();
  b.morir(b.hijos[0]);
  assert.equal(b.pendientes.length, 1);
  b.mv.parar();
  assert.equal(b.pendientes[0].cancelado, true);
  assert.equal(b.mv.activo, false);

  b.mv.iniciar();
  assert.equal(b.hijos.length, 2);
  b.mv.parar();
  assert.equal(b.hijos[1].muerto, true);
  assert.equal(b.pendientes.filter((t) => !t.cancelado).length, 0, "morir por parar() no deja nada agendado");
  assert.equal(b.hijos.length, 2);
});

test("mantenerVivo: un wsl.exe que ni arranca (error) también se reintenta", () => {
  const b = banco();
  b.mv.iniciar();
  b.hijos[0].emit("error", new Error("ENOENT"));
  b.hijos[0].emit("close", -1); // error y close juntos cuentan una vez
  assert.equal(b.pendientes.length, 1);
  b.correr();
  assert.equal(b.hijos.length, 2);
});
