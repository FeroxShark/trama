// Saca los PNG de la maqueta con el Electron de la app, sin abrir ventanas. Pide el build de la interfaz (`npx vite build`), porque
// usa su CSS compilado: así los tokens y las fuentes son los de verdad.
//   node_modules/electron/dist/electron --user-data-dir=/tmp/wv maquetas/rediseno-0.4/worker-vista-fuente/generar.cjs [filtro]
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const AQUI = __dirname;
const SALIDA = path.join(AQUI, "..");
const ASSETS = path.join(AQUI, "../../../dist/assets");
const CSS = path.join(ASSETS, fs.readdirSync(ASSETS).find((f) => f.endsWith(".css")));

// Qué muestra cada estado además del estado en sí: entre todos se ven los 7 puntos en cada propuesta.
const COMUN = [
  ["trabajando", { s: "trabajando", consigna: 1, tip: "corrio" }],
  ["trabado", { s: "trabado", tip: "colgado" }],
  ["termino", { s: "termino", grupo: 1, sel: "grep" }],
  ["fallo", { s: "fallo", tip: "error" }],
  ["solo-cambios", { s: "termino", filtro: 1, sel: "mig" }],
  ["claro", { s: "trabado", t: "claro", tip: "colgado" }],
  ["en", { s: "termino", l: "en", grupo: 1, sel: "grep", tip: "tests" }],
];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("allow-file-access-from-files");

app.whenReady().then(async () => {
  const filtro = process.argv.slice(2).find((a) => !a.startsWith("-") && !a.endsWith(".cjs"));
  const w = new BrowserWindow({ show: false, width: 2160, height: 1350, useContentSize: true, webPreferences: { offscreen: true, webSecurity: false, backgroundThrottling: false, zoomFactor: 1.5 } });
  w.setContentSize(2160, 1350); // Electron la recorta al monitor primario al crearla.
  w.webContents.on("console-message", (e) => {
    if (/assert|error/i.test(e.message)) console.log("consola:", e.message);
  });
  for (const p of ["a", "b"]) {
    for (const [nombre, op] of COMUN) {
      const archivo = `worker-vista-${p}-${nombre}.png`;
      if (filtro && !archivo.includes(filtro)) continue;
      const q = new URLSearchParams({ p, css: `file://${CSS}`, ...Object.fromEntries(Object.entries(op).map(([k, v]) => [k, String(v)])) });
      await w.loadURL(`file://${path.join(AQUI, "maqueta.html")}?${q}`);
      w.webContents.setZoomFactor(1.5);
      for (let i = 0; i < 100; i++) {
        if (await w.webContents.executeJavaScript('document.body.dataset.listo === "1"')) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 250));
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(SALIDA, archivo), img.toPNG());
      console.log(archivo, `${img.getSize().width}x${img.getSize().height}`);
    }
  }
  app.quit();
});
