"use strict";
// La identidad de Trama en Windows (nombre del producto, del .exe y del atajo; título de la ventana; AppUserModelId). Se lee de
// los yml y de src/main.js como texto: sin Electron, que es lo que pide la prueba.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const campo = (t, clave) => new RegExp(`^${clave}:\\s*(.+)$`, "m").exec(t)?.[1].trim();

for (const yml of ["electron-builder-nativo.yml", "electron-builder.yml"]) {
  test(`${yml}: productName, executableName y shortcutName son Trama`, () => {
    const t = leer(yml);
    assert.equal(campo(t, "productName"), "Trama");
    assert.equal(campo(t, "executableName"), "Trama");
    assert.match(t, /^\s+shortcutName: Trama$/m);
  });
}

test("el AppUserModelId de main.js es el appId de los dos instaladores", () => {
  const aumid = /app\.setAppUserModelId\("([^"]+)"\)/.exec(leer("src/main.js"))?.[1];
  assert.ok(aumid, "main.js no fija el AppUserModelId");
  assert.equal(aumid, campo(leer("electron-builder-nativo.yml"), "appId"));
  assert.equal(aumid, campo(leer("electron-builder.yml"), "appId"));
});

test("la ventana se llama Trama aunque la página del motor traiga otro <title>", () => {
  const main = leer("src/main.js");
  assert.match(main, /title: "Trama"/);
  assert.match(main, /on\("page-title-updated", \(e\) => e\.preventDefault\(\)\)/);
});
