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
/** La barra de Guardar es una sola (suma plan y compactación, modelos y celular): 0 Guardar, 1 Cancelar. */
const GUARDAR = 0;
const CANCELAR = 1;
const boton = (_b, cual) => en((c) => document.querySelectorAll(".pn-barra .btn2")[c === 0 ? 1 : 0]?.click(), cual);
const apagado = (_b, cual) => en((c) => document.querySelectorAll(".pn-barra .btn2")[c === 0 ? 1 : 0]?.disabled, cual);
/** Lo que dice la barra (también los avisos de los bloques, como "Apretá Agregar"). */
const aviso = () => en(() => document.querySelector(".pn-barra")?.textContent ?? "");
const PUERTO = 'input[aria-label="Puerto"]';
const NUEVO = ".pn-nuevo .pn-campo";
const agregar = () => en(() => document.querySelector(".pn-nuevo button")?.click());
const agregarApagado = () => en(() => document.querySelector(".pn-nuevo button")?.disabled);
const lista = async () => (await en(() => [...document.querySelectorAll(".pn-disp:not(.mdl-instalados):not(.mdl-locales) .pn-disp-nom")].map((e) => e.textContent))).join(",");
const errores = () => en(() => [...document.querySelectorAll(".pn-campo-error")].map((e) => e.textContent));

async function abrir() {
  await alternar();
  return hasta(() => !!document.querySelector(".pn-barra") && !!document.querySelector(".pn-nuevo"), 8);
}
async function reabrir() {
  await alternar();
  await espera(300);
  return abrir();
}

