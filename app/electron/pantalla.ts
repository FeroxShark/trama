// Control de pantalla de la ventana PROPIA de un worker (#1869): lo que el worker de frontend usa para probar la interfaz solo.
// El comando `pantalla` (electron/cli/pantalla.ts) lanza una Trama offscreen (HILOS_PANTALLA=<carpeta>, como scripts/captura.sh pero
// que sigue viva) y le habla por HTTP a 127.0.0.1 con un token. Todo va por `webContents` (capturePage, sendInputEvent, insertText):
// nunca toca el escritorio ni el puntero del dueño, y no hay dependencia nueva. Este módulo es el lado de la ventana: la lógica
// (`crearPantalla`) recibe el `webContents` por una interfaz mínima para poder probarla sin Electron.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

/** Lo que se usa de `webContents`: la foto, JS en la página y el protocolo de DevTools (`debugger.sendCommand`, que no depende del foco del sistema). */
export interface Contenido {
  capturePage(): Promise<{ toPNG(): Buffer; getSize(): { width: number; height: number } }>;
  executeJavaScript(js: string): Promise<unknown>;
  /** `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`… */
  cdp(metodo: string, params: Record<string, unknown>): Promise<unknown>;
}

export type Respuesta = { estado: number; tipo: string; cuerpo: Buffer | string };

const json = (estado: number, o: unknown): Respuesta => ({ estado, tipo: "application/json", cuerpo: JSON.stringify(o) });
const falla = (estado: number, error: string) => json(estado, { ok: false, error });

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const BOTONES = new Set(["left", "right", "middle"]);
/** Máscara de modificadores de DevTools. */
const MASCARA: Record<string, number> = { alt: 1, ctrl: 2, control: 2, meta: 4, super: 4, cmd: 4, shift: 8 };
type Tecla = { key: string; code: string; vk: number; text?: string };
/** Teclas con nombre → lo que pide `Input.dispatchKeyEvent`. */
const NOMBRADAS: Record<string, Tecla> = {
  enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" }, return: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", vk: 9 }, escape: { key: "Escape", code: "Escape", vk: 27 }, esc: { key: "Escape", code: "Escape", vk: 27 },
  space: { key: " ", code: "Space", vk: 32, text: " " }, espacio: { key: " ", code: "Space", vk: 32, text: " " },
  backspace: { key: "Backspace", code: "Backspace", vk: 8 }, delete: { key: "Delete", code: "Delete", vk: 46 }, supr: { key: "Delete", code: "Delete", vk: 46 },
  up: { key: "ArrowUp", code: "ArrowUp", vk: 38 }, arriba: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", vk: 40 }, abajo: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 }, izquierda: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", vk: 39 }, derecha: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  home: { key: "Home", code: "Home", vk: 36 }, end: { key: "End", code: "End", vk: 35 },
  pageup: { key: "PageUp", code: "PageUp", vk: 33 }, pagedown: { key: "PageDown", code: "PageDown", vk: 34 },
};
/** Atajos de edición que Chromium sólo aplica si se le dice el comando (sin una ventana de verdad no los deduce de la tecla). */
const COMANDOS: Record<string, string> = { "ctrl+a": "selectAll", "ctrl+c": "copy", "ctrl+x": "cut", "ctrl+v": "paste", "ctrl+z": "undo", "ctrl+y": "redo", "ctrl+shift+z": "redo" };

export type Pulsacion = { tecla: Tecla; modifiers: number; comandos: string[] };

