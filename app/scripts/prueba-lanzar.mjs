#!/usr/bin/env node
// Prueba del paso previo de Ramas (Actualizar, Analizar, Retomar, Arreglar): con el `pa` y el `claude` falsos
// (nada toca `pa` ni datos de verdad) comprueba por CDP que tocar el botón no lanza nada, que el paso trae el
// default de esa acción, que Enter lanza con él, que lo elegido llega a la línea de `pa` (`-m`, `--effort`,
// `--tipo`, el texto tras `--`) y que Cancelar / Esc no mandan nada.
//   npm run build && node scripts/prueba-lanzar.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-lanzar-")));
const casa = path.join(tmp, "casa");
mkdirSync(casa);
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
const log = path.join(tmp, "pa-falso.log");
const logClaude = path.join(tmp, "claude-falso.log");
const puerto = 9300 + Math.floor(Math.random() * 600);

for (const d of ["atlas", "brote"]) mkdirSync(path.join(tmp, "proy", d), { recursive: true });
mkdirSync(path.join(tmp, "pa"));
// 13131 (Atlas Web) está lista y chocó con main: la app lo recuerda en auto.json y ofrece Actualizar.
writeFileSync(path.join(tmp, "pa", "seguras"), "");
mkdirSync(path.join(tmp, "hilos"));
writeFileSync(
  path.join(tmp, "hilos", "auto.json"),
  JSON.stringify({
    version: 1,
    integradas: [],
    fallas: [{ id: "20261003-100900-13131", rama: "pa/atlas/20261003-100900-13131", proyecto: "atlas", error: "conflictos con main", rc: 80, ts: Math.floor(Date.now() / 1000) }],
  }),
);
writeFileSync(
  path.join(tmp, "registry.json"),
  JSON.stringify({ projects: [{ name: "Atlas Web", path: path.join(tmp, "proy", "atlas"), desc: "La web" }, { name: "brote", path: path.join(tmp, "proy", "brote"), desc: "El jardín" }] }),
);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
  env: {
    ...process.env,
    HOME: casa,
    XDG_CONFIG_HOME: path.join(casa, ".config"),
    XDG_DATA_HOME: path.join(casa, ".local/share"),
    XDG_CACHE_HOME: path.join(casa, ".cache"),
    XDG_STATE_HOME: path.join(casa, ".local/state"),
    HILOS_PRUEBA: "90",
    HILOS_IDIOMA: "es",
    HILOS_FIXTURES: "0",
    HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
    PA_FALSO_LOG: log,
    PA_STATE: path.join(tmp, "pa"),
    HILOS_STATE: path.join(tmp, "hilos"),
    HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
    PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
    HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
    TRAMA_FALSO_LOG: logClaude,
    HILOS_HYPRCTL: "/bin/false",
    HILOS_KITTEN: "/bin/false",
  },
  stdio: process.env.PRUEBA_VERBOSO ? "inherit" : "ignore",
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
const VK = { Enter: 13, Escape: 27 };
async function tecla(key) {
  const k = { key, code: key, windowsVirtualKeyCode: VK[key] };
  // Enter sobre un botón lo activa con el `\r` del keyDown (como el teclado de verdad).
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...(key === "Enter" ? { text: "\r" } : {}), ...k });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
}
const escribir = (sel, texto) =>
  en(
    (sel, texto) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, texto);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    sel,
    texto,
  );
