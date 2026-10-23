#!/usr/bin/env node
// Prueba de punta a punta de la pestaña Tablero: abre la app offscreen (HILOS_PRUEBA, sin ventana),
// la maneja por CDP con el mouse (apretar, mover, soltar) y verifica contra el CLI `tablero` lo que
// quedó escrito. El tablero es TEMPORAL (`TABLERO_DIR` en una carpeta de /tmp, con `tablero init`):
// el real no se toca nunca. `pa` es el falso; PA_STATE, HILOS_STATE, el perfil y el registry, temporales.
//   npm run build && node scripts/prueba-tablero.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-tablero-"));
const puerto = 9300 + Math.floor(Math.random() * 600);
const bin =
  process.env.HILOS_TABLERO ??
  [...(process.env.PATH ?? "").split(":"), path.join(os.homedir(), ".local/bin")].map((d) => path.join(d, "tablero")).find((f) => existsSync(f));
if (!bin) {
  console.log("no está el CLI `tablero`: nada que probar");
  process.exit(1);
}
for (const d of ["pa", "sesiones", "proy/atlas"]) mkdirSync(path.join(tmp, d), { recursive: true });
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [{ name: "atlas", path: path.join(tmp, "proy", "atlas"), desc: "La web" }] }));

const env = {
  ...process.env,
  TABLERO_DIR: path.join(tmp, "tablero"),
  PA_STATE: path.join(tmp, "pa"),
  PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
  HILOS_TABLERO: bin,
  HILOS_PRUEBA: "60",
  HILOS_FIXTURES: "0",
  HILOS_IDIOMA: "es",
  HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
  PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
  HILOS_STATE: path.join(tmp, "hilos"),
  HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
  HILOS_SESIONES: path.join(tmp, "sesiones"),
  HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
  HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
  HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
  NPM_FALSO_LOG: path.join(tmp, "npm-falso.log"),
};
// Sin esto el CLI escribiría la vista en la real aunque el tablero sea temporal.
delete env.TABLERO_VISTA;

const tablero = (...args) => execFileSync(bin, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const enDisco = () => JSON.parse(tablero("listar", "--todo", "--json"));
const item = (id) => enDisco().find((i) => i.id === id);

tablero("init");
const A = Number(tablero("agregar", "--proyecto=atlas", "--", "Revisar el arranque en frío"));
const B = Number(tablero("agregar", "--columna=espera-dueno", "--proyecto=atlas", "--prueba=atlas --exportar ejemplo.csv", "--detalle=Quedó a medias.", "--origen=pa", "--clave=pa:20260101-010101-1234", "--", "Probar la exportación"));
const C = Number(tablero("agregar", "--columna=ideas", "--", "Una idea para más adelante"));
const D = Number(tablero("agregar", "--", "Esto se tira"));
const E = Number(tablero("agregar", "--columna=sigue", "--", "Esto se pospone"));

const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], { env, stdio: "ignore" });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

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

/** Corre `fn` en la página (se manda como texto) y devuelve lo que devuelva. */
async function en(fn, ...args) {
  const r = await cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "error en la página");
  return r.result?.result?.value;
}

/** Espera hasta que `fn` devuelva algo verdadero (tope 10 s). */
async function hasta(fn, que, ...args) {
  for (let i = 0; i < 100; i++) {
    const v = await en(fn, ...args).catch(() => null);
    if (v) return v;
    await espera(100);
  }
  console.log(`      (se esperó en vano: ${que})`);
  return null;
}

/** Lo mismo, pero mirando el disco (lo que dice el CLI). */
async function hastaDisco(fn, que) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return true;
    await espera(100);
  }
  console.log(`      (se esperó en vano: ${que})`);
  return false;
}

const centro = (sel) =>
  en((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const c = el.getBoundingClientRect();
    return { x: c.left + c.width / 2, y: c.top + Math.min(c.height / 2, 14) };
  }, sel);
