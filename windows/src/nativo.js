"use strict";
// Trama nativo de Windows (sin WSL ni bash), del lado de la carcasa: dónde va cada cosa, el PATH del usuario, la clave Run
// y el supervisor del motor. En Windows no hay systemd: la carcasa arranca con la sesión (clave Run, en segundo plano, sin
// ventana) y tiene al motor (`node.exe dist-electron\motor.js`) de hijo; lo chequea por POST /rpc y lo relanza si se cae o
// se cuelga. Lo puro (rutas, PATH, el supervisor con lanzar/chequear/matar inyectados) lo prueba tests/nativo.test.js; lo que
// toca Windows de verdad (PowerShell, taskkill, el proceso del motor) va abajo, aparte, como en wsl.js.

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PUERTO = 8791;
const MOTOR_URL_NATIVO = `http://localhost:${PUERTO}`;
const CLAVE_RUN = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALOR_RUN = "Trama";
// Con esto en la línea de comandos la carcasa arranca sin ventana: sólo supervisa al motor (ver main.js).
const SEGUNDO_PLANO = "--segundo-plano";
// El motor sale con 3 si ya hay otro escuchando en el socket (motor.ts): no es una caída, es que ya hay uno.
const SALIDA_YA_HAY_OTRO = 3;

// Las mismas rutas que app/electron/rutas.ts da en win32 (raizWindows, carpetaApp, configTrama, estadoHilos, nodeWindows).
function rutasNativas(env = process.env) {
  const w = path.win32;
  const home = env.USERPROFILE || env.HOME || "";
  const raiz = w.join(env.LOCALAPPDATA || w.join(home, "AppData", "Local"), "trama");
  const app = w.join(raiz, "app");
  return {
    home,
    raiz,
    app,
    node: w.join(raiz, "node", "node.exe"),
    bin: w.join(raiz, "bin"),
    motor: w.join(app, "dist-electron", "motor.js"),
    cli: (nombre) => w.join(app, "dist-electron", "cli", `${nombre}.js`),
    // La huella del payload instalado (la `.version` del payload que se copió); vive en app\, así se va con ella.
    marca: w.join(app, ".payload-version"),
    token: w.join(raiz, "config", "token"),
    dueno: w.join(raiz, "estado", "hilos", "dueno"),
    logMotor: w.join(raiz, "estado", "motor.log"),
  };
}

// ---------- PATH del usuario ----------
// Una entrada del PATH comparada sin comillas, sin barra final y sin mayúsculas (Windows no las distingue).
const normalizarEntrada = (s) => String(s).trim().replace(/^"(.*)"$/, "$1").replace(/[\\/]+$/, "").toLowerCase();
const partesPath = (texto) => String(texto || "").split(";").filter((p) => p.trim() !== "");

/** El PATH con `carpeta` al final, o null si ya estaba (cruda o con sus %VARIABLES% expandidas). */
function agregarAlPath(actual, carpeta, expandir = (s) => s) {
  const buscada = normalizarEntrada(carpeta);
  const partes = partesPath(actual);
  if (partes.some((p) => normalizarEntrada(p) === buscada || normalizarEntrada(expandir(p)) === buscada)) return null;
  return [...partes, carpeta].join(";");
}

/** El PATH sin `carpeta` (todas las veces que esté), o null si no estaba. */
function quitarDelPath(actual, carpeta, expandir = (s) => s) {
  const buscada = normalizarEntrada(carpeta);
  const partes = partesPath(actual);
  const quedan = partes.filter((p) => normalizarEntrada(p) !== buscada && normalizarEntrada(expandir(p)) !== buscada);
  return quedan.length === partes.length ? null : quedan.join(";");
}

/** El valor de la clave Run: la carcasa en segundo plano. */
const comandoArranque = (exe) => `"${exe}" ${SEGUNDO_PLANO}`;