const lineas = (archivo) => {
  try {
    return readFileSync(archivo, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};
/** Lo que `pa` recibió para actualizar (nunca la lectura de `--hilos`). */
const delPa = () => lineas(log).filter((l) => / --actualizar /.test(l) && !/ --hilos?( |$)/.test(l));
const dePaso = () =>
  en(() => ({
    abierto: !!document.querySelector(".lz-caja"),
    titulo: document.querySelector(".lz-caja h2")?.textContent ?? "",
    botones: [...document.querySelectorAll(".lz-caja .pbtn")].map((b) => b.getAttribute("aria-label")),
    tipo: document.querySelector(".lz-tipo")?.textContent ?? "",
    foco: document.activeElement?.textContent ?? "",
  }));
/** Abre el selector `i` del paso y elige la opción que dice `nombre`. */
async function elegir(i, nombre) {
  await en((i) => document.querySelectorAll(".lz-caja .pick > .pbtn")[i]?.click(), i);
  await hasta(() => !!document.querySelector('.lz-caja [role="option"]'), 3);
  return en((nombre) => {
    const o = [...document.querySelectorAll('.lz-caja [role="option"]')].find((e) => e.querySelector(".on1")?.textContent.startsWith(nombre));
    o?.click();
    return !!o;
  }, nombre);
}
/** Corre en la página: toca el Actualizar de la rama 13131. */
const botonActualizar = () => {
  const b = [...document.querySelectorAll('.pn-rama:has(.pn-tarea[data-id="20261003-100900-13131"]) button')].find((x) => /Actualizar/.test(x.textContent));
  b?.click();
  return !!b;
};

try {
  ok(await hasta(() => !!document.querySelector(".pie button"), 20), "la app abrió");
  await en(() => document.querySelectorAll(".pie button")[1]?.click()); // Ramas
  ok(await hasta(() => !!document.querySelector(".pn-rama"), 10), "Ramas lista las ramas");

  // --- Actualizar: el default de lo mecánico y nada sale hasta Lanzar -----------------------------
  ok(await hasta(botonActualizar, 10), "la rama que chocó con main ofrece Actualizar");
  let p = await dePaso();
  ok(p.abierto, "tocarlo abre el paso previo");
  ok(p.botones.some((b) => /Haiku 5\.5/.test(b)) && p.botones.some((b) => /xhigh/.test(b)), `arranca con Haiku 5.5 y xhigh: ${JSON.stringify(p.botones)}`);
  ok(/mecanico/.test(p.tipo), `muestra el tipo: "${p.tipo}"`);
  ok(/Lanzar/.test(p.foco), "el foco empieza en Lanzar");
  await foto("lanzar-actualizar");
  await espera(600);
  ok(delPa().length === 0, "sin Lanzar, pa no recibió nada");

  // Esc cancela sin lanzar y el foco vuelve a la rama.
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".lz-caja"), 3), "Esc cierra el paso");
  await espera(400);
  ok(delPa().length === 0, "cancelar no lanza nada");

  // Enter lanza con el default.
  await en(botonActualizar);
  ok(await hasta(() => !!document.querySelector(".lz-caja"), 5), "de nuevo el paso");
  await tecla("Enter");
  ok(await hasta(() => !document.querySelector(".lz-caja"), 5), "Enter lanza y cierra");
  let v = null;
  for (let i = 0; i < 60 && !v; i++) {
    v = delPa()[0];
    if (!v) await espera(100);
  }
  ok(!!v && v.includes("--actualizar 20261003-100900-13131 --async") && v.includes("-m claude-haiku-5-5") && v.includes("--effort xhigh") && v.includes("--tipo mecanico"), `Enter: pa recibió el default: ${v?.replace(/^\S+ /, "")}`);
  ok(!!v && !v.includes(" -- "), "sin texto no hay `--`");
  ok(delPa().length === 1, "una sola vez");

  // Lo elegido llega a pa: otro modelo, otro esfuerzo y un texto.
  await en(botonActualizar);
  ok(await hasta(() => !!document.querySelector(".lz-caja"), 5), "otra vez el paso");
  ok(await elegir(0, "Sonnet"), "elige Sonnet 5.5");
  ok(await elegir(1, "high"), "elige high");
  ok(await escribir(".lz-texto", "solo los conflictos de package.json"), "escribe el texto");
  await foto("lanzar-elegido");
  await en(() => document.querySelector(".lz-caja .btn2[data-primario]")?.click());
  ok(await hasta(() => !document.querySelector(".lz-caja"), 5), "Lanzar cierra el paso");
  let w = null;
  for (let i = 0; i < 60 && !w; i++) {
    w = delPa()[1];
    if (!w) await espera(100);
  }
  ok(!!w && w.includes("-m claude-sonnet-5-5") && w.includes("--effort high") && w.includes("--tipo mecanico"), `lo elegido llega: ${w?.replace(/^\S+ /, "")}`);
  ok(!!w && w.includes("-- solo\\ los\\ conflictos\\ de\\ package.json"), "el texto va después de `--`");

  // --- Analizar ramas: un líder, nada sale hasta Lanzar ---------------------------------------------
  const arranques = () => lineas(logClaude).filter((l) => l.includes('"args"')).length;
  const antes = arranques();
  await en(() => document.querySelector(".pn-analista-btn")?.click());
  ok(await hasta(() => !!document.querySelector(".lz-caja"), 5), "Analizar ramas abre el paso previo");
  p = await dePaso();
  ok(p.tipo === "", "un líder no muestra tipo de pa");
  await foto("lanzar-analizar");
  await espera(600);
  ok(arranques() === antes, "sin Lanzar no arrancó ningún claude");
  await en(() => document.querySelector(".lz-caja .btn2:not([data-primario])")?.click());
  ok(await hasta(() => !document.querySelector(".lz-caja"), 3), "Cancelar cierra el paso");
  await espera(400);
  ok(arranques() === antes, "Cancelar no lanza nada");
  await en(() => document.querySelector(".pn-analista-btn")?.click());
  ok(await hasta(() => !!document.querySelector(".lz-caja"), 5), "otra vez");
  await tecla("Enter");
  ok(await hasta(() => !document.querySelector(".lz-caja"), 5), "Enter lanza");
  for (let i = 0; i < 80 && arranques() === antes; i++) await espera(100);
  ok(arranques() === antes + 1, "ahora sí arrancó el claude del analista");
} catch (e) {
  ok(false, String(e?.stack ?? e));
} finally {
  ws.close();
  app.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
