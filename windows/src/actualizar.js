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
//   lista        descargada: «Reiniciar para actualizar» (`instalar()`)
//   error        no se pudo preguntar o bajar; `mensaje` en una línea

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

// La máquina de estados, sin Electron: `autoUpdater` es el de electron-updater (o un falso en los tests).
// `canal`: el del instalador nativo es «nativo» (nativo.yml en la release; electron-builder-nativo.yml), el de WSL el de siempre.
function crearActualizador({ autoUpdater, onEstado, log = () => {}, canal = null }) {
  let fase = "";
  let version = null;
  let porcentaje = -1;
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
  autoUpdater.on("checking-for-update", () => decir({ fase: "buscando" }));
  autoUpdater.on("update-not-available", () => decir({ fase: "al-dia" }));
  autoUpdater.on("update-available", (i) => {
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
  autoUpdater.on("update-downloaded", (i) => decir({ fase: "lista", version: i.version }));
  autoUpdater.on("error", (e) => {
    log(`actualizador: ${e?.message || e}`);
    decir({ fase: "error", mensaje: corto(e) });
  });
  const buscar = async () => {
    // Una búsqueda a la vez; y ya descargada, o bajando, no se vuelve a preguntar.
    if (fase === "buscando" || fase === "descargando" || fase === "lista") return;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      // `error` ya se emitió si fue de electron-updater; esto cubre lo que salta antes de emitir.
      if (fase !== "error") {
        log(`actualizador: ${e?.message || e}`);
        decir({ fase: "error", mensaje: corto(e) });
      }
    }
  };
  return { buscar, instalar: () => autoUpdater.quitAndInstall(), activo: true };
}

function iniciarActualizador({ app, recursos, onEstado, log = () => {}, canal = null }) {
  const nulo = {
    instalar() {},
    buscar: async () => onEstado({ fase: "inactiva" }),
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
