"use strict";
// electron-updater contra GitHub Releases. El dueño y el repo salen de la config de build
// (electron-builder.yml → app-update.yml); mientras sean los de relleno no se pregunta nada.
// Nunca instala solo ni interrumpe: avisa y la persona decide cuándo Reiniciar.

const fs = require("node:fs");
const path = require("node:path");

function esDeRelleno(recursos) {
  try {
    return /TRAMA_GH_OWNER|TRAMA_GH_REPO/.test(fs.readFileSync(path.join(recursos, "app-update.yml"), "utf8"));
  } catch {
    return true;
  }
}

function iniciarActualizador({ app, recursos, onEstado, log = () => {} }) {
  const nulo = { instalar() {}, buscar() {}, activo: false };
  if (!app.isPackaged || esDeRelleno(recursos)) return nulo;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    log(`electron-updater no está: ${e.message}`);
    return nulo;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (i) => onEstado({ fase: "descargando", version: i.version }));
  autoUpdater.on("update-downloaded", (i) => onEstado({ fase: "lista", version: i.version }));
  autoUpdater.on("error", (e) => log(`actualizador: ${e?.message || e}`));
  const buscar = () => autoUpdater.checkForUpdates().catch((e) => log(`actualizador: ${e?.message || e}`));
  return { instalar: () => autoUpdater.quitAndInstall(), buscar, activo: true };
}

module.exports = { iniciarActualizador };
