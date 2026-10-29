"use strict";
// Main mínimo de captura: pinta una pantalla del asistente (?demo=<nombre>) sin hablar con el main.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const [demo, salida] = [process.env.TRAMA_DEMO || "instalar", process.env.TRAMA_PNG];
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1180, height: 760, show: false, webPreferences: { offscreen: true } });
  w.setContentSize(1180, 760);
  await w.loadFile(path.join(__dirname, "..", "src", "ui", "index.html"), { query: { demo } });
  await new Promise((r) => setTimeout(r, 600));
  const img = await w.webContents.capturePage();
  fs.writeFileSync(salida, img.toPNG());
  app.quit();
});