try {
  ok(await hasta(() => !!document.querySelector(".pie button"), 15), "la app abrió");
  ok(await abrir(), "Ajustes abre con la compactación y el acceso del celular");

  // --- La compactación (General): un selector de topes, borrador, cancelar y guardar -----------------------------------
  const COMP = "[data-opc='ajustes.compactar']";
  const tope = () => en((c) => document.querySelector(`${c} button`)?.textContent ?? "", COMP);
  const elegirTope = async (txt) => {
    await en((c) => document.querySelector(`${c} button`)?.click(), COMP);
    ok(await hasta(() => document.querySelectorAll("[role=option]").length > 0, 3), "el selector de topes abre");
    const lista = await en(() => [...document.querySelectorAll("[role=option]")].map((o) => o.textContent.replace(/\s+/g, " ")));
    await en((txt) => [...document.querySelectorAll("[role=option]")].find((o) => o.textContent.includes(txt))?.click(), txt);
    await espera(150);
    return lista;
  };
  await en(() => document.querySelector(".aj-it[data-cat='general']")?.click());
  ok(await hasta(() => !!document.querySelector(".aj-cat:not([hidden]) [data-opc='ajustes.compactar']"), 3), "la compactación está en General");
  ok(/300.000 tokens/.test(await tope()), "el selector muestra lo guardado (300 000, que no está en la lista fija)");
  ok((await apagado(0, GUARDAR)) && (await apagado(0, CANCELAR)), "sin cambios, Guardar y Cancelar no se pueden apretar");
  const opciones = await elegirTope("150");
  ok(["100", "150", "200", "300", "Sin tope"].every((x) => opciones.some((o) => o.includes(x))), "ofrece 100k, 150k, 200k, 300k y sin tope");
  ok(opciones.filter((o) => /default|por defecto/i.test(o)).length === 1 && /200.000/.test(opciones.find((o) => /default|por defecto/i.test(o)) ?? ""), "y marca el de 200 000 como default");
  ok(/150.000 tokens/.test(await tope()), "elegir uno lo pone en el botón");
  ok(/sin guardar/i.test(await aviso(0)) && !(await apagado(0, GUARDAR)), "con un cambio, la barra dice 'Cambios sin guardar' y Guardar se puede apretar");
  ok(await en(() => { const r = document.querySelector(".pn-barra")?.getBoundingClientRect(); return !!r && r.bottom <= innerHeight + 1 && r.top >= 0; }), "y la barra está a la vista");
  await foto("ajustes-compactar-editando");
  await boton(0, CANCELAR);
  await espera(150);
  ok(/300.000 tokens/.test(await tope()) && (await apagado(0, GUARDAR)), "Cancelar vuelve a lo guardado");
  await elegirTope("150");
  await reabrir();
  await en(() => document.querySelector(".aj-it[data-cat='general']")?.click());
  ok(/300.000 tokens/.test(await tope()), "lo elegido y no guardado no sobrevive: al reabrir sigue lo de antes");
  await elegirTope("Sin tope");
  await boton(0, GUARDAR);
  ok(await hasta(() => /Guardado/.test(document.querySelector(".pn-barra-estado")?.textContent ?? ""), 5), "Guardar dice Guardado");
  await reabrir();
  await en(() => document.querySelector(".aj-it[data-cat='general']")?.click());
  ok(/Sin tope/.test(await tope()), "y lo guardado vuelve al reabrir");
  await foto("ajustes-compactar-guardado");
  await en(() => document.querySelector(".aj-it[data-cat='modelos']")?.click());

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
  ok(await hasta(() => /EACCES/.test(document.querySelector(".pn-barra")?.textContent ?? ""), 5), "un Guardar que falla muestra el error en línea");
  ok((await lista()) === "celu-de-prueba,tablet-sala,mi-tablet" && !(await apagado(1, GUARDAR)), "y lo escrito queda como estaba, para reintentar");
  await foto("ajustes-guardar-falla");
  await boton(1, GUARDAR);
  ok(await hasta(() => /Guardado/.test(document.querySelector(".pn-barra")?.textContent ?? ""), 5), "al reintentar, guarda");
  await reabrir();
  ok((await lista()) === "celu-de-prueba,tablet-sala,mi-tablet", "y el dispositivo agregado vuelve al reabrir");

  // Apagar el acceso sin dispositivos no vale; apagado sí.
  await en(() => document.querySelectorAll(".pn-quitar").forEach((b) => b.click()));
  await en(() => document.querySelectorAll(".pn-quitar").forEach((b) => b.click()));
  await en(() => document.querySelectorAll(".pn-quitar").forEach((b) => b.click()));
  ok((await lista()) === "" && (await apagado(1, GUARDAR)), "prendido y sin dispositivos no se puede guardar");
  await foto("ajustes-celular");

  // --- La estructura: categorías a la izquierda, buscador arriba, una categoría a la vez --------------------------------
  const cats = () => en(() => [...document.querySelectorAll(".aj-it")].map((b) => b.dataset.cat).join(","));
  const activa = () => en(() => document.querySelector(".aj-it[aria-current='page']")?.dataset.cat ?? null);
  const visibles = () => en(() => [...new Set([...document.querySelectorAll(".aj-cat:not([hidden])")].map((c) => c.dataset.cat))].join(","));
  const ir = (c) => en((c) => document.querySelector(`.aj-it[data-cat="${c}"]`)?.click(), c);
  ok((await cats()) === "modelos,cupos,locales,celular,general", "la barra lateral lista las categorías de esta máquina (sin Cuentas ni Actualizaciones: son del .exe de Windows)");
  ok((await activa()) === "modelos" && (await visibles()) === "modelos", "arranca en Modelos y sólo se ve esa categoría");
  ok(await en(() => [...document.querySelectorAll(".aj-it")].every((b) => b.querySelector("svg"))), "cada categoría lleva su ícono");
  await ir("cupos");
  ok((await activa()) === "cupos" && (await visibles()) === "cupos" && (await en(() => location.hash)) === "#ajustes/cupos", "elegir una categoría muestra sólo esa y la recuerda en la URL");
  ok(await en(() => !!document.querySelector(".aj-cat:not([hidden]) [data-opc='ajustes.planSus']") && !document.querySelector(".aj-cat:not([hidden]) [data-opc='ajustes.idioma']")), "lo de otras categorías no se ve");
  await foto("ajustes-cupos");

  // Escribir y cambiar de categoría no pierde el borrador: todo sigue montado.
  await boton(0, CANCELAR);
  await ir("general");
  await elegirTope("100");
  await ir("cupos");
  await ir("general");
  ok(!(await apagado(0, GUARDAR)) && /100.000 tokens/.test(await tope()), "un borrador sin guardar sobrevive a cambiar de categoría y la barra de abajo sigue a la vista");
  await boton(0, CANCELAR);

  // El buscador: por título, por sinónimo en otro idioma, sin resultados, Esc, y saltar a la fila resaltándola.
  const BUSCA = ".aj-busca-c";
  const filas = () => en(() => [...document.querySelectorAll(".aj-res-f .aj-res-n")].map((e) => e.textContent));
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await en(() => document.querySelector(".aj-busca-c")?.focus());
  await escribir(BUSCA, "language");
  ok(await hasta(() => document.querySelectorAll(".aj-res-f").length > 0, 3), "el buscador encuentra una opción por un sinónimo en otro idioma");
  ok((await filas()).includes("Idioma"), "y la muestra con su título");
  await foto("ajustes-busca");
  await escribir(BUSCA, "zzzxqy");
  ok(await hasta(() => !!document.querySelector(".aj-res-vacio"), 3), "sin resultados lo dice en una línea");
  await en(() => document.querySelector(".aj-busca-c")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  ok((await valor(BUSCA)) === "" && (await en(() => !!document.querySelector(".aj-busca-c") && !!document.querySelector(".pn-ajustes"))), "Esc borra lo escrito y no cierra el panel");
  await en(() => document.querySelector(".aj-busca-c")?.focus());
  await escribir(BUSCA, "idioma");
  await hasta(() => document.querySelectorAll(".aj-res-f").length > 0, 3);
  await en(() => document.querySelector(".aj-busca-c")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  ok(await hasta(() => document.querySelector(".aj-it[aria-current='page']")?.dataset.cat === "general", 3), "Enter en un resultado salta a su categoría");
  ok(await hasta(() => document.querySelector("[data-opc='ajustes.idioma']")?.hasAttribute("data-resalta"), 3), "y resalta la fila");
  ok((await valor(BUSCA)) === "", "y deja el buscador vacío");
  await foto("ajustes-resalta");
  ok(await hasta(() => !document.querySelector("[data-resalta]"), 4), "el resalte se apaga solo");

  // Angosto: con el panel chico la barra lateral pasa a un selector arriba (una ventana de 800 px).
  await cdp("Emulation.setDeviceMetricsOverride", { width: 800, height: 800, deviceScaleFactor: 1, mobile: false });
  await espera(400);
  ok(await en(() => getComputedStyle(document.querySelector(".aj-nav")).display === "none" && getComputedStyle(document.querySelector(".aj-sel")).display !== "none"), "a 800 px la barra lateral se vuelve un selector");
  ok(await en(() => document.querySelector(".aj-sel .pbtn, .aj-sel button")?.textContent?.includes("General")), "que dice la categoría de ahora");
  ok(await en(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector(".aj")?.getBoundingClientRect().right <= innerWidth + 1), "y nada se sale de la pantalla");
  await foto("ajustes-800");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await espera(300);
  ok(await en(() => getComputedStyle(document.querySelector(".aj-nav")).display !== "none" && getComputedStyle(document.querySelector(".aj-sel")).display === "none"), "a 1280 px vuelve la barra lateral y el selector se esconde");
} finally {
  ws.close();
  app.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
