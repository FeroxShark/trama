#!/usr/bin/env node
// Prueba de punta a punta del vigía (electron/vigia.ts) con el `pa` falso: abre la app
// offscreen (HILOS_PRUEBA, sin ventana) con un líder de terminal de mentira (un `sleep`
// con su sesión en un HILOS_SESIONES temporal) y su worker trabajando. Después lo mata
// como lo mata systemd-oomd: sin evento en `eventos.jsonl` y sin borrar la sesión. La
// barra tiene que enterarse sola (≤ 10 s): el worker pasa a "Died", sin onda, y el
// líder sigue en la barra, marcado "Died", con el worker colgando. Después lo retoma con
// el botón (no lanza nada) y le escribe: recién ahí sale el `claude --resume`, en su carpeta.
// Nada toca `pa` ni a Claude de verdad: PA_STATE, HILOS_STATE, CLAUDE_CONFIG_DIR, el perfil
// y el registry son temporales.
//   npm run build && node scripts/prueba-vigia.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-vigia-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
const WORKER = "20261003-100300-44444";
const SID = "5a1f0c1d-0000-4000-8000-00000000fa15";
for (const d of ["atlas", "brote"]) mkdirSync(path.join(tmp, "proy", d), { recursive: true });
mkdirSync(path.join(tmp, "pa"));
writeFileSync(
  path.join(tmp, "registry.json"),
  JSON.stringify({
    projects: [
      { name: "Atlas Web", path: path.join(tmp, "proy", "atlas"), desc: "La web" },
      { name: "brote", path: path.join(tmp, "proy", "brote"), desc: "El jardín" },
    ],
  }),
);

// El líder "ana-prueba": un `sleep` con su sesión (pid y arranque reales). Lanzó el 44444.
const lider = spawn("sleep", ["120"], { stdio: "ignore" });
const sesiones = path.join(tmp, "sesiones");
mkdirSync(sesiones);
const arranque = Number(readFileSync(`/proc/${lider.pid}/stat`, "utf8").split(") ").at(-1).split(" ")[19]);
writeFileSync(
  path.join(sesiones, `${lider.pid}.json`),
  JSON.stringify({
    pid: lider.pid,
    sessionId: SID,
    cwd: path.join(tmp, "proy", "brote"),
    kind: "interactive",
    entrypoint: "cli",
    name: "ana-prueba",
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    procStart: arranque,
  }),
);

// Su conversación en el disco, como la deja Claude Code: de ahí sale la carpeta al retomarlo.
const logClaude = path.join(tmp, "claude-falso.log");
mkdirSync(path.join(tmp, "claude", "projects", "-proy-brote"), { recursive: true });
writeFileSync(
  path.join(tmp, "claude", "projects", "-proy-brote", `${SID}.jsonl`),
  JSON.stringify({ type: "user", cwd: path.join(tmp, "proy", "brote"), sessionId: SID, message: { role: "user", content: "hola" } }) + "\n",
);

const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
  env: {
    ...process.env,
    HILOS_PRUEBA: "60",
    HILOS_FIXTURES: "0",
    HILOS_IDIOMA: "en",
    HILOS_VISTA: "todo",
    HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
    PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
    // Un id de sesión de verdad (uuid): es lo que se retoma.
    PA_FALSO_LIDER: SID,
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

/** Corre `fn` en la página (se manda como texto) y devuelve lo que devuelva. */
async function en(fn, ...args) {
  const r = await cdp("Runtime.evaluate", {
    expression: `(${fn})(...${JSON.stringify(args)})`,
    awaitPromise: true,
    returnByValue: true,
  });
  return r.result?.result?.value;
}

/** Espera hasta que `fn` devuelva algo verdadero (tope en segundos). */
async function hasta(fn, tope, ...args) {
  for (let i = 0; i < tope * 10; i++) {
    const v = await en(fn, ...args).catch(() => null);
    if (v) return v;
    await espera(100);
  }
  return null;
}

/** La fila del worker: su texto, si late (onda) y si tiene el punto de lo que murió. */
const fila = (id) => {
  const f = document.querySelector(`[data-fila="${id}"]`);
  if (!f) return null;
  return { texto: f.innerText.replace(/\s+/g, " "), onda: !!f.querySelector(".onda"), fallo: !!f.querySelector(".pt-fallo") };
};
/** Los `claude --resume` que salieron (el falso anota cada arranque; también el de `--version`). */
const resumes = () =>
  existsSync(logClaude)
    ? readFileSync(logClaude, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x)).filter((x) => x.args?.includes("--resume"))
    : [];
const json = (f) => {
  try {
    return JSON.parse(readFileSync(path.join(tmp, "hilos", f), "utf8"));
  } catch {
    return null;
  }
};

