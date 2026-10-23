#!/usr/bin/env node
// Prueba del registro histórico al cambiar de período: con fixtures, en Estadísticas se elige el filtro de Líderes y se pasa de 7 a 30 días
// con el pedido demorado. Lo abierto no se colapsa: las secciones siguen ahí, apagadas (`data-viejo`), el filtro sigue en Líderes, y al llegar
// lo nuevo se encienden. Todo son fixtures: nada toca `pa` ni datos de verdad.
//   npm run build && node scripts/prueba-historial.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-historial-")));
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
const puerto = 9300 + Math.floor(Math.random() * 600);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
  env: {
    ...process.env,
    HILOS_PRUEBA: "60",
    HILOS_IDIOMA: "es",
    HILOS_FIXTURES: "1",
    HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
    PA_STATE: path.join(tmp, "pa"),
    HILOS_STATE: path.join(tmp, "hilos"),
    HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
    HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
    HILOS_HYPRCTL: "/bin/false",
    HILOS_KITTEN: "/bin/false",
  },
  stdio: "ignore",
});

async function conectar() {
  for (let i = 0; i < 150; i++) {
    try {
      const ts = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
      const p = ts.find((t) => t.type === "page");
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await espera(100);
  }
  throw new Error("la app no abrió el puerto de CDP");
}

const ws = new WebSocket(await conectar());
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
async function en(fn, ...args) {
  const r = await cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
}
async function hasta(fn, tope, ...args) {
  for (let i = 0; i < tope * 20; i++) {
    const v = await en(fn, ...args).catch(() => null);
    if (v) return v;
    await espera(50);
  }
  return null;
}
async function foto(nombre) {
  if (!fotos) return;
  await espera(300);
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
}
const pulsar = (aria, texto) =>
  en(
    (aria, texto) => {
      const b = [...document.querySelectorAll(`[aria-label="${aria}"] button`)].find((x) => x.textContent.trim() === texto);
      b?.click();
      return !!b;
    },
    aria,
    texto,
  );
const estado = () =>
  en(() => ({
    secciones: document.querySelectorAll(".pn-sec").length,
    apagadas: document.querySelectorAll(".pn-sec[data-viejo]").length,
    leyendo: [...document.querySelectorAll(".pn-aviso")].some((a) => /Leyendo/i.test(a.textContent)),
    filtro: [...document.querySelectorAll('[aria-label="Rol"] button')].find((b) => b.getAttribute("aria-pressed") === "true")?.textContent.trim() ?? null,
    periodo: [...document.querySelectorAll('[aria-label="Período"] button')].find((b) => b.getAttribute("aria-pressed") === "true")?.textContent.trim() ?? null,
    alto: Math.round(document.querySelector(".pn-sec")?.closest("[class*='pn-']")?.getBoundingClientRect().height ?? 0),
  }));

try {
  ok(await hasta(() => !!document.querySelector(".pie button"), 15), "la app abrió");
  await en(() => document.querySelectorAll(".pie button")[2]?.click());
  ok(await hasta(() => !!document.querySelector('[aria-label="Rol"]'), 10), "Estadísticas cargó su registro histórico");
  await pulsar("Rol", "Líderes");
  await espera(400);
  let e = await estado();
  ok(e.filtro === "Líderes" && e.periodo === "7 días" && e.apagadas === 0, `filtro en Líderes, 7 días, nada apagado: ${JSON.stringify(e)}`);
  await foto("historial-7");

  await en(() => (globalThis.__historialDemora = 1500));
  await pulsar("Período", "30 días");
  await espera(300);
  const durante = await estado();
  ok(durante.periodo === "30 días", "el período cambió ya");
  ok(!durante.leyendo && durante.secciones === e.secciones, `no se vació ni colapsó: ${e.secciones} secciones antes, ${durante.secciones} durante`);
  ok(durante.apagadas > 0, "lo anterior queda apagado mientras llega lo nuevo");
  ok(durante.filtro === "Líderes", "el filtro de Líderes sigue elegido");
  await foto("historial-30-llegando");

  ok(await hasta(() => document.querySelectorAll(".pn-sec[data-viejo]").length === 0, 10), "al llegar lo nuevo se enciende");
  e = await estado();
  ok(e.filtro === "Líderes" && e.secciones === durante.secciones, `y el filtro sigue en Líderes: ${JSON.stringify(e)}`);
  await foto("historial-30");
} finally {
  ws.close();
  app.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
