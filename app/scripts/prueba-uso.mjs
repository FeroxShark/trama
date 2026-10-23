#!/usr/bin/env node
// Prueba de punta a punta de los límites de la barra (5 h y semana): abre la app offscreen
// (HILOS_PRUEBA, sin ventana) con el claude falso y un `$PA_STATE` temporal como quedó el de
// verdad el 2026-10-12: el statusline más nuevo es de una sesión que no llegó a contestar
// (`rate_limits` en null) y el anterior ya es viejo. Comprueba que el renglón no queda vacío
// ("sin dato"), que con la primera respuesta de un líder de la app aparecen los dos límites (los
// dice su stream: un `claude -p` no tiene statusline), que quedan guardados (`uso.json`), que un
// statusline nuevo de una terminal sigue valiendo y que el tope de 5 h se ve entero.
// Nada toca `pa` ni a Claude de verdad: todo es temporal o falso.
//   npm run build && node scripts/prueba-uso.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-uso-")));
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
const puerto = 9300 + Math.floor(Math.random() * 600);
const sl = path.join(tmp, "pa", "statusline");
mkdirSync(sl, { recursive: true });
mkdirSync(path.join(tmp, "sesiones"));
mkdirSync(path.join(tmp, "claude", "projects", "-prueba"), { recursive: true });
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [] }));

const ya = () => Math.floor(Date.now() / 1000);
const statusline = (id, ts, limites) =>
  writeFileSync(path.join(sl, `${id}.json`), JSON.stringify({ version: 1, ts, session_id: id, cwd: "/tmp", modelo: "claude-opus-5-5", prompt_cache: null, rate_limits: limites }));
// El de anoche, con los dos límites (el de 5 h ya se reinició), y el de la madrugada, sin ninguno.
statusline("aaaaaaaa-0000-4000-8000-000000000001", ya() - 20 * 3600, {
  five_hour: { used_percentage: 52, resets_at: ya() - 18 * 3600 },
  seven_day: { used_percentage: 7, resets_at: ya() + 6 * 86_400 },
});
statusline("aaaaaaaa-0000-4000-8000-000000000002", ya() - 16 * 3600, { five_hour: null, seven_day: null });

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
    HILOS_FIXTURES: "0",
    HILOS_IDIOMA: "es",
    HILOS_VISTA: "todo",
    HILOS_TIERNOS: "0",
    HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
    PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
    PA_FALSO_N: "0",
    PA_STATE: path.join(tmp, "pa"),
    HILOS_STATE: path.join(tmp, "hilos"),
    HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
    PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
    HILOS_SESIONES: path.join(tmp, "sesiones"),
    HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
    CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
    TRAMA_FALSO_LOG: path.join(tmp, "claude-falso.log"),
    TRAMA_FALSO_USO: "12,34",
    HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
    HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
    NPM_FALSO_LOG: path.join(tmp, "npm-falso.log"),
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
async function tecla(key, vk, modifiers = 0) {
  const k = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: vk, modifiers };
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
}
const CTRL = 2;
async function mandar(texto) {
  await en(() => document.querySelector(".caja-zona textarea")?.focus());
  await cdp("Input.insertText", { text: texto });
  await tecla("Enter", 13);
}
/** Lo que dice cada renglón de los límites: nombre, lo de al lado, el porcentaje y cuánto está lleno el riel. */
const limites = () =>
  en(() => {
    const u = document.querySelector(".usos:not([data-espera])");
    if (!u) return null;
    return [...u.querySelectorAll(".uso")].map((e) => ({
      nombre: e.querySelector(".n")?.textContent ?? "",
      cuando: [...e.querySelectorAll(".cuando")].find((c) => getComputedStyle(c).display !== "none")?.textContent ?? "",
      pct: e.querySelector(".r b")?.textContent ?? null,
      aria: e.getAttribute("aria-label"),
      alto: Math.round(e.getBoundingClientRect().height),
    }));
  });
