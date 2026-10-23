"use strict";
// La carcasa: una ventana que muestra Trama (http://localhost:8791, el motor que corre en WSL2).
// Si el motor no está, el asistente de primer arranque (src/ui/) deja todo listo y sólo entonces
// carga la página. La lógica de los pasos vive en pasos.js; acá sólo se conecta con Windows.

const { app, BrowserWindow, ipcMain, shell, Menu } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { crearAsistente, ErrorPaso, DISTRO, MOTOR_URL, PASOS } = require("./pasos");
const wslReal = require("./wsl");
const { iniciarActualizador } = require("./actualizar");

// TRAMA_CAPTURA=<png> (sólo para la prueba de arranque sin Windows): offscreen, foto a los 4 s y sale.
const CAPTURA = process.env.TRAMA_CAPTURA || "";

const COLOR_FONDO = "#0a0a0a";
const ENLACES_OK = new Set(["https://ollama.com/download", "https://ollama.com"]);

if (!app.requestSingleInstanceLock()) app.quit();

let ventana = null;
let enMotor = false;
let ocupado = null;
let ultimaActualizacion = null;
let ultimaEspera = null;

const carpetaEstado = () => app.getPath("userData");
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

function cargarMotor(url) {
  enMotor = true;
  vivo.iniciar();
  return ventana.loadURL(url).catch((e) => {
    log(`no pude cargar ${url}: ${e.message}`);
    return mostrarAsistente();
  });
}

// Windows no deja a una app robar el foco; subirla un instante «siempre encima» sí la trae al frente.
// Sirve cuando «Welcome to WSL» o «Welcome to Ollama» (de Windows y de Ollama, no nuestras) la taparon.
function traerAlFrente() {
  if (!ventana || ventana.isDestroyed() || enMotor) return;
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

const actualizador = { instalar() {} };

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
ipcMain.handle("asistente:conectar", (_e, proveedor) => asistente.conectar(proveedor).then(() => ({}), (e) => ({ error: e.message })));
ipcMain.handle("asistente:saltarLogin", (_e, proveedor) => void asistente.saltarLogin(proveedor));
ipcMain.handle("asistente:saltarOllama", () => void asistente.saltarOllama());
ipcMain.handle("asistente:espejo", () => asistente.habilitarEspejo().then((r) => r, (e) => ({ error: e.message })));
ipcMain.handle("app:abrir", (_e, url) => (ENLACES_OK.has(url) ? shell.openExternal(url) : undefined));
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("actualizar:estado", () => ultimaActualizacion);
ipcMain.handle("actualizar:instalar", () => actualizador.instalar());

app.on("second-instance", () => {
  if (!ventana) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.focus();
});
app.on("before-quit", () => vivo.parar());
app.on("window-all-closed", () => app.quit());

app.whenReady().then(() => {
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
  setTimeout(() => u.buscar(), 4000);
});
