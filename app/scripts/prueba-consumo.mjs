#!/usr/bin/env node
// Prueba de punta a punta del panel de consumo (src/paneles/Consumo.tsx, electron/consumo.ts) con el
// `pa` falso y transcripts inventados: la app offscreen (HILOS_PRUEBA, sin ventana) con dos líderes de
// mentira (dos `sleep` con su sesión) y tres workers vivos (uno colgado de un líder, dos sueltos en su
// proyecto), cada uno con su `.sid` y su transcript. Compara cada número del panel contra la cuenta
// hecha acá sobre lo mismo que se escribió: modelo, esfuerzo, contexto, tokens, compactaciones y el
// resumen de hoy por modelo. Después lo oculta y lo vuelve a mostrar, y abre la app de nuevo (de a
// una) para ver que se acuerda; a 360 px no existe.
// Nada toca `pa` ni a Claude de verdad: PA_STATE, HILOS_STATE, CLAUDE_CONFIG_DIR, el perfil y el
// registry son temporales.
//   npm run build && node scripts/prueba-consumo.mjs        (FOTOS=<carpeta> deja capturas; VER=1 muestra lo que dice el main)
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-consumo-")));
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });

const LIDER_A = "5a1f0c1d-0000-4000-8000-0000000000a1";
const LIDER_B = "5a1f0c1d-0000-4000-8000-0000000000b2";
const SUELTA = "5a1f0c1d-0000-4000-8000-0000000000c3";
const W1 = "20261003-100300-44444";
const W2 = "20261003-110000-10101";
const W3 = "20261003-110100-20202";
const sidDe = { [W1]: "5a1f0c1d-0000-4000-8000-000000000d01", [W2]: "5a1f0c1d-0000-4000-8000-000000000d02", [W3]: "5a1f0c1d-0000-4000-8000-000000000d03" };
const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

for (const d of ["atlas", "brote", "cauce"]) mkdirSync(path.join(tmp, "proy", d), { recursive: true });
mkdirSync(path.join(tmp, "pa"));
writeFileSync(
  path.join(tmp, "registry.json"),
  JSON.stringify({
    projects: [
      { name: "atlas", titulo: "Atlas Web", path: path.join(tmp, "proy", "atlas"), desc: "La web" },
      { name: "brote", path: path.join(tmp, "proy", "brote"), desc: "El jardín" },
      { name: "cauce", path: path.join(tmp, "proy", "cauce"), desc: "El río" },
    ],
  }),
);

// --- Los transcripts inventados ------------------------------------------------------
// Cada mensaje: [id, modelo, [entrada, caché creado, caché leído, salida], más]. `ayer`: no entra en
// el resumen de hoy; `veces`: el mismo mensaje en varias líneas (una por bloque), que cuenta una vez.
const AHORA = Date.now();
const AYER = AHORA - 86_400_000;
const linea = ([id, modelo, [i, c, r, o], mas = {}]) => {
  const { ayer, veces = 1, ...resto } = mas;
  const l =
    JSON.stringify({
      type: "assistant",
      timestamp: new Date(ayer ? AYER : AHORA).toISOString(),
      message: { id, model: modelo, usage: { input_tokens: i, cache_creation_input_tokens: c, cache_read_input_tokens: r, output_tokens: o }, content: [{ type: "text", text: "texto inventado" }] },
      ...resto,
    }) + "\n";
  return l.repeat(veces);
};
const COMPACTO = "compacto";
const compacto = JSON.stringify({ type: "system", subtype: "compact_boundary", timestamp: new Date(AHORA).toISOString(), compactMetadata: { trigger: "auto" } }) + "\n";
const usuario = JSON.stringify({ type: "user", timestamp: new Date(AHORA).toISOString(), message: { role: "user", content: "un pedido inventado" } }) + "\n";

