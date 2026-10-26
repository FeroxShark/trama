#!/usr/bin/env node
// Prueba de punta a punta del chat vivo con los fakes: abre la
// app offscreen (HILOS_PRUEBA, sin ventana) con el `pa` falso, un líder de terminal de
// mentira (un `sleep` con su sesión en un HILOS_SESIONES temporal) y el `claude` falso.
//  1. Compactar: corre `scripts/hook-compactando.sh` como lo corre Claude Code (PreCompact /
//     PostCompact) para un worker y para el líder de terminal: las hojas tienen que aparecer
//     en su fila y en su chat, y la onda de "trabajando" irse; al terminar, al revés. Un
//     líder de la app lo dice por su stream ("compactá").
//  2. El paso en curso: el líder de terminal trabaja (su transcript crece, un Bash cada 220 ms);
//     con el trabajo cerrado, una sola línea que se reemplaza.
//  3. Seguir el fondo: abierta, la lista sigue su último paso; si se sube se suelta, y al
//     volver al fondo sigue de nuevo. Y el chat entero queda en el fondo al llegar la respuesta.
// Nada toca `pa` ni a Claude de verdad: PA_STATE, HILOS_STATE, CLAUDE_CONFIG_DIR, el perfil
// y el registry son temporales.
//   npm run build && node scripts/prueba-compactando.mjs
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-compactando-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
const WORKER = "20261003-100300-44444";
const SID = "5a1f0c1d-0000-4000-8000-00000000c0a1";
const HOOK = path.join(raiz, "scripts/hook-compactando.sh");
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
/** Su sesión, como la deja Claude Code: `status` dice si está trabajando. */
const sesion = (status) =>
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
      status,
    }),
  );
sesion("idle");