// ---------- el motor como hijo ----------
/** El entorno del motor: lo mismo que `trama-motor run` en Linux, con el node.exe y bin\ propios primero en el PATH. */
function entornoMotor(env, rutas) {
  const e = { ...env };
  // En Windows las variables no distinguen mayúsculas: se conserva el nombre que ya traía el PATH.
  const clave = Object.keys(e).find((k) => k.toLowerCase() === "path") || "Path";
  e[clave] = [path.win32.dirname(rutas.node), rutas.bin, e[clave]].filter(Boolean).join(";");
  return { ...e, HILOS_MOTOR: "1", TRAMA_UNIDAD: "1", TRAMA_LOCAL: "1", TRAMA_APP: rutas.app };
}

/**
 * Supervisa al motor: lo lanza, lo chequea cada `intervaloMs` y lo relanza (con espera creciente) si se cae; si responde mal
 * `fallasMax` veces seguidas pasada la `graciaMs` del arranque, lo da por colgado y lo mata (el relanzo sale de su salida).
 * Si al arrancar ya hay un motor que contesta (otra carcasa, o uno que quedó de antes), no se lanza otro: se lo adopta y se
 * lo mira igual; si ése deja de contestar, se lanza uno propio.
 *   lanzar()        → {pid, alSalir(cb(codigo))}
 *   chequear()      → Promise<{ok: boolean, motivo?: string}>
 *   matar(pid)      → Promise (el árbol entero)
 * Fases: parado · arrancando · vivo · adoptado · caido (esperando para relanzar)
 */
function crearSupervisor(deps) {
  const {
    lanzar,
    chequear,
    matar,
    log = () => {},
    intervaloMs = 5000,
    fallasMax = 3,
    graciaMs = 30000,
    esperaMaxMs = 60000,
    ahora = () => Date.now(),
    reloj = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) },
  } = deps;

  let fase = "parado";
  let hijo = null;
  let lanzadoEn = 0;
  let fallas = 0;
  let caidas = 0;
  let ultimo = null;
  let sondeo = null;
  let relanzo = null;
  let parando = false;
  let enChequeo = false;
  const esperando = new Set();

  const avisarVivo = () => {
    for (const r of esperando) r(true);
    esperando.clear();
  };
  const programarSondeo = () => {
    reloj.clearTimeout(sondeo);
    sondeo = parando ? null : reloj.setTimeout(() => void mirar(), intervaloMs);
  };

  function arrancarHijo() {
    reloj.clearTimeout(relanzo);
    relanzo = null;
    fase = "arrancando";
    fallas = 0;
    lanzadoEn = ahora();
    let h;
    try {
      h = lanzar();
    } catch (e) {
      ultimo = `no pude lanzar el motor: ${e.message}`;
      log(ultimo);
      return programarRelanzo();
    }
    hijo = h;
    log(`motor lanzado (pid ${h.pid})`);
    h.alSalir((codigo) => {
      if (hijo !== h) return;
      hijo = null;
      if (parando) {
        fase = "parado";
        return;
      }
      if (codigo === SALIDA_YA_HAY_OTRO) {
        // Otro motor tiene el socket: se lo mira a él.
        log("el motor salió porque ya hay otro andando: se lo adopta");
        fase = "adoptado";
        fallas = 0;
        return programarSondeo();
      }
      ultimo = `el motor salió con ${codigo}`;
      log(ultimo);
      programarRelanzo();
    });
    programarSondeo();
  }

  function programarRelanzo() {
    fase = "caido";
    caidas++;
    // 1 s, 2 s, 4 s… hasta `esperaMaxMs`; un motor que anduvo un rato (llegó a vivo) vuelve a empezar de 1 s.
    const ms = Math.min(esperaMaxMs, 1000 * 2 ** Math.min(caidas - 1, 16));
    reloj.clearTimeout(relanzo);
    relanzo = reloj.setTimeout(() => {
      relanzo = null;
      if (!parando) arrancarHijo();
    }, ms);
  }

  async function mirar() {
    if (parando || enChequeo) return;
    enChequeo = true;
    let r;
    try {
      r = await chequear();
    } catch (e) {
      r = { ok: false, motivo: e.message };
    } finally {
      enChequeo = false;
    }
    if (parando) return;
    if (r.ok) {
      if (fase === "arrancando") log("el motor contesta");
      if (fase !== "adoptado") fase = hijo ? "vivo" : "adoptado";
      fallas = 0;
      caidas = 0;
      avisarVivo();
      return programarSondeo();
    }
    ultimo = r.motivo || "no contesta";
    if (fase === "adoptado") {
      if (++fallas >= fallasMax) {
        log(`el motor adoptado dejó de contestar (${ultimo}): se lanza uno propio`);
        return arrancarHijo();
      }
    } else if (hijo && ahora() - lanzadoEn >= graciaMs) {
      if (++fallas >= fallasMax) {
        log(`el motor no contesta hace ${fallas} chequeos (${ultimo}): lo mato para relanzarlo`);
        fallas = 0;
        const pid = hijo.pid;
        await Promise.resolve(matar(pid)).catch((e) => log(`no pude matar al motor ${pid}: ${e.message}`));
      }
    }
    programarSondeo();
  }

  async function iniciar() {
    if (fase !== "parado") return;
    parando = false;
    fase = "arrancando";
    const r = await Promise.resolve(chequear()).catch(() => ({ ok: false }));
    if (parando) return;
    if (r.ok) {
      log("ya hay un motor que contesta: se lo adopta");
      fase = "adoptado";
      avisarVivo();
      return programarSondeo();
    }
    arrancarHijo();
  }

  async function parar() {
    parando = true;
    reloj.clearTimeout(sondeo);
    reloj.clearTimeout(relanzo);
    sondeo = relanzo = null;
    for (const r of esperando) r(false);
    esperando.clear();
    const h = hijo;
    // Se suelta ya (su salida, que llega después, no relanza nada): así un `iniciar()` enseguida, tras una actualización, lanza otro.
    hijo = null;
    if (h) await Promise.resolve(matar(h.pid)).catch((e) => log(`no pude parar al motor ${h.pid}: ${e.message}`));
    fase = "parado";
  }

  /** true apenas el motor contesta (o ya contestaba); false si se agota `ms` o se para. */
  function esperarVivo(ms = 60000) {
    if (fase === "vivo" || fase === "adoptado") return Promise.resolve(true);
    return new Promise((resolver) => {
      const t = reloj.setTimeout(() => {
        esperando.delete(listo);
        resolver(false);
      }, ms);
      const listo = (v) => {
        reloj.clearTimeout(t);
        resolver(v);
      };
      esperando.add(listo);
    });
  }

  const estado = () => ({ fase, pid: hijo?.pid ?? null, caidas, ultimo });
  return { iniciar, parar, esperarVivo, estado, mirar };
}

