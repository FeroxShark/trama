#!/usr/bin/env node
// Prueba de punta a punta del texto que se ve mientras llega: abre la app offscreen
// (HILOS_PRUEBA, sin ventana) con el claude falso, le manda "novela" a un líder nuevo (una
// respuesta larga en markdown, de a un delta por palabra) y mira la conversación mientras
// crece. Comprueba que el texto aparece de a poco, siempre en un solo mensaje; que la vista lo
// sigue si está al fondo y no arrastra si se scrolleó para arriba; y que al terminar, cuando la
// vista relee el transcript, queda un solo mensaje con el mismo render que mientras llegaba.
// El transcript lo escribe la prueba (el falso no escribe ninguno), como lo deja Claude Code.
// Nada toca `pa` ni a Claude de verdad: todo es temporal o falso.
//   npm run build && node scripts/prueba-stream.mjs
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-stream-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
const falso = path.join(raiz, "scripts/claude-falso.mjs");
mkdirSync(path.join(tmp, "pa"));
mkdirSync(path.join(tmp, "sesiones"));
mkdirSync(path.join(tmp, "claude", "projects", "-prueba"), { recursive: true });
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [] }));

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

/** Lo que el falso contesta a "novela" (se lo pregunta a él: la prueba no copia el texto). */
async function novela() {
  const p = spawn(process.execPath, [falso, "-p", "--input-format", "stream-json", "--output-format", "stream-json"], {
    env: { ...process.env, TRAMA_FALSO_TOKEN_MS: "0", TRAMA_FALSO_LOG: "" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  let todo = "";
  p.stdout.setEncoding("utf8");
  const texto = await new Promise((r, mal) => {
    p.stdout.on("data", (d) => {
      todo += d;
      for (const l of todo.split("\n").slice(0, -1)) {
        const o = JSON.parse(l);
        if (o.type === "assistant") r(o.message.content[0].text);
      }
    });
    p.on("exit", () => mal(new Error("el claude falso salió sin contestar")));
    p.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: "novela" } }) + "\n");
  });
  p.kill();
  return texto;
}
const NOVELA = await novela();
const PALABRAS = NOVELA.match(/\s*\S+/g).length;

const logClaude = path.join(tmp, "claude-falso.log");
const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
  env: {
    ...process.env,
    HILOS_PRUEBA: "90",
    HILOS_FIXTURES: "0",
    HILOS_IDIOMA: "en",
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
    HILOS_CLAUDE: falso,
    CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
    TRAMA_FALSO_LOG: logClaude,
    // Unos 4 s por novela: da tiempo a mirar y a scrollear a mitad.
    TRAMA_FALSO_TOKEN_MS: "6",
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

/** Manda un mensaje por la caja y empieza a anotar cómo cambia la conversación (`window.__m`). */
async function mandar(texto) {
  await en(() => {
    window.__obs?.disconnect();
    window.__m = [];
    // La vista abierta (las otras siguen montadas, escondidas).
    const zona = () => [...document.querySelectorAll(".conv-zona")].find((z) => z.clientHeight > 0);
    window.__zona = zona;
    window.__obs = new MutationObserver(() => {
      const z = zona();
      if (!z) return;
      const els = z.querySelectorAll(".conv .el");
      const ult = els[els.length - 1];
      window.__m.push({
        els: els.length,
        yo: z.querySelectorAll(".conv .yo").length,
        largo: ult?.innerText.length ?? 0,
        falta: Math.round(z.scrollHeight - z.scrollTop - z.clientHeight),
        desborda: z.scrollHeight > z.clientHeight + 4,
        tope: Math.round(z.scrollTop),
      });
    });
    window.__obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.querySelector(".caja-zona textarea")?.focus();
  });
  await cdp("Input.insertText", { text: texto });
  await tecla("Enter", 13);
}
/** La respuesta `k` (desde 0) llegó entera. */
const termino = (k) =>
  hasta(
    (k) => {
      const els = window.__zona?.()?.querySelectorAll(".conv .el") ?? [];
      return els.length === k + 1 && els[k].innerText.includes("Fin de la novela.");
    },
    20,
    k,
  );
const libre = () => hasta(() => !document.querySelector(".conv-zona .hace") && !!document.querySelector(".caja-zona textarea:not([readonly])"), 10);
const muestras = () => en(() => window.__m);
const estado = () =>
  en(() => {
    const z = window.__zona();
    const els = [...z.querySelectorAll(".conv .el")];
    return {
      els: els.length,
      yo: z.querySelectorAll(".conv .yo").length,
      html: els.map((e) => e.innerHTML),
      falta: Math.round(z.scrollHeight - z.scrollTop - z.clientHeight),
      tope: Math.round(z.scrollTop),
    };
  });

const lineas = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x)) : []);
let transcript = null;
let turnosN = 0;
/** Lo que Claude Code deja en el transcript por un turno: lo del usuario y el mensaje entero. */
function anotar(texto) {
  const k = ++turnosN;
  const ts = new Date().toISOString();
  appendFileSync(transcript, JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content: texto } }) + "\n");
  appendFileSync(
    transcript,
    JSON.stringify({ type: "assistant", timestamp: ts, message: { id: `msg_falso_${k}`, model: "claude-opus-5-5", role: "assistant", content: [{ type: "text", text: NOVELA }] } }) + "\n",
  );
}

