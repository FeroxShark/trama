// Saca los PNG de cola-mensajes.html con Electron, sin ventana a la vista. Usa el CSS compilado de la app (tokens, fuentes y clases reales):
// antes, `npx vite build` en app/. Desde app/, con un HOME temporal:
//   HOME=$(mktemp -d) node_modules/electron/dist/electron maquetas/rediseno-0.4/cola-mensajes-recursos/render.cjs  (con SOLO=<parte del nombre> saca sólo esos)
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "..");
const assets = path.resolve(dir, "../../dist/assets");
const css = fs.readdirSync(assets).find((f) => /^index-.*\.css$/.test(f));
const ESTADOS = [
  ["uno", {}], ["tres", {}], ["colapsada", {}], ["comando-largo", {}], ["fallo", {}], ["confirmar", {}], ["arrastrando", {}], ["miniatura", {}],
  ["claro", { e: "tres", tema: "claro" }], ["ingles", { e: "confirmar", idioma: "en" }],
];
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const filtro = process.env.SOLO;
  const win = new BrowserWindow({ show: false, width: 1920, height: 1200, enableLargerThanScreen: true, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, zoomFactor: 1.5 } });
  for (const p of ["a", "b"])
    for (const [nombre, o] of ESTADOS) {
      const archivo = `cola-mensajes-${p}-${nombre}.png`;
      if (filtro && !archivo.includes(filtro)) continue;
      const q = new URLSearchParams({ p, e: o.e ?? nombre, tema: o.tema ?? "oscuro", idioma: o.idioma ?? "es", css: `../../dist/assets/${css}` });
      await win.loadFile(path.join(dir, "cola-mensajes.html"), { search: q.toString() });
      win.setContentSize(1920, 1200);
      win.webContents.setZoomFactor(1.5);
      await win.webContents.executeJavaScript("document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))");
      await new Promise((r) => setTimeout(r, 250));
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1920, height: 1200 });
      fs.writeFileSync(path.join(dir, archivo), img.toPNG());
      console.log(archivo, img.getSize().width + "x" + img.getSize().height);
    }
  app.quit();
});
