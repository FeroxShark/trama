#!/usr/bin/env node
// Prueba de punta a punta de escribirle a un líder abierto en una terminal (`traer`,
// electron/lider.ts) y de "Ir a la ventana" (electron/terminal.ts): abre la app offscreen
// (HILOS_PRUEBA, sin ventana) con un líder de terminal de mentira (un `sleep` con su sesión
// en un HILOS_SESIONES temporal) que está a mitad de algo. Tiene la caja de siempre; lo que
// se le escribe queda en cola (electron/cola.ts) sin tocarlo, y cuando termina su turno se
// cierra ESE proceso (y ningún otro) y recién entonces sale el `claude --resume`, en su
// carpeta. A otro, también a mitad de algo, se lo corta con "Cut and send now". El botón de ir
// a su ventana enfoca la que le toca (un hyprctl de mentira; nunca el compositor de verdad).
// Nada toca `pa`, a Claude ni a kitty de verdad: todo es temporal o falso.
//   npm run build && node scripts/prueba-traer.mjs
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-traer-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
const SID = "5a1f0c1d-0000-4000-8000-0000000074ae";
const carpeta = path.join(tmp, "proy", "brote");
mkdirSync(carpeta, { recursive: true });
mkdirSync(path.join(tmp, "pa"));
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [{ name: "brote", path: carpeta, desc: "El jardín" }] }));

// Un hyprctl de mentira: este script "tiene" una sola ventana, así que la del líder (su hijo) es esa.
const logHypr = path.join(tmp, "hyprctl.log");
const hyprctl = path.join(tmp, "hyprctl");
writeFileSync(
  hyprctl,
  `#!/usr/bin/env node
const a = process.argv.slice(2);
require("node:fs").appendFileSync(${JSON.stringify(logHypr)}, JSON.stringify(a) + "\\n");
if (a[0] === "clients") console.log(JSON.stringify([{ address: "0xabc123", pid: ${process.pid}, title: "terminal" }]));
else console.log("ok");
`,
);
chmodSync(hyprctl, 0o755);

const arranque = (pid) => readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").at(-1).split(" ")[19];
const sesiones = path.join(tmp, "sesiones");
mkdirSync(sesiones);
/** Un `claude` de terminal de mentira: un `sleep` (sin entorno: no está en kitty) y su sesión. */
function terminal(sid, nombre, status) {
  transcript(sid);
  const p = spawn("sleep", ["120"], { stdio: "ignore", env: {} });
  let fin = null;
  p.on("exit", (_c, senal) => (fin = senal ?? "salió"));
  writeFileSync(
    path.join(sesiones, `${p.pid}.json`),
    JSON.stringify({ pid: p.pid, sessionId: sid, cwd: carpeta, kind: "interactive", entrypoint: "cli", name: nombre, status, startedAt: Date.now() - 60_000, updatedAt: Date.now(), procStart: arranque(p.pid) }),
  );
  const archivo = path.join(sesiones, `${p.pid}.json`);
  /** Cambia su estado (`busy` → `idle`: terminó el turno), como lo hace Claude Code. */
  const estado = (st) => writeFileSync(archivo, JSON.stringify({ ...JSON.parse(readFileSync(archivo, "utf8")), status: st, updatedAt: Date.now() }));
  return { p, fin: () => fin, estado };
}
const SID2 = "5a1f0c1d-0000-4000-8000-0000000c0a7e";
const logClaude = path.join(tmp, "claude-falso.log");
function transcript(sid) {
  const d = path.join(tmp, "claude", "projects", "-proy-brote");
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, `${sid}.jsonl`), JSON.stringify({ type: "user", cwd: carpeta, sessionId: sid, message: { role: "user", content: "hola" } }) + "\n");
}
const lider = terminal(SID, "ana-prueba", "busy");
// Otro a mitad de algo: a este se lo corta.
const apurado = terminal(SID2, "ana-apurado", "busy");
// Otra terminal con otra sesión: no se la toca.
const otra = terminal("5a1f0c1d-0000-4000-8000-00000000074a", "ana-otra", "idle");


