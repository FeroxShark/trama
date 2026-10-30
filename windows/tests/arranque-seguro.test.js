"use strict";
// Actualizar seguro en la carcasa de Windows (src/arranque-seguro.js y src/version-anterior.js): las mismas reglas que
// app/tests/arranque-seguro.test.ts (una versión nueva a prueba vuelve a la anterior si se cierra sola dos veces o no llega a ventana
// lista a tiempo; una buena no se deshace) y el disco: la copia de la instalación, el guion de cmd que vuelve y el servicio entero con un
// "instalador" de mentira en una carpeta temporal. Nunca toca la instalación real ni corre cmd.exe.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const R = require("../src/arranque-seguro");
const V = require("../src/version-anterior");

const nuevaCasa = () => fs.mkdtempSync(path.join(os.tmpdir(), "trama-wva-"));
const copia = (version) => ({ version, tipo: "carpeta", ruta: path.join(os.tmpdir(), `trama-copia-${version}`), cuando: 1 });
const recienActualizada = () => {
  let e = R.alArrancar(R.estadoVacio(), "0.2.25", 1).estado;
  e = R.conRespaldo(R.alVentanaLista(e), copia("0.2.25"));
  return R.alArrancar(e, "0.2.26", 10).estado;
};

test("reglas: una versión nueva toma el respaldo de la que corría como anterior, a prueba", () => {
  const e = recienActualizada();
  assert.equal(e.actual, "0.2.26");
  assert.equal(e.anterior.version, "0.2.25");
  assert.equal(e.buena, false);
  const sin = R.alArrancar(R.conRespaldo(R.alArrancar(R.estadoVacio(), "0.2.20", 1).estado, copia("0.2.10")), "0.2.26", 2).estado;
  assert.equal(sin.anterior, null);
});

test("reglas: se cierra sola dos veces seguidas y al tercer arranque vuelve", () => {
  const e1 = recienActualizada();
  const r = R.alArrancar(e1, "0.2.26", 20);
  assert.equal(r.decision.accion, "seguir");
  const r2 = R.alArrancar(r.estado, "0.2.26", 30);
  assert.equal(r2.estado.fallas, 2);
  assert.deepEqual([r2.decision.accion, r2.decision.a.version, r2.decision.motivo], ["volver", "0.2.25", "cierres"]);
});

test("reglas: ventana lista borra la cuenta; una buena no se deshace; salir a propósito no suma", () => {
  let e = R.alVentanaLista(R.alArrancar(recienActualizada(), "0.2.26", 20).estado);
  assert.deepEqual([e.fallas, e.buena], [0, true]);
  for (let i = 0; i < 5; i++) e = R.alArrancar(e, "0.2.26", 30 + i).estado;
  assert.equal(R.alArrancar(e, "0.2.26", 99).decision.accion, "seguir");
  let f = R.alSalirAProposito(recienActualizada());
  f = R.alSalirAProposito(R.alArrancar(f, "0.2.26", 20).estado);
  assert.equal(R.alArrancar(f, "0.2.26", 30).estado.fallas, 0);
});

test("reglas: sin copia de la anterior no hay a dónde volver; lento vuelve y llegar a tiempo no", () => {
  let e = R.alArrancar(R.estadoVacio(), "0.2.26", 1).estado;
  for (let i = 0; i < 4; i++) e = R.alArrancar(e, "0.2.26", 2 + i).estado;
  assert.equal(R.alArrancar(e, "0.2.26", 9).decision.accion, "seguir");
  assert.equal(R.alTiempoAgotado(e).accion, "seguir");
  const n = recienActualizada();
  assert.equal(R.alTiempoAgotado(n).motivo, "lento");
  assert.equal(R.alTiempoAgotado(R.alVentanaLista(n)).accion, "seguir");
});

test("reglas: volver deja la anterior como la que corre, desecha la mala y deja el aviso", () => {
  const e = R.alVolver(recienActualizada(), copia("0.2.25"), "cierres");
  assert.deepEqual([e.actual, e.buena, e.anterior, e.rechazada], ["0.2.25", true, null, "0.2.26"]);
  assert.deepEqual(e.aviso, { de: "0.2.26", a: "0.2.25", motivo: "cierres" });
  assert.equal(R.sinAviso(e).aviso, null);
  assert.equal(R.alArrancar(e, "0.2.25", 50).decision.accion, "seguir");
});

