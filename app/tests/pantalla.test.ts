// pantalla (#1869): el control de pantalla de la ventana propia de un worker. La ventana de Electron se reemplaza por un
// `Contenido` de mentira que anota lo que le piden; el servidor HTTP y la CLI son los de verdad (127.0.0.1, token).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { crearPantalla, leerTecla, servirPantalla, type Contenido } from "../electron/pantalla.ts";
import { buscarApp, entornoAislado, main, nombreSesion, parsear, type Deps } from "../electron/cli/pantalla.ts";

type Llamada = { metodo: string; params: Record<string, unknown> };

/** Una ventana de mentira: anota los comandos de DevTools y contesta al JS de la página según un guion. */
function falsa(opc: { dpr?: number; js?: (codigo: string) => unknown } = {}) {
  const llamadas: Llamada[] = [];
  const c: Contenido = {
    capturePage: async () => ({ toPNG: () => Buffer.from("PNG"), getSize: () => ({ width: 1280, height: 800 }) }),
    executeJavaScript: async (js) => {
      if (js === "window.devicePixelRatio") return opc.dpr ?? 1;
      if (js.includes("requestAnimationFrame")) return true;
      return opc.js ? opc.js(js) : null;
    },
    cdp: async (metodo, params) => {
      llamadas.push({ metodo, params });
    },
  };
  return { c, llamadas };
}

const ni = () => undefined;

test("leerTecla: nombres, letras, combinaciones y comandos de edición", () => {
  assert.equal(leerTecla("Enter")?.tecla.vk, 13);
  assert.equal(leerTecla("enter")?.tecla.text, "\r");
  assert.equal(leerTecla("Escape")?.tecla.key, "Escape");
  assert.equal(leerTecla("F5")?.tecla.vk, 116);
  const k = leerTecla("ctrl+k");
  assert.equal(k?.modifiers, 2);
  assert.equal(k?.tecla.code, "KeyK");
  assert.equal(k?.tecla.text, undefined, "con ctrl no se escribe la letra");
  assert.deepEqual(leerTecla("ctrl+a")?.comandos, ["selectAll"]);
  assert.deepEqual(leerTecla("Control+Shift+Z")?.comandos, ["redo"]);
  assert.equal(leerTecla("a")?.tecla.text, "a");
  assert.equal(leerTecla("shift+a")?.tecla.text, "A");
  assert.equal(leerTecla("pulpo"), null);
  assert.equal(leerTecla("hiper+a"), null);
  assert.equal(leerTecla(""), null);
});

test("crearPantalla: clic = mover, apretar y soltar, con las coordenadas de la captura pasadas a píxeles CSS", async () => {
  const { c, llamadas } = falsa({ dpr: 2 });
  const manejar = crearPantalla(c, { alCerrar: ni });
  const r = await manejar("POST", "/clic", JSON.stringify({ x: 200, y: 100, veces: 2 }));
  assert.equal(r.estado, 200);
  assert.deepEqual(
    llamadas.map((l) => [l.metodo, l.params.type, l.params.x, l.params.y, l.params.clickCount ?? null]),
    [
      ["Input.dispatchMouseEvent", "mouseMoved", 100, 50, null],
      ["Input.dispatchMouseEvent", "mousePressed", 100, 50, 1],
      ["Input.dispatchMouseEvent", "mouseReleased", 100, 50, 1],
      ["Input.dispatchMouseEvent", "mousePressed", 100, 50, 2],
      ["Input.dispatchMouseEvent", "mouseReleased", 100, 50, 2],
    ],
  );
});

test("crearPantalla: clic derecho, botones raros y coordenadas que faltan", async () => {
  const { c, llamadas } = falsa();
  const manejar = crearPantalla(c, { alCerrar: ni });
  await manejar("POST", "/clic", JSON.stringify({ x: 1, y: 2, boton: "right" }));
  assert.equal(llamadas[1].params.button, "right");
  assert.equal((await manejar("POST", "/clic", JSON.stringify({ x: 1, y: 2, boton: "laser" }))).estado, 400);
  assert.equal((await manejar("POST", "/clic", JSON.stringify({ x: "uno" }))).estado, 400);
  assert.equal((await manejar("POST", "/clic", "{roto")).estado, 400);
  assert.equal((await manejar("POST", "/clic", "[1]")).estado, 400);
  assert.equal((await manejar("GET", "/clic", "")).estado, 405);
  assert.equal((await manejar("POST", "/nada", "")).estado, 404);
});