const raton = (type, p, apretado) => cdp("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" && !apretado ? "none" : "left", buttons: apretado ? 1 : 0, clickCount: 1 });

/** Un clic de mouse de verdad (apretar y soltar en el lugar). */
async function clicEn(sel) {
  const p = await centro(sel);
  if (!p) return false;
  await raton("mouseMoved", p, false);
  await raton("mousePressed", p, true);
  await raton("mouseReleased", p, false);
  return true;
}

/** Lleva `de` hasta `a` con el mouse apretado; a mitad de camino devuelve qué se ve. */
async function llevar(de, a) {
  const p0 = await centro(de);
  const p1 = await centro(a);
  if (!p0 || !p1) return null;
  await raton("mouseMoved", p0, false);
  await raton("mousePressed", p0, true);
  for (let i = 1; i <= 8; i++) await raton("mouseMoved", { x: p0.x + ((p1.x - p0.x) * i) / 8, y: p0.y + ((p1.y - p0.y) * i) / 8 }, true);
  await espera(60);
  const visto = await en(() => ({ fantasma: !!document.querySelector(".tb-fantasma"), sobre: document.querySelector("[data-sobre]")?.dataset.columna ?? null }));
  await raton("mouseReleased", p1, false);
  return visto;
}

const tarjeta = (id, columna) => `.tb-col[data-columna="${columna}"] .tb-card[data-id="${id}"]`;
const hay = (sel) => en((sel) => !!document.querySelector(sel), sel);
const VK = { Escape: 27 };
async function tecla(key) {
  const k = { key, code: key, windowsVirtualKeyCode: VK[key] };
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
}

