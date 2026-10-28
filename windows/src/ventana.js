"use strict";
// Los canales de la pantalla de la PC que la página de Trama no le puede pedir al motor. El motor de la carcasa corre con
// TRAMA_LOCAL=1, así que su /rpc rechaza lo de SOLO_VENTANA_LOCAL (app/electron/nucleo.ts) como "canal desconocido". Acá se
// atienden en el proceso main de la carcasa, con los mismos nombres de canal que app/electron/ventana-canales.ts.
// Pura: lo de Electron entra por `o.electron`, así lo prueban tests/ventana.test.js y app/tests sin Electron.

// Igual que ID_VALIDO de app/electron/cuentas-varias.ts: el id va a una línea de comando de cmd.exe.
const ID_VALIDO = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Los dos textos del menú de la bandeja, ya traducidos por la página (app/electron/bandeja.ts). */
function textosValidos(x) {
  return typeof x?.abrir === "string" && x.abrir.trim() && typeof x?.cerrar === "string" && x.cerrar.trim()
    ? { abrir: x.abrir.slice(0, 80), cerrar: x.cerrar.slice(0, 80) }
    : null;
}

/** Cuántos líderes esperan y el texto de la bandeja (app/electron/espera-aviso.ts). */
function estadoValido(x) {
  if (typeof x?.n !== "number" || !Number.isInteger(x.n) || x.n < 0 || x.n > 999 || typeof x.texto !== "string") return null;
  return { n: x.n, texto: x.texto.slice(0, 120) };
}

/** Una notificación de "te espera": el líder (para abrirlo al tocarla) y sus textos. */
function avisoValido(x) {
  if (typeof x?.sid !== "string" || !x.sid || x.sid.length > 200) return null;
  if (typeof x.titulo !== "string" || !x.titulo.trim() || typeof x.cuerpo !== "string") return null;
  return { sid: x.sid, titulo: x.titulo.slice(0, 120), cuerpo: x.cuerpo.slice(0, 200) };
}

/**
 * Un manejador por canal: `(evento, ...args) => valor`. `o`:
 *  - electron: { app, BrowserWindow, dialog, clipboard, shell, Notification }
 *  - nativo: si el motor es el de Windows (no WSL). Ahí "seguir" esconde la ventana (el motor y los líderes siguen con el
 *    ícono de la bandeja); en WSL no hay bandeja y cerrar la carcasa es lo que se pide.
 *  - changelog: la URL de "ver cambios" de Claude Code.
 *  - bandeja: { textos(t), espera(e) } para el menú y la descripción del ícono.
 *  - abrirLogin(id): abre la consola para `cuentas login <id>` (sólo la carcasa nativa sabe hacerlo).
 *  - abrirAviso(sid): el usuario tocó la notificación de un líder: la ventana se trae y la página abre ese líder.
 *  - log(texto): lo que no se puede mostrar al usuario.
 */
function crearCanalesVentana(o) {
  const { app, BrowserWindow, dialog, clipboard, shell, Notification } = o.electron;
  const avisos = new Set();
  const ventanaDe = (e) => BrowserWindow.fromWebContents(e?.sender) ?? BrowserWindow.getAllWindows()[0] ?? null;
  const abrirExterno = (url) => shell.openExternal(url).catch((err) => o.log(`ventana: ${err.message}`));

  function notificar(a) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: a.titulo, body: a.cuerpo, silent: true });
    avisos.add(n);
    const soltar = () => void avisos.delete(n);
    n.on("close", soltar);
    n.on("failed", soltar);
    n.on("click", () => {
      soltar();
      o.abrirAviso(a.sid);
    });
    n.show();
  }

  return {
    // "Cerrar del todo" (la página): con "seguir" la carcasa nativa queda en la bandeja; si no, sale y el motor se apaga con ella.
    "app:salir": (_e, x) => {
      if (x?.modo === "seguir" && o.nativo) for (const v of BrowserWindow.getAllWindows()) v.hide();
      else app.quit();
      return 0;
    },
    // Lo que "parar todo" hace en la PC (workers y líderes): la carcasa sale igual que el Salir de la bandeja. No pregunta por los líderes ocupados.
    "app:pararTodo": () => {
      app.quit();
      return 0;
    },
    "carpeta:elegir": async (e) => {
      const v = ventanaDe(e);
      const r = await (v ? dialog.showOpenDialog(v, { properties: ["openDirectory"] }) : dialog.showOpenDialog({ properties: ["openDirectory"] }));
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    "portapapeles:texto": () => {
      try {
        return clipboard.readText() || "";
      } catch {
        return "";
      }
    },
    "bandeja:textos": (_e, x) => {
      const t = textosValidos(x);
      if (t) o.bandeja.textos(t);
    },
    "espera:estado": (_e, x) => {
      const s = estadoValido(x);
      if (s) o.bandeja.espera(s);
    },
    "espera:notificar": (_e, x) => {
      const a = avisoValido(x);
      if (a) notificar(a);
    },
    "cuentas:login": (_e, id) => {
      if (typeof id !== "string" || !ID_VALIDO.test(id)) throw new Error("id de cuenta inválido");
      return o.abrirLogin(id);
    },
    // "Ir a la ventana" de un líder: la carcasa no sabe enfocar la consola de un proceso, así que no se ofrece (la página lo oculta).
    "lider:ir": () => false,
    "lider:ubicable": () => false,
    "claude:changelog": () => abrirExterno(o.changelog),
    // Las notas de Trama: sólo de github.com (la página ya lo filtra; acá se vuelve a mirar, lo que llega por IPC no es de fiar).
    "trama:notas": (_e, url) => {
      if (typeof url === "string" && url.startsWith("https://github.com/")) abrirExterno(url);
    },
    // "Volver como estaba": la carcasa no guarda lo abierto al reiniciar. Sin eso la página arranca como siempre.
    "volver:leer": () => null,
    "volver:guardar": () => undefined,
    "volver:anotar": () => undefined,
    // El paso de un reinicio que anota la página: la carcasa no lleva un reinicio en marcha (electron/reinicio-marcas.ts).
    "reinicio:marca": () => undefined,
    "app:recargar": (e) => {
      ventanaDe(e)?.webContents.reload();
    },
    "trama:reiniciarVentana": () => {
      app.relaunch();
      app.quit();
    },
  };
}

module.exports = { crearCanalesVentana, textosValidos, estadoValido, avisoValido, ID_VALIDO };