// Su conversación en el disco: la prueba la hace crecer como si trabajara.
const transcript = path.join(tmp, "claude", "projects", "-proy-brote", `${SID}.jsonl`);
mkdirSync(path.dirname(transcript), { recursive: true });
const linea = (o) => appendFileSync(transcript, JSON.stringify({ cwd: path.join(tmp, "proy", "brote"), sessionId: SID, timestamp: new Date().toISOString(), ...o }) + "\n");
linea({ type: "user", message: { role: "user", content: "hola" } });
linea({ type: "assistant", message: { id: "m0", role: "assistant", content: [{ type: "text", text: "Hola." }] } });
const PASOS = 30;
/** Un paso: usa el Bash (con su descripción) y le llega el resultado. */
const paso = (k) => {
  linea({ type: "assistant", message: { id: `mp${k}`, role: "assistant", content: [{ type: "tool_use", id: `tp${k}`, name: "Bash", input: { command: `echo paso ${k}`, description: `Paso ${k} de ${PASOS}` } }] } });
  linea({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tp${k}`, content: `paso ${k}` }] } });
};

const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
  env: {
    ...process.env,
    HILOS_PRUEBA: "90",
    HILOS_FIXTURES: "0",
    HILOS_IDIOMA: "en",
    HILOS_VISTA: "todo",
    HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
    PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
    PA_FALSO_LIDER: SID,
    PA_STATE: path.join(tmp, "pa"),
    HILOS_STATE: path.join(tmp, "hilos"),
    HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
    PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
    HILOS_SESIONES: sesiones,
    HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
    CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
    TRAMA_FALSO_LOG: path.join(tmp, "claude-falso.log"),
    TRAMA_FALSO_COMPACTA_MS: "2500",
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

/** Espera hasta que `fn` devuelva algo verdadero (tope en segundos; mira cada 50 ms). */
async function hasta(fn, tope, ...args) {
  for (let i = 0; i < tope * 20; i++) {
    const v = await en(fn, ...args).catch(() => null);
    if (v) return v;
    await espera(50);
  }
  return null;
}

/** El hook como lo corre Claude Code: el evento por stdin; en un worker de `pa`, con su entorno. */
function hook(evento, sesion, worker = null) {
  const { PA_WORKER: _w, PA_TS: _t, ...limpio } = process.env;
  execFileSync(HOOK, [], {
    input: JSON.stringify({ session_id: sesion, hook_event_name: evento, trigger: "auto" }),
    env: { ...limpio, HILOS_STATE: path.join(tmp, "hilos"), ...(worker ? { PA_WORKER: "1", PA_TS: worker } : {}) },
  });
}

/** Una fila de la barra (`sel`): su texto, si tiene las hojas (y si se mueven) y si late de trabajando. */
const fila = (sel) => {
  const f = document.querySelector(sel);
  if (!f) return null;
  const hojas = [...f.querySelectorAll("[data-compactando], .pt-hojas")].length > 0 ? [...f.querySelectorAll(".pliega")] : [];
  return {
    texto: f.innerText.replace(/\s+/g, " "),
    hojas: hojas.length,
    onda: !!f.querySelector(".onda"),
    fulgor: !!f.querySelector(".fulgor") || f.matches(".fulgor"),
  };
};
/** La línea de compactar del chat abierto: su texto y si sus hojas se mueven (dos lecturas del transform). */
const chat = async () => {
  const c = document.querySelector(".conv-zona .pliegue[data-compactando], .hilo .pliegue[data-compactando], .pliegue[data-compactando]");
  if (!c) return null;
  const h = c.querySelector('.pliega[data-k="1"], .pliega');
  const a = h ? getComputedStyle(h).transform : null;
  await new Promise((r) => setTimeout(r, 300));
  return { texto: c.innerText.replace(/\s+/g, " "), hojas: c.querySelectorAll(".pliega").length, mueve: !!h && getComputedStyle(h).transform !== a };
};
/**
 * El ritmo del hilo principal durante `ms`, medido como anda el latido (src/barra/latido.ts): un
 * timer encadenado cada 16 ms. Cuántos pasos por segundo dio y el hueco más largo entre dos.
 * Offscreen no hay pantalla que medir, pero el hilo es el mismo: un hueco largo es un tartamudeo.
 */
const ritmo = (ms) =>
  new Promise((r) => {
    const t0 = performance.now();
    let antes = t0;
    let pasos = 0;
    let hueco = 0;
    const tic = () => {
      const a = performance.now();
      pasos++;
      hueco = Math.max(hueco, a - antes);
      antes = a;
      if (a - t0 >= ms) r({ fps: Math.round((pasos / (a - t0)) * 1000), hueco: Math.round(hueco) });
      else setTimeout(tic, 16);
    };
    setTimeout(tic, 16);
  });
const fluido = (m) => !!m && m.fps >= 55 && m.hueco <= 50;
const VK = { Enter: 13 };
async function tecla(key, modifiers = 0) {
  const k = { key, modifiers, code: key.length === 1 ? `Key${key.toUpperCase()}` : key };
  k.windowsVirtualKeyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : VK[key];
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
}
/** Escribir en un campo de React: el setter nativo y un evento input. */
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

const FW = `[data-fila="${WORKER}"]`;
const FL = `[data-lider="${SID}"]`;

try {
  // --- 1. Compactar: un worker de `pa` (la marca lleva el id de su run) ------------------
  const antes = await hasta(fila, 15, FW);
  ok(antes?.onda && !antes.hojas, "el worker trabaja: su fila late con la onda, sin hojas");
  hook("PreCompact", "s-del-worker", WORKER);
  let t0 = Date.now();
  const comp = await hasta((s) => !!document.querySelector(`${s} .pt-hojas .pliega`), 5, FW);
  const f1 = await en(fila, FW);
  ok(comp && f1.hojas === 3 && !f1.onda && /Compacting/.test(f1.texto), `PreCompact: la fila cambia la onda por las hojas (${Date.now() - t0} ms): ${f1?.texto.slice(0, 80)}`);
  await en((s) => document.querySelector(`${s} .wbtn`)?.click(), FW);
  const c1 = await hasta(chat, 5);
  ok(c1?.hojas === 3 && c1.mueve && /Compacting conversation/.test(c1.texto), `y su chat lo dice con las hojas moviéndose: ${c1?.texto ?? (await en(() => document.querySelector("main, .vista-hilo, #root")?.innerText.slice(-300)))}`);
  hook("PostCompact", "s-del-worker", WORKER);
  t0 = Date.now();
  ok(await hasta((s) => !document.querySelector(`${s} .pliega`) && !!document.querySelector(`${s} .onda`), 5, FW), `PostCompact: la fila vuelve a la onda (${Date.now() - t0} ms)`);
  ok(await hasta(() => !document.querySelector(".pliegue[data-compactando]"), 5), "y la línea se va del chat");

  // --- Un líder abierto en una terminal (la marca lleva su session_id) -------------------
  ok(await hasta((s) => !!document.querySelector(s), 10, FL), "el líder de terminal está en la barra");
  hook("PreCompact", SID);
  const l1 = await hasta((s) => (document.querySelector(`${s} [data-compactando] .pliega`) ? true : null), 5, FL);
  const fl = await en(fila, FL);
  ok(l1 && fl.hojas === 3 && /Compacting · \d+ s/.test(fl.texto), `PreCompact: la fila del líder dice Compacting y hace cuánto: ${fl?.texto.slice(0, 80)}`);
  await en((s) => document.querySelector(s)?.click(), FL);
  const c2 = await hasta(chat, 5);
  ok(c2?.hojas === 3 && c2.mueve && /Compacting conversation… \d+ s/.test(c2.texto), `y su chat también: ${c2?.texto}`);
  const r1 = await en(ritmo, 2000);
  ok(fluido(r1), `con las hojas moviéndose en la fila y en el chat, el latido va a ${r1?.fps} pasos/s (hueco más largo: ${r1?.hueco} ms)`);
  hook("PostCompact", SID);
  ok(await hasta((s) => !document.querySelector(`${s} .pliega`) && !document.querySelector(".pliegue[data-compactando]"), 5, FL), "PostCompact: se va de la fila y del chat");

  // --- 2. Cerrado y trabajando: una sola línea con el paso en curso ----------------------
  // El líder de terminal se pone a trabajar: su transcript crece, un Bash cada 220 ms.
  sesion("busy");
  linea({ type: "user", message: { role: "user", content: "seguí" } });
  let hechos = 0;
  const reloj = setInterval(() => {
    if (hechos < PASOS) paso(++hechos);
  }, 220);
  const pasoDice = () => {
    const ps = document.querySelectorAll(".conv [data-paso-actual]");
    return ps.length === 1 ? ps[0].innerText.replace(/\s+/g, " ").trim() : ps.length ? `(${ps.length} líneas)` : null;
  };
  const RE = new RegExp(`^Bash · Paso \\d+ de ${PASOS}$`);
  // El latido de un worker que trabaja, mientras al chat le llegan pasos: si algo tartamudea, se ve acá.
  const latido = en(ritmo, 6000);
  const p1 = await hasta(pasoDice, 8);
  ok(RE.test(p1 ?? ""), `cerrado, dice el paso en curso en una línea: ${p1}`);
  const p2 = await hasta((a) => {
    const p = document.querySelector(".conv [data-paso-actual]")?.innerText.replace(/\s+/g, " ").trim();
    return p && p !== a ? p : null;
  }, 5, p1);
  ok(RE.test(p2 ?? "") && p2 !== p1, `y se reemplaza al cambiar el paso: ${p2}`);
  ok(await en(() => !document.querySelector(".conv details.trabajo[open]")), "sin abrir el trabajo");

  // --- 3. Abierto: la lista sigue su último paso; subir la suelta, volver al fondo la retoma ----
  await en(() => [...document.querySelectorAll(".conv details.trabajo summary")].at(-1)?.click());
  const medida = () => {
    const u = [...document.querySelectorAll(".conv details.trabajo[open] ul")].at(-1);
    return u ? { n: u.querySelectorAll(".ll").length, top: Math.round(u.scrollTop), falta: Math.round(u.scrollHeight - u.clientHeight - u.scrollTop) } : null;
  };
  ok(await hasta(() => !document.querySelector(".conv [data-paso-actual]") && !!document.querySelector(".conv details.trabajo[open] ul"), 5), "abierto: la línea suelta se va y queda la lista");
  const m1 = await hasta(() => {
    const u = [...document.querySelectorAll(".conv details.trabajo[open] ul")].at(-1);
    return u && u.scrollHeight > u.clientHeight + 40 ? true : null;
  }, 8);
  const a1 = await en(medida);
  await espera(700);
  const a2 = await en(medida);
  ok(m1 && a2 && a2.n > a1.n && a2.falta <= 8 && a2.top > a1.top, `la lista sigue el último paso (${a1?.n} → ${a2?.n} pasos, de ${a1?.top} a ${a2?.top} px, faltan ${a2?.falta})`);
  // el usuario sube: deja de seguir aunque sigan llegando pasos.
  await en(() => void ([...document.querySelectorAll(".conv details.trabajo[open] ul")].at(-1).scrollTop = 0));
  await espera(100);
  const b1 = await en(medida);
  await espera(700);
  const b2 = await en(medida);
  ok(b1 && b2 && b2.n > b1.n && b2.top === 0, `si sube, se queda donde la dejó aunque lleguen pasos (${b1?.n} → ${b2?.n} pasos, top ${b2?.top})`);
  // Vuelve al fondo: sigue de nuevo.
  await en(() => {
    const u = [...document.querySelectorAll(".conv details.trabajo[open] ul")].at(-1);
    u.scrollTop = u.scrollHeight;
  });
  await espera(100);
  const d1 = await en(medida);
  await espera(700);
  const d2 = await en(medida);
  ok(d1 && d2 && d2.n > d1.n && d2.falta <= 8, `al volver al fondo sigue de nuevo (${d1?.n} → ${d2?.n} pasos, faltan ${d2?.falta})`);

  const r2 = await latido;
  ok(fluido(r2), `mientras llegan pasos y la lista sigue, el latido va a ${r2?.fps} pasos/s (hueco más largo: ${r2?.hueco} ms)`);

  // --- El chat entero: llega la respuesta y queda a la vista ---------------------------
  clearInterval(reloj);
  linea({ type: "assistant", message: { id: "mfin", role: "assistant", content: [{ type: "text", text: "Listo: terminé los pasos.\n\n" + "Otro renglón.\n\n".repeat(30) }] } });
  sesion("idle");
  const fin = await hasta(() => [...document.querySelectorAll(".conv .el")].some((e) => e.textContent.includes("terminé los pasos")), 10);
  await espera(300);
  const z = await en(() => {
    const z = document.querySelector(".conv-zona");
    return { falta: Math.round(z.scrollHeight - z.clientHeight - z.scrollTop), desborda: z.scrollHeight > z.clientHeight + 40 };
  });
  ok(fin && z?.desborda && z.falta <= 8, `la respuesta llega y el chat queda en el fondo (faltan ${z?.falta} px)`);
  ok(await hasta(() => !document.querySelector(".conv [data-paso-actual]"), 5), "terminado, no queda la línea del paso");

  // --- Un líder de la app: lo dice su stream, sin hook -----------------------------------
  await tecla("n", 2);
  ok(await hasta(() => document.querySelector(".lider-linea")?.textContent.includes("New lead") || !document.querySelector(".conv .el"), 10), "Ctrl+N abre un líder nuevo");
  await escribir(".caja-zona textarea", "compactá y contestá");
  await tecla("Enter");
  const c3 = await hasta(chat, 8);
  ok(c3?.hojas === 3 && c3.mueve, `el líder de la app compacta: las hojas en su chat: ${c3?.texto}`);
  const fa = await en(fila, ".lider[data-activa]");
  ok(fa?.hojas === 3 && /Compacting/.test(fa.texto), `y en su fila: ${fa?.texto.slice(0, 80)}`);
  ok(await hasta(() => !document.querySelector(".pliegue[data-compactando]") && !document.querySelector(".lider[data-activa] .pliega"), 8), "al terminar de compactar se van");
  ok(await hasta(() => [...document.querySelectorAll(".conv *")].some((e) => e.children.length === 0 && /compacted/i.test(e.textContent)), 5), 'y queda la raya de "compacted"');
  ok(await hasta(() => [...document.querySelectorAll(".conv .el")].some((e) => e.textContent.includes("eco: compactá")), 10), "y contesta");
} finally {
  lider.kill("SIGKILL");
  app.kill();
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
