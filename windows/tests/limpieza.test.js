"use strict";
// La limpieza (src/limpieza.js) contra un Windows de mentira (disco y registro en memoria) y las entradas reales de manifiesto.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearLimpieza } = require("../src/limpieza");
const { ENTRADAS } = require("../src/manifiesto");

const L = "C:\\Users\\Gonza\\AppData\\Local";
const CACHE = `${L}\\trama-windows-updater`;
const DATOS = "C:\\Users\\Gonza\\AppData\\Roaming\\Trama";
const CLAVE = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run|Trama";
const ENV = { LOCALAPPDATA: L, APPDATA: "C:\\Users\\Gonza\\AppData\\Roaming" };
// Una entrada de registro de mentira: el manifiesto de hoy no trae ninguna que se quite sola.
const REGISTRO = { id: "win-prueba-registro", ambito: "windows", grupo: "carcasa", tipo: "registro", ruta: CLAVE, que: "Clave de prueba", desde: "0.1.0", hasta: null, quitar: "seguro", auto: true };

function entorno(expandir = (r) => r.replace(/%([^%]+)%/g, (m, n) => ENV[n] ?? m)) {
  const e = { carpetas: new Set(), registro: new Set(), borrados: [], regQuitados: [], estado: {} };
  e.win = {
    expandir,
    tipo: async (r) => (e.carpetas.has(r) ? "carpeta" : null),
    borrar: async (r) => (e.borrados.push(r), e.carpetas.delete(r)),
    registro: {
      hay: async (c, v) => e.registro.has(`${c}|${v}`),
      quitar: async (c, v) => (e.regQuitados.push(`${c}|${v}`), e.registro.delete(`${c}|${v}`)),
    },
  };
  e.limpieza = (version, entradas = ENTRADAS) =>
    crearLimpieza({ win: e.win, estado: { cargar: () => ({ ...e.estado }), guardar: (o) => (e.estado = { ...o }) }, version, entradas });
  return e;
}

const hasta = (id, v) => (x) => (x.id === id ? { ...x, hasta: v } : x);

test("con la versión 0.1.0 nada está muerto: el plan viene vacío y no se toca nada", async () => {
  const e = entorno();
  e.carpetas.add(CACHE);
  const plan = await e.limpieza("0.1.0").planificar({ modo: "restos" });
  assert.deepEqual(plan.items, []);
  assert.deepEqual(e.borrados, []);
});

test("restos: lista lo que la versión nueva dejó de usar, con su ruta y su frase, y no toca nada", async () => {
  const e = entorno();
  e.carpetas.add(CACHE);
  const plan = await e.limpieza("0.2.0", ENTRADAS.map(hasta("win-cache-actualizador", "0.2.0"))).planificar({ modo: "restos" });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].id, "win-cache-actualizador");
  assert.equal(plan.items[0].accion, "quitar");
  assert.match(plan.items[0].que, /Descargas viejas/);
  assert.deepEqual(e.borrados, []);
});

test("desinstalar: la caché del actualizador se quita; los datos de la app sólo si se aceptan; la instalación la borra NSIS", async () => {
  const e = entorno();
  e.carpetas.add(CACHE);
  e.carpetas.add(DATOS);
  const l = e.limpieza("0.1.0");
  const plan = await l.planificar({ modo: "desinstalar" });
  const acc = Object.fromEntries(plan.items.map((i) => [i.id, i.accion]));
  assert.equal(acc["win-cache-actualizador"], "quitar");
  assert.equal(acc["win-datos-carcasa"], "datos");
  assert.equal(acc["win-instalacion"], undefined);
  const r1 = await l.ejecutar({ modo: "desinstalar", ids: plan.items.map((i) => i.id) });
  assert.equal(r1.resultados.find((r) => r.id === "win-datos-carcasa").estado, "omitido");
  assert.ok(e.carpetas.has(DATOS));
  assert.ok(!e.carpetas.has(CACHE));
  const r2 = await l.ejecutar({ modo: "desinstalar", ids: [], datos: ["win-datos-carcasa"] });
  assert.equal(r2.resultados.find((r) => r.id === "win-datos-carcasa").estado, "quitado");
  assert.ok(!e.carpetas.has(DATOS));
});

test("una carpeta de la persona donde Trama tenía la suya queda «ajena» y no se borra; sólo se quita lo que se pidió", async () => {
  const e = entorno();
  e.win.tipo = async (r) => (r === CACHE ? "archivo" : null);
  const l = e.limpieza("0.1.0");
  const plan = await l.planificar({ modo: "desinstalar" });
  assert.equal(plan.items.find((i) => i.id === "win-cache-actualizador").accion, "ajeno");
  await l.ejecutar({ modo: "desinstalar", ids: ["win-cache-actualizador"] });
  assert.deepEqual(e.borrados, []);
});

test("en el modo restos los datos de Windows ni se ofrecen ni se borran, aunque se los pida", async () => {
  const e = entorno();
  e.carpetas.add(DATOS);
  const l = e.limpieza("0.2.0", ENTRADAS.map(hasta("win-datos-carcasa", "0.2.0")));
  const r = await l.ejecutar({ modo: "restos", ids: ["win-datos-carcasa"], datos: ["win-datos-carcasa"] });
  assert.notEqual(r.resultados.find((x) => x.id === "win-datos-carcasa").estado, "quitado");
  assert.ok(e.carpetas.has(DATOS));
});

test("una ruta de Windows con una variable sin expandir no se borra", async () => {
  const e = entorno((r) => r); // %LOCALAPPDATA% queda tal cual
  e.carpetas.add("%LOCALAPPDATA%\\trama-windows-updater");
  const plan = await e.limpieza("0.1.0").planificar({ modo: "desinstalar" });
  assert.equal(plan.items.find((i) => i.id === "win-cache-actualizador").accion, "ajeno");
});

test("después de actualizar: corre una vez por versión y sólo quita lo `auto`", async () => {
  const e = entorno();
  e.carpetas.add(CACHE);
  e.carpetas.add(DATOS);
  e.registro.add(CLAVE);
  const entradas = [...ENTRADAS, { ...REGISTRO, hasta: "0.2.0" }].map(hasta("win-cache-actualizador", "0.2.0"));
  const l = e.limpieza("0.2.0", entradas);
  const r = await l.despuesDeActualizar();
  assert.equal(r.hecho, true);
  assert.deepEqual(r.resultados.map((x) => x.id).sort(), ["win-cache-actualizador", "win-prueba-registro"]);
  assert.deepEqual(e.regQuitados, [CLAVE]);
  assert.equal(e.estado.limpiezaAuto, "0.2.0");
  assert.equal((await l.despuesDeActualizar()).hecho, false);
  assert.equal((await e.limpieza("0.3.0", entradas).despuesDeActualizar()).hecho, true, "una versión nueva vuelve a mirar");
});

test("después de actualizar nunca toca los datos, aunque estén marcados como muertos", async () => {
  const e = entorno();
  e.carpetas.add(DATOS);
  await e.limpieza("0.2.0", ENTRADAS.map(hasta("win-datos-carcasa", "0.2.0"))).despuesDeActualizar();
  assert.ok(e.carpetas.has(DATOS));
});
