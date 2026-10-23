#!/usr/bin/env node
// Mide la conversación larga: abre la app offscreen (HILOS_PRUEBA, sin ventana, fixtures y fakes) con el chat de un líder de
// 3000 mensajes inventados (captura `lider-formato`, `HILOS_VARIANTE=larga`) y por CDP saca:
//   abrir    ms desde que se recarga la página hasta que el último mensaje está pintado y la vista abajo (con su arranque)
//   tipear   ms de cada tecla en la caja hasta el cuadro siguiente (mediana y p95) y cuánto traba (tareas largas)
//   scrollear  cuadros pasados de 24 ms mientras se rueda hacia arriba y hacia abajo
//   nodos    cuántos elementos tiene la página
// Compara con la misma app y una conversación corta (`HILOS_VARIANTE=pegado`: 5 mensajes), que es el arranque sin la conversación.
//   npm run build && node scripts/medir-larga.mjs [etiqueta]      (SIN_CV=1: sin content-visibility)
// Una instancia a la vez, sin tocar `pa` ni los líderes de verdad. Sólo imprime números.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const TECLAS = 30;

async function abrir(variante) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-larga-"));
  const puerto = 9300 + Math.floor(Math.random() * 600);
  const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
    env: {
      ...process.env,
      HILOS_PRUEBA: "120",
      HILOS_CAPTURA: "lider-formato",
      HILOS_CAPTURA_MS: "120000",
      HILOS_VARIANTE: variante,
      HILOS_IDIOMA: "es",
      HILOS_TAM: "1280 900",
      HILOS_STATE: path.join(tmp, "hilos"),
      HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
      HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
      PA_STATE: path.join(tmp, "pa"),
      HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
      HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
      HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
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
  if (!url) {
    app.kill();
    throw new Error("la app no abrió el puerto de CDP");
  }
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
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "error en la página");
    return r.result?.result?.value;
  };
  const cerrar = () => {
    ws.close();
    app.kill();
    rmSync(tmp, { recursive: true, force: true });
  };
  return { cdp, en, cerrar };
}

/** Se instala antes de que cargue la página: anota cuándo el último mensaje está pintado y la vista abajo. */
const espiar = (ultimo) => {
  window.__abrio = null;
  const listo = () => {
    const z = document.querySelector(".conv-zona");
    if (!z) return false;
    const els = z.querySelectorAll(".el");
    const ult = els[els.length - 1];
    return !!ult && ult.textContent.includes(ultimo) && z.scrollHeight - z.scrollTop - z.clientHeight < 4;
  };
  const mo = new MutationObserver(() => {
    if (window.__abrio !== null || !listo()) return;
    mo.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => (window.__abrio = performance.now())));
  });
  document.addEventListener("DOMContentLoaded", () => mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }));
};

const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];
const f1 = (x) => Math.round(x * 10) / 10;

async function medir(variante, ultimo) {
  const a = await abrir(variante);
  try {
    await a.cdp("Page.enable");
    await a.cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await espera(2500);
    await a.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(${espiar})(${JSON.stringify(ultimo)})` });
    // SIN_CV=1: el mismo build sin `content-visibility`, para ver qué aporta.
    if (process.env.SIN_CV)
      await a.cdp("Page.addScriptToEvaluateOnNewDocument", {
        source: `document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = "* { content-visibility: visible !important }"; document.head.append(s); });`,
      });
    const abrio = [];
    for (let k = 0; k < 3; k++) {
      await a.cdp("Page.reload");
      let t = null;
      for (let i = 0; i < 300 && t === null; i++) {
        await espera(100);
        t = await a.en(() => window.__abrio).catch(() => null);
      }
      abrio.push(t);
      await espera(800);
    }
    const nodos = await a.en(() => document.querySelectorAll("*").length);
    const alto = await a.en(() => document.querySelector(".conv-zona")?.scrollHeight ?? 0);

    // Tipear: cada tecla hasta el cuadro siguiente.
    await a.en(() => {
      window.__lat = [];
      window.__largas = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__largas += e.duration))).observe({ type: "longtask", buffered: false });
      document.addEventListener(
        "input",
        (e) => {
          const t0 = e.timeStamp;
          requestAnimationFrame(() => {
            const c = new MessageChannel();
            c.port1.onmessage = () => window.__lat.push(performance.now() - t0);
            c.port2.postMessage(0);
          });
        },
        true,
      );
      document.querySelector("textarea")?.focus();
    });
    for (let k = 0; k < TECLAS; k++) {
      const c = "abcdefghij"[k % 10];
      await a.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: c, text: c });
      await a.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: c });
      await espera(60);
    }
    await espera(300);
    const lat = await a.en(() => window.__lat);
    const largas = await a.en(() => window.__largas);

    // Scrollear: ruedita hacia arriba hasta el principio de lo cargado y de vuelta, contando los cuadros lentos.
    await a.en(() => {
      window.__cuadros = [];
      let ant = performance.now();
      const paso = (t) => {
        window.__cuadros.push(t - ant);
        ant = t;
        if (window.__mide) requestAnimationFrame(paso);
      };
      window.__mide = true;
      requestAnimationFrame(paso);
    });
    const rueda = async (dy, veces) => {
      for (let k = 0; k < veces; k++) {
        await a.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 640, y: 400, deltaX: 0, deltaY: dy });
        await espera(25);
      }
    };
    await rueda(-1500, 40);
    await rueda(1500, 40);
    await a.en(() => (window.__mide = false));
    await espera(100);
    const cuadros = await a.en(() => window.__cuadros.slice(2));
    const arriba = await a.en(() => {
      const z = document.querySelector(".conv-zona");
      return Math.round(z.scrollHeight - z.scrollTop - z.clientHeight);
    });
    return {
      abrir: Math.round(mediana(abrio)),
      abrirTodas: abrio.map(Math.round),
      tipearMed: f1(mediana(lat)),
      tipearP95: f1(p95(lat)),
      tareasLargasMs: Math.round(largas),
      cuadrosLentos: cuadros.filter((x) => x > 24).length + "/" + cuadros.length,
      cuadroMax: Math.round(Math.max(...cuadros)),
      nodos,
      alto,
      alFondoTrasRueda: arriba,
    };
  } finally {
    a.cerrar();
  }
}

const etiqueta = process.argv[2] ?? "";
console.log(`--- ${etiqueta || "medición"} ---`);
const corta = await medir("pegado", "Pedí uno nuevo");
console.log("conversación corta (5 mensajes):", JSON.stringify({ abrir: corta.abrir, nodos: corta.nodos, tipearMed: corta.tipearMed }));
const larga = await medir("larga", "caso 999");
console.log("conversación larga (3000):      ", JSON.stringify(larga));
