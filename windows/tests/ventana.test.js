"use strict";
// La carcasa atiende lo de la pantalla de la PC (src/ventana.js) y el preload lo expone: los dos tienen que tener los mismos canales.
// El recorrido contra SOLO_VENTANA (app/electron/nucleo.ts) está en app/tests/nucleo.test.ts. Sin Electron: se simula lo que se usa.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { crearCanalesVentana, textosValidos, estadoValido, avisoValido, ID_VALIDO } = require("../src/ventana");

// Lo que la carcasa usa de Electron, y lo que hizo cada llamada (en `llamadas`).
function electronFalso({ carpeta = null, texto = "", notificaciones = [] } = {}) {
  // nativeImage de mentira: un buffer que empieza con "PNG" es una imagen de 200×100; el resto no se lee.
  const nativeImage = {
    createFromBuffer: (b) => {
      const ok = b.subarray(0, 3).toString() === "PNG";
      return {
        isEmpty: () => !ok,
        getSize: () => ({ width: 200, height: 100 }),
        toDataURL: () => "data:image/png;base64,original",
        resize: ({ width, height }) => ({ toDataURL: () => `redimensionada:${width}x${height}` }),
      };
    },
  };
  const llamadas = [];
  const ventana = { hide: () => llamadas.push("ocultar"), webContents: { reload: () => llamadas.push("recargar") } };
  const electron = {
    app: { quit: () => llamadas.push("salir"), relaunch: () => llamadas.push("relanzar") },
    BrowserWindow: { fromWebContents: () => ventana, getAllWindows: () => [ventana] },
    dialog: {
      showOpenDialog: async (...a) => {
        llamadas.push(["carpetas", a[a.length - 1].properties]);
        return carpeta === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [carpeta] };
      },
    },
    clipboard: {
      readText: () => {
        if (texto === null) throw new Error("sin portapapeles");
        return texto;
      },
    },
    shell: { openExternal: async (u) => void llamadas.push(["abrir", u]) },
    Notification: class {
      static isSupported() {
        return true;
      }
      constructor(o) {
        this.o = o;
        notificaciones.push(this);
      }
      on(evento, fn) {
        this[evento] = fn;
      }
      show() {
        llamadas.push(["aviso", this.o.title]);
      }
    },
  };
  return { electron: { ...electron, nativeImage }, llamadas, notificaciones };
}

function carcasa(over = {}, opts = {}) {
  const f = electronFalso(over);
  const datos = { electron: f.electron, nativo: true, changelog: "https://ejemplo/cambios", ...opts };
  const manejadores = crearCanalesVentana({
    bandeja: { textos: (t) => f.llamadas.push(["textos", t]), espera: (e) => f.llamadas.push(["espera", e]) },
    abrirLogin: (id) => f.llamadas.push(["login", id]),
    abrirAviso: (sid) => f.llamadas.push(["abrir-aviso", sid]),
    log: () => {},
    ...datos,
  });
  return { manejadores, ...f };
}

// Carga el preload con un `electron` de mentira y devuelve lo que expone en window.carcasa.
function cargarPreload() {
  const api = {};
  const real = Module._load;
  Module._load = function (req, ...r) {
    if (req === "electron") return { contextBridge: { exposeInMainWorld: (k, v) => void (api[k] = v) }, ipcRenderer: { invoke: async () => null, on() {}, off() {} } };
    return real.call(this, req, ...r);
  };
  const ruta = require.resolve("../src/preload.js");
  delete require.cache[ruta];
  try {
    require(ruta);
  } finally {
    Module._load = real;
    delete require.cache[ruta];
  }
  return api.carcasa;
}

test("el preload expone exactamente los canales que atiende la carcasa", () => {
  const { manejadores } = carcasa();
  assert.deepEqual([...cargarPreload().ventana.canales].sort(), Object.keys(manejadores).sort());
});

test("el preload no deja pedir canales que no son de la ventana", async () => {
  await assert.rejects(cargarPreload().ventana.llamar("asistente:avanzar"), /no es de la ventana/);
});

test("carpeta:elegir: abre el selector de carpetas y devuelve la elegida o null si se canceló", async () => {
  assert.equal(await carcasa({ carpeta: "C:\\proyectos\\x" }).manejadores["carpeta:elegir"]({ sender: {} }), "C:\\proyectos\\x");
  assert.equal(await carcasa({ carpeta: null }).manejadores["carpeta:elegir"]({ sender: {} }), null);
});

test("archivo:elegirLogo: la imagen elegida achicada a 64 px; null si se canceló; lo que no es imagen, error", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logo-"));
  const png = path.join(dir, "logo.png");
  const basura = path.join(dir, "malo.png");
  fs.writeFileSync(png, "PNG de prueba");
  fs.writeFileSync(basura, "no es una imagen");
  const manejar = (carpeta) => carcasa({ carpeta }).manejadores["archivo:elegirLogo"]({ sender: {} });
  assert.equal(await manejar(null), null);
  assert.equal(await manejar(png), "redimensionada:64x32");
  await assert.rejects(manejar(basura), /no sirve como logo/);
});