/** «ctrl+shift+k» → la tecla, la máscara de modificadores y los comandos de edición; null si no se entiende. */
export function leerTecla(texto: string): Pulsacion | null {
  const partes = texto.split("+").map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return null;
  const ultima = partes[partes.length - 1];
  let modifiers = 0;
  const nombres: string[] = [];
  for (const p of partes.slice(0, -1)) {
    const m = MASCARA[p.toLowerCase()];
    if (!m) return null;
    modifiers |= m;
    nombres.push(p.toLowerCase() === "control" ? "ctrl" : p.toLowerCase());
  }
  const l = ultima.toLowerCase();
  let tecla: Tecla | undefined = NOMBRADAS[l];
  const fn = /^f([1-9]|1[0-2])$/.exec(l);
  if (!tecla && fn) tecla = { key: `F${fn[1]}`, code: `F${fn[1]}`, vk: 111 + Number(fn[1]) };
  if (!tecla && /^[a-z]$/.test(l)) {
    const mayus = !!(modifiers & 8);
    tecla = { key: mayus ? l.toUpperCase() : l, code: `Key${l.toUpperCase()}`, vk: l.toUpperCase().charCodeAt(0), text: modifiers & (2 | 4 | 1) ? undefined : mayus ? l.toUpperCase() : l };
  }
  if (!tecla && /^[0-9]$/.test(l)) tecla = { key: l, code: `Digit${l}`, vk: 48 + Number(l), text: modifiers & (2 | 4 | 1) ? undefined : l };
  if (!tecla) return null;
  const clave = [...new Set(nombres.filter((n) => n !== "meta"))].sort((a, b) => (a === "ctrl" ? -1 : b === "ctrl" ? 1 : 0)).concat(l).join("+");
  return { tecla, modifiers, comandos: COMANDOS[clave] ? [COMANDOS[clave]] : [] };
}

/** Espera dos cuadros pintados: lo que el clic o la tecla provocó ya está en pantalla (sin reloj). */
const ASENTAR = "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))";

/** El centro (en píxeles de la captura) del primer elemento que cumple el selector CSS, o null. */
const DONDE = (selector: string) => `(() => {
  const e = document.querySelector(${JSON.stringify(selector)});
  if (!e) return null;
  e.scrollIntoView({ block: "nearest", inline: "nearest" });
  const r = e.getBoundingClientRect();
  const z = window.devicePixelRatio || 1;
  return { x: Math.round((r.left + r.width / 2) * z), y: Math.round((r.top + r.height / 2) * z), ancho: Math.round(r.width * z), alto: Math.round(r.height * z) };
})()`;

/** El texto visible (`innerText`; `value` si es un campo) del elemento (todo el documento sin selector), recortado a `tope` caracteres. */
const LEER = (selector: string, tope: number) => `(() => {
  const e = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.body"};
  return e ? String(typeof e.value === "string" ? e.value : e.innerText ?? "").slice(0, ${tope}) : null;
})()`;

/**
 * El manejador de pedidos: `POST /<orden>` con cuerpo JSON → respuesta. Las coordenadas son píxeles de la captura
 * (lo que el worker ve en la imagen), con el origen arriba a la izquierda de la ventana.
 */
