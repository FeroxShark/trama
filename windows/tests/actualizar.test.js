"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { crearActualizador, iniciarActualizador, esDeRelleno } = require("../src/actualizar");

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

test("bajando no se vuelve a preguntar; buscando tampoco en paralelo", async () => {
  const au = falso({ alBuscar: (a) => { a.emit("update-available", { version: "0.2.0" }); } });
  const u = crearActualizador({ autoUpdater: au, onEstado: () => {}, reloj: reloj0() });
  await u.buscar();
  await u.buscar();
  assert.equal(au.busquedas, 1);
});

// --- el tiempo falso: `ahora`, el ciclo (`cada`) y el reintento (`despues`) los maneja el test ---
function reloj0(t0 = 1_000_000) {
  const r = {
    t: t0,
    ciclo: () => {},
    reintento: () => {},
    esperas: [],
    ahora: () => r.t,
    cada: (f) => (r.ciclo = f),
    despues: (f, ms) => ((r.reintento = f), r.esperas.push(ms)),
    avanzar: (ms) => (r.t += ms),
  };
  return r;
}
const error = (msg, extra = {}) => Object.assign(new Error(msg), extra);

test("de fondo: el ciclo es cada 2 min, un foco seguido no pregunta de nuevo y sin novedad no dice nada", async () => {
  const eventos = [];
  const au = falso({ alBuscar: (a) => { a.emit("checking-for-update"); a.emit("update-not-available", {}); } });
  const r = reloj0();
  const u = crearActualizador({ autoUpdater: au, onEstado: (e) => eventos.push(e), reloj: r });
  await u.buscar();
  assert.deepEqual(eventos.map((e) => e.fase), ["buscando", "al-dia"]);
  eventos.length = 0;
  r.avanzar(5_000);
  await u.refrescar();
  assert.equal(au.busquedas, 1, "menos de 15 s desde la última: no sale");
  r.avanzar(15_000);
  await u.refrescar();
  assert.equal(au.busquedas, 2);
  r.avanzar(2 * 60_000);
  r.ciclo();
  assert.equal(au.busquedas, 3);
  assert.deepEqual(eventos, [], "de fondo, sin versión nueva, no cambia lo que se ve");
});

test("lista: una búsqueda que no trae nada más nuevo no la borra; una más nueva pasa a bajar y queda lista", async () => {
  const eventos = [];
  let n = 0;
  const au = falso({
    alBuscar: (a) => {
      n++;
      if (n === 1) {
        a.emit("update-available", { version: "0.2.0" });
        a.emit("update-downloaded", { version: "0.2.0" });
      } else if (n === 2) {
        a.emit("checking-for-update");
        a.emit("update-not-available", {});
      } else if (n === 3) {
        a.emit("update-available", { version: "0.2.0" });
      } else {
        a.emit("update-available", { version: "0.2.1" });
        a.emit("update-downloaded", { version: "0.2.1" });
      }
    },
  });
  const r = reloj0();
  const u = crearActualizador({ autoUpdater: au, onEstado: (e) => eventos.push(e), reloj: r });
  await u.buscar();
  assert.deepEqual(eventos.at(-1), { fase: "lista", version: "0.2.0" });
  for (let i = 0; i < 2; i++) {
    r.avanzar(2 * 60_000);
    r.ciclo();
    assert.deepEqual(eventos.at(-1), { fase: "lista", version: "0.2.0" }, `la búsqueda ${i + 2} no la borra`);
  }
  assert.equal(eventos.length, 2, "ni la búsqueda ni la misma versión dicen nada nuevo");
  r.avanzar(2 * 60_000);
  r.ciclo();
  assert.deepEqual(eventos.slice(2), [
    { fase: "descargando", version: "0.2.1", progreso: 0 },
    { fase: "lista", version: "0.2.1" },
  ]);
});

test("de fondo, un límite (403) no se muestra y espera 15 min; un error de red reintenta a los 30 s", async () => {
  const eventos = [];
  let modo = "limite";
  const au = falso({
    alBuscar: (a) => {
      if (modo === "limite") a.emit("error", error("HTTP error: 403 rate limit exceeded", { statusCode: 403 }));
      else if (modo === "red") a.emit("error", error("net::ERR_INTERNET_DISCONNECTED"));
      else a.emit("update-not-available", {});
    },
  });
  const r = reloj0();
  const u = crearActualizador({ autoUpdater: au, onEstado: (e) => eventos.push(e), reloj: r, log: () => {} });
  r.avanzar(2 * 60_000);
  r.ciclo();
  assert.equal(au.busquedas, 1);
  assert.deepEqual(eventos, [], "el límite no se muestra");
  r.avanzar(10 * 60_000);
  r.ciclo();
  assert.equal(au.busquedas, 1, "dentro de la pausa no sale");
  r.avanzar(6 * 60_000);
  modo = "red";
  r.ciclo();
  assert.equal(au.busquedas, 2);
  assert.deepEqual(eventos, [], "un fallo de red de fondo no se muestra");
  assert.deepEqual(r.esperas, [30_000]);
  r.avanzar(30_000);
  modo = "ok";
  r.reintento();
  assert.equal(au.busquedas, 3, "al volver la red se pregunta a los 30 s");
  assert.deepEqual(eventos, []);
});

test("Buscar a mano con un límite (403) tampoco muestra error", async () => {
  const eventos = [];
  const au = falso({ alBuscar: (a) => a.emit("error", error("HTTP error: 429", { statusCode: 429 })) });
  const u = crearActualizador({ autoUpdater: au, onEstado: (e) => eventos.push(e), reloj: reloj0(), log: () => {} });
  await u.buscar();
  assert.deepEqual(eventos, []);
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

// La versión no se fija acá: se comprueba la FORMA. Un número exacto obliga a tocar el test en cada release.
test("configuración de release: FeroxShark/trama activa electron-updater y los valores de relleno lo dejan inactivo", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "la versión de la carcasa es x.y.z");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trama-upd-yml-"));
  try {
    fs.writeFileSync(path.join(dir, "app-update.yml"), "provider: github\nowner: FeroxShark\nrepo: trama\n");
    assert.equal(esDeRelleno(dir), false, "con FeroxShark/trama el actualizador queda activo");
    fs.writeFileSync(path.join(dir, "app-update.yml"), "provider: github\nowner: TRAMA_GH_OWNER\nrepo: TRAMA_GH_REPO\n");
    assert.equal(esDeRelleno(dir), true, "con los valores de relleno queda inactivo");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
