#!/usr/bin/env node
// Prueba de Ajustes > Conectores como tienda (AjustesConectores.tsx y las Tienda*.tsx) con fixtures: nada se instala de verdad (los
// datos de muestra viven en memoria y el HOME es temporal). Mira: las cuatro pestañas con su número, «Tuyos | Descubrir», el buscador,
// el orden, las secciones de Descubrir de los plugins («Nuevos», «Más instalados», «Categorías» con conteo que filtran), el «+» de un
// plugin (instala y pasa a ✓), el «+» de una skill (abre la confirmación con sus archivos y NO instala hasta confirmar), el detalle de
// una tarjeta (Escape lo cierra), el panel «Agregar» de cada pestaña y que Hooks no ofrece agregar. Sin consolas ni claves de nadie.
//   npm run build && node scripts/prueba-conectores.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-conectores-")));
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
/** Una tecla de verdad (por CDP, como la del teclado): va al elemento con el foco. */
const tecla = async (key, code, vk) => {
  for (const type of ["rawKeyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk });
};
const escape = async () => {
  await hasta(() => document.querySelector("[data-tarjeta-detalle]")?.contains(document.activeElement) === true, 3);
  // La primera tecla tras abrir el diálogo a veces se pierde en el Electron sin ventana que maneja CDP (a mano, y con `pantalla tecla`, siempre cierra): se repite hasta 3 veces.
  for (let i = 0; i < 3; i++) {
    await tecla("Escape", "Escape", 27);
    if (await hasta(() => !document.querySelector("[data-tarjeta-detalle]"), 1)) return;
  }
};
const clic = (sel) => en((s) => { const e = document.querySelector(s); e?.click(); return !!e; }, sel);
const cuantas = (sel) => en((s) => document.querySelectorAll(s).length, sel);
const nombres = () => en(() => [...document.querySelectorAll("#ti-panel .ti-tarj .ti-nombre-t")].map((e) => e.textContent));
const pestana = (p) => clic(`[data-pestana-btn='${p}']`);
const vista = (v) => clic(`[data-vista-btn='${v}']`);
const seleccionada = () => en(() => document.querySelector("[data-pestana-btn][aria-selected='true']")?.getAttribute("data-pestana-btn"));
/** La tarjeta cuyo nombre es exactamente `nombre`: devuelve un selector estable (su data-tarjeta). */
const claveDe = (nombre) =>
  en((nombre) => [...document.querySelectorAll("#ti-panel .ti-tarj")].find((t) => t.querySelector(".ti-nombre-t")?.textContent === nombre)?.getAttribute("data-tarjeta") ?? null, nombre);
const dentro = async (nombre, sel) => {
  const k = await claveDe(nombre);
  return k ? en((k, sel) => document.querySelector(`[data-tarjeta="${CSS.escape(k)}"] ${sel}`)?.textContent ?? "", k, sel) : null;
};
const clicEn = async (nombre, sel) => {
  const k = await claveDe(nombre);
  return k ? en((k, sel) => { const e = document.querySelector(`[data-tarjeta="${CSS.escape(k)}"] ${sel}`); e?.click(); return !!e; }, k, sel) : false;
};

try {
  ok(await hasta(() => !!document.querySelector(".pie button"), 15), "la app abrió");
  await en(() => document.querySelector(".pie button[aria-label='Ajustes']")?.click());
  ok(await hasta(() => !!document.querySelector(".aj-it[data-cat='conectores']"), 8), "Ajustes abre");
  await en(() => document.querySelector(".aj-it[data-cat='conectores']")?.click());
  ok(await hasta(() => !!document.querySelector("[data-pestana-btn]"), 5), "Conectores abre con sus pestañas");

  // --- Pestañas: cuatro, con su número y una sola elegida -----------------------------------------------------------------
  ok((await cuantas("[data-pestana-btn]")) === 4, "hay cuatro pestañas (Skills, Conectores, Plugins y Hooks)");
  ok(await hasta(() => [...document.querySelectorAll(".ti-pestana-n")].every((e) => /^\d+$/.test(e.textContent)), 5), "cada pestaña dice cuántos hay (número, no sólo color)");
  ok((await seleccionada()) === "skills", "arranca en Skills");
  ok(await en(() => document.querySelector("[role=tablist]")?.getAttribute("aria-label")), "las pestañas son un tablist con nombre");
  ok(await en(() => document.querySelector("[data-pestana-btn='skills']")?.getAttribute("aria-selected") === "true" && document.querySelectorAll("[data-pestana-btn][aria-selected='true']").length === 1), "una sola está elegida");

  // --- Tuyos: tarjetas con nombre, de quién es, qué hace y un dato ---------------------------------------------------------
  ok(await hasta(() => document.querySelectorAll("#ti-panel .ti-tarj").length >= 3, 5), "Tuyos muestra tarjetas");
  const ns = await nombres();
  ok(ns.includes("diseno") && ns.includes("revisar"), "las skills tuyas están (diseno, revisar)");
  ok(/Tuyo/.test((await dentro("diseno", ".ti-origen")) ?? ""), "la tarjeta dice de quién es («Tuyo»)");
  ok(((await dentro("diseno", ".ti-desc")) ?? "").length > 5, "y qué hace en una línea");
  ok(/uso/i.test((await dentro("diseno", ".ti-dato")) ?? ""), "y un dato de uso (con palabra: usos o «sin dato de uso»)");
  await foto("tuyos-skills");

  // --- Buscador y orden -------------------------------------------------------------------------------------------------
  await escribir(".ti-buscar input", "revis");
  ok(await hasta(() => document.querySelectorAll("#ti-panel .ti-tarj").length === 1, 3), "el buscador filtra por nombre");
  await escribir(".ti-buscar input", "zzzzz-nada");
  ok(await hasta(() => document.querySelectorAll("#ti-panel .ti-tarj").length === 0 && !!document.querySelector("#ti-panel .ti-estado, #ti-panel .ti-vacio"), 3), "sin coincidencias lo dice en palabras");
  await escribir(".ti-buscar input", "");
  ok(await hasta(() => document.querySelectorAll("#ti-panel .ti-tarj").length >= 3, 3), "borrar la búsqueda vuelve la lista");
  ok((await cuantas(".ti-campo select")) >= 1, "hay un selector de orden");

  // --- Conectores (MCP): los de Claude Code y los propios de Trama --------------------------------------------------------
  await pestana("mcp");
  ok(await hasta(() => document.querySelectorAll("#ti-panel .ti-tarj").length >= 4, 5), "Conectores muestra los de Claude Code y los propios");
  const mcp = await nombres();
  ok(mcp.includes("notion") && mcp.includes("documentos") && mcp.includes("calendario"), "ahí están notion, documentos (propio) y calendario (de un proyecto)");
  ok(/proyecto/i.test((await dentro("calendario", ".ti-origen")) ?? ""), "uno de proyecto dice de qué proyecto es");
  await foto("tuyos-mcp");

  // --- Detalle: se abre al tocar, dice dónde vive y se cierra con Escape --------------------------------------------------
  await clicEn("calendario", ".ti-nombre");
  ok(await hasta(() => !!document.querySelector("[role=dialog][data-tarjeta-detalle]"), 3), "tocar la tarjeta abre el detalle");
  ok(/Dónde vive/i.test(await en(() => document.querySelector("[data-tarjeta-detalle] .ti-meta")?.textContent ?? "")), "el detalle dice dónde vive");
  ok(await hasta(() => document.querySelector("[data-tarjeta-detalle]")?.contains(document.activeElement) === true, 3), "el foco entra al detalle");
  await foto("detalle-mcp");
  await escape();
  ok(await hasta(() => !document.querySelector("[data-tarjeta-detalle]"), 3), "Escape cierra el detalle");

  // --- Plugins: Tuyos, Descubrir por secciones, categorías y el «+» -------------------------------------------------------
  await pestana("plugins");
  ok(await hasta(() => document.querySelectorAll("#ti-panel .ti-tarj").length >= 2, 5), "Plugins tuyos muestra los instalados");
  await vista("descubrir");
  ok(await hasta(() => !!document.querySelector("[data-secciones]"), 5), "Descubrir de plugins se arma por secciones");
  const secs = await en(() => [...document.querySelectorAll("[data-seccion]")].map((s) => s.getAttribute("data-seccion")));
  ok(secs.includes("nuevos") && secs.includes("masInstalados") && secs.includes("categorias"), `trae «Nuevos», «Más instalados» y «Categorías» (hay: ${secs.join(", ")})`);
  ok(secs.includes("paraVos"), "y «Para vos», porque hay plugins instalados con categoría");
  ok((await cuantas(".ti-sec .ti-ver")) >= 2, "cada sección tiene «Ver todo»");
  ok(await en(() => [...document.querySelectorAll(".ti-cat")].every((c) => /\d/.test(c.querySelector(".ti-cat-c")?.textContent ?? ""))), "cada categoría dice cuántos plugins tiene");
  await foto("descubrir-plugins");
  // Una categoría filtra: queda sólo lo de esa categoría y se puede volver.
  await en(() => [...document.querySelectorAll(".ti-cat")].find((c) => /escritura/i.test(c.textContent))?.click());
  ok(await hasta(() => !!document.querySelector("[data-plana]") && document.querySelectorAll("#ti-panel .ti-tarj").length >= 2, 3), "tocar una categoría muestra sólo lo suyo");
  ok(await en(() => [...document.querySelectorAll("#ti-panel .ti-tarj .ti-nombre-t")].some((e) => e.textContent === "tesis") && ![...document.querySelectorAll("#ti-panel .ti-tarj .ti-nombre-t")].some((e) => e.textContent === "paleta")), "la categoría «escritura» trae tesis y no paleta");
  await foto("categoria-plugins");
  await en(() => [...document.querySelectorAll("[data-plana] .ui-btn")].find((b) => /volver/i.test(b.textContent))?.click());
  ok(await hasta(() => !!document.querySelector("[data-secciones]"), 3), "«Volver» regresa a las secciones");
  // El «+» de un plugin lo instala (los datos son de muestra) y la tarjeta pasa a ✓ «Instalado».
  const clave = await claveDe("paleta");
  ok(!!clave, "«paleta» está en Descubrir");
  ok(!/Instalado/.test((await dentro("paleta", ".ti-accion")) ?? ""), "antes de instalar no dice «Instalado»");
  await clicEn("paleta", ".ti-mas");
  ok(await hasta((k) => /Instalado/.test(document.querySelector(`[data-tarjeta="${CSS.escape(k)}"] .ti-accion`)?.textContent ?? ""), 5, clave), "el «+» instala el plugin y la tarjeta dice «Instalado» (ícono y palabra)");
  ok((await dentro("paleta", ".ti-mas")) === null || (await dentro("paleta", ".ti-mas")) === "", "y el «+» ya no está");

  // --- Skills Descubrir: el «+» pide confirmar y no instala hasta que se confirma --------------------------------------
  await pestana("skills");
  await vista("descubrir");
  ok(await hasta(() => document.querySelectorAll("#ti-panel .ti-tarj").length >= 3, 5), "Descubrir de skills trae el catálogo");
  const sk = await nombres();
  const porInstalar = sk.find((x) => x === "webapp-testing") ?? sk[0];
  await clicEn(porInstalar, ".ti-mas");
  ok(await hasta(() => !!document.querySelector("[data-tarjeta-detalle] .ds-confirma, [data-tarjeta-detalle] .ds-archivos"), 5), "el «+» de una skill abre la confirmación con sus archivos");
  ok(/SKILL\.md/.test(await en(() => document.querySelector("[data-tarjeta-detalle]")?.textContent ?? "")), "la confirmación lista los archivos (SKILL.md)");
  ok(await en(() => !!document.querySelector("[data-tarjeta-detalle] .ds-alerta")), "y avisa si trae scripts");
  ok(!/Instalada/.test((await dentro(porInstalar, ".ti-accion")) ?? ""), "mientras no se confirma, no está instalada");
  await foto("confirmar-skill");
  await escape();
  ok(await hasta(() => !document.querySelector("[data-tarjeta-detalle]"), 3), "Escape cancela y no instala");
  ok(!/Instalada/.test((await dentro(porInstalar, ".ti-accion")) ?? ""), "cancelar no deja nada instalado");

  // --- Agregar: cada pestaña ofrece lo que de verdad existe ---------------------------------------------------------------
  await pestana("mcp");
  await vista("tuyos");
  await clic("[data-agregar-btn]");
  ok(await hasta(() => !!document.querySelector("#ti-agregar-panel [data-mcp-form]"), 3), "«Agregar» en Conectores abre el alta de un conector");
  await foto("agregar-mcp");
  await clic("[data-agregar-btn]");
  ok(await hasta(() => !document.querySelector("#ti-agregar-panel"), 3), "volver a tocar «Agregar» lo cierra");
  await pestana("hooks");
  ok(await hasta(() => document.querySelectorAll("#ti-panel .ti-tarj").length >= 2, 3), "Hooks muestra los que hay");
  ok((await cuantas("[data-agregar-btn]")) === 0 && (await cuantas("[data-vista-btn]")) === 0, "Hooks no ofrece Agregar ni Descubrir (no hay de dónde instalarlos)");
  await foto("tuyos-hooks");

  // --- Nada de lo de la persona quedó tocado ---------------------------------------------------------------------------
  ok(await en(() => !document.querySelector("#ti-panel [data-error]")), "ninguna pestaña mostró un error");
} catch (e) {
  fallas++;
  console.error("FALLA (excepción)", e);
} finally {
  try {
    ws.close();
  } catch {}
  app.kill("SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `\n${fallas} fallas` : "\ntodo ok");
process.exit(fallas ? 1 : 0);