export function crearPantalla(c: Contenido, opc: { alCerrar: () => void }) {
  const asentar = () => c.executeJavaScript(ASENTAR).catch(() => undefined);
  /** Coordenadas de la captura → píxeles CSS de la página (con zoom distinto de 1 no coinciden). */
  const zoom = async () => {
    const z = await c.executeJavaScript("window.devicePixelRatio").catch(() => 1);
    return typeof z === "number" && z > 0 ? z : 1;
  };
  const raton = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) => c.cdp("Input.dispatchMouseEvent", { type, x, y, ...extra });

  async function clic(x: number, y: number, boton: string, veces: number) {
    const z = await zoom();
    const [cx, cy] = [x / z, y / z];
    await raton("mouseMoved", cx, cy, { button: "none" });
    for (let n = 1; n <= veces; n++) {
      await raton("mousePressed", cx, cy, { button: boton, buttons: boton === "left" ? 1 : boton === "right" ? 2 : 4, clickCount: n });
      await raton("mouseReleased", cx, cy, { button: boton, buttons: 0, clickCount: n });
    }
    await asentar();
  }

  async function atender(orden: string, cuerpo: Record<string, unknown>): Promise<Respuesta> {
    switch (orden) {
      case "estado": {
        const f = await c.capturePage();
        return json(200, { ok: true, ...f.getSize() });
      }
      case "captura": {
        await asentar();
        return { estado: 200, tipo: "image/png", cuerpo: (await c.capturePage()).toPNG() };
      }
      case "clic": {
        const x = num(cuerpo.x), y = num(cuerpo.y);
        if (x === null || y === null) return falla(400, "clic pide x e y (números, en píxeles de la captura)");
        const boton = typeof cuerpo.boton === "string" ? cuerpo.boton : "left";
        if (!BOTONES.has(boton)) return falla(400, "botón desconocido: izquierdo/derecho/medio (left, right, middle)");
        const veces = Math.min(3, Math.max(1, num(cuerpo.veces) ?? 1));
        await clic(x, y, boton, veces);
        return json(200, { ok: true });
      }
      case "mover": {
        const x = num(cuerpo.x), y = num(cuerpo.y);
        if (x === null || y === null) return falla(400, "mover pide x e y");
        const z = await zoom();
        await raton("mouseMoved", x / z, y / z, { button: "none" });
        await asentar();
        return json(200, { ok: true });
      }
      case "rueda": {
        const x = num(cuerpo.x) ?? 0, y = num(cuerpo.y) ?? 0, dy = num(cuerpo.dy);
        if (dy === null) return falla(400, "rueda pide dy (positivo = hacia abajo)");
        const z = await zoom();
        await raton("mouseWheel", x / z, y / z, { deltaX: 0, deltaY: dy / z });
        await asentar();
        return json(200, { ok: true });
      }
      case "escribir": {
        if (typeof cuerpo.texto !== "string" || !cuerpo.texto) return falla(400, "escribir pide un texto");
        await c.cdp("Input.insertText", { text: cuerpo.texto });
        await asentar();
        return json(200, { ok: true });
      }
      case "tecla": {
        const t = typeof cuerpo.tecla === "string" ? leerTecla(cuerpo.tecla) : null;
        if (!t) return falla(400, "tecla no entendida: Enter, Tab, Escape, Backspace, flechas, F1..F12, una letra, con ctrl+/shift+/alt+ delante");
        const base = { key: t.tecla.key, code: t.tecla.code, windowsVirtualKeyCode: t.tecla.vk, nativeVirtualKeyCode: t.tecla.vk, modifiers: t.modifiers };
        await c.cdp("Input.dispatchKeyEvent", { ...base, type: t.tecla.text ? "keyDown" : "rawKeyDown", text: t.tecla.text, commands: t.comandos });
        await c.cdp("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
        await asentar();
        return json(200, { ok: true });
      }
      case "donde": {
        if (typeof cuerpo.selector !== "string" || !cuerpo.selector) return falla(400, "donde pide un selector CSS");
        const r = await c.executeJavaScript(DONDE(cuerpo.selector));
        return r ? json(200, { ok: true, ...(r as object) }) : falla(404, `no hay ningún elemento para «${cuerpo.selector}»`);
      }
      case "leer": {
        const selector = typeof cuerpo.selector === "string" ? cuerpo.selector : "";
        const tope = Math.min(100_000, Math.max(1, num(cuerpo.tope) ?? 20_000));
        const r = await c.executeJavaScript(LEER(selector, tope));
        return typeof r === "string" ? { estado: 200, tipo: "text/plain; charset=utf-8", cuerpo: r } : falla(404, `no hay ningún elemento para «${selector}»`);
      }
      case "js": {
        if (typeof cuerpo.codigo !== "string" || !cuerpo.codigo) return falla(400, "js pide el código (una expresión)");
        const r = await c.executeJavaScript(cuerpo.codigo);
        return json(200, { ok: true, valor: r === undefined ? null : r });
      }
      case "cerrar":
        setImmediate(opc.alCerrar);
        return json(200, { ok: true });
      default:
        return falla(404, `orden desconocida: ${orden}`);
    }
  }

  return async function manejar(metodo: string, ruta: string, cuerpoCrudo: string): Promise<Respuesta> {
    if (metodo !== "POST") return falla(405, "sólo POST");
    const orden = ruta.replace(/^\/+/, "");
    let cuerpo: Record<string, unknown> = {};
    if (cuerpoCrudo.trim()) {
      try {
        const o: unknown = JSON.parse(cuerpoCrudo);
        if (!o || typeof o !== "object" || Array.isArray(o)) return falla(400, "el cuerpo tiene que ser un objeto JSON");
        cuerpo = o as Record<string, unknown>;
      } catch {
        return falla(400, "el cuerpo no es JSON");
      }
    }
    try {
      return await atender(orden, cuerpo);
    } catch (e) {
      return falla(500, String((e as Error)?.message ?? e));
    }
  };
}