// ---------- lo que toca Windows de verdad ----------

/** POST /rpc `maquina:saludo` con el token de la instalación: el motor contesta solo si su event loop anda. */
function chequearRpc({ puerto = PUERTO, token = () => null, timeoutMs = 5000 } = {}) {
  const cliente = crypto.randomBytes(8).toString("hex");
  return () =>
    new Promise((resolver) => {
      const cuerpo = JSON.stringify({ canal: "maquina:saludo", args: [] });
      const t = token();
      const req = http.request(
        {
          host: "127.0.0.1",
          port: puerto,
          path: "/rpc",
          method: "POST",
          timeout: timeoutMs,
          headers: {
            host: `127.0.0.1:${puerto}`,
            origin: `http://127.0.0.1:${puerto}`,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(cuerpo),
            "x-trama-cliente": cliente,
            ...(t ? { cookie: `trama=${t}` } : {}),
          },
        },
        (res) => {
          const partes = [];
          res.on("data", (b) => partes.push(b));
          res.on("end", () => resolver(respuestaRpc(res.statusCode, Buffer.concat(partes).toString("utf8"))));
          res.on("error", (e) => resolver({ ok: false, motivo: e.message }));
        },
      );
      req.on("timeout", () => req.destroy(new Error("no contestó a tiempo")));
      req.on("error", (e) => resolver({ ok: false, motivo: e.code === "ECONNREFUSED" ? "no escucha" : e.message }));
      req.end(cuerpo);
    });
}