try {
  // --- Abrir ---
  ok(await hasta(() => document.querySelectorAll(".pie button").length >= 4, "el pie"), "el pie tiene el botón del Tablero");
  await en(() => document.querySelector('.pie button[aria-label^="Tablero"]')?.click());
  // El Tablero abre en "Te esperan" (scripts/prueba-pendientes.mjs); el kanban es la pestaña "Todo".
  await hasta(() => !!document.querySelector(".pd .tb-vistas"), "las pestañas");
  await en(() => [...document.querySelectorAll(".pd > .pd-barra .tb-vistas button")].find((b) => b.textContent === "Todo")?.click());
  ok(await hasta((s) => !!document.querySelector(s), "la tarjeta en bandeja", tarjeta(A, "bandeja")), "el Tablero abre y la bandeja tiene su tarjeta");
  ok(await hay(tarjeta(B, "espera-dueno")), "lo que espera a Ana está en su columna");
  ok(await en((s) => document.querySelector(s)?.querySelector(".tb-p code")?.textContent === "atlas --exportar ejemplo.csv", tarjeta(B, "espera-dueno")), "la tarjeta trae la prueba exacta");
  ok(await en((s) => document.querySelector(s)?.querySelector(".tb-chip")?.textContent === "atlas", tarjeta(B, "espera-dueno")), "y el chip del proyecto");
  ok(
    await en((a, b) => {
      const c = (s) => document.querySelector(s)?.querySelector(".tb-chip")?.style.getPropertyValue("--tono");
      return !!c(a) && c(a) === c(b);
    }, tarjeta(A, "bandeja"), tarjeta(B, "espera-dueno")),
    "el mismo proyecto, el mismo color",
  );
  ok(await en(() => document.querySelector('.tb-plegada[data-columna="hecho"] .tb-n')?.textContent === "0"), "Hecho está plegada, en 0");
  ok(await en(() => !document.querySelector('[data-columna="tirado"]')), "no hay columna de lo tirado");

  // --- Arrastrar a otra columna = tablero mover ---
  const visto = await llevar(tarjeta(A, "bandeja"), '.tb-col[data-columna="sigue"] .tb-lista');
  ok(visto?.fantasma, "al llevarla, la copia sigue al mouse");
  ok(visto?.sobre === "sigue", `la columna de destino se marca (${visto?.sobre})`);
  ok(await hastaDisco(() => item(A).columna === "sigue", "mover"), "soltarla en Sigue corre `tablero mover`: el CLI la tiene en sigue");
  ok(await hasta((s) => !!document.querySelector(s), "la tarjeta en sigue", tarjeta(A, "sigue")), "y se ve en Sigue");
  ok(await en(() => !document.querySelector(".tb-fantasma, [data-sobre]")), "no queda la copia ni la marca");
  ok(await en(() => !document.querySelector(".tb-det")), "arrastrar no abre el detalle");

  // --- Clic = detalle; Hecho = tablero cerrar ---
  ok(await clicEn(tarjeta(B, "espera-dueno")), "clic en una tarjeta");
  ok(await hasta(() => !!document.querySelector(".tb-det"), "el detalle"), "abre el detalle");
  const det = await en(() => document.querySelector(".tb-det")?.textContent ?? "");
  ok(det.includes("Probar la exportación") && det.includes("Quedó a medias.") && det.includes("atlas --exportar ejemplo.csv"), "con el título, el detalle y la prueba");
  ok(det.includes("pa:20260101-010101-1234") && det.includes("Lo anotó"), "y el origen y la fuente");
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".tb-det") && !!document.querySelector(".tb"), "Esc"), "Esc cierra el detalle y no el panel");
  await clicEn(tarjeta(B, "espera-dueno"));
  await hasta(() => !!document.querySelector(".tb-det .tb-hecho"), "el detalle otra vez");
  await en(() => document.querySelector(".tb-det .tb-hecho").click());
  ok(await hastaDisco(() => item(B).columna === "hecho", "cerrar"), "Hecho corre `tablero cerrar`: el CLI la tiene en hecho");
  ok(await hasta(() => document.querySelector('.tb-plegada[data-columna="hecho"] .tb-n')?.textContent === "1", "hecho en 1"), "Hecho cuenta 1 y la tarjeta salió de su columna");

  // --- Alta rápida = tablero agregar ---
  await en(() => {
    const el = document.querySelector(".tb-alta input");
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "Anotado desde la prueba");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await en(() => document.querySelector('.tb-alta button[type="submit"]').click());
  ok(await hastaDisco(() => enDisco().some((i) => i.titulo === "Anotado desde la prueba" && i.columna === "bandeja" && i.origen === "trama"), "agregar"), "el alta rápida corre `tablero agregar`: cae en bandeja, con origen trama");
  ok(await hasta(() => [...document.querySelectorAll('.tb-col[data-columna="bandeja"] .tb-t')].some((e) => e.textContent === "Anotado desde la prueba"), "la tarjeta nueva"), "y aparece en la bandeja");
  ok(await en(() => document.querySelector(".tb-alta input").value === ""), "el campo queda vacío");

  // --- Se actualiza solo ---
  tablero("agregar", "--", "Cargado por voz");
  ok(await hasta(() => [...document.querySelectorAll('.tb-col[data-columna="bandeja"] .tb-t')].some((e) => e.textContent === "Cargado por voz"), "lo de afuera"), "un item cargado por afuera aparece sin recargar");

  // --- Tirar (con confirmación) y posponer ---
  await clicEn(tarjeta(D, "bandeja"));
  await hasta(() => !!document.querySelector(".tb-det .tb-tirar"), "el detalle de lo que se tira");
  await en(() => {
    const b = document.querySelector(".tb-det .tb-tirar");
    b.focus();
    b.click();
  });
  ok(await hasta(() => document.querySelector(".tb-det .tb-tirar")?.hasAttribute("data-armado"), "armado"), "Tirar pide confirmación");
  ok(item(D).columna === "bandeja", "con un clic no se tiró nada");
  await en(() => document.querySelector(".tb-det .tb-tirar").click());
  ok(await hastaDisco(() => item(D).columna === "tirado", "tirar"), "el segundo clic corre `tablero tirar`");
  ok(await hasta((d) => !document.querySelector(`.tb-card[data-id="${d}"]`), "sin la tirada", D), "lo tirado no se muestra");

  await clicEn(tarjeta(E, "sigue"));
  await hasta(() => !!document.querySelector(".tb-det .tb-posponer button"), "el detalle de lo que se pospone");
  await en(() => document.querySelector(".tb-det .tb-posponer button").click());
  ok(await hastaDisco(() => !!item(E).hasta, "posponer"), "Posponer corre `tablero mover --hasta`");
  ok(await hasta(() => document.querySelector(".tb-cuenta")?.textContent.includes("1 pospuestos"), "la cuenta"), "lo pospuesto sale de la vista y se cuenta");

  // --- Soltar en Hecho (plegada) = cerrar ---
  await en(() => (document.querySelector(".tb-cols").scrollLeft = 1e6));
  const aHecho = await llevar(tarjeta(C, "ideas"), '.tb-plegada[data-columna="hecho"]');
  ok(aHecho?.sobre === "hecho", `Hecho plegada se marca como destino (${aHecho?.sobre})`);
  ok(await hastaDisco(() => item(C).columna === "hecho", "cerrar soltando"), "soltar en Hecho cierra el item");

  // --- Hecho desplegada y reabrir ---
  await en(() => document.querySelector('.tb-plegada[data-columna="hecho"]').click());
  ok(await hasta((s) => !!document.querySelector(s), "hecho abierta", tarjeta(C, "hecho")), "Hecho se despliega con lo cerrado");
  await en(() => (document.querySelector(".tb-cols").scrollLeft = 1e6));
  await llevar(tarjeta(C, "hecho"), '.tb-col[data-columna="ideas"] .tb-lista');
  ok(await hastaDisco(() => item(C).columna === "ideas", "reabrir"), "llevar de Hecho a una columna lo reabre");

  // --- Buscador y filtro ---
  await en(() => {
    const el = document.querySelector(".tb-buscar input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "arranque frio");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  ok(await hasta((a) => document.querySelectorAll(".tb-card").length === 1 && !!document.querySelector(`.tb-card[data-id="${a}"]`), "buscar", A), "el buscador deja sólo lo que nombra todas las palabras (sin tildes)");
  await en(() => {
    const el = document.querySelector(".tb-buscar input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // --- Proyectos ---
  await en(() => document.querySelectorAll(".tb .tb-vistas button")[1].click());
  ok(await hasta(() => !!document.querySelector("button.tb-pr"), "proyectos"), "la vista Proyectos lista los proyectos");
  const fila = await en(() => document.querySelector("button.tb-pr")?.textContent ?? "");
  ok(fila.includes("atlas"), `con su fila (${fila.replace(/\s+/g, " ").slice(0, 60)})`);
  await en(() => document.querySelector("button.tb-pr").click());
  ok(await hasta(() => !!document.querySelector(".tb-cols") && document.querySelector(".tb-barra:not(.tb-alta) .pbtn")?.textContent.includes("atlas"), "filtro"), "clic en un proyecto vuelve al kanban filtrado por él");
  ok(await en(() => [...document.querySelectorAll(".tb-card .tb-chip")].every((c) => c.textContent === "atlas") && document.querySelectorAll(".tb-card").length > 0), "y sólo se ven sus tarjetas");

  // --- Cerrar el panel ---
  await en(() => document.activeElement?.blur());
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".tb"), "panel cerrado"), "Esc cierra el Tablero");
} catch (e) {
  ok(false, String(e?.stack ?? e));
} finally {
  ws.close();
  app.kill();
  console.log(`tablero temporal: ${env.TABLERO_DIR}`);
  console.log(fallas ? `${fallas} fallas` : "todo ok");
  process.exit(fallas ? 1 : 0);
}