/** Lo que el CLI lee para encontrar la ventana: `<carpeta>/sesion.json`. */
export type Sesion = { puerto: number; token: string; pid: number };

const igual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Levanta el servidor en 127.0.0.1 (puerto libre) y deja `sesion.json` (0600) en la carpeta. Se cierra solo tras `ociosoMs`
 * sin pedidos: una ventana que el worker se olvidó no queda viva. Devuelve `cerrar`.
 */
export async function servirPantalla(c: Contenido, carpeta: string, opc: { ociosoMs: number; salir: () => void }): Promise<{ cerrar: () => void; sesion: Sesion }> {
  const token = randomBytes(24).toString("hex");
  let reloj: NodeJS.Timeout | undefined;
  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    if (reloj) clearTimeout(reloj);
    rmSync(path.join(carpeta, "sesion.json"), { force: true });
    servidor.close();
    opc.salir();
  };
  const manejar = crearPantalla(c, { alCerrar: cerrar });
  const vigilar = () => {
    if (reloj) clearTimeout(reloj);
    reloj = setTimeout(cerrar, opc.ociosoMs);
    reloj.unref();
  };
  const servidor = http.createServer((req, res) => {
    const dado = String(req.headers["x-trama-pantalla"] ?? "");
    if (!igual(dado, token)) {
      res.writeHead(401).end();
      return;
    }
    vigilar();
    const trozos: Buffer[] = [];
    let largo = 0;
    req.on("data", (t: Buffer) => {
      largo += t.length;
      if (largo > 1_000_000) req.destroy();
      else trozos.push(t);
    });
    req.on("end", () => {
      void manejar(req.method ?? "", (req.url ?? "/").split("?")[0], Buffer.concat(trozos).toString("utf8")).then((r) => {
        res.writeHead(r.estado, { "content-type": r.tipo }).end(r.cuerpo);
      });
    });
  });
  await new Promise<void>((listo, fallo) => {
    servidor.once("error", fallo);
    servidor.listen(0, "127.0.0.1", listo);
  });
  const puerto = (servidor.address() as { port: number }).port;
  const sesion: Sesion = { puerto, token, pid: process.pid };
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(path.join(carpeta, "sesion.json"), JSON.stringify(sesion), { mode: 0o600 });
  vigilar();
  return { cerrar, sesion };
}

/**
 * El `webContents` de Electron como `Contenido`. Entrada por DevTools (`webContents.debugger`) y no `sendInputEvent`: en una ventana
 * offscreen sin foco del sistema éste no llegaba a la página (ni clics ni hover). Se prende además el foco emulado, así `:focus`,
 * `document.hasFocus()` y el cursor de los campos andan como con la ventana al frente.
 */
export function contenidoDe(wc: import("electron").WebContents): Contenido {
  let listo: Promise<unknown> | null = null;
  const preparar = () => {
    if (!listo) {
      wc.debugger.attach("1.3");
      listo = wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    }
    return listo;
  };
  return {
    capturePage: () => wc.capturePage(),
    executeJavaScript: (js) => wc.executeJavaScript(js),
    cdp: async (metodo, params) => {
      await preparar();
      return wc.debugger.sendCommand(metodo, params);
    },
  };
}
