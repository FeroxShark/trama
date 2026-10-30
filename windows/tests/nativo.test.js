"use strict";
// El lado de la carcasa del Trama nativo (src/nativo.js): rutas, PATH de usuario, clave Run y el supervisor del motor, con un
// reloj y un motor de mentira. El chequeo por /rpc contra un servidor HTTP local de verdad.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const n = require("../src/nativo");

test("las rutas son las de app/electron/rutas.ts en win32", () => {
  const r = n.rutasNativas({ LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local", USERPROFILE: "C:\\Users\\Ana" });
  assert.equal(r.raiz, "C:\\Users\\Ana\\AppData\\Local\\trama");
  assert.equal(r.node, "C:\\Users\\Ana\\AppData\\Local\\trama\\node\\node.exe");
  assert.equal(r.bin, "C:\\Users\\Ana\\AppData\\Local\\trama\\bin");
  assert.equal(r.motor, "C:\\Users\\Ana\\AppData\\Local\\trama\\app\\dist-electron\\motor.js");
  assert.equal(r.cli("trama-estado"), "C:\\Users\\Ana\\AppData\\Local\\trama\\app\\dist-electron\\cli\\trama-estado.js");
  assert.equal(r.token, "C:\\Users\\Ana\\AppData\\Local\\trama\\config\\token");
  assert.equal(r.dueno, "C:\\Users\\Ana\\AppData\\Local\\trama\\estado\\hilos\\dueno");
  // Sin LOCALAPPDATA, la de siempre bajo el perfil.
  assert.equal(n.rutasNativas({ USERPROFILE: "C:\\Users\\Bo" }).raiz, "C:\\Users\\Bo\\AppData\\Local\\trama");
});

test("agregarAlPath: al final, una sola vez, sin importar mayúsculas, comillas, barra final ni %VARIABLES%", () => {
  const bin = "C:\\Users\\Ana\\AppData\\Local\\trama\\bin";
  assert.equal(n.agregarAlPath("", bin), bin);
  assert.equal(n.agregarAlPath("C:\\x;;C:\\y;", bin), `C:\\x;C:\\y;${bin}`);
  assert.equal(n.agregarAlPath(`C:\\x;"${bin.toUpperCase()}\\"`, bin), null);
  const expandir = n.expandirCon({ localappdata: "C:\\Users\\Ana\\AppData\\Local" });
  assert.equal(n.agregarAlPath("%LOCALAPPDATA%\\trama\\bin;C:\\x", bin, expandir), null);
});

test("quitarDelPath: saca todas las veces que esté y deja lo demás; null si no estaba", () => {
  const bin = "C:\\T\\bin";
  assert.equal(n.quitarDelPath(`C:\\x;${bin};C:\\y;c:\\t\\BIN\\`, bin), "C:\\x;C:\\y");
  assert.equal(n.quitarDelPath("C:\\x;C:\\y", bin), null);
});

test("la clave Run abre la carcasa en segundo plano", () => {
  assert.equal(n.comandoArranque("C:\\Users\\Ana López\\AppData\\Local\\Programs\\Trama\\Trama.exe"), '"C:\\Users\\Ana López\\AppData\\Local\\Programs\\Trama\\Trama.exe" --segundo-plano');
});

test("el entorno del motor: bin\\ primero; sin node en el sistema el node propio va al final (modo local y TRAMA_APP)", () => {
  const r = n.rutasNativas({ LOCALAPPDATA: "C:\\L", USERPROFILE: "C:\\U" });
  const e = n.entornoMotor({ Path: "C:\\Windows", USERNAME: "ana" }, r, () => false);
  assert.equal(e.Path, "C:\\L\\trama\\bin;C:\\Windows;C:\\L\\trama\\node");
  assert.equal(e.PATH, undefined);
  assert.equal(e.TRAMA_LOCAL, "1");
  assert.equal(e.HILOS_MOTOR, "1");
  assert.equal(e.TRAMA_UNIDAD, "1");
  assert.equal(e.TRAMA_APP, "C:\\L\\trama\\app");
  assert.equal(e.USERNAME, "ana");
});

test("el entorno del motor: si el sistema ya tiene node, el de Trama no entra al PATH de los hijos (no le gana ni lo bloquea)", () => {
  const r = n.rutasNativas({ LOCALAPPDATA: "C:\\L", USERPROFILE: "C:\\U" });
  const hay = new Set(["C:\\Program Files\\nodejs\\node.exe", "C:\\L\\trama\\node\\node.exe"]);
  const e = n.entornoMotor({ Path: 'C:\\Windows;"C:\\Program Files\\nodejs";C:\\L\\trama\\node' }, r, (f) => hay.has(f));
  assert.equal(e.Path, 'C:\\L\\trama\\bin;C:\\Windows;"C:\\Program Files\\nodejs";C:\\L\\trama\\node', "el del sistema queda antes que el de Trama; no se agrega otra copia adelante");
  assert.ok(!e.Path.startsWith("C:\\L\\trama\\node"));
  // El único node que hay es el propio (ya estaba en el PATH del usuario): cuenta como "sin node del sistema".
  const solo = n.entornoMotor({ Path: "C:\\Windows" }, r, (f) => f === "C:\\L\\trama\\node\\node.exe");
  assert.equal(solo.Path, "C:\\L\\trama\\bin;C:\\Windows;C:\\L\\trama\\node");
});

test("respuestaRpc: 200 con ok, 401 (atiende aunque falte el token), y lo demás es falla", () => {
  assert.deepEqual(n.respuestaRpc(200, '{"ok":true,"valor":{}}'), { ok: true });
  assert.deepEqual(n.respuestaRpc(401, "401"), { ok: true, sinToken: true });
  assert.equal(n.respuestaRpc(200, '{"ok":false,"error":"x"}').ok, false);
  assert.equal(n.respuestaRpc(200, "no json").ok, false);
  assert.equal(n.respuestaRpc(500, "").ok, false);
  assert.equal(n.respuestaRpc(403, "").ok, false);
});

test("chequearRpc manda POST /rpc maquina:saludo con Origin, cliente y la cookie del token", async () => {
  const vistos = [];
  const s = http.createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (b) => (cuerpo += b));
    req.on("end", () => {
      vistos.push({ metodo: req.method, ruta: req.url, h: req.headers, cuerpo: JSON.parse(cuerpo) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true,"valor":{"version":1}}');
    });
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const puerto = s.address().port;
  try {
    assert.deepEqual(await n.chequearRpc({ puerto, token: () => "ab".repeat(16) })(), { ok: true });
    const v = vistos[0];
    assert.equal(v.metodo, "POST");
    assert.equal(v.ruta, "/rpc");
    assert.deepEqual(v.cuerpo, { canal: "maquina:saludo", args: [] });
    assert.equal(v.h.origin, `http://127.0.0.1:${puerto}`);
    assert.equal(v.h.host, `127.0.0.1:${puerto}`);
    assert.match(v.h["x-trama-cliente"], /^[0-9a-f]{16}$/);
    assert.equal(v.h.cookie, `trama=${"ab".repeat(16)}`);
  } finally {
    s.close();
  }
  assert.deepEqual(await n.chequearRpc({ puerto })(), { ok: false, motivo: "no escucha" });
});

test("leerToken sólo acepta un token hex (lo que deja token.ts)", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trama-token-"));
  try {
    const f = path.join(dir, "token");
    assert.equal(n.leerToken(f), null);
    fs.writeFileSync(f, `${"0f".repeat(32)}\n`);
    assert.equal(n.leerToken(f), "0f".repeat(32));
    fs.writeFileSync(f, "no; es un token");
    assert.equal(n.leerToken(f), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- el supervisor con un reloj y un motor de mentira ----------
function banco({ contesta = () => false, ahora0 = 0 } = {}) {
  const t = { ahora: ahora0, timers: [], sec: 0 };
  const reloj = {
    setTimeout: (f, ms) => {
      const id = ++t.sec;
      t.timers.push({ id, cuando: t.ahora + ms, f });
      return id;
    },
    clearTimeout: (id) => (t.timers = t.timers.filter((x) => x.id !== id)),
  };
  const b = { lanzados: [], matados: [], logs: [], contesta };
  b.lanzar = () => {
    const h = { pid: 100 + b.lanzados.length, cbs: [], salir: (c) => h.cbs.splice(0).forEach((cb) => cb(c)) };
    h.alSalir = (cb) => h.cbs.push(cb);
    b.lanzados.push(h);
    return h;
  };
  b.sup = n.crearSupervisor({
    lanzar: b.lanzar,
    chequear: async () => ({ ok: !!b.contesta(), motivo: "no escucha" }),
    matar: async (pid) => {
      b.matados.push(pid);
      const h = b.lanzados.find((x) => x.pid === pid);
      setImmediate(() => h?.salir(1));
    },
    log: (m) => b.logs.push(m),
    intervaloMs: 1000,
    graciaMs: 5000,
    fallasMax: 3,
    ahora: () => t.ahora,
    reloj,
  });
  // Avanza el reloj de mentira corriendo los timers vencidos (y dejando correr las promesas entre medio).
  b.pasar = async (ms) => {
    const fin = t.ahora + ms;
    for (;;) {
      await new Promise((r) => setImmediate(r));
      t.timers.sort((x, y) => x.cuando - y.cuando);
      const prox = t.timers[0];
      if (!prox || prox.cuando > fin) break;
      t.timers.shift();
      t.ahora = prox.cuando;
      prox.f();
    }
    t.ahora = fin;
    await new Promise((r) => setImmediate(r));
  };
  return b;
}

test("supervisor: lanza el motor, queda vivo cuando contesta y esperarVivo lo avisa", async () => {
  let vivo = false;
  const b = banco({ contesta: () => vivo });
  await b.sup.iniciar();
  assert.equal(b.lanzados.length, 1);
  assert.equal(b.sup.estado().fase, "arrancando");
  const espera = b.sup.esperarVivo(10000);
  vivo = true;
  await b.pasar(1000);
  assert.equal(await espera, true);
  assert.deepEqual(b.sup.estado(), { fase: "vivo", pid: 100, caidas: 0, ultimo: null });
});

test("supervisor: si ya hay un motor que contesta no lanza otro (lo adopta)", async () => {
  const b = banco({ contesta: () => true });
  await b.sup.iniciar();
  assert.equal(b.lanzados.length, 0);
  assert.equal(b.sup.estado().fase, "adoptado");
  assert.equal(await b.sup.esperarVivo(10), true);
});

test("supervisor: si el motor se cae lo relanza, esperando 1 s, 2 s, 4 s… entre caídas seguidas", async () => {
  const b = banco();
  await b.sup.iniciar();
  b.lanzados[0].salir(1);
  assert.equal(b.sup.estado().fase, "caido");
  await b.pasar(999);
  assert.equal(b.lanzados.length, 1);
  await b.pasar(1);
  assert.equal(b.lanzados.length, 2);
  b.lanzados[1].salir(1);
  await b.pasar(1999);
  assert.equal(b.lanzados.length, 2);
  await b.pasar(1);
  assert.equal(b.lanzados.length, 3);
  assert.equal(b.sup.estado().caidas, 2);
});

test("supervisor: salir con 3 (ya hay otro motor en el socket) no es una caída: adopta al otro", async () => {
  let otro = false;
  const b = banco({ contesta: () => otro });
  await b.sup.iniciar();
  otro = true;
  b.lanzados[0].salir(n.SALIDA_YA_HAY_OTRO);
  assert.equal(b.sup.estado().fase, "adoptado");
  await b.pasar(5000);
  assert.equal(b.lanzados.length, 1);
});

test("supervisor: colgado (no contesta 3 veces pasada la gracia) se lo mata y se relanza", async () => {
  let vivo = false;
  const c = banco({ contesta: () => vivo });
  await c.sup.iniciar();
  vivo = true;
  await c.pasar(1000);
  assert.equal(c.sup.estado().fase, "vivo");
  vivo = false;
  // Dentro de la gracia (5 s desde que se lanzó) no se cuenta.
  await c.pasar(3000);
  assert.deepEqual(c.matados, []);
  await c.pasar(3000);
  assert.deepEqual(c.matados, [100]);
  await c.pasar(1000);
  assert.equal(c.lanzados.length, 2, "relanzado tras matarlo");
});

test("supervisor: un motor adoptado que deja de contestar se reemplaza por uno propio", async () => {
  let vivo = true;
  const b = banco({ contesta: () => vivo });
  await b.sup.iniciar();
  vivo = false;
  await b.pasar(2000);
  assert.equal(b.lanzados.length, 0);
  await b.pasar(1000);
  assert.equal(b.lanzados.length, 1);
  assert.equal(b.sup.estado().fase, "arrancando");
});

test("supervisor: parar mata al motor, no lo relanza, y se puede iniciar de nuevo enseguida", async () => {
  const b = banco();
  await b.sup.iniciar();
  const espera = b.sup.esperarVivo(10000);
  await b.sup.parar();
  assert.equal(await espera, false);
  assert.deepEqual(b.matados, [100]);
  assert.equal(b.sup.estado().fase, "parado");
  await b.pasar(60000);
  assert.equal(b.lanzados.length, 1);
  await b.sup.iniciar();
  assert.equal(b.lanzados.length, 2);
});

test("el actualizador del instalador nativo usa el canal «nativo» sin permitir bajar de versión", () => {
  const { crearActualizador } = require("../src/actualizar");
  const au = { on() {}, checkForUpdates: async () => {} };
  crearActualizador({ autoUpdater: au, onEstado() {}, canal: "nativo" });
  assert.equal(au.channel, "nativo");
  assert.equal(au.allowDowngrade, false);
  const wsl = { on() {}, checkForUpdates: async () => {} };
  crearActualizador({ autoUpdater: wsl, onEstado() {} });
  assert.equal(wsl.channel, undefined);
});
