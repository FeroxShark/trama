"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearAsistente, ErrorPaso, aRutaWsl, nombreLinux, parsearEstado } = require("../src/pasos");
const { decodificar } = require("../src/wsl");

// Una máquina de mentira: lo que wsl.exe vería, sin Windows. Cada test la deja en el estado que quiere.
function maquina(sobre = {}) {
  const m = {
    wslInstalado: true,
    distro: true,
    usuario: false, // ¿hay usuario ≠ root por defecto?
    systemd: false,
    confPendiente: false,
    estadoBin: false,
    versionMarca: "",
    claude: { instalado: true, logueado: false },
    agy: { instalado: true, logueado: false },
    motorVivo: false,
    ollamaWindows: false,
    ollamaVisible: false,
    falla: {}, // {instalar: true, apt: true}
    llamadas: [],
    elevadas: [],
    consolas: [],
    terminadas: 0,
    shutdowns: 0,
    wslconfig: null,
    ...sobre,
  };
  m.wsl = async (args, { input = "", onLinea } = {}) => {
    m.llamadas.push({ args, input });
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    if (args[0] === "-l") return m.wslInstalado ? (m.distro ? ok("Ubuntu-24.04\r\n") : { code: 1, stdout: "", stderr: "" }) : { code: -1, stdout: "", stderr: "", falta: true };
    if (args[0] === "--terminate") {
      m.terminadas++;
      if (m.confPendiente) m.systemd = true;
      return ok();
    }
    if (args[0] === "--shutdown") {
      m.shutdowns++;
      return ok();
    }
    const root = args.includes("root");
    if (input.includes('echo "uid=')) return ok(`uid=${root || !m.usuario ? 0 : 1000}\npid1=${m.systemd ? "systemd" : "init"}\nhome=/home/ana\n`);
    if (input.includes("useradd")) {
      m.usuario = true;
      m.confPendiente = true;
      return ok("usuario=ana\n");
    }
    if (input.includes("cp -a")) return ok("dest=/home/ana/.cache/trama/payload\n");
    if (input.includes("--solo-apt")) {
      assert.ok(root, "los paquetes se instalan como root");
      onLinea?.("apt: listo");
      return m.falla.apt ? { code: 100, stdout: "E: no pude\n", stderr: "" } : ok("apt: listo\n");
    }
    if (input.includes("--fuente")) {
      assert.ok(!root, "el motor se instala como usuario");
      if (m.falla.instalar) return { code: 1, stdout: "paso 3: boom\n", stderr: "" };
      m.estadoBin = true;
      return ok();
    }
    if (input.includes("printf %s")) {
      m.versionMarca = /printf %s '([^']*)'/.exec(input)[1];
      return ok();
    }
    if (input.includes("estado=si")) return ok(`estado=${m.estadoBin ? "si" : "no"}\nversion=${m.versionMarca}\n`);
    if (input.includes("--json")) {
      if (!m.estadoBin) return { code: 127, stdout: "", stderr: "no such file" };
      return ok(JSON.stringify({ version: 1, claude: m.claude, agy: m.agy, ollama: { url: "http://localhost:11434", responde: false, modelos: [] }, motor: { vivo: m.motorVivo, url: "http://localhost:8791" } }));
    }
    if (input.includes("visible=")) return ok(`visible=${m.ollamaVisible ? "si" : "no"}\n`);
    if (input.includes("systemctl --user start")) {
      m.motorVivo = true;
      return ok();
    }
    if (input.includes("journalctl")) return ok("motor: error de ejemplo\n");
    throw new Error(`wsl no esperado: ${JSON.stringify(args)} ${input}`);
  };
  return m;
}

