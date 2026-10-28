"use strict";
// El asistente del Trama nativo (src/pasos-nativo.js) con todo lo de afuera falso: el disco es un Map, el PATH y la clave Run
// viven en memoria, `correrCli` contesta como trama-estado e instalar-nativo y el supervisor es de mentira.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { crearAsistenteNativo, PASOS_NATIVO } = require("../src/pasos-nativo");
const { rutasNativas, agregarAlPath } = require("../src/nativo");

const EXE = "C:\\Users\\Ana\\AppData\\Local\\Programs\\Trama\\Trama.exe";
const estadoJson = (o = {}) =>
  JSON.stringify({
    version: 1,
    claude: { instalado: true, logueado: false, ...o.claude },
    agy: { instalado: false, logueado: false, ...o.agy },
    ollama: { url: "http://localhost:11434", responde: false, modelos: [] },
    motor: { vivo: false, url: "http://127.0.0.1:8791" },
  });

function banco(sobre = {}) {
  const rutas = rutasNativas({ LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local", USERPROFILE: "C:\\Users\\Ana" });
  const archivos = new Map();
  const PAYLOAD = "C:\\Programs\\Trama\\resources\\payload-nativo";
  for (const c of ["", "node", "app", "bin"]) archivos.set(path.win32.join(PAYLOAD, c), "dir");
  const b = {
    rutas,
    archivos,
    copias: [],
    borrados: [],
    lineas: [],
    cli: [],
    pathUsuario: "C:\\Windows",
    run: null,
    estadoTrama: estadoJson(),
    ollama: null,
    fasesup: "parado",
    sup: [],
    guardado: {},
    instaladorRc: 0,
  };
  const disco = {
    existe: (r) => archivos.has(r),
    leer: (r) => (archivos.has(r) ? archivos.get(r) : null),
    escribir: (r, t) => archivos.set(r, t),
    copiar: (de, a) => {
      b.copias.push([de, a]);
      archivos.set(a, "dir");
      if (a.endsWith("\\node")) archivos.set(rutas.node, "exe");
      if (a.endsWith("\\app")) archivos.set(rutas.motor, "js");
    },
    borrar: (r) => {
      b.borrados.push(r);
      for (const k of [...archivos.keys()]) if (k === r || k.startsWith(`${r}\\`)) archivos.delete(k);
    },
    unir: (...p) => path.win32.join(...p),
  };
  b.asistente = crearAsistenteNativo({
    rutas,
    payload: { dir: PAYLOAD, version: "v2" },
    disco,
    correrCli: async (nombre, args) => {
      b.cli.push([nombre, ...args]);
      if (nombre === "trama-estado") return { code: 0, stdout: b.estadoTrama, stderr: "" };
      if (nombre === "cuentas") return { code: b.importarRc ?? 0, stdout: b.importarOut ?? '{"importadas": 0, "omitidas": 0, "cuentas": []}\n', stderr: "" };
      if (nombre === "instalar-nativo") return { code: b.instaladorRc, stdout: "hecho  settings.json: destructive-guard y statusline-espejo registrados\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "?" };
    },
    pathUsuario: {
      tiene: async (c) => agregarAlPath(b.pathUsuario, c) === null,
      agregar: async (c) => (b.pathUsuario = agregarAlPath(b.pathUsuario, c) ?? b.pathUsuario),
    },
    arranque: { leer: async () => b.run, registrar: async (c) => (b.run = c) },
    supervisor: {
      iniciar: async () => (b.sup.push("iniciar"), (b.fasesup = "vivo")),
      parar: async () => (b.sup.push("parar"), (b.fasesup = "parado")),
      esperarVivo: async () => b.fasesup === "vivo",
      estado: () => ({ fase: b.fasesup, ultimo: null }),
    },
    abrirConsola: async (p) => b.lineas.push(`consola ${p}`),
    fetch: async () => {
      if (!b.ollama) throw new Error("no escucha");
      return { ok: true, json: async () => ({ models: b.ollama.map((name) => ({ name })) }) };
    },
    estado: { cargar: () => b.guardado, guardar: (o) => (b.guardado = o) },
    exe: EXE,
    version: "0.2.0",
    ...sobre,
  });
  return b;
}

test("los pasos nativos no tienen WSL ni Ubuntu, y la pantalla sabe que son nativos", () => {
  assert.deepEqual(PASOS_NATIVO.map((p) => p.id), ["instalar", "sistema", "login", "ollama", "motor"]);
  assert.ok(PASOS_NATIVO.every((p) => p.nativo && !/wsl|ubuntu/i.test(p.titulo)));
});

test("de cero: copia el payload, corre instalar-nativo, PATH y Run, y se para en las cuentas", async () => {
  const b = banco();
  const ev = [];
  const r = await b.asistente.avanzar((e) => ev.push(e));
  assert.deepEqual(r, { espera: "login", paso: "login", info: r.info });
  assert.deepEqual(b.copias.map(([, a]) => a), ["node", "app", "bin"].map((c) => `C:\\Users\\Ana\\AppData\\Local\\trama\\${c}`));
  assert.deepEqual(b.sup, ["parar"], "antes de copiar se para el motor (node.exe en uso)");
  assert.equal(b.archivos.get(b.rutas.marca), "v2");
  assert.deepEqual(b.cli[0], ["instalar-nativo"]);
  assert.equal(b.pathUsuario, "C:\\Windows;C:\\Users\\Ana\\AppData\\Local\\trama\\bin");
  assert.equal(b.run, `"${EXE}" --segundo-plano`);
  assert.equal(b.guardado.instalado.modo, "nativo");
  assert.ok(ev.some((e) => e.tipo === "linea" && /destructive-guard/.test(e.texto)), "las líneas de instalar-nativo llegan a la pantalla");
  assert.deepEqual(ev.filter((e) => e.tipo === "ok").map((e) => e.paso), ["instalar", "sistema"]);
  assert.equal(r.info.nativo, true);
});

test("con Claude conectado y Ollama de Windows andando, arranca el motor y da la URL con el token", async () => {
  const b = banco();
  b.estadoTrama = estadoJson({ claude: { logueado: true } });
  b.guardado.loginHecho = true;
  b.ollama = ["qwen3:8b"];
  b.archivos.set(b.rutas.token, `${"a1".repeat(32)}\n`);
  const r = await b.asistente.avanzar();
  assert.deepEqual(r, { listo: true, url: `http://localhost:8791/?t=${"a1".repeat(32)}` });
  assert.deepEqual(b.sup, ["parar", "iniciar"]);
  assert.equal(b.guardado.ollamaResuelto, true);
});

test("sin Ollama espera a la persona; «continuar sin Ollama» lo resuelve", async () => {
  const b = banco();
  b.estadoTrama = estadoJson({ claude: { logueado: true } });
  b.guardado.loginHecho = true;
  const r = await b.asistente.avanzar();
  assert.equal(r.espera, "ollama");
  assert.equal(r.info.detectado, false);
  b.asistente.saltarOllama();
  assert.equal((await b.asistente.avanzar()).listo, true);
});

test("ya instalado y al día no copia nada; una versión nueva del payload reinstala (actualización)", async () => {
  const b = banco();
  b.estadoTrama = estadoJson({ claude: { logueado: true } });
  b.guardado = { loginHecho: true, ollamaResuelto: true };
  await b.asistente.avanzar();
  const copias = b.copias.length;
  b.fasesup = "vivo";
  await b.asistente.avanzar();
  assert.equal(b.copias.length, copias, "al día: nada que copiar");
  b.archivos.set(b.rutas.marca, "v1");
  const ev = [];
  await b.asistente.avanzar((e) => ev.push(e));
  assert.equal(b.copias.length, copias + 3);
  assert.ok(ev.some((e) => e.tipo === "inicia" && e.paso === "instalar" && e.actualizacion));
});

test("un instalador sin payload es un error del paso instalar", async () => {
  const b = banco({ payload: { dir: "C:\\no\\hay", version: null } });
  await assert.rejects(b.asistente.avanzar(), (e) => e.paso === "instalar" && /no trae los archivos/.test(e.message));
});

test("instalar-nativo con avisos no frena la instalación (queda en el registro)", async () => {
  const logs = [];
  const b = banco({ log: (m) => logs.push(m) });
  b.instaladorRc = 1;
  const r = await b.asistente.avanzar();
  assert.equal(r.espera, "login");
  assert.ok(logs.some((l) => /instalar-nativo terminó con 1/.test(l)));
});

test("en desarrollo (sin Trama.exe) no se toca la clave Run", async () => {
  const b = banco({ exe: null });
  await b.asistente.avanzar();
  assert.equal(b.run, null);
  assert.ok((await b.asistente.comprobar("sistema")).ok);
});

test("el motor que no contesta es un error del paso motor, con el final de motor.log", async () => {
  const b = banco({
    supervisor: { iniciar: async () => {}, parar: async () => {}, esperarVivo: async () => false, estado: () => ({ fase: "caido", ultimo: "el motor salió con 1" }) },
  });
  b.estadoTrama = estadoJson({ claude: { logueado: true } });
  b.guardado = { loginHecho: true, ollamaResuelto: true };
  b.archivos.set(b.rutas.logMotor, "línea 1\nError: EADDRINUSE 127.0.0.1:8791\n");
  await assert.rejects(b.asistente.avanzar(), (e) => e.paso === "motor" && /el motor salió con 1/.test(e.detalle) && /EADDRINUSE/.test(e.detalle));
});

test("conectar abre la consola con el CLI del proveedor; uno desconocido es un error", async () => {
  const b = banco();
  await b.asistente.conectar("claude");
  await b.asistente.conectar("gemini");
  assert.deepEqual(b.lineas, ["consola claude", "consola agy"]);
  await assert.rejects(b.asistente.conectar("otro"), /desconocido/);
});

test("en segundo plano: sin instalar no hace nada; instalado arranca el motor; desactualizado copia en silencio y arranca", async () => {
  const b = banco();
  assert.equal(await b.asistente.arrancarSoloMotor(), false);
  assert.deepEqual(b.sup, []);
  b.archivos.set(b.rutas.node, "exe");
  b.archivos.set(b.rutas.motor, "js");
  b.archivos.set(b.rutas.marca, "v2");
  assert.equal(await b.asistente.arrancarSoloMotor(), true);
  assert.deepEqual(b.sup, ["iniciar"]);
  b.archivos.set(b.rutas.marca, "v1");
  b.fasesup = "parado";
  assert.equal(await b.asistente.arrancarSoloMotor(), true);
  assert.equal(b.copias.length, 3);
  assert.equal(b.archivos.get(b.rutas.marca), "v2");
});

test("al instalar corre `cuentas importar-perfiles` una sola vez y muestra «Se importaron N cuentas de tu Trama anterior»", async () => {
  const b = banco();
  b.importarOut = '{"importadas": 2, "omitidas": 1, "cuentas": ["ana", "bruno"]}\n';
  const ev = [];
  const r = await b.asistente.avanzar((e) => ev.push(e));
  assert.deepEqual(b.cli.filter(([n]) => n === "cuentas"), [["cuentas", "importar-perfiles", "--json"]]);
  assert.ok(ev.some((e) => e.tipo === "linea" && e.texto === "Se importaron 2 cuentas de tu Trama anterior"));
  assert.equal(b.guardado.cuentasImportadas.n, 2);
  assert.equal(r.info.cuentasImportadas, 2, "la pantalla de cuentas lo recibe");
  // otra instalación (actualización): no se vuelve a correr
  b.archivos.set(b.rutas.marca, "v1");
  await b.asistente.avanzar();
  assert.equal(b.cli.filter(([n]) => n === "cuentas").length, 1);
});

test("sin Trama vieja (0 importadas) no dice nada; si el comando falla no frena la instalación y se reintenta", async () => {
  const b = banco();
  const ev = [];
  await b.asistente.avanzar((e) => ev.push(e));
  assert.ok(!ev.some((e) => e.tipo === "linea" && /Trama anterior/.test(e.texto)));
  assert.equal(b.guardado.cuentasImportadas.n, 0);

  const c = banco();
  c.importarRc = 1;
  const r = await c.asistente.avanzar(() => {});
  assert.equal(r.espera, "login", "la instalación siguió");
  assert.equal(c.guardado.cuentasImportadas, undefined, "sin marca: se reintenta");
});