test("crearPantalla: escribir inserta el texto y tecla manda keyDown/keyUp con el comando de edición", async () => {
  const { c, llamadas } = falsa();
  const manejar = crearPantalla(c, { alCerrar: ni });
  assert.equal((await manejar("POST", "/escribir", JSON.stringify({ texto: "hola ñandú" }))).estado, 200);
  assert.deepEqual(llamadas[0], { metodo: "Input.insertText", params: { text: "hola ñandú" } });
  assert.equal((await manejar("POST", "/escribir", JSON.stringify({ texto: "" }))).estado, 400);

  llamadas.length = 0;
  assert.equal((await manejar("POST", "/tecla", JSON.stringify({ tecla: "ctrl+a" }))).estado, 200);
  assert.deepEqual(llamadas.map((l) => l.params.type), ["rawKeyDown", "keyUp"]);
  assert.deepEqual(llamadas[0].params.commands, ["selectAll"]);
  llamadas.length = 0;
  await manejar("POST", "/tecla", JSON.stringify({ tecla: "Enter" }));
  assert.deepEqual(llamadas.map((l) => l.params.type), ["keyDown", "keyUp"]);
  assert.equal(llamadas[0].params.text, "\r");
  assert.equal((await manejar("POST", "/tecla", JSON.stringify({ tecla: "pulpo" }))).estado, 400);
});

test("crearPantalla: donde y leer apuntan al selector y avisan si no hay elemento", async () => {
  const visto: string[] = [];
  const { c } = falsa({
    js: (codigo) => {
      visto.push(codigo);
      if (codigo.includes('"#caja"')) return codigo.includes("getBoundingClientRect") ? { x: 10, y: 20, ancho: 30, alto: 40 } : "texto de la caja";
      return null;
    },
  });
  const manejar = crearPantalla(c, { alCerrar: ni });
  const d = await manejar("POST", "/donde", JSON.stringify({ selector: "#caja" }));
  assert.deepEqual(JSON.parse(String(d.cuerpo)), { ok: true, x: 10, y: 20, ancho: 30, alto: 40 });
  assert.equal((await manejar("POST", "/donde", JSON.stringify({ selector: "#nada" }))).estado, 404);
  const l = await manejar("POST", "/leer", JSON.stringify({ selector: "#caja" }));
  assert.equal(String(l.cuerpo), "texto de la caja");
  assert.equal((await manejar("POST", "/leer", JSON.stringify({ selector: "#nada" }))).estado, 404);
  // el selector viaja como literal JSON: no puede cerrar la cadena ni inyectar código
  await manejar("POST", "/donde", JSON.stringify({ selector: '"); alert(1); ("' }));
  assert.ok(visto.some((v) => v.includes(JSON.stringify('"); alert(1); ("'))));
});

test("crearPantalla: captura devuelve el PNG y cerrar avisa", async () => {
  const { c } = falsa();
  let cerrada = false;
  const manejar = crearPantalla(c, { alCerrar: () => (cerrada = true) });
  const r = await manejar("POST", "/captura", "");
  assert.equal(r.tipo, "image/png");
  assert.equal(String(r.cuerpo), "PNG");
  await manejar("POST", "/cerrar", "");
  await new Promise<void>((listo) => setImmediate(listo));
  assert.equal(cerrada, true);
});

test("parsear: orden, posicionales, opciones con valor y números negativos", () => {
  assert.equal(parsear([]), null);
  assert.deepEqual(parsear(["clic", "10", "20", "--doble"]), { orden: "clic", posicionales: ["10", "20"], opciones: { doble: true } });
  assert.deepEqual(parsear(["captura", "-o", "/tmp/x.png"]), { orden: "captura", posicionales: [], opciones: { o: "/tmp/x.png" } });
  assert.deepEqual(parsear(["abrir", "lider", "--tam=900 600", "HILOS_TEMA=claro"]), { orden: "abrir", posicionales: ["lider", "HILOS_TEMA=claro"], opciones: { tam: "900 600" } });
  assert.deepEqual(parsear(["rueda", "-300"])?.posicionales, ["-300"]);
  assert.equal(parsear(["captura", "-o"]), null);
});