test("el archivo de estado va y vuelve; uno roto o con basura es el estado vacío; el de TS y el de JS son el mismo formato", () => {
  const archivo = path.join(nuevaCasa(), "sub", "arranque.json");
  const a = R.crearAlmacen(archivo);
  assert.deepEqual(a.leer(), R.estadoVacio());
  const e = a.cambiar(() => recienActualizada());
  assert.deepEqual(a.leer(), e);
  assert.equal(JSON.parse(fs.readFileSync(archivo, "utf8")).version, 1);
  fs.writeFileSync(archivo, "{no es json");
  assert.deepEqual(a.leer(), R.estadoVacio());
  assert.deepEqual(R.estadoDesde({ actual: 7, anterior: { version: "1", tipo: "raro", ruta: "/x" }, aviso: { de: "a" } }), R.estadoVacio());
});

// --- el disco ---

/** Una "instalación" de mentira: Trama.exe, resources\ con el motor, y la versión en cada uno. */
function instalacionEn(casa, v) {
  const dir = path.join(casa, "Programs", "Trama");
  fs.mkdirSync(path.join(dir, "resources", "payload-nativo"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Trama.exe"), `exe ${v}`);
  fs.writeFileSync(path.join(dir, "resources", "payload-nativo", "motor.js"), `motor ${v}`);
  return { tipo: "carpeta", dir, exe: "Trama.exe" };
}

test("instalacionDe: sólo empaquetada y con una ruta absoluta", () => {
  const exe = path.join(os.tmpdir(), "Trama", "Trama.exe");
  assert.deepEqual(V.instalacionDe({ empaquetada: true, execPath: exe }), { tipo: "carpeta", dir: path.dirname(exe), exe: "Trama.exe" });
  assert.equal(V.instalacionDe({ empaquetada: false, execPath: exe }), null);
  assert.equal(V.instalacionDe({ empaquetada: true, execPath: "Trama.exe" }), null);
});

test("guardarCopia deja la carpeta entera; podar deja sólo las vivas", async () => {
  const casa = nuevaCasa();
  const inst = instalacionEn(casa, "0.2.25");
  const base = path.join(casa, "anterior");
  const a = await V.guardarCopia(inst, "0.2.24", base, 1);
  const b = await V.guardarCopia(inst, "0.2.25", base, 2);
  assert.equal(fs.readFileSync(path.join(b.ruta, "resources", "payload-nativo", "motor.js"), "utf8"), "motor 0.2.25");
  assert.ok(await V.copiaExiste(b, "Trama.exe"));
  await V.podar(base, [b, null]);
  assert.equal(fs.existsSync(a.ruta), false);
  assert.equal(fs.existsSync(b.ruta), true);
  await assert.rejects(V.guardarCopia(inst, "../x", base, 1), /inválida/);
});

test("guardarCopia copia resources\\app.asar como un archivo, sin tratarlo como carpeta (Electron: «Invalid package»)", async () => {
  const casa = nuevaCasa();
  const inst = instalacionEn(casa, "0.2.28");
  const asar = Buffer.from([0x04, 0, 0, 0, 0xde, 0xad, 0xbe, 0xef, 1, 2, 3]);
  fs.writeFileSync(path.join(inst.dir, "resources", "app.asar"), asar);
  // El `fs` común de Electron: cualquier stat/lstat/cp sobre un .asar lo trata como carpeta virtual y tira esto.
  const invalido = (r) => Object.assign(new Error(`Invalid package ${r}`), { code: "ENOENT" });
  const comoElectron = {
    ...fs,
    stat: (r, ...a) => (/\.asar$/.test(r) ? a.at(-1)(invalido(r)) : fs.stat(r, ...a)),
    lstat: (r, ...a) => (/\.asar$/.test(r) ? a.at(-1)(invalido(r)) : fs.lstat(r, ...a)),
    cp: (r, ...a) => a.at(-1)(invalido(r)),
  };
  const base = path.join(casa, "anterior");
  const c = await V.guardarCopia(inst, "0.2.28", base, 1, comoElectron);
  assert.deepEqual(fs.readFileSync(path.join(c.ruta, "resources", "app.asar")), asar);
  assert.equal(fs.existsSync(`${c.ruta}.tmp`), false);
  // Volver a guardar la misma versión (y podar lo que sobra) tampoco toca el .asar como carpeta.
  await V.guardarCopia(inst, "0.2.28", base, 2, comoElectron);
  await V.podar(base, [], comoElectron);
  assert.deepEqual(fs.readdirSync(base), []);
  assert.equal(typeof V.fsCrudo().copyFile, "function", "fuera de Electron cae al fs común");
});

test("el guion de cmd: espera al pid, copia con robocopy /MIR, abre Trama y se borra; lo que cmd leería como otra cosa se rechaza", () => {
  const g = V.guionDeRestauracion({ origen: "C:\\Users\\a\\AppData\\Local\\trama\\anterior\\Trama-0.2.25", destino: "C:\\Users\\a\\AppData\\Local\\Programs\\Trama", exe: "Trama.exe", pid: 4321, args: ["--segundo-plano", "--raro"] });
  assert.match(g, /Wait-Process -Id 4321 -Timeout 60/);
  assert.match(g, /robocopy "C:\\Users\\a\\AppData\\Local\\trama\\anterior\\Trama-0\.2\.25" "C:\\Users\\a\\AppData\\Local\\Programs\\Trama" \/MIR/);
  assert.match(g, /start "" "C:\\Users\\a\\AppData\\Local\\Programs\\Trama\\Trama\.exe" --segundo-plano\r?\n/);
  assert.ok(!g.includes("--raro"), "sólo los argumentos permitidos");
  assert.match(g, /del "%~f0"/);
  const base = { origen: "C:\\a", destino: "C:\\b", exe: "Trama.exe", pid: 1 };
  for (const mal of [{ origen: 'C:\\a" & calc & "' }, { destino: "C:\\100%\\x" }, { exe: "..\\x.exe" }, { exe: "T&r.exe" }, { pid: "1; calc" }, { pid: -3 }]) assert.throws(() => V.guionDeRestauracion({ ...base, ...mal }));
});

test("lanzarRestauracion escribe el guion y lo lanza suelto con cmd.exe /d /c", async () => {
  const escritos = [];
  const lanzados = [];
  const archivo = await V.lanzarRestauracion(
    { origen: "C:\\a", destino: "C:\\b", exe: "Trama.exe", pid: 77 },
    { escribir: async (f, t) => void escritos.push([f, t]), lanzar: (c, a, o) => (lanzados.push([c, a, o]), { unref() {} }), carpeta: "C:\\tmp" },
  );
  assert.equal(path.basename(archivo), "trama-volver-77.cmd");
  assert.equal(escritos.length, 1);
  assert.deepEqual(lanzados[0].slice(0, 2), ["cmd.exe", ["/d", "/c", archivo]]);
  assert.equal(lanzados[0][2].detached, true);
  assert.equal(lanzados[0][2].windowsHide, true);
});

async function escenario() {
  const casa = nuevaCasa();
  const inst = instalacionEn(casa, "0.2.25");
  const almacen = R.crearAlmacen(path.join(casa, "estado", "arranque.json"));
  const restauradas = [];
  const salidas = [];
  const pendientes = [];
  const armar = (version, extra = {}) =>
    V.crearVersionAnterior({
      almacen,
      version,
      inst,
      base: path.join(casa, "anterior"),
      restaurar: async (_i, c) => void restauradas.push(c.version),
      salir: async () => void salidas.push(version),
      despues: (f) => (pendientes.push(f), { cancelar: () => void pendientes.splice(pendientes.indexOf(f), 1) }),
      topeMs: 1000,
      ...extra,
    });
  const v1 = armar("0.2.25");
  assert.equal(await v1.alArrancar(), false);
  await v1.alVentanaLista();
  await v1.guardarAntes(); // antes de instalar la 0.2.26
  return { casa, almacen, restauradas, salidas, pendientes, armar };
}

test("servicio: la nueva no llega a ventana lista a tiempo, restaura, sale y deja el aviso", async () => {
  const { almacen, restauradas, salidas, pendientes, armar } = await escenario();
  const v2 = armar("0.2.26");
  assert.equal(await v2.alArrancar(), false);
  assert.equal(await v2.disponible(), "0.2.25");
  assert.equal(pendientes.length, 1);
  pendientes[0]();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(restauradas, ["0.2.25"]);
  assert.deepEqual(salidas, ["0.2.26"]);
  assert.equal(almacen.leer().actual, "0.2.25");
  const v1 = armar("0.2.25");
  assert.equal(await v1.alArrancar(), false);
  assert.deepEqual(v1.leerAviso(), { de: "0.2.26", a: "0.2.25", motivo: "lento" });
  assert.equal(v1.leerAviso(), null);
  assert.equal(v1.rechazada(), "0.2.26");
});

test("servicio: llegar a ventana lista cancela el tope; dos cierres solos vuelven al tercer arranque sin abrir nada", async () => {
  const a = await escenario();
  const v2 = a.armar("0.2.26");
  await v2.alArrancar();
  await v2.alVentanaLista();
  assert.equal(a.pendientes.length, 0);
  assert.deepEqual(a.restauradas, []);
  const b = await escenario();
  assert.equal(await b.armar("0.2.26").alArrancar(), false);
  assert.equal(await b.armar("0.2.26").alArrancar(), false);
  assert.equal(await b.armar("0.2.26").alArrancar(), true);
  assert.deepEqual(b.restauradas, ["0.2.25"]);
});

test("servicio: el botón vuelve aunque la nueva ande; si falla el guion, no anota que se volvió", async () => {
  const a = await escenario();
  const v2 = a.armar("0.2.26");
  await v2.alArrancar();
  await v2.alVentanaLista();
  assert.deepEqual(await v2.volverManual(), { ok: true });
  assert.deepEqual(a.restauradas, ["0.2.25"]);
  assert.equal(a.armar("0.2.25").leerAviso()?.motivo, "manual");
  const b = await escenario();
  const w = b.armar("0.2.26", { restaurar: async () => Promise.reject(new Error("sin permiso")) });
  await w.alArrancar();
  assert.deepEqual(await w.volverManual(), { ok: false, error: "sin permiso" });
  assert.equal(b.almacen.leer().actual, "0.2.26", "no se anotó una vuelta que no pasó");
  assert.equal(b.salidas.length, 0);
});

test("servicio: sin copia entera en disco no se ofrece ni se vuelve; sin instalación no hace nada", async () => {
  const { casa, armar } = await escenario();
  const v2 = armar("0.2.26");
  await v2.alArrancar();
  fs.rmSync(path.join(casa, "anterior"), { recursive: true });
  assert.equal(await v2.disponible(), null);
  assert.equal((await v2.volverManual()).ok, false);
  const nada = V.crearVersionAnterior({ almacen: R.crearAlmacen(path.join(casa, "x.json")), version: "0.2.26", inst: null, base: casa, restaurar: () => assert.fail(), salir: () => assert.fail() });
  assert.equal(await nada.alArrancar(), false);
  await nada.alVentanaLista();
  assert.equal(await nada.disponible(), null);
  assert.equal(fs.existsSync(path.join(casa, "x.json")), false);
});

test("servicio: copiarAlEstarLista guarda al llegar la ventana (así una instalación a mano deja a dónde volver)", async () => {
  const casa = nuevaCasa();
  const inst = instalacionEn(casa, "0.2.25");
  const almacen = R.crearAlmacen(path.join(casa, "arranque.json"));
  const v = V.crearVersionAnterior({ almacen, version: "0.2.25", inst, base: path.join(casa, "anterior"), restaurar: () => {}, salir: () => {}, copiarAlEstarLista: true });
  await v.alArrancar();
  await v.alVentanaLista();
  assert.equal(almacen.leer().respaldo.version, "0.2.25");
});