try {
  ok(await hasta(() => !!document.querySelector(".barra, .pie") && document.querySelectorAll(".pie button").length >= 4, 15), "la app abrió");
  // Con la interfaz recién pintada el atajo puede llegar antes de que React lo registre: si no pasó nada, una segunda vez.
  await tecla("N", 78, CTRL);
  if (!(await hasta(() => !!document.querySelector(".caja-zona textarea"), 3))) await tecla("N", 78, CTRL);
  ok(await hasta(() => !!document.querySelector(".caja-zona textarea"), 8), "Ctrl+N abre un líder nuevo");

  // --- Un turno: el texto se ve mientras llega -------------------------------------------
  await mandar("novela");
  let sid = null;
  for (let i = 0; i < 100 && !sid; i++) {
    const a = lineas(logClaude).find((x) => x.args?.includes("--session-id"))?.args;
    sid = a ? a[a.indexOf("--session-id") + 1] : null;
    if (!sid) await espera(50);
  }
  ok(!!sid, `salió el claude del líder: ${sid}`);
  transcript = path.join(tmp, "claude", "projects", "-prueba", `${sid}.jsonl`);
  anotar("novela");
  ok(await termino(0), "la respuesta llegó entera");
  const alLlegar = await estado();
  let ms = await muestras();
  const largos = [...new Set(ms.filter((m) => m.els === 1).map((m) => m.largo))];
  ok(largos.length >= 10, `el texto se vio crecer: ${largos.length} largos distintos antes del entero`);
  ok(largos.every((l, i) => i === 0 || l >= largos[i - 1] - 2), "siempre creciendo, nunca para atrás");
  ok(largos.length < PALABRAS / 2, `juntado: ${largos.length} repintados para ${PALABRAS} deltas`);
  ok(ms.every((m) => m.els <= 1 && m.yo <= 1), "en todo momento, un solo mensaje del líder");
  const largas = ms.filter((m) => m.desborda);
  ok(largas.length > 5, `la respuesta es más alta que la ventana (${largas.length} muestras con scroll)`);
  const lejos = Math.max(0, ...largas.map((m) => m.falta));
  ok(lejos < 60, `al fondo, la vista sigue al texto: nunca quedó a más de ${lejos} px`);
  ok(alLlegar.falta < 2, `y termina al fondo: ${alLlegar.falta} px`);

  // Al terminar se relee el transcript (y a los 2 s se suelta lo del stream): queda igual.
  ok(await libre(), "terminó el turno");
  await espera(2600);
  const despues = await estado();
  ok(despues.els === 1 && despues.yo === 1, `con el transcript leído sigue habiendo un solo mensaje: ${despues.els} del líder, ${despues.yo} del usuario`);
  ok(despues.html[0] === alLlegar.html[0], "y se ve igual que mientras llegaba (el mismo render)");
  const partes = await en(() => {
    const e = window.__zona().querySelector(".conv .el");
    return { h: e.querySelectorAll("h4").length, li: e.querySelectorAll("li").length, pre: e.querySelectorAll("pre").length, tr: e.querySelectorAll("table tr").length };
  });
  ok(partes.h === 1 && partes.li === 3 && partes.pre === 1 && partes.tr === 3, `el markdown entero: ${JSON.stringify(partes)}`);
  ok(despues.falta < 2, "sigue al fondo");

  // --- Scrolleado para arriba: no arrastra ------------------------------------------------
  await mandar("otra novela");
  anotar("otra novela");
  ok(await hasta(() => window.__m.some((m) => m.els === 2 && m.largo > 500), 10), "la segunda respuesta ya va por la mitad");
  const subido = await en(() => {
    const z = window.__zona();
    z.scrollBy(0, -260);
    return Math.round(z.scrollTop);
  });
  ok(await termino(1), "la segunda llegó entera");
  let fin = await estado();
  ok(Math.abs(fin.tope - subido) <= 1, `el usuario scrolleó para arriba y la vista no se movió: ${subido} → ${fin.tope}`);
  ok(fin.falta > 260, `lo nuevo quedó abajo, sin arrastrarlo: faltan ${fin.falta} px`);
  ok(await libre(), "terminó el segundo turno");
  await espera(2600);
  fin = await estado();
  ok(fin.els === 2 && fin.yo === 2 && Math.abs(fin.tope - subido) <= 1, `releído el transcript sigue donde estaba: ${fin.tope}, ${fin.els} respuestas`);

  // --- De vuelta al fondo: lo sigue otra vez ----------------------------------------------
  await en(() => {
    const z = window.__zona();
    z.scrollTop = z.scrollHeight;
  });
  await espera(100);
  await mandar("la última novela");
  anotar("la última novela");
  ok(await termino(2), "la tercera llegó entera");
  ms = (await muestras()).filter((m) => m.els === 3);
  const lejos3 = Math.max(0, ...ms.map((m) => m.falta));
  ok(ms.length > 10 && lejos3 < 60, `vuelto al fondo, la sigue de nuevo: ${ms.length} muestras, a lo sumo a ${lejos3} px`);
  ok((await estado()).falta < 2, "y termina al fondo");
} finally {
  app.kill();
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