test("nombreSesion: estable por carpeta de trabajo, distinto entre carpetas, o el nombre dado", () => {
  const a = nombreSesion({}, "/x/uno");
  assert.equal(a, nombreSesion({}, "/x/uno"));
  assert.notEqual(a, nombreSesion({}, "/x/dos"));
  assert.equal(nombreSesion({ sesion: "mi ventana/../x" }, "/x"), "mi_ventana_.._x");
});

test("entornoAislado: HOME vacío propio, estado y perfil temporales, PATH sin el home y sin lo del dueño", () => {
  const env = { HOME: "/home/ana", PATH: "/usr/bin:/home/ana/.local/bin:/home/ana/node/bin:/bin", PA_STATE: "/home/ana/pa", WAYLAND_DISPLAY: "wayland-1", HILOS_PRUEBA: "5" };
  const e = entornoAislado(env, "/tmp/casa", "/repo/motor", { HILOS_CAPTURA: "normal" }, "/tmp/sesion");
  assert.equal(e.HOME, "/tmp/casa");
  assert.equal(e.XDG_CONFIG_HOME, path.join("/tmp/casa", ".config"));
  assert.equal(e.HILOS_STATE, path.join("/tmp/casa", "estado"));
  assert.equal(e.HILOS_PERFIL, path.join("/tmp/casa", "perfil"));
  assert.equal(e.PATH, process.platform === "win32" ? e.PATH : "/usr/bin:/bin");
  assert.equal(e.PA_STATE, undefined);
  assert.equal(e.HILOS_PRUEBA, undefined);
  assert.equal(e.WAYLAND_DISPLAY, "wayland-1", "lo gráfico se hereda");
  assert.equal(e.HILOS_CAPTURA, "normal");
  assert.equal(e.HILOS_PANTALLA, "/tmp/sesion");
  assert.equal(e.HILOS_AISLAR_PERMITE, "/repo/motor");
});

test("buscarApp: sólo vale una carpeta con el build hecho", () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pantalla-app-"));
  const app = path.join(raiz, "app");
  const env = { XDG_CONFIG_HOME: path.join(raiz, "nada"), HOME: raiz, USERPROFILE: raiz, LOCALAPPDATA: path.join(raiz, "local") };
  assert.equal(buscarApp({ env, aqui: path.join(app, "dist-electron", "cli") }), null);
  mkdirSync(path.join(app, "dist"), { recursive: true });
  writeFileSync(path.join(app, "dist", "index.html"), "");
  assert.equal(buscarApp({ env, aqui: path.join(app, "dist-electron", "cli") }), null, "sin dist-electron/main.js");
  mkdirSync(path.join(app, "dist-electron"), { recursive: true });
  writeFileSync(path.join(app, "dist-electron", "main.js"), "");
  assert.equal(buscarApp({ env, aqui: path.join(app, "dist-electron", "cli") }), path.resolve(app));
  assert.equal(buscarApp({ app, env, aqui: "/no/existe" }), path.resolve(app));
});

