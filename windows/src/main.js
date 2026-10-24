"use strict";
// La carcasa: una ventana que muestra Trama (http://localhost:8791, el motor que corre en WSL2).
// Si el motor no está, el asistente de primer arranque (src/ui/) deja todo listo y sólo entonces
// carga la página. La lógica de los pasos vive en pasos.js; acá sólo se conecta con Windows.

const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { crearAsistente, ErrorPaso, DISTRO, MOTOR_URL, PASOS } = require("./pasos");
const wslReal = require("./wsl");
const { crearGuardiaFoco } = require("./foco");
const { iniciarActualizador } = require("./actualizar");
const { crearLimpieza } = require("./limpieza");

// TRAMA_CAPTURA=<png> (sólo para la prueba de arranque sin Windows): offscreen, foto a los 4 s y sale.
const CAPTURA = process.env.TRAMA_CAPTURA || "";

const COLOR_FONDO = "#0a0a0a";
const ENLACES_OK = new Set(["https://ollama.com/download", "https://ollama.com"]);

// El desinstalador de Windows (build/installer.nsh) nos llama con --desinstalar: quita lo que Trama dejó fuera de su
// carpeta, sin ventana y sin candado de instancia única. Su userData va a una carpeta temporal para no recrear ni
// trabar %APPDATA%\Trama, que es justo una de las cosas que se pregunta si borrar.
const DESINSTALAR = process.argv.includes("--desinstalar");
// La carpeta de verdad (antes de moverla): ahí viven estado.json y carcasa.log.
const USERDATA = app.getPath("userData");
if (DESINSTALAR) app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "trama-desinstalar-")));
else if (!app.requestSingleInstanceLock()) app.quit();

let ventana = null;
let enMotor = false;
let ocupado = null;
let ultimaActualizacion = null;
let ultimaEspera = null;

const carpetaEstado = () => USERDATA;
const rutaLog = () => path.join(carpetaEstado(), "carcasa.log");
function log(m) {
  try {
    fs.mkdirSync(carpetaEstado(), { recursive: true });
    fs.appendFileSync(rutaLog(), `${new Date().toISOString()} ${m}\n`);
  } catch {}
}

const store = {
  cargar() {
    try {
      return JSON.parse(fs.readFileSync(path.join(carpetaEstado(), "estado.json"), "utf8"));
    } catch {
      return {};
    }
  },
  guardar(o) {
    fs.mkdirSync(carpetaEstado(), { recursive: true });
    fs.writeFileSync(path.join(carpetaEstado(), "estado.json"), JSON.stringify(o, null, 2));
  },
};

