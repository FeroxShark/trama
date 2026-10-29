"use strict";
// La carcasa: una ventana que muestra Trama (http://localhost:8791, el motor). El motor corre en Windows, sin WSL ni bash: la
// carcasa lo supervisa como hijo (nativo.js) y queda en la bandeja al cerrar la ventana; arranca con la sesión por la clave Run
// (--segundo-plano: sin ventana). Si el motor no está, el asistente de primer arranque (src/ui/, pasos en pasos-nativo.js) deja
// todo listo y sólo entonces carga la página; acá sólo se conecta con Windows. Todo lo que la página le pide al main sale del
// contrato único de canales (app/electron/canales/contrato.ts, vía canales.json): ver ventana.js.

const { app, BrowserWindow, ipcMain, shell, Menu, Tray, dialog, clipboard, Notification, nativeImage, powerMonitor } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ErrorPaso, MOTOR_URL } = require("./pasos-comun");
const { entornoWindows } = require("./entorno-windows");
const { crearGuardiaFoco } = require("./foco");
const { iniciarActualizador } = require("./actualizar");
const { crearLimpieza } = require("./limpieza");
const { opcionesTitulo, overlayDesde } = require("./titulo");
const nativo = require("./nativo");
const { crearAsistenteNativo } = require("./pasos-nativo");
const { ENTRADAS_NATIVO } = require("./manifiesto-nativo");
const { crearCanalesVentana } = require("./ventana");

// TRAMA_CAPTURA=<png> (sólo para la prueba de arranque sin Windows): offscreen, foto a los 4 s y sale.
const CAPTURA = process.env.TRAMA_CAPTURA || "";

const COLOR_FONDO = "#0a0a0a";
const ENLACES_OK = new Set(["https://ollama.com/download", "https://ollama.com"]);
// Lo mismo que CHANGELOG de app/electron/actualizacion.ts (la página de Trama lo abre por "claude:changelog").
const CHANGELOG = "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md";
// Los textos del menú de la bandeja: la página los manda ya traducidos (bandeja:textos); esto es lo que hay hasta que llegan.
let textosBandeja = { abrir: "Abrir Trama", cerrar: "Salir (apaga el motor y los líderes)" };

// El desinstalador de Windows (build/installer.nsh) nos llama con --desinstalar: quita lo que Trama dejó fuera de su
// carpeta, sin ventana y sin candado de instancia única. Su userData va a una carpeta temporal para no recrear ni
// trabar %APPDATA%\Trama, que es justo una de las cosas que se pregunta si borrar.
const DESINSTALAR = process.argv.includes("--desinstalar");
// El AppUserModelId es el appId de electron-builder*.yml (con ése crea el instalador el atajo de Inicio): así la barra de
// tareas y las notificaciones son de Trama y no de Electron. Lo prueba tests/identidad.test.js.
app.setAppUserModelId("app.trama.windows");
// El árbol del Trama que trae el instalador (node.exe, app compilada, bin\*.cmd); en desarrollo, windows/payload-nativo/.
const dirPayloadNativo = () => (app.isPackaged ? path.join(process.resourcesPath, "payload-nativo") : path.join(__dirname, "..", "payload-nativo"));
// La carpeta de verdad (antes de moverla): ahí viven estado.json y carcasa.log. Es %APPDATA%\Trama-nativo y no la de siempre de
// Electron (%APPDATA%\Trama): esa es de la Trama vieja (su cuentas.json y sus cuentas, que `cuentas importar-perfiles` sólo lee y
// copia) y ni el asistente, ni Electron (cachés), ni el desinstalador tienen que pisarla.
const USERDATA = path.join(app.getPath("appData"), "Trama-nativo");
if (DESINSTALAR) app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "trama-desinstalar-")));
else {
  app.setPath("userData", USERDATA);
  if (!app.requestSingleInstanceLock()) app.quit();
}

const SEGUNDO_PLANO = process.argv.includes(nativo.SEGUNDO_PLANO);

