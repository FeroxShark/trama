#!/usr/bin/env node
// Prueba de punta a punta del razonamiento y los comandos de un líder de Gemini (src/hilo/Actividad.tsx, Turno.tsx, Llamada.tsx):
// la app offscreen con el `agy` falso (scripts/agy-falso.mjs, gatillos "pienso", "herramienta", "falla", "despacio"), que escribe el
// razonamiento donde lo deja agy de verdad (su transcript, HILOS_AGY_BRAIN) y sólo `thinking_tokens` por el stream. Mira, con el turno
// corriendo: el progreso de la tarjeta con cada pensamiento terminado en su línea plegada ("Pensó: …", ninguno borra al anterior, un clic
// lo abre) y el que llega escribiéndose, cada comando con su estado (corriendo / ok / error), el chip "Trabajando" y la tarjeta siempre
// a la vista al fondo; el trabajo del turno guarda la salida plegable de cada comando; y al terminar, los pensamientos quedan en "Pensó".
// Nada toca `pa`, Claude ni Gemini de verdad.
//   npm run build && node scripts/prueba-gemini-razon.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-gemini-razon-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
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
    HILOS_TIERNOS: "1",
    HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
    PA_FALSO_N: "0",
    PA_STATE: path.join(tmp, "pa"),
    HILOS_STATE: path.join(tmp, "hilos"),
    HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
    PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
    HILOS_SESIONES: path.join(tmp, "sesiones"),
    HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
    HILOS_AGY: path.join(raiz, "scripts/agy-falso.mjs"),
    HILOS_AGY_BRAIN: path.join(tmp, "brain"),
    TRAMA_FALSO_MS_LENTO: "900",
    CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
    HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
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
/** Lo que se ve de la conversación abierta. */
const vista = () =>
  en(() => {
    const z = [...document.querySelectorAll(".conv-zona")].find((x) => x.querySelector(".conv > *")) ?? document.querySelector(".conv-zona");
    const tv = z?.querySelector(".tv");
    const r = tv?.getBoundingClientRect();
    const zr = z?.getBoundingClientRect();
    return {
      hay: !!tv,
      chip: tv?.querySelector(".ui-chip")?.textContent ?? null,
      // El progreso de la tarjeta: cada línea con su clase (pensamiento / herramienta / vivo) y su texto.
      lineas: [...(tv?.querySelectorAll(".tv-lt .tv-li") ?? [])].map((li) => ({ k: li.getAttribute("data-k"), t: li.textContent })),
      plegados: [...(tv?.querySelectorAll(".tv-lt .tv-pb[aria-expanded=false]") ?? [])].map((b) => b.textContent),
      entero: tv?.querySelector(".tv-lt .tv-li[data-k=pensamiento] .tv-pe")?.textContent ?? null,
      tierno: !!tv?.querySelector(".tierno, [data-tierno]"),
      herr: [...(tv?.querySelectorAll(".tv-lt .tv-li[data-k=herramienta]") ?? [])].map((li) => [li.querySelector(".tv-ln")?.textContent, li.querySelector(".ll-e")?.getAttribute("data-e")]),
      estados: [...z.querySelectorAll(".ll .ll-e")].map((e) => e.getAttribute("data-e")),
      llamadas: [...z.querySelectorAll(".ll .ll-n")].map((e) => e.textContent),
      cuerpos: z.querySelectorAll(".ll .ll-res").length,
      abierto: !!z.querySelector("details.trabajo[open]"),
      pensado: [...z.querySelectorAll(".tv-pensados .tv-pb")].map((e) => e.textContent),
      visible: r && zr ? r.bottom <= zr.bottom + 1 && r.top >= zr.top : null,
    };
  });
async function esperar(cumple, seg) {
  let v = null;
  for (let i = 0; i < seg * 10; i++) {
    v = await vista();
    if (cumple(v)) return v;
    await espera(100);
  }
  return cumple(v) ? v : null;
}

