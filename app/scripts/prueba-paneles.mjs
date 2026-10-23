#!/usr/bin/env node
// Prueba de los paneles que no cargan: con fixtures y `HILOS_FALLA=paneles-una` (el primer pedido de
// Ajustes, de Estadísticas y de su registro histórico falla; después andan) abre cada panel y comprueba
// que no queda mudo: el aviso con el motivo en una línea (una frase simple si es de los errores conocidos
// de `pa`) y un Reintentar que lo vuelve a pedir y deja el panel con sus datos. Nada toca `pa` ni datos
// de verdad: todo son fixtures.
//   npm run build && node scripts/prueba-paneles.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-paneles-")));
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
    HILOS_FALLA: "paneles-una",
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
/** Abre el panel del pie por su lugar: 0 Ajustes, 2 Estadísticas. */
const abrir = (i) => en((i) => document.querySelectorAll(".pie button")[i]?.click(), i);
const avisos = () =>
  en(() =>
    [...document.querySelectorAll(".pn-falla")].map((a) => ({
      texto: a.querySelector(".pn-falla-t")?.textContent ?? "",
      boton: a.querySelector("button")?.textContent ?? "",
      alto: Math.round(a.getBoundingClientRect().height),
      ancho: Math.round(a.getBoundingClientRect().width),
      salido: a.scrollWidth > a.clientWidth + 1,
    })),
  );
const reintentar = () => en(() => document.querySelector(".pn-falla button")?.click());

try {
  ok(await hasta(() => !!document.querySelector(".pie button"), 15), "la app abrió");

  // --- Ajustes: el pedido falla con un error conocido de pa ------------------------------------
  await abrir(0);
  ok(await hasta(() => !!document.querySelector(".pn-falla"), 8), "Ajustes que no cargó muestra el aviso, no queda mudo");
  let a = await avisos();
  ok(a.length === 1 && /límite de sesión/i.test(a[0].texto) && !/pa:/.test(a[0].texto), `el motivo es una frase simple: "${a[0]?.texto}"`);
  ok(a[0]?.boton === "Reintentar" && a[0].alto > 10, "con su Reintentar");
  await foto("ajustes-error");
  await reintentar();
  ok(await hasta(() => !document.querySelector(".pn-falla") && !!document.querySelector("[class*='pn-']"), 8), "Reintentar lo pide de nuevo y el aviso se va");
  await abrir(0); // cierra

  // --- Estadísticas: la medición (error de red) y el registro histórico (error desconocido, crudo) ----
  await abrir(2);
  ok(await hasta(() => document.querySelectorAll(".pn-falla").length >= 1, 8), "Estadísticas que no cargó muestra el aviso");
  await espera(400);
  a = await avisos();
  ok(a.some((x) => /sin conexión/i.test(x.texto)), `la falla de red dice "sin conexión": ${JSON.stringify(a.map((x) => x.texto))}`);
  ok(a.every((x) => !x.salido && x.boton === "Reintentar"), "el aviso cabe en su lugar y trae Reintentar");
  await foto("estadisticas-error");
  // El registro histórico se pide recién cuando la medición cargó: falla con algo que no se conoce.
  await reintentar();
  ok(await hasta(() => /EACCES/.test(document.querySelector(".pn-falla")?.textContent ?? ""), 8), "el registro histórico que no cargó dice el error tal cual, si no se lo conoce");
  a = await avisos();
  ok(a.length === 1 && !a[0].salido && a[0].boton === "Reintentar", "también con su Reintentar, y cabe");
  await foto("historial-error");
  for (let i = 0; i < 4 && (await avisos()).length; i++) {
    await reintentar();
    await espera(400);
  }
  ok((await avisos()).length === 0, "reintentando cada uno, los paneles cargan y no queda ningún aviso");
  await foto("estadisticas-ok");
} finally {
  ws.close();
  app.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