const con = (pcts) => hasta((pcts) => JSON.stringify([...document.querySelectorAll(".usos:not([data-espera]) .uso .r b")].map((b) => b.textContent)) === JSON.stringify(pcts), 10, pcts);
/** La cabecera de la barra (la marca y los límites), al doble para que se lea. */
async function foto(nombre) {
  if (!fotos) return;
  await espera(300);
  const c = await en(() => {
    const r = document.querySelector(".usos").getBoundingClientRect();
    return { x: 0, y: 0, width: Math.ceil(r.right + 16), height: Math.ceil(r.bottom + 56) };
  });
  const r = await cdp("Page.captureScreenshot", { format: "png", clip: { ...c, scale: 2 } });
  writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
}

try {
  ok(await hasta(() => !!document.querySelector(".usos:not([data-espera])"), 15), "la app abrió y el renglón de los límites está");

  // --- Sin dato: lo dice, no queda vacío ---------------------------------------------------
  let l = await limites();
  ok(l?.length === 2, `hay un renglón por límite: ${l?.map((x) => x.nombre).join(", ")}`);
  ok(l?.every((x) => x.cuando === "sin dato" && x.pct === null), `sin ninguna lectura que valga, cada uno dice "sin dato": ${JSON.stringify(l?.map((x) => x.cuando))}`);
  ok(l?.every((x) => x.alto > 10 && /sin dato/.test(x.aria ?? "")), "y ocupa su lugar (no es un renglón vacío), también para un lector de pantalla");
  ok(await en(() => !document.querySelector(".releer").disabled), "Actualizar límites se puede tocar");
  await foto("sin-dato");

  // --- Un líder de la app contesta: su stream trae los dos límites -------------------------
  await tecla("N", 78, CTRL);
  ok(await hasta(() => !!document.querySelector(".caja-zona textarea"), 8), "Ctrl+N abre un líder nuevo");
  await mandar("hola");
  ok(await con(["12%", "34%"]), "con la primera respuesta del líder aparecen los dos: 12 % y 34 %");
  l = await limites();
  ok(l?.every((x) => /reinicia|en /.test(x.cuando)), `cada uno con cuándo se reinicia: ${JSON.stringify(l?.map((x) => x.cuando))}`);
  await foto("con-dato");
  const guardado = path.join(tmp, "hilos", "uso.json");
  ok(await hasta0(() => existsSync(guardado)), "quedó guardado en uso.json (sobrevive a un relanzo)");
  const g = existsSync(guardado) ? JSON.parse(readFileSync(guardado, "utf8")) : {};
  ok(g.version === 1 && Math.round(g.five_hour?.pct) === 12 && Math.round(g.seven_day?.pct) === 34, `con las dos ventanas: ${JSON.stringify(g)}`);

  // --- Una sesión de terminal escribe su statusline después: vale el más nuevo --------------
  await espera(1100);
  // De la misma ventana que dijo el stream (mismo reinicio): adentro de una ventana vale la lectura que no baja
  // (`electron/uso.ts`), y una con el reinicio más de una hora antes sería una ventana anterior y no cuenta.
  statusline("aaaaaaaa-0000-4000-8000-000000000003", ya(), {
    five_hour: { used_percentage: 55, resets_at: g.five_hour.resets_at },
    seven_day: { used_percentage: 36, resets_at: g.seven_day.resets_at },
  });
  ok(await con(["55%", "36%"]), "un statusline más nuevo que el stream se ve solo: 55 % y 36 %");

  // --- El tope de 5 h: el líder lo dice y la barra lo muestra entero ------------------------
  await hasta(() => !!document.querySelector(".caja-zona textarea:not([readonly])"), 8);
  await espera(1100);
  await mandar("límite");
  ok(await con(["100%", "36%"]), "con el tope de 5 h alcanzado dice 100 %, y la semana sigue en 36 % (el uso no baja dentro de su ventana)");
  await foto("tope");
} finally {
  ws.close();
  app.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);

/** Espera a algo de este proceso (no de la página). */
async function hasta0(f, tope = 5) {
  for (let i = 0; i < tope * 20; i++) {
    if (f()) return true;
    await espera(50);
  }
  return false;
}
