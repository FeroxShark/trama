#!/usr/bin/env node
// Prueba de punta a punta de la red de contención (electron/contencion.ts, electron/log.ts, src/ErrorBoundary.ts):
// abre la app offscreen (HILOS_PRUEBA, sin ventana, fixtures, estado y perfil temporales) y le mata el renderer (SIGKILL a su proceso: nada de cargar la CPU). Las dos primeras muertes la recargan sola; la tercera en un minuto deja el
// cartel y no reintenta; Recargar vuelve a la app. Un error y una promesa rechazada del renderer llegan al log
// (`$HILOS_STATE/trama.log`). Nada toca la trama del usuario ni `pa`.
//   npm run build && node scripts/prueba-contencion.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-contencion-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
const log = path.join(tmp, "hilos", "trama.log");

const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
  env: {
    ...process.env,
    HILOS_PRUEBA: "90",
    HILOS_FIXTURES: "1",
    HILOS_IDIOMA: "es",
    HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
    PA_STATE: path.join(tmp, "pa"),
    HILOS_STATE: path.join(tmp, "hilos"),
    HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
    PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
  },
  stdio: ["ignore", "ignore", process.env.PRUEBA_VERBOSO ? "inherit" : "ignore"],
});

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

/** Una conexión CDP nueva a la página que haya (tras una recarga el destino puede ser otro). */
async function conectar(tope = 15) {
  for (let i = 0; i < tope * 10; i++) {
    try {
      const ts = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
      for (const p of ts.filter((x) => x.type === "page")) {
        const ws = new WebSocket(p.webSocketDebuggerUrl);
        const abre = await new Promise((r) => {
          ws.addEventListener("open", () => r(true), { once: true });
          ws.addEventListener("error", () => r(false), { once: true });
        });
        if (!abre) continue;
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
            ws.addEventListener("close", () => r({}), { once: true });
          });
        return { ws, cdp };
      }
    } catch {}
    await espera(100);
  }
  console.log("lista:", JSON.stringify(await fetch(`http://127.0.0.1:${puerto}/json/list`).then((r) => r.json()).catch((e) => String(e))).slice(0, 600), "app salió:", app.exitCode);
  throw new Error("la app no abrió el puerto de CDP");
}

let c = await conectar();
/** Corre `fn` en la página (se manda como texto). */
async function en(fn, ...args) {
  const r = await c.cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
}
async function hasta(fn, tope, ...args) {
  for (let i = 0; i < tope * 10; i++) {
    const v = await en(fn, ...args).catch(() => null);
    if (v) return v;
    await espera(100);
  }
  return null;
}
const texto = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
const cuantas = (re) => (texto().match(re) ?? []).length;
const hayApp = () => !!document.querySelector(".app");
const hayCartel = () => !!document.querySelector(".er");

/** Los renderers de ESTA instancia (su perfil es el temporal): nunca los de otra trama. */
function renderers() {
  const mios = [];
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const args = readFileSync(`/proc/${d}/cmdline`, "utf8").split(/[\0 ]/); // Chromium reescribe su argv con espacios
      if (args.includes("--type=renderer") && args.includes(`--user-data-dir=${path.join(tmp, "perfil")}`)) mios.push(Number(d));
    } catch {}
  }
  return mios;
}

/** Mata el renderer con SIGKILL, como lo hace systemd-oomd (un SIGSEGV de afuera no lo tira: Chromium lo ignora). */
async function matar() {
  try {
    c.ws.close();
  } catch {}
  const pids = renderers();
  for (const pid of pids) process.kill(pid, "SIGKILL");
  console.log("     renderers:", pids.join(","));
  return pids.length;
}

try {
  ok(await hasta(hayApp, 20), "arranca: la app está pintada");
  ok(!(await en(hayCartel)), "sin cartel");

  // Muerte 1 y 2: se recarga sola.
  for (const n of [1, 2]) {
    ok((await matar()) === 1, `muerte ${n}: un renderer de la prueba, SIGKILL`);
    await espera(1500);
    c = await conectar();
    ok(await hasta(hayApp, 20), `muerte ${n}: la recarga sola la deja pintada`);
    ok(cuantas(/error \[renderer render-process-gone\].*se recarga/g) === n, `muerte ${n}: queda en el log`);
  }

  // Muerte 3 en el minuto: el cartel, y no reintenta.
  await matar();
  await espera(1500);
  c = await conectar();
  ok(await hasta(hayCartel, 20), "muerte 3: se queda el cartel");
  ok((await en(() => document.querySelector(".er")?.innerText.replace(/\s+/g, " "))) ?? "", "cartel con texto");
  console.log("     ", await en(() => document.querySelector(".er")?.innerText.replace(/\s+/g, " ")));
  ok(!(await en(hayApp)), "el cartel es sólo el cartel, sin la app");
  ok(cuantas(/demasiadas muertes seguidas, se deja el cartel/g) === 1, "la tercera queda en el log como cartel");
  await espera(2500);
  ok(await en(hayCartel), "pasan unos segundos y no reintentó");
  ok(await en(() => [...document.querySelectorAll(".er button")].map((b) => b.innerText).join("|")) === "Recargar|Copiar detalle", "con Recargar y Copiar detalle");

  // Recargar: vuelve la app (y el tope empieza de cero).
  await en(() => document.querySelector(".er button")?.click());
  await espera(500);
  c = await conectar();
  ok(await hasta(hayApp, 20), "Recargar vuelve a la app");

  // Errores del renderer al log.
  await en(() => void setTimeout(() => { throw new Error("prueba-onerror-1234"); }, 0));
  await en(() => void Promise.reject(new Error("prueba-rechazo-5678")));
  await espera(800);
  ok(/error \[renderer\/ventana onerror\] Error: prueba-onerror-1234/.test(texto()), "un error sin atrapar del renderer llega al log");
  ok(/error \[renderer\/ventana unhandledrejection\] Error: prueba-rechazo-5678/.test(texto()), "una promesa rechazada del renderer llega al log");
  ok(/error \[renderer console\]/.test(texto()), "console.error del renderer llega al log");
} finally {
  console.log("--- trama.log ---\n" + texto().split("\n").map((l) => l.slice(0, 160)).slice(0, 40).join("\n"));
  app.kill("SIGTERM");
  await espera(500);
  rmSync(tmp, { recursive: true, force: true });
}
if (fallas) {
  console.log(`\n${fallas} falla(s)`);
  process.exit(1);
}
console.log("\ntodo bien");
process.exit(0);