function armar(m, extra = {}) {
  let guardado = {};
  const eventos = [];
  const a = crearAsistente({
    wsl: m.wsl,
    elevarWsl: async (args) => {
      m.elevadas.push(args);
      if (m.cancelaUac) return { code: 1223, cancelado: true, stderr: "cancelado" };
      if (m.instalaWsl) {
        m.wslInstalado = true;
        m.distro = m.instalaWsl === "con-distro";
      }
      return { code: m.codigoInstall ?? 0, stderr: "" };
    },
    abrirConsola: async (d, c) => m.consolas.push([d, c]),
    fetch: async () => {
      if (!m.ollamaWindows) throw new Error("ECONNREFUSED");
      return { ok: true, json: async () => ({ models: [{ name: "qwen3-coder:30b" }] }) };
    },
    estado: { cargar: () => guardado, guardar: (o) => (guardado = o) },
    payload: { dir: "C:\\Users\\Ana\\AppData\\Local\\Programs\\Trama\\resources\\payload", version: "v1" },
    wslconfig: { leer: () => m.wslconfig, escribir: (t) => (m.wslconfig = t) },
    inicioSistema: () => m.inicioSistema ?? 1000,
    espera: async () => {},
    env: { USERNAME: "Ana" },
    ...extra,
  });
  return { a, eventos, emit: (e) => eventos.push(e), guardado: () => guardado };
}

test("rutas y nombres", () => {
  assert.equal(aRutaWsl("C:\\Users\\Ana\\x y\\payload"), "/mnt/c/Users/Ana/x y/payload");
  assert.equal(nombreLinux("Ana María"), "anamaria");
  assert.equal(nombreLinux("9lives"), "lives");
  assert.equal(nombreLinux("Administrator"), "administrator");
  assert.equal(nombreLinux("root"), "trama");
  assert.equal(nombreLinux("日本"), "trama");
});

test("wsl.exe en UTF-16 se lee bien", () => {
  assert.equal(decodificar(Buffer.from("Ubuntu-24.04\r\n", "utf16le")).trim(), "Ubuntu-24.04");
  assert.equal(decodificar(Buffer.from("héllo", "utf8")), "héllo");
});

test("trama-estado: versión desconocida y basura", () => {
  assert.throws(() => parsearEstado('{"version":2}'), /versión/);
  assert.throws(() => parsearEstado("no es json"), ErrorPaso);
  const e = parsearEstado('aviso\n{"version":1,"claude":{"instalado":true,"logueado":true}}');
  assert.equal(e.claude.logueado, true);
  assert.equal(e.motor.url, "http://localhost:8791");
});

test("camino rápido: todo listo → carga la UI sin tocar nada", async () => {
  const m = maquina({ usuario: true, systemd: true, estadoBin: true, versionMarca: "v1", claude: { instalado: true, logueado: true }, motorVivo: true, ollamaWindows: false });
  const { a, eventos, emit, guardado } = armar(m);
  guardado().ollamaResuelto = true;
  const r = await a.avanzar(emit);
  assert.deepEqual(r, { listo: true, url: "http://localhost:8791" });
  assert.ok(!eventos.some((e) => e.tipo === "inicia"), "sin pantallas de trabajo");
  assert.equal(m.elevadas.length, 0);
  assert.ok(!m.llamadas.some((c) => c.input.includes("cp -a")));
});

test("primer arranque completo: usuario, systemd, instalación, login, ollama, motor", async () => {
  const m = maquina();
  const { a, eventos, emit } = armar(m);

  let r = await a.avanzar(emit);
  assert.equal(r.espera, "login", "se frena en el login");
  assert.equal(m.usuario, true);
  assert.equal(m.terminadas, 1, "reinicia la distro para que lea wsl.conf");
  assert.equal(m.shutdowns, 0);
  assert.equal(m.versionMarca, "v1");
  assert.deepEqual(eventos.filter((e) => e.tipo === "inicia").map((e) => e.paso), ["sistema", "instalar"]);
  const orden = m.llamadas.map((c) => c.input).filter((i) => i.includes("--solo-apt") || i.includes("--fuente"));
  assert.match(orden[0], /--solo-apt/);
  assert.match(orden[1], /--fuente '\/home\/ana\/\.cache\/trama\/payload'/);
  const copia = m.llamadas.find((c) => c.input.includes("cp -a")).input;
  assert.match(copia, /cp -a '\/mnt\/c\/Users\/Ana\/AppData\/Local\/Programs\/Trama\/resources\/payload'\/\./);
  const wslconf = m.llamadas.find((c) => c.input.includes("useradd")).input;
  assert.match(wslconf, /systemd=true/);
  assert.match(wslconf, /default=%s/);

  // Sin login no avanza; con uno de los dos alcanza.
  r = await a.avanzar(emit);
  assert.equal(r.espera, "login");
  m.agy.logueado = true;
  r = await a.avanzar(emit);
  assert.equal(r.espera, "ollama");
  assert.equal(r.info.detectado, false);

  a.saltarOllama();
  r = await a.avanzar(emit);
  assert.deepEqual(r, { listo: true, url: "http://localhost:8791" });
  assert.equal(m.motorVivo, true);
});

