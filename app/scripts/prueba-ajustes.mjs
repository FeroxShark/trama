#!/usr/bin/env node
// Prueba de Ajustes editable (plan, red de seguridad y acceso desde el celular) con fixtures y `HILOS_FALLA=remoto-guardar`
// (el primer Guardar del acceso del celular falla; después anda): lo escrito no se guarda hasta Guardar, lo que no vale se dice
// en línea y no deja guardar (0.0.0.0 no entra como dispositivo, un puerto fuera de rango tampoco), Cancelar vuelve a lo
// guardado, un Guardar que falla deja el error en línea y lo escrito intacto, y lo guardado vuelve al reabrir el panel.
// Nada toca `pa`, el settings ni `remoto.json` de verdad.
//   npm run build && node scripts/prueba-ajustes.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-ajustes-")));
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
    HILOS_FALLA: "remoto-guardar",
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
/** Abre o cierra Ajustes: el primer botón del pie. */
const alternar = () => en(() => document.querySelectorAll(".pie button")[0]?.click());
/** Escribe en un campo como lo haría el teclado (React escucha `input`). */
const escribir = (sel, valor) =>
  en(
    (sel, valor) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    sel,
    valor,
  );
const texto = (sel) => en((sel) => document.querySelector(sel)?.textContent ?? null, sel);
const valor = (sel) => en((sel) => document.querySelector(sel)?.value ?? null, sel);
/** Los botones de un bloque: 0 Guardar, 1 Cancelar; bloque 0 = plan y red, 1 = celular. */
const GUARDAR = 0;
const CANCELAR = 1;
const boton = (bloque, cual) => en((b, c) => document.querySelectorAll(".pn-acciones")[b]?.querySelectorAll(".btn2")[c]?.click(), bloque, cual);
const apagado = (bloque, cual) => en((b, c) => document.querySelectorAll(".pn-acciones")[b]?.querySelectorAll(".btn2")[c]?.disabled, bloque, cual);
const aviso = (bloque) => en((b) => document.querySelectorAll(".pn-acciones")[b]?.textContent ?? "", bloque);
const RED = "#ajustes-red";
const PUERTO = 'input[aria-label="Puerto"]';
const NUEVO = ".pn-nuevo .pn-campo";
const agregar = () => en(() => document.querySelector(".pn-nuevo button")?.click());
const agregarApagado = () => en(() => document.querySelector(".pn-nuevo button")?.disabled);
const lista = async () => (await en(() => [...document.querySelectorAll(".pn-disp .pn-disp-nom")].map((e) => e.textContent))).join(",");
const errores = () => en(() => [...document.querySelectorAll(".pn-campo-error")].map((e) => e.textContent));

async function abrir() {
  await alternar();
  return hasta(() => document.querySelectorAll(".pn-acciones").length === 2, 8);
}
async function reabrir() {
  await alternar();
  await espera(300);
  return abrir();
}

try {
  ok(await hasta(() => !!document.querySelector(".pie button"), 15), "la app abrió");
  ok(await abrir(), "Ajustes abre con la red de seguridad y el acceso del celular");
  ok((await valor(RED)) === "300000", "la red muestra lo guardado");
  ok((await apagado(0, GUARDAR)) && (await apagado(0, CANCELAR)), "sin cambios, Guardar y Cancelar no se pueden apretar");

  // --- La red de seguridad: validar, cancelar, guardar --------------------------------------------
  await escribir(RED, "50");
  ok((await errores()).some((x) => /entre/.test(x)), "una red fuera de rango dice el motivo en línea");
  ok(await apagado(0, GUARDAR), "y no deja guardar");
  await escribir(RED, "doscientos");
  ok((await errores()).some((x) => /dígitos/.test(x)), "con letras también");
  await escribir(RED, "350000");
  ok((await errores()).length === 0 && !(await apagado(0, GUARDAR)), "con un número que vale, el error se va y Guardar se puede apretar");
  await boton(0, CANCELAR);
  await espera(150);
  ok((await valor(RED)) === "300000" && (await apagado(0, GUARDAR)), "Cancelar vuelve a lo guardado");
  await escribir(RED, "350000");
  await reabrir();
  ok((await valor(RED)) === "300000", "lo escrito y no guardado no sobrevive: al reabrir sigue lo de antes");
  await escribir(RED, "350000");
  await boton(0, GUARDAR);
  ok(await hasta(() => /Guardado/.test(document.querySelector(".pn-ok")?.textContent ?? ""), 5), "Guardar dice Guardado");
  await reabrir();
  ok((await valor(RED)) === "350000", "y lo guardado vuelve al reabrir");

  // --- El acceso desde el celular ------------------------------------------------------------------
  ok((await lista()) === "celu-de-prueba,tablet-sala", "la lista de dispositivos es la guardada");
  await escribir(NUEVO, "0.0.0.0");
  ok((await errores()).some((x) => /dirección/.test(x)), "0.0.0.0 como dispositivo se rechaza con el motivo en línea");
  ok(await agregarApagado(), "y Agregar no se puede apretar");
  ok(await apagado(1, GUARDAR), "ni Guardar");
  await foto("ajustes-rechaza-direccion");
  await escribir(NUEVO, "");
  await escribir(PUERTO, "80");
  ok((await errores()).some((x) => /entre/.test(x)) && (await apagado(1, GUARDAR)), "un puerto que no se puede abrir también se rechaza");
  await escribir(PUERTO, "8791");
  await escribir(NUEVO, "mi-tablet");
  ok(/Apretá Agregar/.test(await aviso(1)) && (await apagado(1, GUARDAR)), "un nombre a medio escribir pide Agregar antes de guardar");
  await agregar();
  ok((await lista()) === "celu-de-prueba,tablet-sala,mi-tablet", "Agregar suma el dispositivo a la lista, sin guardar todavía");
  await en(() => document.querySelectorAll(".pn-quitar")[0]?.click());
  ok((await lista()) === "tablet-sala,mi-tablet", "× lo quita de la lista");
  await boton(1, CANCELAR);
  await espera(150);
  ok((await lista()) === "celu-de-prueba,tablet-sala", "Cancelar deja la lista como estaba");

  // El primer Guardar falla: el error queda en línea y lo escrito, intacto.
  await escribir(NUEVO, "mi-tablet");
  await agregar();
  await boton(1, GUARDAR);
  ok(await hasta(() => /EACCES/.test(document.querySelectorAll(".pn-acciones")[1]?.textContent ?? ""), 5), "un Guardar que falla muestra el error en línea");
  ok((await lista()) === "celu-de-prueba,tablet-sala,mi-tablet" && !(await apagado(1, GUARDAR)), "y lo escrito queda como estaba, para reintentar");
  await foto("ajustes-guardar-falla");
  await boton(1, GUARDAR);
  ok(await hasta(() => /Guardado/.test(document.querySelectorAll(".pn-acciones")[1]?.textContent ?? ""), 5), "al reintentar, guarda");
  await reabrir();
  ok((await lista()) === "celu-de-prueba,tablet-sala,mi-tablet", "y el dispositivo agregado vuelve al reabrir");

  // Apagar el acceso sin dispositivos no vale; apagado sí.
  await en(() => document.querySelectorAll(".pn-quitar").forEach((b) => b.click()));
  await en(() => document.querySelectorAll(".pn-quitar").forEach((b) => b.click()));
  await en(() => document.querySelectorAll(".pn-quitar").forEach((b) => b.click()));
  ok((await lista()) === "" && (await apagado(1, GUARDAR)), "prendido y sin dispositivos no se puede guardar");
  await foto("ajustes-celular");
} finally {
  ws.close();
  app.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
