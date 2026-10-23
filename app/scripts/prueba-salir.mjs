#!/usr/bin/env node
// Prueba de "Cerrar del todo": una trama residente de verdad, escondida, con su propio perfil y estado y los fakes
// (todo en uno, sin motor, y como la unidad: TRAMA_UNIDAD=1). Ctrl+Q abre la pregunta
// de Trama (no un confirm) con sus dos salidas y Esc la cierra sin salir; "Cerrar y dejar que sigan" saca el proceso con el
// código 3 (el que la unidad no vuelve a levantar); lo mismo "Cerrar y parar todo". Sin ícono en la bandeja (HILOS_PERFIL):
// ésa y Super+Q (el cierre de la ventana, que `window.close()` por CDP no emula) se prueban a mano. Nunca toca la trama de Ana: sólo se matan, por pid exacto, los procesos de esta prueba.
//   npm run build && node scripts/prueba-salir.mjs   (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-salir-")));
const puerto = 10400 + Math.floor(Math.random() * 400);
const electron = path.join(raiz, "node_modules/electron/dist/electron");
const estado = path.join(tmp, "hilos");
for (const d of ["pa", "sesiones", "claude", "tablero"]) mkdirSync(path.join(tmp, d), { recursive: true });
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [] }));
writeFileSync(path.join(tmp, "settings.json"), "{}");
writeFileSync(path.join(tmp, "CLAUDE.md"), "");
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });

const env = {
  ...process.env,
  HILOS_FIXTURES: "0",
  HILOS_IDIOMA: "es",
  HILOS_PERFIL: path.join(tmp, "perfil"),
  HILOS_BUILD: path.join(tmp, "build"),
  HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
  PA_FALSO_N: "0",
  PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
  PA_STATE: path.join(tmp, "pa"),
  HILOS_STATE: estado,
  PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
  HILOS_SESIONES: path.join(tmp, "sesiones"),
  HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
  HILOS_CLAUDE_SETTINGS: path.join(tmp, "settings.json"),
  HILOS_CLAUDE_MD: path.join(tmp, "CLAUDE.md"),
  CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
  HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
  HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
  HILOS_TABLERO: "/bin/false",
  TABLERO_DIR: path.join(tmp, "tablero"),
  TRAMA_UNIDAD: "1",
};
for (const k of ["HILOS_PRUEBA", "HILOS_BENCH", "HILOS_GUION", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG", "HILOS_DEV_URL", "HILOS_BANDEJA"]) delete env[k];

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};
const mios = new Set();
const mio = (pid) => {
  try {
    return pid > 0 && readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0 ]/).includes(`--remote-debugging-port=${puerto}`);
  } catch {
    return false;
  }
};
const huerfanos = () => {
  const r = [];
  for (const d of readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try {
      if (readFileSync(`/proc/${d}/environ`, "utf8").split("\0").includes(`HILOS_STATE=${estado}`)) r.push(Number(d));
    } catch {}
  }
  return r.filter((p) => p !== process.pid);
};
async function limpiar() {
  for (const pid of mios) if (mio(pid)) process.kill(pid, "SIGKILL");
  for (const pid of huerfanos()) process.kill(pid, "SIGKILL");
  await espera(300);
  rmSync(tmp, { recursive: true, force: true });
}
setTimeout(() => (console.log("FALLA la prueba tardó más de 2 minutos"), limpiar().then(() => process.exit(1))), 120_000).unref();

function lanzar() {
  const p = spawn(electron, [raiz, "--escondida", `--remote-debugging-port=${puerto}`], { env, stdio: "ignore" });
  mios.add(p.pid);
  p.codigo = new Promise((r) => p.on("exit", (c, s) => r(s ?? c)));
  return p;
}