test("sin WSL: pide elevar, avisa del reinicio y retoma sola cuando Windows reinició", async () => {
  const m = maquina({ wslInstalado: false, distro: false, instalaWsl: "sin-distro", codigoInstall: 3010 });
  const { a, guardado, emit } = armar(m);
  let r = await a.avanzar(emit);
  assert.equal(r.espera, "reinicio");
  assert.deepEqual(m.elevadas, [["--install", "-d", "Ubuntu-24.04", "--no-launch"]]);
  assert.ok(guardado().reinicio);

  // Reabierta sin reiniciar: no vuelve a pedir permiso.
  r = await a.avanzar(emit);
  assert.equal(r.espera, "reinicio");
  assert.equal(m.elevadas.length, 1);

  // Windows reinició y la distro ya está: sigue de largo.
  m.inicioSistema = 500000;
  m.distro = true;
  r = await a.avanzar(emit);
  assert.equal(r.espera, "login");
  assert.equal(guardado().reinicio, null);
  assert.equal(m.elevadas.length, 1);
});

test("reinicio hecho pero la distro aún no está: reintenta la instalación", async () => {
  const m = maquina({ wslInstalado: false, distro: false, instalaWsl: "con-distro" });
  const { a, guardado, emit } = armar(m);
  guardado().reinicio = { inicioSistema: 1000 };
  m.inicioSistema = 900000;
  m.wslInstalado = true;
  const r = await a.avanzar(emit);
  assert.equal(m.elevadas.length, 1);
  assert.equal(r.espera, "login");
});

test("cancelar el permiso de administrador es un error legible", async () => {
  const m = maquina({ wslInstalado: false, distro: false, cancelaUac: true });
  const { a, emit } = armar(m);
  await assert.rejects(a.avanzar(emit), (e) => e instanceof ErrorPaso && e.paso === "wsl" && /Cancelaste/.test(e.message));
});

test("error en la instalación: muestra el final del log y Reintentar sigue desde ahí", async () => {
  const m = maquina({ usuario: true, systemd: true, falla: { instalar: true } });
  const { a, emit } = armar(m);
  await assert.rejects(a.avanzar(emit), (e) => e.paso === "instalar" && /boom/.test(e.detalle));
  assert.equal(m.estadoBin, false);
  m.falla = {};
  const r = await a.avanzar(emit);
  assert.equal(r.espera, "login");
  assert.equal(m.estadoBin, true);
});

test("falla de apt: error del paso, el motor ni se intenta", async () => {
  const m = maquina({ usuario: true, systemd: true, falla: { apt: true } });
  const { a, emit } = armar(m);
  await assert.rejects(a.avanzar(emit), (e) => e.paso === "instalar" && /paquetes/.test(e.message));
  assert.ok(!m.llamadas.some((c) => c.input.includes("--fuente")));
});

test("un .exe nuevo con otra versión del árbol reinstala el motor", async () => {
  const m = maquina({ usuario: true, systemd: true, estadoBin: true, versionMarca: "v0", claude: { instalado: true, logueado: true }, motorVivo: true });
  const { a, eventos, emit, guardado } = armar(m);
  guardado().ollamaResuelto = true;
  const r = await a.avanzar(emit);
  assert.equal(r.listo, true);
  const ini = eventos.find((e) => e.tipo === "inicia");
  assert.deepEqual([ini.paso, ini.actualizacion], ["instalar", true]);
  assert.equal(m.versionMarca, "v1");
});

