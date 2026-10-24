"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { crearActualizador, iniciarActualizador } = require("../src/actualizar");

function falso({ alBuscar } = {}) {
  const au = new EventEmitter();
  au.busquedas = 0;
  au.instalado = 0;
  au.checkForUpdates = async () => {
    au.busquedas++;
    if (alBuscar) await alBuscar(au);
  };
  au.quitAndInstall = () => au.instalado++;
  return au;
}

test("nunca toma prereleases y baja solo lo estable", () => {
  const au = falso();
  au.allowPrerelease = true;
  crearActualizador({ autoUpdater: au, onEstado: () => {} });
  assert.equal(au.allowPrerelease, false);
  assert.equal(au.autoDownload, true);
});

test("al día: buscando → al-dia", async () => {
  const fases = [];
  const au = falso({ alBuscar: (a) => { a.emit("checking-for-update"); a.emit("update-not-available", {}); } });
  const u = crearActualizador({ autoUpdater: au, onEstado: (e) => fases.push(e.fase) });
  await u.buscar();
  assert.deepEqual(fases, ["buscando", "al-dia"]);
});

test("versión nueva: descargando con porcentaje entero sin repetir, y lista para reiniciar", async () => {
  const eventos = [];
  const au = falso({
    alBuscar: (a) => {
      a.emit("checking-for-update");
      a.emit("update-available", { version: "0.2.0" });
      for (const p of [0.2, 0.9, 1.4, 1.9, 50.5, 100]) a.emit("download-progress", { percent: p });
      a.emit("update-downloaded", { version: "0.2.0" });
    },
  });
  const u = crearActualizador({ autoUpdater: au, onEstado: (e) => eventos.push(e) });
  await u.buscar();
  const progreso = eventos.filter((e) => e.fase === "descargando").map((e) => e.progreso);
  assert.deepEqual(progreso, [0, 1, 50, 100]);
  assert.deepEqual(eventos.at(-1), { fase: "lista", version: "0.2.0" });
  u.instalar();
  assert.equal(au.instalado, 1);
});

test("ya descargada o bajando no se vuelve a preguntar; buscando tampoco en paralelo", async () => {
  const au = falso({ alBuscar: (a) => { a.emit("update-available", { version: "0.2.0" }); a.emit("update-downloaded", { version: "0.2.0" }); } });
  const u = crearActualizador({ autoUpdater: au, onEstado: () => {} });
  await u.buscar();
  await u.buscar();
  assert.equal(au.busquedas, 1);
});

test("un error se dice en una línea y se puede volver a buscar", async () => {
  const eventos = [];
  let falla = true;
  const au = falso({ alBuscar: (a) => { if (falla) a.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED\n    at algo")); else a.emit("update-not-available", {}); } });
  const u = crearActualizador({ autoUpdater: au, onEstado: (e) => eventos.push(e), log: () => {} });
  await u.buscar();
  assert.deepEqual(eventos.at(-1), { fase: "error", mensaje: "net::ERR_INTERNET_DISCONNECTED" });
  falla = false;
  await u.buscar();
  assert.equal(eventos.at(-1).fase, "al-dia");
});

test("si checkForUpdates mismo tira, también queda como error", async () => {
  const eventos = [];
  const au = falso({ alBuscar: () => { throw new Error("sin conexión"); } });
  const u = crearActualizador({ autoUpdater: au, onEstado: (e) => eventos.push(e), log: () => {} });
  await u.buscar();
  assert.deepEqual(eventos, [{ fase: "error", mensaje: "sin conexión" }]);
});

test("sin empaquetar (o con el instalador de relleno) el botón dice «inactiva» y no pregunta nada", async () => {
  const eventos = [];
  const u = iniciarActualizador({ app: { isPackaged: false }, recursos: "/no/existe", onEstado: (e) => eventos.push(e) });
  assert.equal(u.activo, false);
  await u.buscar();
  u.instalar();
  assert.deepEqual(eventos, [{ fase: "inactiva" }]);
  const v = iniciarActualizador({ app: { isPackaged: true }, recursos: "/no/existe", onEstado: (e) => eventos.push(e) });
  assert.equal(v.activo, false);
});