const sesiones = {
  // El líder de los workers: ayer y hoy, con un mensaje partido en tres líneas.
  [LIDER_A]: { carpeta: "-proy-brote", lider: true, effort: "high", mensajes: [["a0", OPUS, [40, 9000, 0, 700], { ayer: true }], ["a1", OPUS, [12, 2000, 30000, 400], { veces: 3 }], ["a2", OPUS, [8, 500, 120000, 900], { effort: "high" }]] },
  // Otro líder: compactó una vez y volvió a contestar.
  [LIDER_B]: { carpeta: "-proy-atlas", lider: true, effort: "medium", mensajes: [["b1", SONNET, [5, 100, 700000, 50], { effort: "medium" }], COMPACTO, ["b2", SONNET, [5, 40000, 0, 300], { effort: "medium" }]] },
  // Un `claude` que no lanzó `pa` y no está en la barra: cuenta en líderes, sin fila.
  [SUELTA]: { carpeta: "-proy-cauce", lider: true, mensajes: [["c1", HAIKU, [100, 0, 0, 100]]] },
  // El worker del líder, casi lleno (ámbar), con un subagente Haiku.
  [sidDe[W1]]: { carpeta: "-proy-brote", mensajes: [["w1", OPUS, [10, 1000, 750000, 200]]], subagente: [["s1", HAIKU, [3, 0, 3000, 30], { isSidechain: true }]] },
  [sidDe[W2]]: { carpeta: "-proy-atlas", mensajes: [["x1", SONNET, [20, 3000, 95000, 500]]] },
  // Haiku: la ventana es de 200 mil (rojo).
  [sidDe[W3]]: { carpeta: "-proy-cauce", mensajes: [["y1", HAIKU, [7, 1000, 185000, 100]]] },
};
const proyectos = path.join(tmp, "claude", "projects");
function escribir(sid) {
  const s = sesiones[sid];
  const dir = path.join(proyectos, s.carpeta);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${sid}.jsonl`), usuario + s.mensajes.map((m) => (m === COMPACTO ? compacto : linea(m))).join(""));
  if (s.subagente) {
    mkdirSync(path.join(dir, sid, "subagents"), { recursive: true });
    writeFileSync(path.join(dir, sid, "subagents", "agent-a1.jsonl"), s.subagente.map(linea).join(""));
  }
}
function anotarSid(id, proyecto) {
  mkdirSync(path.join(tmp, "pa", proyecto), { recursive: true });
  writeFileSync(path.join(tmp, "pa", proyecto, `${id}.sid`), sidDe[id] + "\n");
}

// Lo que tiene que decir el panel, contado acá (aparte del código que se prueba).
const suma = ([, , u]) => u[0] + u[1] + u[2] + u[3];
const todos = (sid) => [...sesiones[sid].mensajes.filter((m) => m !== COMPACTO), ...(sesiones[sid].subagente ?? [])];
function esperado(sid) {
  const s = sesiones[sid];
  const propios = s.mensajes.filter((m) => m !== COMPACTO);
  const [, modelo, u] = propios.at(-1);
  const usados = u[0] + u[1] + u[2];
  return {
    modelo: /opus/.test(modelo) ? "opus" : /sonnet/.test(modelo) ? "sonnet" : "haiku",
    usados,
    pct: Math.round((usados / (/haiku/.test(modelo) ? 200_000 : 1_000_000)) * 100),
    tokens: todos(sid).reduce((n, m) => n + suma(m), 0),
    compactaciones: s.mensajes.filter((m) => m === COMPACTO).length,
  };
}
/** El resumen de hoy: por modelo, líderes y workers. `sids`: los que ya tienen transcript. */
function resumenEsperado(sids) {
  const r = {};
  for (const sid of sids)
    for (const m of todos(sid)) {
      if (m[3]?.ayer) continue;
      const k = /opus/.test(m[1]) ? "opus" : /sonnet/.test(m[1]) ? "sonnet" : "haiku";
      (r[k] ??= { lideres: 0, workers: 0 })[sesiones[sid].lider ? "lideres" : "workers"] += suma(m);
    }
  return r;
}

for (const sid of [LIDER_A, LIDER_B, SUELTA, sidDe[W1], sidDe[W2]]) escribir(sid);
anotarSid(W1, "brote");
anotarSid(W2, "atlas");
// Los dos workers sueltos, como los anota el `pa` falso al lanzarlos. El tercero todavía no tiene
// ni `.sid` ni transcript (recién lanzado): su fila tiene que decir "sin dato".
const inicio = Math.floor(AHORA / 1000) - 120;
writeFileSync(
  path.join(tmp, "pa", "lanzados.tsv"),
  [
    [W2, "atlas", "Ordenar el menú", SONNET, "high", "", inicio, "trabajando"],
    [W3, "cauce", "Medir el caudal", HAIKU, "low", "", inicio, "trabajando"],
  ]
    .map((f) => f.join("\t") + "\n")
    .join(""),
);

// Los dos líderes: un `sleep` cada uno, con su sesión (pid y arranque reales).
const dirSesiones = path.join(tmp, "sesiones");
mkdirSync(dirSesiones);
const procesos = [
  [LIDER_A, "ana-prueba", "brote"],
  [LIDER_B, "otra-sesion", "atlas"],
].map(([sid, nombre, carpeta]) => {
  const p = spawn("sleep", ["300"], { stdio: "ignore" });
  const arranque = Number(readFileSync(`/proc/${p.pid}/stat`, "utf8").split(") ").at(-1).split(" ")[19]);
  writeFileSync(
    path.join(dirSesiones, `${p.pid}.json`),
    JSON.stringify({ pid: p.pid, sessionId: sid, cwd: path.join(tmp, "proy", carpeta), kind: "interactive", entrypoint: "cli", name: nombre, startedAt: AHORA - 60_000, updatedAt: AHORA, procStart: arranque }),
  );
  return p;
});

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

// --- La app, de a una ----------------------------------------------------------------
let app = null;
let ws = null;
let n = 0;
const pend = new Map();
const cdp = (method, params = {}) =>
  new Promise((r) => {
    const id = ++n;
    pend.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });

async function abrir() {
  const puerto = 9300 + Math.floor(Math.random() * 600);
  app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
    env: {
      ...process.env,
      HILOS_PRUEBA: "90",
      HILOS_FIXTURES: "0",
      HILOS_IDIOMA: "en",
      HILOS_VISTA: "todo",
      HILOS_TAM: "1280 860",
      HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
      PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
      PA_FALSO_LIDER: LIDER_A,
      PA_STATE: path.join(tmp, "pa"),
      HILOS_STATE: path.join(tmp, "hilos"),
      HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
      PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
      HILOS_SESIONES: dirSesiones,
      HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
      CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
      TRAMA_FALSO_LOG: path.join(tmp, "claude-falso.log"),
      HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
      HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
      NPM_FALSO_LOG: path.join(tmp, "npm-falso.log"),
    },
    stdio: process.env.VER ? "inherit" : "ignore",
  });
  let url = null;
  for (let i = 0; i < 150 && !url; i++) {
    try {
      const ts = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
      url = ts.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {}
    if (!url) await espera(100);
  }
  if (!url) throw new Error("la app no abrió el puerto de CDP");
  ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    }
  });
  // La barra armada: el worker del líder ya está en la lista.
  await hasta((id) => !!document.querySelector(`[data-fila="${id}"]`), 15, W1);
}

/** Cierra la app y espera a que salga: nunca dos a la vez (y suelta el candado del perfil). */
async function cerrar() {
  if (!app) return;
  const [p, w] = [app, ws];
  [app, ws] = [null, null];
  const salio = new Promise((r) => p.once("exit", r));
  w?.close();
  p.kill();
  const tope = setTimeout(() => p.kill("SIGKILL"), 5000);
  await salio;
  clearTimeout(tope);
  await espera(300);
}

/** Corre `fn` en la página (se manda como texto) y devuelve lo que devuelva. */
async function en(fn, ...args) {
  const r = await cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
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
async function foto(nombre) {
  if (!fotos) return;
  await espera(400);
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
}
const tecla = async (key) => {
  // Fuera de cualquier campo: los atajos de la barra no valen mientras se escribe.
  await en(() => document.activeElement?.blur?.());
  for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key, code: `Key${key.toUpperCase()}`, text: type === "keyDown" ? key : undefined });
};
const prefs = () => {
  try {
    return JSON.parse(readFileSync(path.join(tmp, "hilos", "preferencias.json"), "utf8"));
  } catch {
    return null;
  }
};
const guardado = async (si) => {
  for (let i = 0; i < 30; i++) {
    if ((prefs()?.consumo === true) === si && (si || prefs()?.consumo === false)) return true;
    await espera(100);
  }
  return false;
};

/** Lo que dice el panel: cada fila y el resumen, con los números ya como números. */
const panel = () => {
  const cs = document.querySelector(".cs");
  if (!cs) return null;
  const num = (s) => (/\d/.test(s ?? "") ? Number(s.replace(/[^\d]/g, "")) : null);
  const filas = {};
  for (const f of cs.querySelectorAll("[data-consumo]")) {
    const campo = (c) => f.querySelector(`[data-campo="${c}"]`);
    const ctx = campo("contexto");
    const [modelo, effort] = [...f.querySelectorAll(".cs-modelo > span")].map((s) => s.textContent.trim());
    filas[f.dataset.consumo] = {
      nombre: f.querySelector(".cs-nom")?.textContent.trim(),
      estado: f.querySelector(".cs-est")?.textContent.trim(),
      worker: f.hasAttribute("data-worker"),
      // De quién cuelga: la primera fila de su grupo (un líder) o el título del proyecto.
      grupo: f.closest(".cs-grupo")?.querySelector(".cs-proy")?.textContent.trim() ?? f.closest(".cs-grupo")?.querySelector("[data-consumo]")?.dataset.consumo,
      modelo,
      effort,
      pct: ctx.hasAttribute("data-falta") ? null : num(ctx.querySelector("b")?.textContent),
      usados: ctx.hasAttribute("data-falta") ? null : num(ctx.querySelector(".cs-de")?.textContent.split(/\bof\b/)[0]),
      nivel: f.querySelector(".cs-barra")?.dataset.nivel ?? null,
      barra: f.querySelector(".cs-barra i")?.style.transform ?? null,
      anchoBarra: Math.round(f.querySelector(".cs-barra")?.getBoundingClientRect().width ?? 0),
      tokens: campo("tokens").hasAttribute("data-falta") ? null : num(campo("tokens").textContent),
      compactaciones: campo("compactaciones").hasAttribute("data-falta") ? null : num(campo("compactaciones").textContent),
      faltas: [...f.querySelectorAll("[data-falta]")].map((x) => x.textContent.trim()),
    };
  }
  const resumen = {};
  for (const tr of cs.querySelectorAll(".cs-tabla tbody tr")) {
    const k = tr.querySelector("th").textContent.toLowerCase().match(/opus|sonnet|haiku/)?.[0] ?? tr.querySelector("th").textContent;
    const [l, w] = [...tr.querySelectorAll("td")].map((td) => num(td.textContent));
    resumen[k] = { lideres: l, workers: w };
  }
  const [tl, tw] = [...cs.querySelectorAll(".cs-tabla tfoot td")].map((td) => num(td.textContent));
  return { filas, resumen, total: { lideres: tl, workers: tw }, hoy: cs.querySelector(".pn-h span")?.textContent.trim(), ancho: cs.getBoundingClientRect().width };
};
const boton = () => {
  const b = [...document.querySelectorAll("button[aria-label]")].find((x) => /^(show|hide) usage$/i.test(x.getAttribute("aria-label")) && !x.closest(".cs"));
  return b ? { etq: b.getAttribute("aria-label"), activo: b.getAttribute("aria-pressed") } : null;
};
/** Iguales sin mirar el orden de las claves (el panel ordena por consumo). */
const orden = (x) => (x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, orden(x[k])])) : x);
const igual = (a, b) => JSON.stringify(orden(a)) === JSON.stringify(orden(b));

function comparar(p, id, sid, que) {
  const [f, e] = [p?.filas?.[id], esperado(sid)];
  ok(
    f && f.modelo.toLowerCase().includes(e.modelo) && f.pct === e.pct && f.usados === e.usados && f.tokens === e.tokens && f.compactaciones === e.compactaciones,
    `${que}: ${f?.modelo} · ${f?.effort}, contexto ${f?.pct}% (${f?.usados}), ${f?.tokens} tokens, ${f?.compactaciones} compactaciones` +
      (f && f.pct === e.pct && f.tokens === e.tokens ? "" : ` — esperado ${JSON.stringify(e)}`),
  );
  return f;
}

try {
  // --- 1. La primera vez: oculto. Se abre con la tecla y se compara todo. ---
  await abrir();
  await espera(500);
  ok(!(await en(() => !!document.querySelector(".cs"))), "sin nada guardado, arranca oculto");
  const b0 = await en(boton);
  ok(b0 && b0.activo === "false", `el pie tiene su botón, sin marcar: ${b0?.etq}`);
  await foto("cerrado");

  await tecla("t");
  ok(await hasta(() => !!document.querySelector(".cs [data-consumo]"), 5), "la tecla t lo abre");
  ok(await guardado(true), "preferencias.json lo anota (consumo: true)");
  ok((await en(boton))?.activo === "true", "el botón del pie queda marcado");

  // Las cinco filas, con los números del main.
  const listo = (ids) => {
    const cs = document.querySelector(".cs");
    return !!cs && ids.every((id) => cs.querySelector(`[data-consumo="${id}"] [data-campo="tokens"]:not([data-falta]):not([data-cargando])`));
  };
  ok(await hasta(listo, 10, [LIDER_A, LIDER_B, W1, W2]), "llegan los números de los dos líderes y los dos workers con transcript");
  let p = await en(panel);
  ok(Object.keys(p.filas).length === 5, `cinco filas (dos líderes, tres workers): ${Object.keys(p.filas).length}`);
  ok(p.hoy === "Today", `el resumen dice de cuándo es: ${p.hoy}`);

  const a = comparar(p, LIDER_A, LIDER_A, "líder ana-prueba");
  ok(a?.nombre === "ana-prueba" && !a.worker && a.effort === "high", `  su nombre y el esfuerzo de su transcript: ${a?.nombre}, ${a?.effort}`);
  const bb = comparar(p, LIDER_B, LIDER_B, "líder otra-sesion (compactó una vez)");
  ok(bb?.effort === "medium" && bb.compactaciones === 1, `  esfuerzo ${bb?.effort}, ${bb?.compactaciones} compactación`);
  const w1 = comparar(p, W1, sidDe[W1], "worker del líder (con subagente)");
  ok(w1?.worker && w1.grupo === LIDER_A && w1.effort === "medium" && w1.nivel === "ambar", `  cuelga de su líder, esfuerzo ${w1?.effort}, barra ${w1?.nivel} ${w1?.barra}`);
  ok(w1?.estado === "Working", `  estado: ${w1?.estado}`);
  ok(w1?.barra === "scaleX(0.75)" && w1.anchoBarra > 150, `  la barra, a lo ancho de la fila (${w1?.anchoBarra} px) y llena al 75%`);
  const w2 = comparar(p, W2, sidDe[W2], "worker suelto de Atlas Web");
  ok(w2?.grupo === "Atlas Web" && w2.effort === "high" && w2.nivel === "normal", `  bajo su proyecto (${w2?.grupo}), esfuerzo ${w2?.effort}`);

  // El recién lanzado: sin `.sid` ni transcript no se inventa nada.
  const w3 = p.filas[W3];
  ok(w3 && w3.pct === null && w3.tokens === null && w3.compactaciones === null, `worker sin transcript: ${w3?.faltas.join(" / ")}`);
  ok(w3?.faltas.length === 3 && w3.faltas.every((x) => x === "no data") && /haiku/i.test(w3.modelo) && w3.effort === "low", `  dice "no data" tres veces, y el modelo y el esfuerzo que dijo pa: ${w3?.modelo} · ${w3?.effort}`);

  let r = resumenEsperado([LIDER_A, LIDER_B, SUELTA, sidDe[W1], sidDe[W2]]);
  ok(igual(p.resumen.opus, r.opus) && igual(p.resumen.sonnet, r.sonnet) && igual(p.resumen.haiku, r.haiku), `resumen de hoy por modelo: ${JSON.stringify(p.resumen)}${igual(p.resumen, r) ? "" : " — esperado " + JSON.stringify(r)}`);
  const tot = (x) => ({ lideres: Object.values(x).reduce((s, v) => s + v.lideres, 0), workers: Object.values(x).reduce((s, v) => s + v.workers, 0) });
  ok(igual(p.total, tot(r)), `el total suma: ${JSON.stringify(p.total)}`);
  ok(r.opus.lideres === 153820 && a.tokens === 163560, "lo de ayer no entra en el resumen, sí en los tokens de la sesión");
  ok(p.ancho > 200 && p.ancho < 400, `el panel es una columna angosta (${Math.round(p.ancho)} px)`);

  // Llegan su `.sid` y su transcript; con el evento de `pa` la app relee y la fila se completa sola.
  escribir(sidDe[W3]);
  anotarSid(W3, "cauce");
  appendFileSync(path.join(tmp, "pa", "eventos.jsonl"), JSON.stringify({ version: 1, tipo: "inicio", id: W3 }) + "\n");
  ok(await hasta(listo, 10, [W3]), "al aparecer su transcript, la fila se completa sola");
  p = await en(panel);
  const w3b = comparar(p, W3, sidDe[W3], "worker suelto de cauce (Haiku, ventana de 200 mil)");
  ok(w3b?.nivel === "rojo" && w3b.grupo === "cauce" && w3b.faltas.length === 0, `  barra ${w3b?.nivel}, bajo ${w3b?.grupo}, sin "no data"`);

  // Un worker contesta de nuevo: el panel se entera por inotify, sin que nadie lo pida.
  sesiones[sidDe[W2]].mensajes.push(["x2", SONNET, [30, 2000, 98000, 800]]);
  appendFileSync(path.join(proyectos, "-proy-atlas", `${sidDe[W2]}.jsonl`), linea(sesiones[sidDe[W2]].mensajes.at(-1)));
  const e2 = esperado(sidDe[W2]);
  ok(await hasta((id, n) => document.querySelector(`.cs [data-consumo="${id}"] [data-campo="tokens"]`)?.textContent.replace(/[^\d]/g, "") === String(n), 5, W2, e2.tokens), `su transcript crece y la fila lo sigue sola (${e2.tokens} tokens)`);
  p = await en(panel);
  comparar(p, W2, sidDe[W2], "worker suelto de Atlas Web, un mensaje después");
  r = resumenEsperado(Object.keys(sesiones));
  ok(igual(p.resumen, r) && igual(p.total, tot(r)), `el resumen, con los tres workers: ${JSON.stringify(p.resumen)}${igual(p.resumen, r) ? "" : " — esperado " + JSON.stringify(r)}`);
  ok(!(await en(() => /texto inventado|un pedido inventado/.test(document.querySelector(".cs").innerText))), "del transcript sólo salen nombres y números");
  await foto("abierto");
  await cerrar();

  // --- 2. Abierta de nuevo: se acuerda de que estaba a la vista. A 360 px no existe. ---
  await abrir();
  const otraVez = await hasta(listo, 10, [LIDER_A, LIDER_B, W1, W2, W3]);
  ok(otraVez, `abierta de nuevo, el panel está a la vista con sus números${otraVez ? "" : ": " + JSON.stringify((await en(panel))?.filas)}`);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  ok(await hasta(() => !document.querySelector(".cs"), 5), "a 360 px el panel no existe");
  ok(!(await en(boton)), "  ni su botón");
  await foto("celular");
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp("Emulation.clearDeviceMetricsOverride");
  ok(await hasta(listo, 10, [LIDER_A, W1]), "de vuelta al ancho de escritorio, vuelve");

  // Se oculta con su botón.
  await en(() => document.querySelector(".cs .cs-cab button").click());
  ok(await hasta(() => !document.querySelector(".cs"), 5), "su botón lo oculta");
  ok(await guardado(false), "preferencias.json lo anota (consumo: false)");
  await cerrar();

  // --- 3. Abierta de nuevo: se acuerda de que estaba oculto. El botón del pie lo trae. ---
  await abrir();
  await espera(800);
  ok(!(await en(() => !!document.querySelector(".cs"))), "abierta de nuevo, sigue oculto");
  await en(() => [...document.querySelectorAll("button[aria-label]")].find((x) => /^(show|hide) usage$/i.test(x.getAttribute("aria-label")))?.click());
  ok(await hasta(listo, 10, [LIDER_A, W1]), "el botón del pie lo muestra");
  ok(await guardado(true), "y queda anotado");
} catch (e) {
  ok(false, `la prueba se cortó: ${e?.stack ?? e}`);
} finally {
  await cerrar().catch(() => {});
  for (const p of procesos) p.kill("SIGKILL");
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
