"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { opcionesTitulo, overlayDesde } = require("../src/titulo");

// process.platform se simula: opcionesTitulo lo mira al llamarse, no al cargar el módulo.
function enPlataforma(plataforma, fn) {
  const real = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: plataforma });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", real);
  }
}

test("en Windows se quita la barra de título y los botones quedan sobre la página", () => {
  const o = enPlataforma("win32", () => opcionesTitulo());
  assert.equal(o.titleBarStyle, "hidden");
  assert.deepEqual(o.titleBarOverlay, { color: "#00000000", symbolColor: "#f4f5f7", height: 64 });
});

test("fuera de Windows las opciones de la ventana no cambian", () => {
  for (const p of ["linux", "darwin"]) assert.deepEqual(enPlataforma(p, () => opcionesTitulo()), {});
});

test("el overlay sigue al tema: el color de los símbolos tiene que ser hex y el alto es acotado", () => {
  assert.equal(overlayDesde("#0e1118", 60).symbolColor, "#0e1118");
  assert.equal(overlayDesde("rgb(1, 2, 3)", 60).symbolColor, "#f4f5f7");
  assert.equal(overlayDesde(undefined, 60).symbolColor, "#f4f5f7");
  assert.equal(overlayDesde("#0e1118", 9999).height, 64);
  assert.equal(overlayDesde("#0e1118", 60.4).height, 60);
  assert.equal(overlayDesde("#0e1118", NaN).color, "#00000000");
});