async function pagina() {
  let url = null;
  for (let i = 0; i < 200 && !url; i++) {
    try {
      const ts = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
      url = ts.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {}
    if (!url) await espera(100);
  }
  if (!url) throw new Error("la app no abrió el puerto de CDP");
  const ws = new WebSocket(url);
  await new Promise((r, no) => (ws.addEventListener("open", r, { once: true }), ws.addEventListener("error", no, { once: true })));
  let n = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) (pend.get(m.id)(m), pend.delete(m.id));
  });
  const cdp = (method, params = {}) =>
    new Promise((r) => {
      const id = ++n;
      pend.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const en = async (fn, ...args) =>
    (await Promise.race([cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }), espera(5000).then(() => null)]))?.result?.result?.value;
  const hasta = async (fn, tope, ...args) => {
    for (let i = 0; i < tope * 10; i++) {
      const v = await en(fn, ...args).catch(() => null);
      if (v) return v;
      await espera(100);
    }
    return null;
  };
  const foto = async (nombre) => {
    if (!fotos) return;
    const r = await Promise.race([cdp("Page.captureScreenshot", { format: "png" }), espera(5000).then(() => null)]);
    if (r?.result?.data) writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
  };
  await cdp("Page.enable");
  return { en, hasta, cdp, foto, cerrar: () => ws.close() };
}

const listo = () => !!window.hilos && !!document.querySelector("#root")?.firstChild;
const dialogo = () => {
  const d = document.querySelector('.sa-caja[role="alertdialog"]');
  return d ? { titulo: d.querySelector("h2")?.textContent, opciones: [...d.querySelectorAll(".sa-op b")].map((b) => b.textContent), foco: document.activeElement?.querySelector?.("b")?.textContent ?? null } : null;
};
const ctrlQ = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "q", ctrlKey: true, bubbles: true, cancelable: true }));
const esc = () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
const clic = (texto) => [...document.querySelectorAll(".sa-op")].find((b) => b.textContent.includes(texto))?.click();
const vive = (p) => p.exitCode === null && p.signalCode === null;

try {
  for (const [opcion, titulo] of [
    ["Cerrar y dejar que sigan", "seguir"],
    ["Cerrar y parar todo", "parar"],
  ]) {
    const app = lanzar();
    const pag = await pagina();
    ok(await pag.hasta(listo, 20), `[${titulo}] arranca y carga la interfaz`);
    // Ctrl+Q: la pregunta de Trama, con dos salidas y la primera enfocada.
    await pag.en(ctrlQ);
    const d = await pag.hasta(dialogo, 5);
    ok(d?.titulo === "¿Cerrar Trama y dejar que los workers sigan?", `[${titulo}] Ctrl+Q abre la pregunta (${d?.titulo})`);
    ok(d?.opciones?.join("|") === "Cerrar y dejar que sigan|Cerrar y parar todo", `[${titulo}] con las dos salidas (${d?.opciones})`);
    ok(d?.foco === "Cerrar y dejar que sigan", `[${titulo}] la que deja seguir al trabajo viene enfocada`);
    await pag.foto(`salir-${titulo}`);
    // Esc la cierra sin salir.
    await pag.en(esc);
    ok(!(await pag.en(dialogo)), `[${titulo}] Esc cierra la pregunta`);
    await espera(500);
    ok(vive(app), `[${titulo}] y no sale`);
    // La salida elegida: el proceso se va con el 3 (la unidad no lo levanta de nuevo).
    await pag.en(ctrlQ);
    await pag.hasta(dialogo, 5);
    await pag.en(clic, opcion);
    const fin = await Promise.race([app.codigo, espera(15_000).then(() => "colgado")]);
    ok(fin === 3, `[${titulo}] "${opcion}" saca al proceso con el código 3 (${fin})`);
    if (fin === "colgado") process.kill(app.pid, "SIGKILL");
    pag.cerrar();
    await espera(500);
    for (const h of huerfanos()) process.kill(h, "SIGKILL");
    await espera(300);
  }
  // Con `pa` falso: ni una salida pidió parar a nadie (no había workers de líderes de trama).
  let paLog = "";
  try {
    paLog = readFileSync(path.join(tmp, "pa-falso.log"), "utf8");
  } catch {}
  ok(!/--parar/.test(paLog), "nunca se paró a un worker que trama no conoce");
} catch (e) {
  console.log(`FALLA ${e?.stack ?? e}`);
  fallas++;
}
await limpiar();
console.log(fallas ? `${fallas} fallas` : "todo bien");
process.exit(fallas ? 1 : 0);