let ventana = null;
let bandeja = null;
let saliendo = false;
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
function versionPayload(dir = dirPayload()) {
  try {
    return fs.readFileSync(path.join(dir, ".version"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

const guardiaFoco = crearGuardiaFoco();

const rutasNativas = nativo.rutasNativas();
const supervisor = nativo.crearSupervisor({
  lanzar: nativo.lanzarMotor(rutasNativas),
  chequear: nativo.chequearRpc({ token: () => nativo.leerToken(rutasNativas.token) }),
  matar: nativo.matarArbol,
  log: (m) => log(`motor: ${m}`),
});

// La limpieza sólo ve el lado de Windows (manifiesto-nativo.js), con el PATH de usuario.
const limpieza = crearLimpieza({ win: { ...entornoWindows(), path: nativo.pathUsuario() }, estado: store, version: app.getVersion(), entradas: ENTRADAS_NATIVO });

const disco = {
  existe: (r) => fs.existsSync(r),
  leer: (r) => {
    try {
      return fs.readFileSync(r, "utf8");
    } catch {
      return null;
    }
  },
  escribir: (r, t) => (fs.mkdirSync(path.dirname(r), { recursive: true }), fs.writeFileSync(r, t)),
  copiar: (de, a) => fs.cpSync(de, a, { recursive: true, force: true }),
  borrar: (r) => fs.rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  unir: (...p) => path.join(...p),
};

const asistente = crearAsistenteNativo({
  rutas: rutasNativas,
  payload: { get dir() { return dirPayloadNativo(); }, get version() { return versionPayload(dirPayloadNativo()); } },
  disco,
  correrCli: nativo.correrCli(rutasNativas),
  pathUsuario: nativo.pathUsuario(),
  arranque: nativo.arranqueSesion(),
  supervisor,
  abrirConsola: nativo.abrirConsolaNativa(rutasNativas),
  fetch: (...a) => fetch(...a),
  estado: store,
  exe: process.platform === "win32" && app.isPackaged ? process.execPath : null,
  version: app.getVersion(),
  log,
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
// Sirve cuando «Welcome to Ollama» (de Ollama, no nuestra) la tapó.
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
    ocupado = asistente
      .avanzar((e) => {
        enviar("asistente:evento", e);
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

const actualizador = { instalar() {}, buscar: async () => {}, refrescar: async () => {} };

// Los pedidos de la página (Ajustes) sólo valen si vienen del asistente o de la Trama de localhost.
const deConfianza = (e) => {
  const u = e?.senderFrame?.url || "";
  return u.startsWith("file:") || u.startsWith(MOTOR_URL);
};
const protegido = (fn) => (e, ...a) => (deConfianza(e) ? fn(...a) : Promise.reject(new Error("No autorizado")));
const textoError = (e) => ({ error: e instanceof Error ? e.message : String(e), detalle: e?.detalle || "" });

// Lo de la pantalla de la PC (ventana.js): la página lo pide por window.carcasa.ventana (preload.js), no al motor, que lo rechaza por red.
const canalesVentana = crearCanalesVentana({
  electron: { app, BrowserWindow, dialog, clipboard, shell, Notification, nativeImage },
  changelog: CHANGELOG,
  bandeja: {
    textos(t) {
      textosBandeja = t;
      bandeja?.setContextMenu(menuBandeja());
    },
    espera(e) {
      bandeja?.setToolTip(e.n > 0 ? e.texto : "Trama");
    },
  },
  abrirLogin(id) {
    return nativo.abrirConsolaNativa(rutasNativas)(`cuentas login ${id}`);
  },
  // Tocó la notificación de un líder: la ventana se trae y la página abre esa conversación.
  abrirAviso(sid) {
    mostrarVentana();
    enviar("espera:abrir", sid);
  },
  log,
});
for (const [canal, fn] of Object.entries(canalesVentana)) {
  ipcMain.handle(canal, (e, ...a) => (deConfianza(e) ? fn(e, ...a) : Promise.reject(new Error("No autorizado"))));
}

// ---- --desinstalar: lo único que hace este modo ----
// En modo nativo el motor (node.exe, de la carcasa que quedó en la bandeja) tiene abiertos los archivos que se van a borrar:
// se lo baja primero, con todo lo que lanzó. Su pid está en `dueno` (motor.ts).
async function bajarMotorNativo() {
  try {
    const pid = Number(JSON.parse(fs.readFileSync(rutasNativas.dueno, "utf8")).pid);
    if (Number.isInteger(pid) && pid > 0) await nativo.matarArbol(pid);
  } catch {}
}

async function desinstalar() {
  await bajarMotorNativo();
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
  if (ids.length || borrarDatos.length) {
    try {
      const { resultados } = await limpieza.ejecutar({ modo: "desinstalar", ids, datos: borrarDatos });
      log(`desinstalar: ${JSON.stringify(resultados)}`);
    } catch (e) {
      log(`desinstalar: ${e.message}\n${e.detalle || ""}`);
    }
  }
  const quedan = plan.items.filter((i) => i.accion === "queda");
  if (quedan.length) {
    await dialog.showMessageBox({
      type: "info",
      noLink: true,
      title: "Quitar Trama",
      message: "Esto queda en tu máquina",
      detail: lista(quedan),
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
    ...opcionesTitulo(),
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: !!CAPTURA },
  });
  // La página del motor trae su propio <title> (app/index.html): la ventana se llama Trama aunque la página diga otra cosa.
  ventana.webContents.on("page-title-updated", (e) => e.preventDefault());
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
  // Al enfocar la ventana se pregunta a GitHub de nuevo (con un mínimo entre preguntas: ver actualizar.js).
  ventana.on("focus", () => {
    guardiaFoco.volvio();
    void actualizador.refrescar();
  });
  // Cerrar la ventana la esconde (el motor y sus líderes siguen; se sale desde la bandeja).
  ventana.on("close", (e) => {
    if (!saliendo && !CAPTURA) {
      e.preventDefault();
      ventana.hide();
    }
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

// La página pide los símbolos del tema que pintó: los botones nativos siguen al tema.
ipcMain.handle("ventana:titulo", (e, t) => {
  const v = BrowserWindow.fromWebContents(e.sender);
  if (v && !v.isDestroyed() && process.platform === "win32") v.setTitleBarOverlay(overlayDesde(t?.simbolo));
});
ipcMain.handle("asistente:pasos", () => asistente.PASOS);
ipcMain.handle("asistente:avanzar", () => correrAsistente());
ipcMain.handle("asistente:conectar", (_e, proveedor) => (guardiaFoco.consolaAbierta(), asistente.conectar(proveedor)).then(() => ({}), (e) => ({ error: e.message })));
ipcMain.handle("asistente:saltarLogin", (_e, proveedor) => void asistente.saltarLogin(proveedor));
ipcMain.handle("asistente:continuarLogin", () => asistente.continuarLogin().then(() => ({}), (e) => ({ error: e.message })));
ipcMain.handle("asistente:cuentas", () => asistente.cuentas().then((c) => c, (e) => ({ error: e.message })));
ipcMain.handle("asistente:saltarOllama", () => void asistente.saltarOllama());
ipcMain.handle("app:abrir", (_e, url) => (ENLACES_OK.has(url) ? shell.openExternal(url) : undefined));
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("actualizar:estado", () => ultimaActualizacion);
ipcMain.handle("actualizar:instalar", () => actualizador.instalar());
ipcMain.handle("actualizar:buscar", protegido(() => actualizador.buscar()));
// Quitar restos de versiones anteriores (Ajustes > Acerca de): primero el plan, la persona confirma, después se quita.
ipcMain.handle("restos:plan", protegido(() => limpieza.planificar({ modo: "restos" }).catch(textoError)));
ipcMain.handle("restos:quitar", protegido((ids) => limpieza.ejecutar({ modo: "restos", ids: Array.isArray(ids) ? ids.map(String) : [] }).catch(textoError)));

function mostrarVentana() {
  if (!ventana) return arrancar();
  if (ventana.isMinimized()) ventana.restore();
  ventana.show();
  ventana.focus();
}

// El ícono de la bandeja es lo que queda cuando la ventana está cerrada (o arrancó con la sesión, sin ventana).
function menuBandeja() {
  return Menu.buildFromTemplate([
    { label: textosBandeja.abrir, click: () => mostrarVentana() },
    { type: "separator" },
    { label: textosBandeja.cerrar, click: () => app.quit() },
  ]);
}
function crearBandeja() {
  if (bandeja) return;
  bandeja = new Tray(path.join(__dirname, "..", "build", "icon.png"));
  bandeja.setToolTip("Trama");
  bandeja.setContextMenu(menuBandeja());
  bandeja.on("click", () => mostrarVentana());
}

app.on("second-instance", () => mostrarVentana());
app.on("before-quit", (e) => {
  if (saliendo) return;
  // Se baja el motor antes de salir (sin systemd, nadie más lo haría): una sola vez, y después se sale de verdad.
  saliendo = true;
  e.preventDefault();
  supervisor.parar().finally(() => app.quit());
});

// Sin este oyente Electron saldría al cerrar la última ventana: acá cerrar la ventana la esconde y el motor sigue (se sale desde la bandeja).
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  if (DESINSTALAR) {
    try {
      await desinstalar();
    } finally {
      app.exit(0);
    }
    return;
  }
  crearBandeja();
  // Con la sesión (clave Run): sin ventana, sólo el motor, y sólo si ya quedó instalado (si no, espera a que abran Trama).
  if (SEGUNDO_PLANO) void asistente.arrancarSoloMotor().catch((e) => log(`segundo plano: ${e.message}`));
  else arrancar();
  const u = iniciarActualizador({
    app,
    recursos: process.resourcesPath,
    canal: "nativo",
    onEstado: (e) => {
      ultimaActualizacion = e;
      enviar("actualizar:cambio", e);
      if (enMotor && ventana && e.fase === "lista") ventana.webContents.executeJavaScript(AVISO_JS(e.version)).catch(() => {});
    },
    log,
  });
  actualizador.instalar = u.instalar;
  actualizador.buscar = u.buscar;
  actualizador.refrescar = u.refrescar;
  // Al volver de la suspensión se pregunta de nuevo (el ciclo de 2 min y el reintento de la red cubren el resto).
  powerMonitor.on("resume", () => void actualizador.refrescar());
  setTimeout(() => u.buscar(), 4000);
});