test("ollama: detectado y visible desde Ubuntu pasa solo; si no lo ve, ofrece el modo espejo", async () => {
  const base = { usuario: true, systemd: true, estadoBin: true, versionMarca: "v1", claude: { instalado: true, logueado: true }, motorVivo: true, ollamaWindows: true };
  let m = maquina({ ...base, ollamaVisible: true });
  let x = armar(m);
  let r = await x.a.avanzar(x.emit);
  assert.equal(r.listo, true);

  m = maquina({ ...base, ollamaVisible: false, wslconfig: "[wsl2]\nmemory=8GB\n" });
  x = armar(m);
  r = await x.a.avanzar(x.emit);
  assert.equal(r.espera, "ollama");
  assert.deepEqual([r.info.detectado, r.info.visibleDesdeWsl, r.info.modelos], [true, false, ["qwen3-coder:30b"]]);
  const h = await x.a.habilitarEspejo();
  assert.equal(h.cambiado, true);
  assert.equal(m.wslconfig, "[wsl2]\nnetworkingMode=mirrored\nmemory=8GB\n");
  assert.equal(m.shutdowns, 1);
  // Ya espejado: no reescribe.
  assert.equal((await x.a.habilitarEspejo()).cambiado, false);
});

test(".wslconfig inexistente o sin sección [wsl2]", async () => {
  for (const [antes, despues] of [
    [null, "[wsl2]\nnetworkingMode=mirrored\n"],
    ["[experimental]\nautoMemoryReclaim=gradual\n", "[experimental]\nautoMemoryReclaim=gradual\n[wsl2]\nnetworkingMode=mirrored\n"],
    ["[wsl2]\nnetworkingMode=nat\n", "[wsl2]\nnetworkingMode=mirrored\n"],
  ]) {
    const m = maquina({ wslconfig: antes });
    await armar(m).a.habilitarEspejo();
    assert.equal(m.wslconfig, despues);
  }
});

test("el motor no arranca: error con el journal", async () => {
  const m = maquina({ usuario: true, systemd: true, estadoBin: true, versionMarca: "v1", claude: { instalado: true, logueado: true } });
  const orig = m.wsl;
  m.wsl = async (args, o) => (o?.input?.includes("systemctl --user start") ? { code: 0, stdout: "", stderr: "" } : orig(args, o));
  const { a, emit, guardado } = armar(m);
  guardado().ollamaResuelto = true;
  await assert.rejects(a.avanzar(emit), (e) => e.paso === "motor" && /error de ejemplo/.test(e.detalle));
});

test("conectar abre la consola con el CLI de cada proveedor", async () => {
  const m = maquina();
  const { a } = armar(m);
  await a.conectar("claude");
  await a.conectar("gemini");
  assert.match(m.consolas[0][1], /; claude$/);
  assert.match(m.consolas[1][1], /; agy$/);
  await assert.rejects(a.conectar("otro"));
});

test("login: seguir sin iniciar sesión, de a un proveedor, y entrar sin ninguna cuenta", async () => {
  const m = maquina({ usuario: true, systemd: true, estadoBin: true, versionMarca: "v1", motorVivo: true });
  const { a, emit, guardado } = armar(m);
  guardado().ollamaResuelto = true;

  let r = await a.avanzar(emit);
  assert.equal(r.espera, "login");
  assert.equal(r.info.claude.saltado, false);

  // Con uno solo saltado todavía falta el otro.
  a.saltarLogin("claude");
  r = await a.avanzar(emit);
  assert.equal(r.espera, "login");
  assert.equal(r.info.claude.saltado, true);
  assert.equal(r.info.agy.saltado, false);

  a.saltarLogin("gemini");
  r = await a.avanzar(emit);
  assert.deepEqual(r, { listo: true, url: "http://localhost:8791" });
  assert.throws(() => a.saltarLogin("otro"));
});

test("login: con uno solo conectado se entra sin saltar nada", async () => {
  const m = maquina({ usuario: true, systemd: true, estadoBin: true, versionMarca: "v1", motorVivo: true, claude: { instalado: true, logueado: true } });
  const { a, emit, guardado } = armar(m);
  guardado().ollamaResuelto = true;
  assert.equal((await a.avanzar(emit)).listo, true);
});

test("reinicio de WSL: registra la reapertura de Trama y la quita cuando la distro ya está", async () => {
  const m = maquina({ wslInstalado: false, distro: false, instalaWsl: "sin-distro", codigoInstall: 3010 });
  const llamadas = [];
  const { a, emit } = armar(m, { reabrir: { registrar: async () => llamadas.push("registrar"), quitar: async () => llamadas.push("quitar") } });
  await a.avanzar(emit);
  assert.deepEqual(llamadas, ["registrar"]);
  m.inicioSistema = 500000;
  m.distro = true;
  await a.avanzar(emit);
  assert.deepEqual(llamadas, ["registrar", "quitar"]);
});
