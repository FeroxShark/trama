#!/usr/bin/env node
// Prueba del visor de imágenes: con la captura `lider-imagenes` (variante `visor`: abierto y con la imagen sin llegar) y por CDP, a 1280 px con
// mouse y a 360 px táctil: dice "Cargando imagen…", tiene su botón de cerrar (44 px con el dedo) y se cierra con el botón, con Esc y tocando afuera.
// Todo son fixtures: nada toca `pa` ni datos de verdad.
//   npm run build && node scripts/prueba-visor.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

async function app(ancho, alto, dedo) {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-visor-")));
  const puerto = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
    env: {
      ...process.env,
      HILOS_PRUEBA: "60",
      HILOS_CAPTURA: "lider-imagenes",
      HILOS_CAPTURA_MS: "120000",
      HILOS_VARIANTE: "visor",
      HILOS_IDIOMA: "es",
      HILOS_TAM: `${ancho} ${alto}`,
      HILOS_STATE: path.join(tmp, "hilos"),
      HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
      HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
      PA_STATE: path.join(tmp, "pa"),
      HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
      HILOS_TABLERO: "/bin/false",
    },
    stdio: "ignore",
  });
  let url = null;
  for (let i = 0; i < 150 && !url; i++) {
    try {
      const ts = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
      url = ts.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {}
    if (!url) await espera(100);
  }
  if (!url) throw new Error("la app no abrió el puerto de CDP");
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let n = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    }
  });
  const cdp = (method, params = {}) =>
    new Promise((r) => {
      const id = ++n;
      pend.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const en = async (fn, ...args) => {
    const r = await cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value;
  };
  const hasta = async (fn, tope = 10, ...args) => {
    for (let i = 0; i < tope * 20; i++) {
      const v = await en(fn, ...args).catch(() => null);
      if (v) return v;
      await espera(50);
    }
    return null;
  };
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: dedo ? 2 : 1, mobile: dedo });
  if (dedo) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp("Page.reload");
  const cerrar = () => {
    ws.close();
    proc.kill();
    rmSync(tmp, { recursive: true, force: true });
  };
  const foto = async (nombre) => {
    if (!fotos) return;
    await espera(300);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
  };
  return { cdp, en, hasta, cerrar, foto };
}

const visor = () =>
  document.querySelector(".visor")
    ? (() => {
        const b = document.querySelector(".visor-x")?.getBoundingClientRect();
        const x = document.querySelector(".visor-x");
        return {
          estado: document.querySelector(".visor-estado")?.textContent ?? null,
          ocupado: document.querySelector(".visor")?.getAttribute("aria-busy"),
          boton: !!b && b.width > 0,
          dentro: !!b && b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
          // Lo que se toca: el botón y su ::after, que crece hacia afuera (se comprueba pegándole 6 px afuera de cada lado).
          toque: b
            ? [[b.left - 6, b.top + b.height / 2], [b.right + 6, b.top + b.height / 2], [b.left + b.width / 2, b.top - 6], [b.left + b.width / 2, b.bottom + 6]].every(([x2, y2]) =>
                document.elementsFromPoint(x2, y2).includes(x),
              )
            : false,
          lado: b ? Math.min(b.width, b.height) : 0,
        };
      })()
    : null;

for (const [que, ancho, alto, dedo] of [
  ["1280 con mouse", 1280, 900, false],
  ["360 táctil", 360, 760, true],
]) {
  const a = await app(ancho, alto, dedo);
  try {
    ok(await a.hasta(() => !!document.querySelector(".visor"), 15), `${que}: el visor está abierto`);
    await espera(400);
    const v = await a.en(visor);
    ok(v?.estado === "Cargando imagen…" && v.ocupado === "true", `${que}: dice que está cargando: ${JSON.stringify(v?.estado)}`);
    ok(v?.boton && v.dentro, `${que}: el botón de cerrar está a la vista`);
    if (dedo) ok(v.toque || v.lado >= 44, `${que}: el botón se toca en 44 px o más (caja ${v.lado}, ::after ${v.toque})`);
    await a.foto(`visor-${ancho}`);
    // Con el botón.
    const c = await a.en(() => {
      const r = document.querySelector(".visor-x").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (dedo) {
      await a.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [c] });
      await a.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await a.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...c, button: "left", clickCount: 1 });
      await a.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...c, button: "left", clickCount: 1 });
    }
    ok(await a.hasta(() => !document.querySelector(".visor"), 5), `${que}: el botón lo cierra`);
  } finally {
    a.cerrar();
  }
}

// Esc, sólo con teclado.
{
  const a = await app(1280, 900, false);
  try {
    ok(await a.hasta(() => !!document.querySelector(".visor"), 15), "Esc: el visor está abierto");
    await espera(400);
    await a.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await a.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    ok(await a.hasta(() => !document.querySelector(".visor"), 5), "Esc lo cierra");
  } finally {
    a.cerrar();
  }
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