try {
  const antes = await hasta(fila, 15, WORKER);
  ok(antes?.onda && !antes.fallo, "vivo: la fila del worker late como siempre");
  ok(await hasta((sid) => !!document.querySelector(`[data-lider="${sid}"]`), 10, SID), "vivo: cuelga de su líder");

  // Los matan: `pa` lo va a decir cuando le pregunten, pero nadie escribe un evento ni borra la sesión.
  const pliegue = (sid) => `.arbol:has([data-lider="${sid}"]) .pliegue .mini-pliegue`;
  writeFileSync(path.join(tmp, "pa", "muertos"), "");
  lider.kill("SIGKILL");
  const t0 = Date.now();
  // Lo que murió ya no ocupa fila bajo su líder: la vista de todo lo pliega en "N terminados" ("N done"). Que el líder
  // figure caído y la fila ya no esté a la vista es que la app se enteró; un clic en el pliegue la despliega, ya sin latir.
  const murio = await hasta((sid, id) => !!document.querySelector(`[data-lider="${sid}"][data-caido="murio"]`) && !document.querySelector(`[data-fila="${id}"]`), 20, SID, WORKER);
  ok(murio, `la app se entera sola de la muerte (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  await en((s) => document.querySelector(s)?.click(), pliegue(SID));
  // La fila vieja (bajo el líder) sale animada: se espera a que quede una sola.
  await hasta((id) => document.querySelectorAll(`[data-fila="${id}"]`).length === 1 && !document.querySelector(`[data-fila="${id}"] .onda`), 3, WORKER);
  const despues = await en(fila, WORKER);
  ok(despues && !despues.onda && despues.fallo && /Died/.test(despues.texto), `la fila dice "Died" y no late: ${despues?.texto.slice(0, 70)}`);
  // El líder muerto sigue en la barra, marcado, con su worker colgando (nada de "sin líder").
  const caido = await hasta((sid) => {
    const e = document.querySelector(`[data-lider="${sid}"][data-caido="murio"]`);
    return e ? e.innerText.replace(/\s+/g, " ") : null;
  }, 5, SID);
  ok(caido && /ana-prueba/.test(caido) && /Died/.test(caido), `el líder sigue en la barra y dice "Died": ${caido}`);
  ok(await en((sid, id) => !!document.querySelector(`.arbol:has([data-lider="${sid}"]) [data-fila="${id}"]`), SID, WORKER), 'su worker cuelga de él, no de "no lead"');

  // Al abrirla, sin Stop: lo que murió no se para.
  await en((id) => document.querySelector(`[data-fila="${id}"] button, [data-fila="${id}"]`)?.click(), WORKER);
  await espera(600);
  ok(!(await en(() => [...document.querySelectorAll("button")].some((b) => /^Stop$/.test(b.innerText.trim())))), "abierta, no ofrece Stop");

  const m = json("muertes.json");
  const hace = Math.floor(Date.now() / 1000) - (m?.muertes?.[WORKER] ?? 0);
  ok(hace >= 0 && hace < 30, `muertes.json guarda cuándo lo vio morir (hace ${hace} s)`);
  const c = json("caidos.json");
  ok(c?.caidos?.some((x) => x.id === SID && x.nombre === "ana-prueba"), "caidos.json recuerda al líder caído");

  // Retomarlo: un clic en su vista. Pasa a ser de la app sin lanzar nada ni mandarle nada.
  await en((sid) => document.querySelector(`[data-lider="${sid}"]`)?.click(), SID);
  ok(await hasta(() => !!document.querySelector("[data-retomar-lider]"), 5), "abierto, ofrece Resume en vez de la caja");
  ok(!(await en(() => !!document.querySelector(".caja textarea"))), "sin retomarlo no hay dónde escribirle");
  await en(() => document.querySelector("[data-retomar-lider]")?.click());
  const caja = await hasta(() => !!document.querySelector(".caja textarea") && !document.querySelector("[data-retomar-lider]"), 5);
  ok(caja, `tras Resume, la caja de siempre${caja ? "" : ": " + (await en(() => document.querySelector(".composer, .caja")?.parentElement?.innerText))}`);
  const g = json("lideres.json")?.lideres?.find((x) => x.sid === SID);
  ok(g?.nombre === "ana-prueba" && g.cwd === path.join(tmp, "proy", "brote"), `lideres.json lo tiene, con su carpeta: ${JSON.stringify(g)}`);
  ok(!resumes().length, "retomar no lanzó ningún claude");
  ok(!(await en((sid) => !!document.querySelector(`[data-lider="${sid}"][data-caido]`), SID)), "en la barra ya no figura como muerto");

  // Escribirle: recién ahora sale el `claude -p --resume`, en la carpeta donde vivía.
  await en(() => document.querySelector(".caja textarea")?.focus());
  await cdp("Input.insertText", { text: "seguimos" });
  for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  let lanzado = null;
  for (let i = 0; i < 100 && !lanzado; i++) {
    [lanzado] = resumes();
    if (!lanzado) await espera(100);
  }
  ok(lanzado?.args?.[lanzado.args.indexOf("--resume") + 1] === SID && lanzado.cwd === path.join(tmp, "proy", "brote"), `al escribirle, claude --resume en su carpeta: ${lanzado?.cwd}`);
} finally {
  lider.kill("SIGKILL");
  app.kill();
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
