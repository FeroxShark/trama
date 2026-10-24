#!/usr/bin/env node
// Prueba de punta a punta de la tarjeta de actividad del chat (src/hilo/Actividad.tsx, dirección C): abre la app offscreen
// (HILOS_PRUEBA) con el claude falso y un líder nuevo, y mira la tarjeta mientras trabaja. "muchos pasos" (un Bash cada 1,5 s)
// da el tipo comando con su detalle y los pasos de atrás atenuados; "novela", escribiendo; "preguntame" la deja en "Te necesita".
// Comprueba que la escena existe y se mueve (transform/opacity que escribe latido.ts, ninguna animación CSS infinita), que la
// tarjeta desaparece al terminar el turno y que el latido se apaga solo. Nada toca `pa` ni a Claude de verdad.
//   npm run build && node scripts/prueba-actividad.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-actividad-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
const falso = path.join(raiz, "scripts/claude-falso.mjs");
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
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

const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
  env: {
    ...process.env,
    HILOS_PRUEBA: "90",
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
    HILOS_CLAUDE: falso,
    CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
    TRAMA_FALSO_LOG: path.join(tmp, "claude-falso.log"),
    TRAMA_FALSO_PASOS: "4",
    TRAMA_FALSO_PASO_MS: "1500",
    TRAMA_FALSO_TOKEN_MS: "40",
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
async function foto(nombre) {
  if (!fotos) return;
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
}
async function mandar(texto) {
  await en(() => document.querySelector(".caja-zona textarea")?.focus());
  await cdp("Input.insertText", { text: texto });
  await tecla("Enter", 13);
}
/** La tarjeta de la conversación abierta, o `null`. */
const tarjeta = () =>
  en(() => {
    // Con una pregunta abierta, el panel se queda con la altura y la conversación se aplasta: la tarjeta sigue ahí, sin altura.
    const z = [...document.querySelectorAll(".conv-zona")].find((x) => x.querySelector(".tv"));
    const tv = z?.querySelector(".tv");
    if (!tv) return null;
    const esc = tv.querySelector(".esc");
    const animadas = [tv, ...tv.querySelectorAll("*")].flatMap((e) => e.getAnimations());
    return {
      tipo: tv.dataset.t,
      verbo: tv.querySelector(".tv-v")?.textContent ?? "",
      detalle: tv.querySelector(".tv-dt")?.textContent ?? "",
      vivo: tv.querySelector(".tv-vivo")?.textContent ?? "",
      pliegue: !!tv.querySelector(".tv-pliega"),
      boton: tv.querySelector(".tv-ent .tv-mas")?.textContent ?? "",
      pasos: [...tv.querySelectorAll(".tv-pasos li")].map((l) => l.textContent),
      reloj: tv.querySelector(".tv-t1 .tv-x")?.textContent ?? "",
      escena: esc ? { w: esc.getBoundingClientRect().width, h: esc.getBoundingClientRect().height } : null,
      piezas: [...tv.querySelectorAll("svg [class^='e-']")].filter((e) => e.style.transform || e.style.opacity).length,
      infinitas: animadas.filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length,
      ancho: tv.getBoundingClientRect().width,
      zona: z.clientWidth,
    };
  });
/** Espera una tarjeta que cumpla `ok` (hasta `seg` s) y la devuelve. */
async function esperar(cumple, seg) {
  let c = null;
  for (let i = 0; i < seg * 10; i++) {
    c = await tarjeta();
    if (c && cumple(c)) return c;
    await espera(100);
  }
  return c && cumple(c) ? c : null;
}
const huellaEscena = () => en(() => [...document.querySelectorAll(".conv-zona .tv svg [class^='e-']")].map((e) => e.style.transform + e.style.opacity).join("|"));
const libre = () => hasta(() => !document.querySelector(".conv-zona .tv") && !!document.querySelector(".caja-zona textarea:not([readonly])"), 20);

try {
  ok(await hasta(() => !!document.querySelector(".barra, .pie") && document.querySelectorAll(".pie button").length >= 4, 15), "la app abrió");
  await tecla("N", 78, 2);
  if (!(await hasta(() => !!document.querySelector(".caja-zona textarea"), 3))) await tecla("N", 78, 2);
  ok(await hasta(() => !!document.querySelector(".caja-zona textarea"), 8), "Ctrl+N abre un líder nuevo");
  ok((await tarjeta()) === null, "en reposo no hay tarjeta");

  // --- Comando: el Bash de "muchos pasos", con los pasos de atrás -------------------------
  await mandar("muchos pasos");
  ok(!!(await esperar(() => true, 15)), "al responder aparece la tarjeta");
  const c = await esperar((x) => x.tipo === "comando" && x.pasos.length >= 2, 15);
  ok(c?.tipo === "comando", `tipo comando mientras corre el Bash: ${c?.tipo}`);
  ok(c?.verbo === "Corriendo", `el verbo: «${c?.verbo}»`);
  ok(/paso/i.test(c?.detalle ?? ""), `la pastilla dice lo concreto: «${c?.detalle}»`);
  ok(c?.pasos.length === 2 && c.pasos.every((p) => p.startsWith("Corrió")), `los dos pasos de atrás: ${JSON.stringify(c?.pasos)}`);
  ok(/^\d+ s$/.test(c?.reloj ?? ""), `el tiempo corre: «${c?.reloj}»`);
  ok(c?.vivo === "En curso", `el paso que hace ahora dice «En curso» mientras vive: «${c?.vivo}»`);
  ok(c?.escena?.w === 44 && c.escena.h === 44, `la escena mide 44 px: ${JSON.stringify(c?.escena)}`);
  ok(!!c && c.ancho <= c.zona, `la tarjeta cabe en la conversación: ${c?.ancho} ≤ ${c?.zona}`);
  await foto("comando");
  // La escena se mueve: latido.ts escribe transform/opacity en sus piezas, y ninguna animación CSS corre sin fin.
  const antes = await huellaEscena();
  await espera(500);
  const despues = await huellaEscena();
  ok(!!antes && !!despues && antes !== despues, "la escena se mueve (latido.ts escribe transform y opacity)");
  const c2 = await tarjeta();
  ok(!!c2 && c2.piezas > 0 && c2.infinitas === 0, `${c2?.piezas} piezas con estilo del latido y ${c2?.infinitas} animaciones CSS infinitas`);
  ok(await libre(), "terminó el turno y la tarjeta se fue");
  // Sin tarjeta no queda ninguna escena (el latido deja de pintarlas y limpia sus piezas).
  ok(await en(() => document.getElementsByClassName("esc").length === 0), "sin tarjeta no queda ninguna escena en pantalla");

  // --- Comando largo: se lee entero (nunca con "…"), se pliega y "Ver todo" lo abre -------
  await mandar("comando largo");
  const l = await esperar((x) => x.tipo === "comando" && /--tope 120/.test(x.detalle), 15);
  ok(!!l && l.detalle.length > 200 && !l.detalle.includes("…"), `el comando largo entero, sin «…»: ${l?.detalle.length ?? 0} caracteres`);
  ok(l?.pliegue === true && /Ver todo/.test(l.boton), `lo muy largo se pliega con «${l?.boton}»`);
  ok(l?.vivo === "En curso", `el comando largo también dice «${l?.vivo}»`);
  await foto("comando-largo");
  await en(() => document.querySelector(".conv-zona .tv .tv-ent .tv-mas")?.click());
  const abierto = await esperar((x) => x.tipo === "comando" && !x.pliegue, 3);
  ok(!!abierto, `«Ver todo» despliega el comando: «${abierto?.boton}»`);
  await foto("comando-largo-abierto");
  ok(await libre(), "terminó el comando largo y la tarjeta se fue");

  // --- Escribiendo: la respuesta larga ---------------------------------------------------
  await mandar("novela");
  const e = await esperar((x) => x.tipo === "escribiendo", 15);
  ok(e?.verbo === "Escribiendo" && /respuesta/.test(e.detalle), `escribiendo la respuesta: «${e?.verbo}» «${e?.detalle}»`);
  await foto("escribiendo");
  ok(await libre(), "terminó la novela y la tarjeta se fue");

  // --- Te necesita: una pregunta sin contestar ------------------------------------------
  await mandar("preguntame");
  const p = await esperar((x) => x.tipo === "permiso", 15);
  ok(p?.verbo === "Te necesita" && /pregunta/.test(p.detalle), `la pregunta sin contestar manda: «${p?.verbo}» «${p?.detalle}»`);
} finally {
  app.kill();
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