try {
  ok(await hasta(() => !!document.querySelector(".barra, .pie") && document.querySelectorAll(".pie button").length >= 4, 15), "la app abrió");
  await tecla("N", 78, 2);
  if (!(await hasta(() => !!document.querySelector(".caja-zona textarea"), 3))) await tecla("N", 78, 2);
  ok(await hasta(() => !!document.querySelector(".caja-zona textarea"), 8), "Ctrl+N abre un líder nuevo");
  // Gemini 3.8 Flash en el selector de modelo de la caja.
  await en(() => document.querySelector(".caja-zona .pbtn")?.click());
  ok(await hasta(() => !![...document.querySelectorAll(".caja-zona [role=option]")].find((o) => /Flash/.test(o.textContent)), 3), "el selector ofrece Gemini 3.8 Flash");
  await en(() => [...document.querySelectorAll(".caja-zona [role=option]")].find((o) => /Flash/.test(o.textContent))?.click());
  ok(await hasta(() => /Flash/.test(document.querySelector(".caja-zona .pbtn")?.textContent ?? ""), 3), "el líder quedó en Gemini 3.8 Flash");

  await mandar("pienso herramienta falla despacio");
  const a = await esperar((v) => v.hay && v.lineas.some((l) => l.k === "pensamiento"), 20);
  ok(!!a && /Primero miro/.test(a.lineas.find((l) => l.k === "pensamiento")?.t ?? ""), `el primer pensamiento queda como línea terminada: «${a?.lineas.find((l) => l.k === "pensamiento")?.t.slice(0, 60)}»`);
  ok(a?.tierno === false, "con razonamiento visible no hay frase tierna");
  ok(/Trabajando|Working/.test(a?.chip ?? ""), `el chip de arriba dice cómo va: «${a?.chip}»`);
  ok((a?.plegados.length ?? 0) >= 1 && a?.entero === null, "los pensamientos terminados están plegados");
  ok(a?.abierto === false, "el trabajo del turno sigue cerrado: las herramientas están en el progreso");
  await foto("razonando");

  // Un comando corriendo y después ok; el que falla, error; todos en el progreso, en orden y sin que un pensamiento borre al anterior.
  const c = await esperar((v) => v.herr.some(([n, e]) => n === "Bash" && e === "corriendo"), 20);
  ok(!!c, `un comando se ve «corriendo»: ${JSON.stringify(c?.herr)}`);
  const f = await esperar((v) => v.herr.some(([, e]) => e === "error"), 30);
  ok(!!f && f.herr.some(([, e]) => e === "ok"), `el que falló dice error y el anterior ok: ${JSON.stringify(f?.herr)}`);
  ok(!!f && f.visible !== false, "la tarjeta queda a la vista, al fondo de la conversación");
  const ps = f?.lineas.filter((l) => l.k === "pensamiento") ?? [];
  ok(ps.length >= 2 && /Primero miro/.test(ps[0].t), `con más pensamientos, el primero sigue ahí: ${ps.length} líneas`);
  const orden = (f?.lineas ?? []).map((l) => l.k).join(",");
  ok(/pensamiento,herramienta,.*pensamiento/.test(orden), `pensamientos y herramientas intercalados en orden: ${orden}`);
  await en(() => document.querySelector(".conv-zona .tv .tv-lt .tv-pb[aria-expanded=false]")?.click());
  const e = await esperar((v) => !!v.entero, 3);
  ok(!!e?.entero && /Primero miro/.test(e.entero), `un clic en una línea abre el pensamiento entero: ${e?.entero?.length ?? 0} caracteres`);
  await foto("pensamiento-abierto");
  await en(() => document.querySelector(".conv-zona .tv .tv-lt .tv-pb[aria-expanded=true]")?.click());
  ok((await vista()).entero === null, "otro clic lo pliega");
  await en(() => document.querySelector(".conv-zona details.trabajo:not([open]) summary")?.click());
  await en(() => document.querySelector(".conv-zona .ll-b")?.click());
  const d = await esperar((v) => v.cuerpos > 0, 3);
  ok(!!d, "en el trabajo del turno, tocar un comando abre su salida");
  await foto("comando-abierto");

  // Terminó: la tarjeta se va y el razonamiento queda en «Pensó», con los comandos y sus estados.
  const fin = await esperar((v) => !v.hay && v.pensado.length > 0, 40);
  ok(!!fin, `al terminar la tarjeta se va y quedan sus pensamientos plegados: ${JSON.stringify(fin?.pensado)}`);
  ok((await en(() => document.querySelectorAll(".conv-zona .el").length)) === 1, "la respuesta aparece una sola vez");
  await en(() => document.querySelector(".conv-zona details.trabajo:not([open]) summary")?.click());
  const fin2 = await esperar((v) => v.estados.length > 0, 3);
  ok(!!fin2 && fin2.estados.includes("error") && fin2.estados.includes("ok"), `abierto el trabajo, los comandos conservan su estado: ${JSON.stringify(fin2?.estados)}`);
  await espera(1500);
  await foto("terminado");
} finally {
  app.kill();
}
console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
