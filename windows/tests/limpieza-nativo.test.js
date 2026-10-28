"use strict";
// La limpieza del desinstalador en modo nativo: el manifiesto nativo (src/manifiesto-nativo.js) con un Windows de mentira
// (disco, registro y PATH de usuario en memoria) y sin WSL.
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearLimpieza } = require("../src/limpieza");
const { validar } = require("../src/manifiesto");
const { ENTRADAS_NATIVO } = require("../src/manifiesto-nativo");
const { agregarAlPath, quitarDelPath } = require("../src/nativo");

const L = "C:\\Users\\Ana\\AppData\\Local";
const ENV = { LOCALAPPDATA: L, APPDATA: "C:\\Users\\Ana\\AppData\\Roaming", USERPROFILE: "C:\\Users\\Ana" };

function windowsFalso() {
  const w = {
    carpetas: new Set([`${L}\\trama\\app`, `${L}\\trama\\node`, `${L}\\trama\\bin`, `${L}\\trama\\estado`, `${L}\\trama\\config`, "C:\\Users\\Ana\\AppData\\Roaming\\Trama"]),
    registro: new Set(["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run|Trama"]),
    path: `C:\\Windows;${L}\\trama\\bin`,
    borrados: [],
    wsl: 0,
  };
  w.win = {
    expandir: (r) => r.replace(/%([^%]+)%/g, (m, n) => ENV[n] ?? m),
    tipo: async (r) => (w.carpetas.has(r) ? "carpeta" : null),
    borrar: async (r) => (w.borrados.push(r), w.carpetas.delete(r)),
    registro: { hay: async (c, v) => w.registro.has(`${c}|${v}`), quitar: async (c, v) => w.registro.delete(`${c}|${v}`) },
    path: { tiene: async (c) => agregarAlPath(w.path, c) === null, quitar: async (c) => (w.path = quitarDelPath(w.path, c) ?? w.path) },
  };
  return w;
}

const crear = (w, estado = {}) =>
  crearLimpieza({
    wsl: async () => (w.wsl++, { code: -1, stdout: "", stderr: "", falta: true }),
    win: w.win,
    estado: { cargar: () => estado, guardar: (o) => Object.assign(estado, o) },
    version: "0.2.0",
    entradas: ENTRADAS_NATIVO,
  });

test("el manifiesto nativo es válido y es todo del lado de Windows (nada de WSL, RunOnce ni .wslconfig)", () => {
  assert.deepEqual(validar(ENTRADAS_NATIVO), []);
  assert.ok(ENTRADAS_NATIVO.every((e) => e.ambito === "windows"));
  assert.ok(!ENTRADAS_NATIVO.some((e) => /RunOnce|wslconfig|Subsystem/i.test(e.ruta)));
});

test("desinstalar: lista el arranque, el PATH y las carpetas del motor para quitar; estado y config como datos; los worktrees quedan", async () => {
  const w = windowsFalso();
  const plan = await crear(w).planificar({ modo: "desinstalar" });
  const por = (a) => plan.items.filter((i) => i.accion === a).map((i) => i.id).sort();
  assert.deepEqual(por("quitar"), ["win-nativo-app", "win-nativo-arranque", "win-nativo-bin", "win-nativo-node", "win-nativo-path"]);
  assert.deepEqual(por("datos"), ["win-datos-carcasa", "win-nativo-config", "win-nativo-estado"]);
  assert.deepEqual(por("queda"), ["win-nativo-hooks", "win-nativo-wt"]);
  assert.equal(plan.distro, null);
});

test("ejecutar quita la entrada del PATH (y sólo ésa), la clave Run y las carpetas; los datos sólo si se aceptan", async () => {
  const w = windowsFalso();
  const l = crear(w);
  const ids = ["win-nativo-arranque", "win-nativo-path", "win-nativo-app", "win-nativo-node", "win-nativo-bin"];
  const { resultados } = await l.ejecutar({ modo: "desinstalar", ids, datos: [] });
  assert.ok(resultados.every((r) => r.estado === "quitado"), JSON.stringify(resultados));
  assert.equal(w.path, "C:\\Windows");
  assert.equal(w.registro.size, 0);
  assert.ok(w.carpetas.has(`${L}\\trama\\estado`) && w.carpetas.has(`${L}\\trama\\config`));
  await l.ejecutar({ modo: "desinstalar", ids: [], datos: ["win-nativo-estado"] });
  assert.ok(!w.carpetas.has(`${L}\\trama\\estado`));
  assert.ok(w.carpetas.has(`${L}\\trama\\config`));
});

test("lo que ya no está no aparece en el plan", async () => {
  const w = windowsFalso();
  w.path = "C:\\Windows";
  w.registro.clear();
  const plan = await crear(w).planificar({ modo: "desinstalar" });
  assert.ok(!plan.items.some((i) => i.id === "win-nativo-path" || i.id === "win-nativo-arranque"));
});