// El árbol que trae el instalador (motor/ + app/); en desarrollo, windows/payload/.
const dirPayload = () => (app.isPackaged ? path.join(process.resourcesPath, "payload") : path.join(__dirname, "..", "payload"));
function versionPayload() {
  try {
    return fs.readFileSync(path.join(dirPayload(), ".version"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

const wslconfig = {
  ruta: () => path.join(process.env.USERPROFILE || os.homedir(), ".wslconfig"),
  leer() {
    try {
      return fs.readFileSync(this.ruta(), "utf8");
    } catch {
      return null;
    }
  },
  escribir(t) {
    fs.writeFileSync(this.ruta(), t);
  },
};

const vivo = wslReal.mantenerVivo(DISTRO);
const guardiaFoco = crearGuardiaFoco();

const limpieza = crearLimpieza({ wsl: wslReal.wsl, win: wslReal.entornoWindows(), estado: store, version: app.getVersion(), distro: DISTRO });

const asistente = crearAsistente({
  wsl: wslReal.wsl,
  elevarWsl: wslReal.elevarWsl,
  abrirConsola: wslReal.abrirConsola,
  fetch: (...a) => fetch(...a),
  estado: store,
  payload: { get dir() { return dirPayload(); }, get version() { return versionPayload(); } },
  wslconfig,
  // Tras el reinicio de Windows, que Trama se reabra sola (RunOnce) y siga donde quedó: los pasos se
  // calculan mirando el sistema, así que abrir el asistente basta.
  reabrir: process.platform === "win32" && app.isPackaged ? wslReal.reabrirTrasReinicio(process.execPath) : undefined,
  version: app.getVersion(),
  inicioSistema: () => Date.now() - os.uptime() * 1000,
  env: { USERNAME: process.env.USERNAME || os.userInfo().username },
});

function enviar(canal, dato) {
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send(canal, dato);
}

function mostrarAsistente() {
  enMotor = false;
  return ventana.loadFile(path.join(__dirname, "ui", "index.html"));
}

let limpiezaProgramada = false;
function cargarMotor(url) {
  enMotor = true;
  vivo.iniciar();
  // Una vez por arranque, con la ventana ya andando: lo que esta versión dejó de usar y es seguro de quitar solo.
  if (!limpiezaProgramada) {
    limpiezaProgramada = true;
    setTimeout(() => limpieza.despuesDeActualizar().then((r) => r.hecho && log(`limpieza tras actualizar: ${JSON.stringify(r)}`), (e) => log(`limpieza tras actualizar: ${e.message}`)), 20000).unref?.();
  }
  return ventana.loadURL(url).catch((e) => {
    log(`no pude cargar ${url}: ${e.message}`);
    return mostrarAsistente();
  });
}

// Windows no deja a una app robar el foco; subirla un instante «siempre encima» sí la trae al frente.
// Sirve cuando «Welcome to WSL» o «Welcome to Ollama» (de Windows y de Ollama, no nuestras) la taparon.
function traerAlFrente() {
  if (!ventana || ventana.isDestroyed() || enMotor || !guardiaFoco.puedeTraer()) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.setAlwaysOnTop(true);
  ventana.show();
  ventana.focus();
  ventana.setAlwaysOnTop(false);
}

// Un pedido a la vez: si la ventana pide dos veces, la segunda espera la misma respuesta.
function correrAsistente() {
  if (!ocupado) {
    vivo.iniciar();
    ocupado = asistente
      .avanzar((e) => {
        enviar("asistente:evento", e);
        if (e.tipo === "ok" && e.paso === "wsl") traerAlFrente();
      })
      .then(
        (r) => {
          if (r.listo) {
            cargarMotor(r.url);
            return { listo: true };
          }
          // Al llegar a algo que espera a la persona (o cambiar lo que se ve), el asistente pasa al frente;
          // el sondeo que repite lo mismo cada pocos segundos no vuelve a robar el foco.
          const marca = `${r.espera}:${r.info?.detectado ?? ""}`;
          if (marca !== ultimaEspera) traerAlFrente();
          ultimaEspera = marca;
          return r;
        },
        (e) => {
          traerAlFrente();
          log(`${e.paso || "?"}: ${e.message}\n${e.detalle || e.stack || ""}`);
          return { error: { paso: e.paso || null, mensaje: e instanceof ErrorPaso ? e.message : `Algo falló sin que lo esperara: ${e.message}`, detalle: e.detalle || "" } };
        },
      )
      .finally(() => {
        ocupado = null;
      });
  }
  return ocupado;
}

// El aviso de versión nueva dentro de la página de Trama: una pastilla chica abajo a la izquierda.
const AVISO_JS = (version) => `(() => {
  if (document.getElementById("trama-carcasa-aviso") || !window.carcasa) return;
  const d = document.createElement("div");
  d.id = "trama-carcasa-aviso";
  d.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;gap:10px;align-items:center;padding:6px 8px 6px 12px;background:#171717;color:#e5e5e5;border:1px solid #333;border-radius:999px;font:12px system-ui,sans-serif";
  const t = document.createElement("span"); t.textContent = ${JSON.stringify(`Trama ${version} está lista`)};
  const b = document.createElement("button"); b.textContent = "Reiniciar";
  b.style.cssText = "all:unset;cursor:pointer;padding:3px 10px;border-radius:999px;background:#fafafa;color:#0a0a0a;font-weight:500";
  b.onclick = () => window.carcasa.reiniciarParaActualizar();
  d.append(t, b); document.body.append(d);
})()`;

const actualizador = { instalar() {}, buscar: async () => {} };

// Los pedidos de la página (Ajustes) sólo valen si vienen del asistente o de la Trama de localhost.
const deConfianza = (e) => {
  const u = e?.senderFrame?.url || "";
  return u.startsWith("file:") || u.startsWith(MOTOR_URL);
};
const protegido = (fn) => (e, ...a) => (deConfianza(e) ? fn(...a) : Promise.reject(new Error("No autorizado")));
const textoError = (e) => ({ error: e instanceof Error ? e.message : String(e), detalle: e?.detalle || "" });

// ---- --desinstalar: lo único que hace este modo ----
async function desinstalar() {
  const lista = (items) => items.map((i) => `• ${i.que}`).join("\n");
  const preguntar = (opts) => dialog.showMessageBox({ type: "question", noLink: true, defaultId: 0, cancelId: 0, title: "Quitar Trama", ...opts });
  let plan;
  try {
    plan = await limpieza.planificar({ modo: "desinstalar" });
  } catch (e) {
    log(`desinstalar: ${e.message}\n${e.detalle || ""}`);
    return;
  }
  const quitar = plan.items.filter((i) => i.accion === "quitar");
  const ids = [];
  if (quitar.length) {
    const r = await preguntar({
      message: "Trama también instaló cosas fuera de su carpeta.",
      detail: `${lista(quitar)}\n\nNo se toca nada tuyo: ni tus proyectos, ni el tablero, ni las sesiones, ni tus cuentas de Claude y Gemini.`,
      buttons: ["Quitar todo eso", "Dejarlo"],
      cancelId: 1,
    });
    if (r.response === 0) ids.push(...quitar.map((i) => i.id));
  }
  const datos = plan.items.filter((i) => i.accion === "datos");
  const borrarDatos = [];
  if (datos.length) {
    const r = await preguntar({
      message: "¿Borrar también los datos de Trama en Windows?",
      detail: `${lista(datos)}\n\nSi pensás volver a instalarla, conservalos.`,
      buttons: ["Conservarlos", "Borrarlos"],
      cancelId: 0,
    });
    if (r.response === 1) borrarDatos.push(...datos.map((i) => i.id));
  }
  let confirmarDistro = null;
  if (plan.distro?.puede) {
    const r = await preguntar({
      type: "warning",
      message: `¿Quitar también ${plan.distro.nombre}?`,
      detail: `La instaló Trama y no encontré nada tuyo adentro, pero esto no se puede deshacer.\n\nSe pierde: ${plan.distro.pierde}\n\nSi la usás para otra cosa, dejala.`,
      buttons: [`Dejar ${plan.distro.nombre}`, `Quitar ${plan.distro.nombre} y todo lo de adentro`],
      cancelId: 0,
    });
    if (r.response === 1) {
      ids.push(plan.distro.id);
      confirmarDistro = plan.distro.nombre;
    }
  }
  if (ids.length || borrarDatos.length) {
    try {
      const { resultados } = await limpieza.ejecutar({ modo: "desinstalar", ids, datos: borrarDatos, confirmarDistro });
      log(`desinstalar: ${JSON.stringify(resultados)}`);
    } catch (e) {
      log(`desinstalar: ${e.message}\n${e.detalle || ""}`);
    }
  }
  const quedan = plan.items.filter((i) => i.accion === "queda");
  if (quedan.length || (plan.distro && !confirmarDistro)) {
    await dialog.showMessageBox({
      type: "info",
      noLink: true,
      title: "Quitar Trama",
      message: "Esto queda en tu máquina",
      detail: [
        ...(plan.distro && !confirmarDistro ? [`• ${plan.distro.nombre}${plan.distro.motivo ? `: ${plan.distro.motivo}` : " (la podés quitar con «wsl --unregister» si ya no la querés)"}`] : []),
        ...quedan.map((i) => `• ${i.que}`),
      ].join("\n"),
    });
  }
}

function arrancar() {
  Menu.setApplicationMenu(null);
  ventana = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: COLOR_FONDO,
    title: "Trama",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: !!CAPTURA },
  });
  ventana.once("ready-to-show", () => ventana.show());
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  ventana.webContents.on("will-navigate", (e, url) => {
    const propio = url.startsWith("file:") || url.startsWith(MOTOR_URL);
    if (!propio) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  ventana.webContents.on("did-fail-load", (_e, _c, desc, url, principal) => {
    if (principal && enMotor && url.startsWith(MOTOR_URL)) {
      log(`falló la carga de ${url}: ${desc}`);
      mostrarAsistente();
    }
  });
  ventana.webContents.on("did-finish-load", () => {
    if (enMotor && ultimaActualizacion?.fase === "lista") ventana.webContents.executeJavaScript(AVISO_JS(ultimaActualizacion.version)).catch(() => {});
  });
  ventana.on("focus", () => guardiaFoco.volvio());
  ventana.on("closed", () => (ventana = null));
  if (CAPTURA) {
    ventana.setContentSize(1180, 760);
    setTimeout(async () => {
      fs.writeFileSync(CAPTURA, (await ventana.webContents.capturePage()).toPNG());
      app.exit(0);
    }, 4000);
  }
  mostrarAsistente();
}

ipcMain.handle("asistente:pasos", () => PASOS);
ipcMain.handle("asistente:avanzar", () => correrAsistente());
ipcMain.handle("asistente:conectar", (_e, proveedor) => (guardiaFoco.consolaAbierta(), asistente.conectar(proveedor)).then(() => ({}), (e) => ({ error: e.message })));
ipcMain.handle("asistente:saltarLogin", (_e, proveedor) => void asistente.saltarLogin(proveedor));
ipcMain.handle("asistente:continuarLogin", () => asistente.continuarLogin().then(() => ({}), (e) => ({ error: e.message })));
ipcMain.handle("cuentas:estado", () => asistente.cuentas().then((c) => c, (e) => ({ error: e.message })));
ipcMain.handle("asistente:saltarOllama", () => void asistente.saltarOllama());
ipcMain.handle("asistente:espejo", () => asistente.habilitarEspejo().then((r) => r, (e) => ({ error: e.message })));
ipcMain.handle("app:abrir", (_e, url) => (ENLACES_OK.has(url) ? shell.openExternal(url) : undefined));
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("actualizar:estado", () => ultimaActualizacion);
ipcMain.handle("actualizar:instalar", () => actualizador.instalar());
ipcMain.handle("actualizar:buscar", protegido(() => actualizador.buscar()));
// Quitar restos de versiones anteriores (Ajustes > Acerca de): primero el plan, la persona confirma, después se quita.
ipcMain.handle("restos:plan", protegido(() => limpieza.planificar({ modo: "restos" }).catch(textoError)));
ipcMain.handle("restos:quitar", protegido((ids) => limpieza.ejecutar({ modo: "restos", ids: Array.isArray(ids) ? ids.map(String) : [] }).catch(textoError)));
ipcMain.handle("restos:quitarDistro", protegido((nombre) => limpieza.ejecutar({ modo: "restos", ids: ["wsl-distro"], confirmarDistro: String(nombre) }).catch(textoError)));

app.on("second-instance", () => {
  if (!ventana) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.focus();
});
app.on("before-quit", () => vivo.parar());
app.on("window-all-closed", () => app.quit());

app.whenReady().then(async () => {
  if (DESINSTALAR) {
    try {
      await desinstalar();
    } finally {
      app.exit(0);
    }
    return;
  }
  arrancar();
  const u = iniciarActualizador({
    app,
    recursos: process.resourcesPath,
    onEstado: (e) => {
      ultimaActualizacion = e;
      enviar("actualizar:cambio", e);
      if (enMotor && e.fase === "lista") ventana.webContents.executeJavaScript(AVISO_JS(e.version)).catch(() => {});
    },
    log,
  });
  actualizador.instalar = u.instalar;
  actualizador.buscar = u.buscar;
  setTimeout(() => u.buscar(), 4000);
});