test("portapapeles:texto: el texto del sistema, o vacío si no se puede leer", () => {
  assert.equal(carcasa({ texto: "hola" }).manejadores["portapapeles:texto"](), "hola");
  assert.equal(carcasa({ texto: null }).manejadores["portapapeles:texto"](), "");
});

test("bandeja:textos y espera:estado sólo pasan lo válido", () => {
  const c = carcasa();
  c.manejadores["bandeja:textos"](null, { abrir: "Abrir", cerrar: "Salir" });
  c.manejadores["bandeja:textos"](null, { abrir: "", cerrar: "Salir" });
  c.manejadores["espera:estado"](null, { n: 2, texto: "2 líderes te esperan" });
  c.manejadores["espera:estado"](null, { n: -1, texto: "x" });
  assert.deepEqual(c.llamadas, [["textos", { abrir: "Abrir", cerrar: "Salir" }], ["espera", { n: 2, texto: "2 líderes te esperan" }]]);
});

test("cuentas:login: sólo ids de cuenta (nada que cmd.exe interprete)", () => {
  const c = carcasa();
  c.manejadores["cuentas:login"](null, "cuenta-2");
  for (const malo of ["a b", "x&calc", 'x"', "", 7, "-x"]) assert.throws(() => c.manejadores["cuentas:login"](null, malo), /id de cuenta inválido/, String(malo));
  assert.deepEqual(c.llamadas, [["login", "cuenta-2"]]);
  assert.match("cuenta-2", ID_VALIDO);
});

test("app:salir: con la carcasa nativa, 'seguir' esconde la ventana y 'parar' sale; en WSL cualquiera sale", () => {
  const nativa = carcasa();
  nativa.manejadores["app:salir"](null, { modo: "seguir", forzar: false });
  nativa.manejadores["app:salir"](null, { modo: "parar", forzar: true });
  assert.deepEqual(nativa.llamadas, ["ocultar", "salir"]);
  const wsl = carcasa({}, { nativo: false });
  wsl.manejadores["app:salir"](null, { modo: "seguir", forzar: false });
  assert.deepEqual(wsl.llamadas, ["salir"]);
});

test("app:pararTodo sale como el Salir de la bandeja", () => {
  const c = carcasa();
  assert.equal(c.manejadores["app:pararTodo"](null, false), 0);
  assert.deepEqual(c.llamadas, ["salir"]);
});

test("lider:ir y lider:ubicable: la carcasa no ubica consolas, así que dicen que no", async () => {
  const c = carcasa();
  assert.equal(await c.manejadores["lider:ir"](null, 1234), false);
  assert.equal(await c.manejadores["lider:ubicable"](null, 1234), false);
});

test("claude:changelog y trama:notas: sólo github.com en trama:notas", () => {
  const c = carcasa();
  c.manejadores["claude:changelog"]();
  c.manejadores["trama:notas"](null, "https://github.com/FeroxShark/trama/releases");
  c.manejadores["trama:notas"](null, "https://evil.example/x");
  assert.deepEqual(c.llamadas, [["abrir", "https://ejemplo/cambios"], ["abrir", "https://github.com/FeroxShark/trama/releases"]]);
});

test("espera:notificar: el aviso sale y tocarlo trae la ventana con ese líder", () => {
  const c = carcasa();
  c.manejadores["espera:notificar"](null, { sid: "s-1", titulo: "Te espera", cuerpo: "Un líder" });
  c.manejadores["espera:notificar"](null, { sid: "", titulo: "x", cuerpo: "y" });
  assert.deepEqual(c.llamadas, [["aviso", "Te espera"]]);
  c.notificaciones[0].click();
  assert.deepEqual(c.llamadas.slice(1), [["abrir-aviso", "s-1"]]);
});

test("volver, reinicio y recargar: lo que la carcasa no guarda no falla", async () => {
  const c = carcasa();
  assert.equal(await c.manejadores["volver:leer"](), null);
  assert.equal(await c.manejadores["volver:guardar"](null, {}), undefined);
  c.manejadores["reinicio:marca"](null, "pagina");
  c.manejadores["app:recargar"]({ sender: {} });
  c.manejadores["trama:reiniciarVentana"]();
  assert.deepEqual(c.llamadas, ["recargar", "relanzar", "salir"]);
});

test("validadores: la forma de lo que llega por IPC", () => {
  assert.equal(textosValidos({ abrir: " ", cerrar: "x" }), null);
  assert.equal(estadoValido({ n: 1.5, texto: "x" }), null);
  assert.equal(avisoValido({ sid: "s", titulo: "t", cuerpo: 5 }), null);
});