const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
  env: {
    ...process.env,
    HILOS_PRUEBA: "60",
    HILOS_FIXTURES: "0",
    HILOS_IDIOMA: "en",
    HILOS_VISTA: "todo",
    HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
    PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
    PA_FALSO_N: "0",
    PA_STATE: path.join(tmp, "pa"),
    HILOS_STATE: path.join(tmp, "hilos"),
    HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
    PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
    HILOS_SESIONES: sesiones,
    HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
    CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
    TRAMA_FALSO_LOG: logClaude,
    HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
    HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
    NPM_FALSO_LOG: path.join(tmp, "npm-falso.log"),
    HILOS_HYPRCTL: hyprctl,
    HILOS_KITTEN: "/bin/false",
  },
  stdio: "ignore",
});

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
async function en(fn, ...args) {
  const r = await cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
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
const lineas = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x)) : []);
const resumes = () => lineas(logClaude).filter((x) => x.args?.includes("--resume"));
const enfoques = () => lineas(logHypr).filter((a) => a[0] === "dispatch");
const enter = async () => {
  for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
};

try {
  ok(await hasta((sid) => !!document.querySelector(`[data-lider="${sid}"]`), 15, SID), "el líder de la terminal está en la barra");
  await en((sid) => document.querySelector(`[data-lider="${sid}"]`)?.click(), SID);
  ok(await hasta(() => !!document.querySelector(".caja textarea") && !!document.querySelector(".caja-ajeno"), 5), "abierto, tiene la caja de siempre y dice que está en una terminal");

  // Ir a la ventana: el botón está porque se la pudo ubicar, y enfoca esa.
  ok(await hasta(() => !!document.querySelector("[data-ir-lider]"), 5), "ofrece Go to the window (se pudo ubicar la ventana)");
  ok(!enfoques().length, "ubicarla no mueve el foco");
  await en(() => document.querySelector("[data-ir-lider]")?.click());
  for (let i = 0; i < 50 && !enfoques().length; i++) await espera(100);
  ok(JSON.stringify(enfoques()) === JSON.stringify([["dispatch", 'hl.dsp.focus({ window = "address:0xabc123" })']]), `el botón enfoca su ventana: ${JSON.stringify(enfoques())}`);

  // Escribirle mientras trabaja: queda en cola, y no toca nada.
  const resumesDe = (sid) => resumes().filter((x) => x.args[x.args.indexOf("--resume") + 1] === sid);
  const guardados = (sid) => {
    try {
      return (JSON.parse(readFileSync(path.join(tmp, "hilos", "cola.json"), "utf8")).colas[sid] ?? []).map((x) => x.texto);
    } catch {
      return [];
    }
  };
  await en(() => document.querySelector(".caja textarea")?.focus());
  await cdp("Input.insertText", { text: "seguimos" });
  await enter();
  ok(await hasta(() => [...document.querySelectorAll(".yo.encolado")].some((x) => /seguimos/.test(x.innerText)), 5), "está a mitad de algo: el mensaje queda en cola, a la vista");
  await espera(300);
  ok(lider.fin() === null && !resumes().length, "el de la terminal sigue vivo y no salió ningún claude");
  ok((await en(() => document.querySelector(".caja textarea")?.value)) === "", "la caja quedó vacía");
  ok(await en(() => !!document.querySelector("[data-cortar-lider]") && !!document.querySelector(".caja-ajeno[data-espera]")), "dice que sale cuando termine, y ofrece cortarlo como salida aparte");
  ok(JSON.stringify(guardados(SID)) === '["seguimos"]', `la cola está en disco (cola.json): ${JSON.stringify(guardados(SID))}`);
  // Otro más: se puede sacar de la cola.
  await cdp("Input.insertText", { text: "esto no" });
  await enter();
  ok(await hasta(() => document.querySelectorAll(".yo.encolado").length === 2, 5), "un segundo mensaje también espera");
  await en(() => [...document.querySelectorAll(".yo.encolado")].at(-1)?.querySelector(".encolado-x")?.click());
  ok(await hasta(() => document.querySelectorAll(".yo.encolado").length === 1, 5), "y se lo puede sacar de la cola");

  // Termina su turno allá: se cierra ese proceso (sólo ese) y recién entonces sale el --resume.
  lider.estado("idle");
  let lanzado = null;
  for (let i = 0; i < 100 && !lanzado; i++) {
    [lanzado] = resumesDe(SID);
    if (!lanzado) await espera(100);
  }
  ok(lider.fin() === "SIGTERM", `terminó el turno: el claude de la terminal recibió SIGTERM: ${lider.fin()}`);
  ok(apurado.fin() === null, "el otro, que sigue a mitad de algo, ni se enteró");
  ok(otra.fin() === null, "la otra terminal ni se enteró");
  ok(lanzado?.args?.[lanzado.args.indexOf("--resume") + 1] === SID && lanzado.cwd === carpeta, `claude --resume en su carpeta: ${lanzado?.cwd}`);
  ok(resumesDe(SID).length === 1, "un solo proceso con esa sesión");
  ok(
    await hasta(() => !document.querySelector(".caja-ajeno") && !!document.querySelector(".caja textarea") && !document.querySelector(".yo.encolado") && [...document.querySelectorAll(".yo")].some((x) => /seguimos/.test(x.innerText)), 8),
    "ya es un líder de la app: su mensaje está en la conversación (no en la cola) y no hay más nota de terminal",
  );
  ok(!(await en(() => document.querySelector(".conv")?.innerText ?? "")).includes("esto no"), "lo que se sacó de la cola no salió");
  ok(!guardados(SID).length, "la cola quedó vacía en disco");
  const g = JSON.parse(readFileSync(path.join(tmp, "hilos", "lideres.json"), "utf8")).lideres.find((x) => x.sid === SID);
  ok(g?.nombre === "ana-prueba" && g.cwd === carpeta, `lideres.json lo tiene, con su carpeta: ${JSON.stringify(g)}`);
  // La respuesta se ve acá.
  const resp = await hasta(() => {
    const t = [...document.querySelectorAll(".conv .turno, .conv .el")].map((x) => x.innerText).join(" ");
    return t.length > 0 ? t.slice(-120) : null;
  }, 10);
  ok(!!resp, `la respuesta se ve en Trama: ${String(resp).replace(/\s+/g, " ").slice(0, 80)}`);

  // El otro: en cola igual, y "Cut and send now" lo corta sin esperar.
  await en((sid) => document.querySelector(`[data-lider="${sid}"]`)?.click(), SID2);
  ok(await hasta(() => !!document.querySelector(".caja-ajeno") && !document.querySelector(".yo.encolado"), 5), "el otro líder, abierto: sigue en su terminal");
  await en(() => document.querySelector(".caja textarea")?.focus());
  await cdp("Input.insertText", { text: "urgente" });
  await enter();
  ok(await hasta(() => !!document.querySelector(".yo.encolado") && !!document.querySelector("[data-cortar-lider]"), 5), "su mensaje queda en cola");
  await espera(300);
  ok(apurado.fin() === null && !resumesDe(SID2).length, "sin pedirlo no se lo corta");
  await en(() => document.querySelector("[data-cortar-lider]")?.click());
  for (let i = 0; i < 100 && !resumesDe(SID2).length; i++) await espera(100);
  ok(apurado.fin() === "SIGTERM" && resumesDe(SID2).length === 1, `Cut and send now: SIGTERM a ese y un --resume: ${apurado.fin()}`);
  ok(otra.fin() === null, "la tercera terminal sigue como estaba");
  ok(await hasta(() => !document.querySelector(".yo.encolado") && [...document.querySelectorAll(".yo")].some((x) => /urgente/.test(x.innerText)), 8), "y su mensaje pasó a la conversación");
} finally {
  lider.p.kill("SIGKILL");
  apurado.p.kill("SIGKILL");
  otra.p.kill("SIGKILL");
  app.kill();
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
