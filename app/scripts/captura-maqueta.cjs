// Captura una maqueta HTML (referencias/maquetas/...) con Electron escondido: un PNG de la página entera y, con --gif,
// un GIF de la escena con cada actividad en su turno. Los cuadros del GIF son deterministas: se frena cada animación
// (Web Animations) y se le pone el tiempo a mano, así no dependen del reloj de la máquina.
//
// uso: node_modules/electron/dist/electron scripts/captura-maqueta.cjs <pagina.html> <salida.png> [--gif <salida.gif>]
//        [--ancho 1280] [--alto 800] [--query "?vivo=1"] [--fps 12] [--seg 1.5] [--selector .escena] [--pad 0] [--escala 1.6]
// --alto fija el alto de la ventana (una maqueta que cabe en una pantalla, sin scroll de página); sin él, el de toda la página.
// Requiere ffmpeg para el GIF. No toca nada de Ana: perfil temporal.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const args = process.argv.slice(2);
const pos = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--"));
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [pagina, png] = pos;
const gif = opt("gif", null);
const ancho = Number(opt("ancho", 1280));
const altoFijo = Number(opt("alto", 0));
const query = opt("query", "");
const fps = Number(opt("fps", 12));
const seg = Number(opt("seg", 1.5));
const selector = opt("selector", ".escena");
// --pad: CSS px de aire alrededor del selector.
const pad = Number(opt("pad", 0));
const escala = Number(opt("escala", 1.6));
if (!pagina || !png) { console.error("uso: electron captura-maqueta.cjs <pagina.html> <salida.png> [--gif salida.gif]"); process.exit(2); }

app.disableHardwareAcceleration();
setTimeout(() => { console.error("timeout"); app.exit(3); }, Number(process.env.MAQUETA_TOPE_S ?? 240) * 1000);
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "maqueta-perfil-")));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function cargar(win, query) {
  await win.loadURL(`file://${path.resolve(pagina)}${query}`);
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
  const alto = altoFijo || (await win.webContents.executeJavaScript("document.documentElement.scrollHeight"));
  win.setContentSize(ancho, Math.ceil(alto * win.webContents.getZoomFactor()));
  await espera(250);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: ancho, height: altoFijo || 900, useContentSize: true, backgroundColor: "#000000", webPreferences: { offscreen: true, backgroundThrottling: false } });
  try {
    // PNG: la página entera, con la escena en una actividad fija (?fijo=N) y la galería animada en su cuadro de partida.
    await cargar(win, query || `?fijo=${opt("fijo", 1)}`);
    await win.webContents.executeJavaScript("document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 700; })");
    await espera(120);
    fs.mkdirSync(path.dirname(path.resolve(png)), { recursive: true });
    fs.writeFileSync(png, (await win.webContents.capturePage()).toPNG());
    console.log("png:", png);

    if (gif) {
      // El GIF se ve más grande (zoom): el viewport en CSS px se achica y la escena conserva su ancho.
      await cargar(win, "?fijo=0&galeria=0");
      win.webContents.setZoomFactor(escala);
      await espera(300);
      win.setContentSize(ancho, Math.ceil((await win.webContents.executeJavaScript("document.documentElement.scrollHeight")) * escala));
      await espera(300);
      const caja = await win.webContents.executeJavaScript(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x) - ${pad}, y: Math.round(r.y) - ${pad}, width: Math.round(r.width) + ${2 * pad}, height: Math.round(r.height) + ${2 * pad} }; })()`,
      );
      for (const k of ["x", "y", "width", "height"]) caja[k] = Math.round(caja[k] * escala);
      const n = await win.webContents.executeJavaScript("window.ACT.length");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maqueta-cuadros-"));
      const porActividad = Math.round(fps * seg);
      let k = 0;
      for (let a = 0; a < n; a++) {
        await win.webContents.executeJavaScript(`window.ir(${a}); document.getAnimations().forEach((x) => x.pause()); true`);
        for (let f = 0; f < porActividad; f++) {
          await win.webContents.executeJavaScript(`document.getAnimations().forEach((x) => { x.currentTime = ${Math.round((f * 1000) / fps)}; })`);
          const img = await win.webContents.capturePage(caja);
          fs.writeFileSync(path.join(tmp, `f${String(k++).padStart(4, "0")}.png`), img.toPNG());
        }
      }
      fs.mkdirSync(path.dirname(path.resolve(gif)), { recursive: true });
      const vf = "split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5";
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(tmp, "f%04d.png"), "-vf", vf, "-loop", "0", gif]);
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log("gif:", gif, `(${k} cuadros, ${caja.width}x${caja.height})`);
    }
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