/** Cómo leer lo que contestó /rpc. Un 401 (token que no coincide) igual prueba que el motor atiende. */
function respuestaRpc(codigo, texto) {
  if (codigo === 401) return { ok: true, sinToken: true };
  if (codigo !== 200) return { ok: false, motivo: `/rpc contestó ${codigo}` };
  try {
    const j = JSON.parse(texto);
    return j && j.ok === true ? { ok: true } : { ok: false, motivo: `/rpc: ${j?.error || "respuesta sin ok"}` };
  } catch {
    return { ok: false, motivo: "/rpc contestó algo que no es JSON" };
  }
}

function leerToken(ruta) {
  try {
    const t = fs.readFileSync(ruta, "utf8").trim();
    return /^[0-9a-f]{16,}$/i.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Lanza `node.exe motor.js` sin consola, con la salida a `motor.log`. */
function lanzarMotor(rutas, env = process.env) {
  return () => {
    fs.mkdirSync(path.dirname(rutas.logMotor), { recursive: true });
    const fd = fs.openSync(rutas.logMotor, "a");
    let p;
    try {
      p = spawn(rutas.node, [rutas.motor], { cwd: rutas.app, env: entornoMotor(env, rutas), windowsHide: true, stdio: ["ignore", fd, fd] });
    } finally {
      fs.closeSync(fd);
    }
    let salio = null;
    const cbs = [];
    const fin = (c) => {
      if (salio !== null) return;
      salio = c ?? -1;
      for (const cb of cbs) cb(salio);
    };
    p.on("exit", (c) => fin(c));
    p.on("error", () => fin(-1));
    return { pid: p.pid, alSalir: (cb) => (salio !== null ? cb(salio) : cbs.push(cb)) };
  };
}

function correr(exe, args, { env, input, timeoutMs = 60000 } = {}) {
  return new Promise((resolver) => {
    let p;
    try {
      p = spawn(exe, args, { windowsHide: true, env: env || process.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return resolver({ code: -1, stdout: "", stderr: String(e) });
    }
    const out = [];
    const err = [];
    const reloj = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on("data", (b) => out.push(b));
    p.stderr.on("data", (b) => err.push(b));
    p.on("error", (e) => {
      clearTimeout(reloj);
      resolver({ code: -1, stdout: "", stderr: String(e) });
    });
    p.on("close", (code) => {
      clearTimeout(reloj);
      resolver({ code: code ?? -1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    p.stdin.on("error", () => {});
    p.stdin.end(input ?? "");
  });
}

/** `taskkill /T /F`: el motor y todo lo que lanzó (líderes, workers). */
const matarArbol = (pid) => correr("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { timeoutMs: 20000 });

// PowerShell con los datos por variables de entorno (nada de armar comillas): leer y escribir HKCU sin reg.exe, que corta
// los valores con una barra final antes de la comilla.
const ps = (script, env = {}) => correr("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, ...env } });

const PS_LEER_PATH = `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
if ($k -eq $null) { exit 0 }
$v = $k.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
[Console]::Out.Write($v)`;
// Se escribe como REG_EXPAND_SZ (el tipo de siempre del PATH de usuario) y se borra una variable que no existe: eso le avisa
// a Windows (WM_SETTINGCHANGE) que el entorno cambió, así las consolas nuevas ya ven el PATH sin cerrar sesión.
const PS_ESCRIBIR_PATH = `$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
$k.SetValue('Path', $env:TRAMA_VALOR, [Microsoft.Win32.RegistryValueKind]::ExpandString)
$k.Close()
[Environment]::SetEnvironmentVariable('TRAMA_AVISO_PATH', $null, 'User')`;
const PS_LEER_RUN = `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Run')
if ($k -ne $null) { [Console]::Out.Write($k.GetValue($env:TRAMA_NOMBRE, '')) }`;
const PS_ESCRIBIR_RUN = `$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Run')
$k.SetValue($env:TRAMA_NOMBRE, $env:TRAMA_VALOR, [Microsoft.Win32.RegistryValueKind]::String)
$k.Close()`;
const PS_QUITAR_RUN = `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Run', $true)
if ($k -ne $null) { $k.DeleteValue($env:TRAMA_NOMBRE, $false); $k.Close() }`;

function falla(r, que) {
  if (r.code !== 0) throw Object.assign(new Error(`No pude ${que}.`), { detalle: String(r.stderr || r.stdout).trim().slice(-600) });
  return r;
}

const expandirCon = (env) => (s) => String(s).replace(/%([^%]+)%/g, (m, n) => env[Object.keys(env).find((k) => k.toLowerCase() === n.toLowerCase()) || ""] ?? m);

/** El PATH de usuario (HKCU\Environment): leer, sumar y quitar la carpeta bin de Trama. */
function pathUsuario(env = process.env) {
  const expandir = expandirCon(env);
  const leer = async () => falla(await ps(PS_LEER_PATH), "leer el PATH de tu usuario").stdout;
  return {
    async tiene(carpeta) {
      return agregarAlPath(await leer(), carpeta, expandir) === null;
    },
    async agregar(carpeta) {
      const nuevo = agregarAlPath(await leer(), carpeta, expandir);
      if (nuevo === null) return false;
      falla(await ps(PS_ESCRIBIR_PATH, { TRAMA_VALOR: nuevo }), "agregar Trama al PATH de tu usuario");
      return true;
    },
    async quitar(carpeta) {
      const nuevo = quitarDelPath(await leer(), carpeta, expandir);
      if (nuevo === null) return false;
      falla(await ps(PS_ESCRIBIR_PATH, { TRAMA_VALOR: nuevo }), "quitar Trama del PATH de tu usuario");
      return true;
    },
  };
}

/** La clave Run de HKCU (arrancar con la sesión, sin administrador). */
function arranqueSesion(nombre = VALOR_RUN) {
  return {
    async leer() {
      return falla(await ps(PS_LEER_RUN, { TRAMA_NOMBRE: nombre }), "leer el arranque de Windows").stdout.trim() || null;
    },
    async registrar(comando) {
      falla(await ps(PS_ESCRIBIR_RUN, { TRAMA_NOMBRE: nombre, TRAMA_VALOR: comando }), "registrar Trama en el arranque de Windows");
    },
    async quitar() {
      falla(await ps(PS_QUITAR_RUN, { TRAMA_NOMBRE: nombre }), "quitar Trama del arranque de Windows");
    },
  };
}

/** `node.exe <cli>.js args…` con el node propio: las herramientas del motor (trama-estado, instalar-nativo). */
function correrCli(rutas, env = process.env) {
  return (nombre, args = [], o = {}) => correr(rutas.node, [rutas.cli(nombre), ...args], { env: entornoMotor(env, rutas), timeoutMs: o.timeoutMs ?? 60000 });
}

/** Abre una consola de Windows (cmd) con un programa, para iniciar sesión en claude o agy. */
function abrirConsolaNativa(rutas, env = process.env) {
  return async (programa) => {
    // `start ""` (el título va vacío y entre comillas, si no lo toma como programa) abre una ventana nueva; `cmd /k` la deja
    // abierta si el programa sale con error.
    const p = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", programa], { env: entornoMotor(env, rutas), detached: true, stdio: "ignore", windowsHide: false });
    p.on("error", () => {});
    p.unref();
  };
}

module.exports = {
  PUERTO,
  MOTOR_URL_NATIVO,
  CLAVE_RUN,
  VALOR_RUN,
  SEGUNDO_PLANO,
  SALIDA_YA_HAY_OTRO,
  rutasNativas,
  agregarAlPath,
  quitarDelPath,
  comandoArranque,
  entornoMotor,
  crearSupervisor,
  chequearRpc,
  respuestaRpc,
  leerToken,
  lanzarMotor,
  matarArbol,
  pathUsuario,
  arranqueSesion,
  correrCli,
  abrirConsolaNativa,
  expandirCon,
};