test("CLI + servidor de punta a punta: abrir, clic por selector, escribir, tecla, leer, captura y cerrar", async () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pantalla-cli-"));
  const app = path.join(raiz, "app");
  mkdirSync(path.join(app, "dist"), { recursive: true });
  mkdirSync(path.join(app, "dist-electron", "cli"), { recursive: true });
  writeFileSync(path.join(app, "dist", "index.html"), "");
  writeFileSync(path.join(app, "dist-electron", "main.js"), "");
  // un "electron" mínimo para que `binarioElectron` lo encuentre: node_modules/electron/index.js exporta su ruta
  const modulo = path.join(app, "node_modules", "electron");
  mkdirSync(modulo, { recursive: true });
  writeFileSync(path.join(app, "package.json"), "{}");
  writeFileSync(path.join(modulo, "package.json"), '{"name":"electron","main":"index.js"}');
  writeFileSync(path.join(modulo, "index.js"), `module.exports = ${JSON.stringify(path.join(modulo, "bin"))};`);
  writeFileSync(path.join(modulo, "bin"), "");

  const { c, llamadas } = falsa({
    js: (codigo) => (codigo.includes("getBoundingClientRect") ? { x: 300, y: 400, ancho: 10, alto: 10 } : "valor leído"),
  });
  const cerradas: string[] = [];
  let cierre: (() => void) | undefined;
  let entornoDeLaVentana: Record<string, string | undefined> = {};
  const deps: Deps = {
    cwd: raiz,
    aqui: path.join(app, "dist-electron", "cli"),
    // en vez de lanzar Electron, levanta el servidor con la ventana de mentira, igual que lo haría main.ts
    lanzar: async ({ carpeta, env }) => {
      entornoDeLaVentana = env;
      const s = await servirPantalla(c, carpeta, { ociosoMs: 60_000, salir: () => cerradas.push("salió") });
      cierre = s.cerrar;
    },
  };
  const env = { TRAMA_PANTALLA_DIR: path.join(raiz, "sesiones"), HOME: raiz, USERPROFILE: raiz, PATH: "" };
  let out = "";
  let err = "";
  const io = { out: (s: string) => void (out += s), err: (s: string) => void (err += s) };
  const correr = async (...a: string[]) => {
    out = "";
    err = "";
    return main(a, env, io, deps);
  };

  assert.equal(await correr("estado"), 2, "sin ventana abierta");
  assert.match(err, /no hay una ventana abierta/);

  assert.equal(await correr("abrir", "lider", "HILOS_TEMA=claro", "--tam", "900 600"), 0, err);
  assert.equal(entornoDeLaVentana.HILOS_CAPTURA, "lider");
  assert.equal(entornoDeLaVentana.HILOS_TAM, "900 600");
  assert.equal(entornoDeLaVentana.HILOS_TEMA, "claro");
  assert.equal(entornoDeLaVentana.HOME !== raiz, true, "la ventana no usa el HOME de quien la abre");

  assert.equal(await correr("abrir"), 0, "abrir otra vez no duplica");
  assert.match(out, /ya está abierta/);

  assert.equal(await correr("estado"), 0, err);
  assert.deepEqual(JSON.parse(out), { ok: true, width: 1280, height: 800 });

  assert.equal(await correr("clic", "--sel", "textarea"), 0, err);
  assert.match(out, /clic en 300,400/);
  assert.ok(llamadas.some((l) => l.params.type === "mousePressed" && l.params.x === 300 && l.params.y === 400));
  assert.equal(await correr("clic", "5", "6", "--derecho"), 0, err);
  assert.equal(await correr("clic", "uno"), 2);
  assert.equal(await correr("escribir", "hola", "mundo"), 0, err);
  assert.deepEqual(llamadas.find((l) => l.metodo === "Input.insertText")?.params, { text: "hola mundo" });
  assert.equal(await correr("tecla", "Enter"), 0, err);
  assert.equal(await correr("tecla", "pulpo"), 1, "la ventana lo rechaza");
  assert.match(err, /tecla no entendida/);
  assert.equal(await correr("leer", "#caja"), 0, err);
  assert.equal(out.trim(), "valor leído");
  assert.equal(await correr("js", "1+1"), 0, err);

  const png = path.join(raiz, "salida", "foto.png");
  assert.equal(await correr("captura", "-o", png), 0, err);
  assert.equal(readFileSync(png, "utf8"), "PNG");
  assert.equal(await correr("captura"), 0, err);
  assert.match(out.trim(), /captura-1\.png$/);
  assert.equal(readFileSync(out.trim(), "utf8"), "PNG");

  assert.equal(await correr("cerrar"), 0, err);
  // `cerrar` responde y recién después (setImmediate) la ventana se baja
  await new Promise<void>((listo) => setImmediate(listo));
  assert.deepEqual(cerradas, ["salió"]);
  cierre?.();
  assert.equal(await correr("estado"), 2, "tras cerrar ya no hay sesión");
});

test("servirPantalla: sin el token correcto no contesta nada", async () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "pantalla-tok-"));
  const { c } = falsa();
  const s = await servirPantalla(c, raiz, { ociosoMs: 60_000, salir: ni });
  const http = await import("node:http");
  const estado = await new Promise<number>((listo, fallo) => {
    const req = http.request({ host: "127.0.0.1", port: s.sesion.puerto, path: "/captura", method: "POST", headers: { "x-trama-pantalla": "otro" } }, (res) => {
      res.resume();
      listo(res.statusCode ?? 0);
    });
    req.on("error", fallo);
    req.end();
  });
  assert.equal(estado, 401);
  s.cerrar();
});
