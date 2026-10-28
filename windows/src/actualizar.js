"use strict";
// electron-updater contra GitHub Releases. El dueño y el repo salen de la config de build
// (electron-builder.yml → app-update.yml); mientras sean los de relleno no se pregunta nada.
// Sólo toma releases normales (no prereleases): lo que se publica para Gonza se publica normal.
// Nunca instala solo ni interrumpe: avisa y la persona decide cuándo Reiniciar.
//
// Estados que se informan (`onEstado`): {fase, version?, progreso?, mensaje?}
//   inactiva     esta copia no se actualiza sola (no está empaquetada, o el instalador es de relleno)
//   buscando     preguntando a GitHub
//   al-dia       no hay nada más nuevo
//   descargando  hay una versión nueva; `progreso` 0–100
//   lista        descargada: «Reiniciar para actualizar» (`instalar()`); una más nueva que aparezca la reemplaza
//   error        no se pudo preguntar o bajar; `mensaje` en una línea
//
// Cuándo se pregunta: cada 2 min en segundo plano, al enfocar la ventana y al volver de la suspensión (`refrescar`), con un mínimo
// de 15 s entre búsquedas que salen. La búsqueda de fondo no cambia lo que se ve salvo que haya una versión más nueva. Un límite de
// GitHub (403/429) espera 15 min sin error a la vista; una falla de red de fondo reintenta a los 30 s (la vuelta de la red se nota sin
// esperar al ciclo).

const fs = require("node:fs");
const path = require("node:path");

function esDeRelleno(recursos) {
  try {
    return /TRAMA_GH_OWNER|TRAMA_GH_REPO/.test(fs.readFileSync(path.join(recursos, "app-update.yml"), "utf8"));
  } catch {
    return true;
  }
}

const corto = (e) => String(e?.message || e || "error").split(/\r?\n/)[0].slice(0, 200);

const CADA_MS = 2 * 60_000;
const MINIMO_MS = 15_000;
const REINTENTO_RED_MS = 30_000;
const PAUSA_LIMITE_MS = 15 * 60_000;
const RELOJ_REAL = {
  ahora: () => Date.now(),
  cada: (f, ms) => setInterval(f, ms).unref?.(),
  despues: (f, ms) => setTimeout(f, ms).unref?.(),
};

const esLimite = (e) => e?.statusCode === 403 || e?.statusCode === 429 || /\b(403|429)\b|rate limit/i.test(String(e?.message || ""));
const esRed = (e) => /ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET|ERR_NAME|net::|network|socket/i.test(String(e?.message || e || ""));

// La máquina de estados, sin Electron: `autoUpdater` es el de electron-updater (o un falso en los tests). `reloj` (`ahora`, `cada`,
// `despues`) es el del tiempo: en los tests, uno falso.
// `canal`: el del instalador nativo es «nativo» (nativo.yml en la release; electron-builder-nativo.yml), el de WSL el de siempre.
function crearActualizador({ autoUpdater, onEstado, log = () => {}, canal = null, reloj = RELOJ_REAL }) {
  let fase = "";
  let version = null;
  let porcentaje = -1;
  // La búsqueda de fondo (el ciclo, el foco, la suspensión, el reintento): no dice nada salvo una versión nueva.
  let enFondo = false;
  // ¿`error` ya dijo lo de esta búsqueda? (para no decirlo dos veces si también lo rechaza `checkForUpdates`).
  let emitido = false;
  let pausaHasta = 0;
  let intentoEn = 0;
  let reintentoArmado = false;
  const decir = (e) => {
    fase = e.fase;
    onEstado(e);
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  if (canal) {
    autoUpdater.channel = canal;
    // Poner un canal prende allowDowngrade en electron-updater: acá nunca se baja de versión.
    autoUpdater.allowDowngrade = false;
  }
  autoUpdater.on("checking-for-update", () => {
    // Con una versión ya bajada (o bajando) la búsqueda no cambia lo que se ve.
    if (!enFondo && fase !== "lista" && fase !== "descargando") decir({ fase: "buscando" });
  });
  autoUpdater.on("update-not-available", () => {
    // Lo que ya está bajado sigue valiendo. De fondo, sin novedad no se dice nada (sólo se borra un error viejo).
    if (fase === "lista") return;
    if (enFondo && fase !== "error") return;
    decir({ fase: "al-dia" });
  });
  autoUpdater.on("update-available", (i) => {
    // La misma que ya está lista: nada que hacer. Una más nueva: se baja, y ésa es la que queda.
    if (fase === "lista" && i.version === version) return;
    version = i.version;
    porcentaje = 0;
    decir({ fase: "descargando", version, progreso: 0 });
  });
  autoUpdater.on("download-progress", (p) => {
    const n = Math.max(0, Math.min(100, Math.floor(p?.percent ?? 0)));
    if (n === porcentaje) return;
    porcentaje = n;
    decir({ fase: "descargando", version, progreso: n });
  });
  autoUpdater.on("update-downloaded", (i) => {
    version = i.version;
    decir({ fase: "lista", version });
  });
  // Un límite (403/429) no se muestra: se espera. De fondo, un error tampoco se muestra; si fue de red, se reintenta pronto.
  const fallo = (e) => {
    emitido = true;
    log(`actualizador: ${e?.message || e}`);
    if (esLimite(e)) {
      pausaHasta = reloj.ahora() + PAUSA_LIMITE_MS;
      return;
    }
    if (enFondo) {
      if (esRed(e)) reintentarEnRed();
      return;
    }
    decir({ fase: "error", mensaje: corto(e) });
  };
  autoUpdater.on("error", fallo);
  // Un solo reintento armado a la vez: la vuelta de la red se nota a los 30 s, sin esperar al ciclo.
  function reintentarEnRed() {
    if (reintentoArmado) return;
    reintentoArmado = true;
    reloj.despues(() => {
      reintentoArmado = false;
      void buscar({ fondo: true });
    }, REINTENTO_RED_MS);
  }
  const buscar = async ({ fondo = false } = {}) => {
    // Una búsqueda a la vez; bajando, no se vuelve a preguntar. Ya lista sí: puede haber una más nueva.
    if (fase === "buscando" || fase === "descargando") return;
    const t = reloj.ahora();
    // De fondo: se respeta la pausa de un límite y no se pregunta dos veces seguidas en menos de MINIMO_MS (los focos).
    if (fondo && (t < pausaHasta || t - intentoEn < MINIMO_MS)) return;
    intentoEn = t;
    enFondo = fondo;
    emitido = false;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      // `error` ya se emitió si fue de electron-updater; esto cubre lo que salta antes de emitir.
      if (!emitido) fallo(e);
    } finally {
      enFondo = false;
    }
  };
  reloj.cada(() => void buscar({ fondo: true }), CADA_MS);
  return {
    buscar: () => buscar(),
    refrescar: () => buscar({ fondo: true }),
    instalar: () => autoUpdater.quitAndInstall(),
    activo: true,
  };
}

function iniciarActualizador({ app, recursos, onEstado, log = () => {}, canal = null }) {
  const nulo = {
    instalar() {},
    buscar: async () => onEstado({ fase: "inactiva" }),
    refrescar: async () => {},
    activo: false,
  };
  if (!app.isPackaged || esDeRelleno(recursos)) return nulo;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    log(`electron-updater no está: ${e.message}`);
    return nulo;
  }
  return crearActualizador({ autoUpdater, onEstado, log, canal });
}

module.exports = { iniciarActualizador, crearActualizador, esDeRelleno };
