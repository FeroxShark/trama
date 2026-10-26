#!/usr/bin/env node
// Prueba de punta a punta de "Iniciar" en el Tablero: abre la app offscreen (HILOS_PRUEBA, sin ventana),
// la maneja por CDP con el mouse y verifica el mensaje que recibió cada líder (contra `promptIniciar`),
// en qué carpeta de la barra quedó y lo que el CLI `tablero` tiene escrito. El tablero es TEMPORAL
// (`TABLERO_DIR` en /tmp, con `tablero init`) y los líderes son el `claude` falso: el tablero real no
// se toca y no se lanza nada de verdad. `pa` es el falso; PA_STATE, HILOS_STATE, el perfil y el registry, temporales.
//   npm run build && node scripts/prueba-iniciar.mjs      (FOTOS=<carpeta> deja capturas)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promptIniciar } from "../src/datos/iniciar.ts";

const raiz = path.resolve(import.meta.dirname, "..");
// Antes de crear nada en /tmp. Sin CLI no es una falla: se salta.
const candidatos = [...(process.env.PATH ?? "").split(":"), path.join(os.homedir(), ".local/bin")].map((d) => path.join(d, "tablero"));
const bin = process.env.HILOS_TABLERO ?? [...candidatos, path.join(import.meta.dirname, "..", "..", "motor", "bin", "tablero")].find((f) => existsSync(f));
if (!bin) {
  console.log("no está el CLI `tablero`: nada que probar");
  process.exit(0);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-iniciar-"));
const puerto = 9300 + Math.floor(Math.random() * 600);
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
// Tres proyectos (uno con un nombre que no es el de su carpeta) y un área, que vive en ~: trama no le tiene carpeta.
for (const d of ["pa", "sesiones", "proy/atlas", "proy/faro", "proy/nube"]) mkdirSync(path.join(tmp, d), { recursive: true });
const proy = (name, carpeta) => ({ name, path: path.join(tmp, "proy", carpeta), desc: "" });
writeFileSync(
  path.join(tmp, "registry.json"),
  JSON.stringify({ projects: [proy("atlas", "atlas"), proy("faro-web", "faro"), proy("nube", "nube"), { name: "casa", path: "~", desc: "Lo de la casa" }] }),
);

const env = {
  ...process.env,
  TABLERO_DIR: path.join(tmp, "tablero"),
  PA_STATE: path.join(tmp, "pa"),
  PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
  HILOS_TABLERO: bin,
  HILOS_PRUEBA: "90",
  HILOS_FIXTURES: "0",
  HILOS_IDIOMA: "es",
  HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
  PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
  HILOS_STATE: path.join(tmp, "hilos"),
  HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
  HILOS_SESIONES: path.join(tmp, "sesiones"),
  HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
  TRAMA_FALSO_LOG: path.join(tmp, "claude-falso.log"),
  TRAMA_FALSO_DICHO: path.join(tmp, "claude-falso-dicho.jsonl"),
  HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
  HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
  NPM_FALSO_LOG: path.join(tmp, "npm-falso.log"),
};
// Sin esto el CLI escribiría la vista en la real aunque el tablero sea temporal.
delete env.TABLERO_VISTA;

const tablero = (...args) => execFileSync(bin, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const enDisco = () => JSON.parse(tablero("listar", "--todo", "--json"));
const item = (id) => enDisco().find((i) => i.id === id);
/** Cuántos `claude` (falsos) arrancaron: uno por líder nuevo. */
const lanzados = () => {
  try {
    return readFileSync(env.TRAMA_FALSO_LOG, "utf8").split("\n").filter((l) => l.includes('"args"')).length;
  } catch {
    return 0;
  }
};
const carpetaDe = (sid) => {
  try {
    return JSON.parse(readFileSync(path.join(env.HILOS_STATE, "nombres.json"), "utf8")).proyectos?.[sid] ?? null;
  } catch {
    return null;
  }
};

tablero("init");
const A = Number(tablero("agregar", "--proyecto=atlas", "--prueba=atlas --arrancar", "--detalle=Tarda 4 s en abrir.\nMedir antes de tocar.", "--", "Revisar el arranque en frío"));
const B = Number(tablero("agregar", "--columna=sigue", "--proyecto=atlas", "--", "Sacar el aviso viejo"));
const C = Number(tablero("agregar", "--columna=sigue", "--proyecto=atlas", "--", "Ordenar el menú"));
const D = Number(tablero("agregar", "--columna=sigue", "--proyecto=faro-web", "--prueba=faro --exportar ejemplo.csv", "--", "Probar la exportación"));
const E = Number(tablero("agregar", "--columna=sigue", "--proyecto=faro-web", "--detalle=Se corta a los 20 renglones.", "--", "Paginar la lista"));
const F = Number(tablero("agregar", "--columna=sigue", "--proyecto=nube", "--", "Renovar el certificado"));
const G = Number(tablero("agregar", "--proyecto=casa", "--", "Pedir turno para la caldera"));
const H = Number(tablero("agregar", "--columna=espera-dueno", "--proyecto=atlas", "--", "Esto no se inicia"));

const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], { env, stdio: "ignore" });

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
  const r = await cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "error en la página");
  return r.result?.result?.value;
}

/** Espera hasta que `fn` devuelva algo verdadero (tope 10 s). */
async function hasta(fn, que, ...args) {
  for (let i = 0; i < 100; i++) {
    const v = await en(fn, ...args).catch(() => null);
    if (v) return v;
    await espera(100);
  }
  console.log(`      (se esperó en vano: ${que})`);
  return null;
}

/** Lo mismo, pero mirando el disco (lo que dice el CLI, o un archivo). */
async function hastaDisco(fn, que) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return true;
    await espera(100);
  }
  console.log(`      (se esperó en vano: ${que})`);
  return false;
}

async function foto(nombre) {
  if (!fotos) return;
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
}

const centro = (sel) =>
  en((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const c = el.getBoundingClientRect();
    return c.width ? { x: c.left + c.width / 2, y: c.top + Math.min(c.height / 2, 14) } : null;
  }, sel);
const raton = (type, p, apretado) => cdp("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" && !apretado ? "none" : "left", buttons: apretado ? 1 : 0, clickCount: 1 });

/** Un clic de mouse de verdad (apretar y soltar en el lugar). */
async function clicEn(sel) {
  const p = await centro(sel);
  if (!p) return false;
  await raton("mouseMoved", p, false);
  await raton("mousePressed", p, true);
  await raton("mouseReleased", p, false);
  return true;
}

const tarjeta = (id) => `.tb-card[data-id="${id}"]`;
/** Un botón de la tarjeta: con mouse aparece al pasarle por encima, así que primero se va hasta ella. */
async function botonDe(id, cual) {
  // Hecho, plegada, va pegada a la derecha por encima de las columnas: la tarjeta tiene que quedar fuera de ahí.
  await en((sel) => {
    const cols = document.querySelector(".tb-cols");
    const c = document.querySelector(sel)?.getBoundingClientRect();
    const tope = cols.getBoundingClientRect().right - 48;
    if (c && c.right > tope) cols.scrollLeft += c.right - tope;
  }, tarjeta(id));
  const p = await centro(tarjeta(id));
  if (!p) return false;
  await raton("mouseMoved", p, false);
  await espera(60);
  return clicEn(`${tarjeta(id)} ${cual}`);
}
const VK = { Escape: 27 };
async function tecla(key) {
  const k = { key, code: key, windowsVirtualKeyCode: VK[key] };
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
}

const abrirTablero = async () => {
  await en(() => document.querySelector('.pie button[aria-label^="Tablero"]')?.click());
  // Abre en "Te esperan"; el kanban es la pestaña "Todo".
  await hasta(() => !!document.querySelector(".pd .tb-vistas"), "las pestañas");
  await en(() => [...document.querySelectorAll(".pd > .pd-barra .tb-vistas button")].find((b) => b.textContent === "Todo")?.click());
  return hasta(() => !!document.querySelector(".tb-cols .tb-card"), "el tablero");
};
/** Los líderes de la app en la barra (el `pa` falso trae además uno de terminal), cada uno con la carpeta donde está. */
const lideres = () =>
  en(() =>
    [...document.querySelectorAll(".lider[data-lider]")]
      .filter((l) => !l.dataset.lider.startsWith("s-falso"))
      .map((l) => ({ id: l.dataset.lider, carpeta: l.closest(".proy")?.querySelector(":scope > [data-carpeta]")?.dataset.carpeta ?? null })),
  );
const hastaLideres = (n) => hasta((n) => [...document.querySelectorAll(".lider[data-lider]")].filter((l) => !l.dataset.lider.startsWith("s-falso")).length === n, `${n} líderes`, n);
/** Lo que recibió ese líder, tal cual le llegó a su `claude` (el falso lo anota): la vista lo muestra como markdown. */
const recibidos = (sid) => {
  try {
    return readFileSync(env.TRAMA_FALSO_DICHO, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.sid === sid).map((m) => m.texto);
  } catch {
    return [];
  }
};
const hastaRecibidos = (sid, n) => hastaDisco(() => recibidos(sid).length >= n, `${n} mensajes en ${sid}`);
/** Cuántos mensajes propios se ven en la conversación abierta. */
const propios = () =>
  en(() => {
    const z = [...document.querySelectorAll(".conv-zona")].find((z) => z.clientHeight > 0);
    return z ? z.querySelectorAll(".conv .yo:not(.encolado)").length : 0;
  });
const liderAbierto = () => en(() => document.querySelector(".lider[data-activa]")?.dataset.lider ?? null);
/** El mensaje que tiene que haber recibido un líder por esas tareas (lo arma `promptIniciar` con lo que dice el CLI). */
const esperado = (ids, carpeta) => {
  const items = ids.map((id) => item(id));
  return promptIniciar({ proyecto: items[0].proyecto ?? "", carpeta, items: items.map((i) => ({ ...i, detalle: i.detalle ?? "", prueba: i.prueba ?? "" })) });
};
const confirmacion = () =>
  en(() =>
    [...document.querySelectorAll(".tb-ini-c > ul > li")].map((li) => ({
      proyecto: li.dataset.proyecto,
      destino: li.querySelector(".tb-ini-h .tb-ini-d")?.textContent.trim() ?? "",
      selector: !!li.querySelector(".tb-ini-h .tb-ini-d .pbtn"),
      tareas: [...li.querySelectorAll("ol li")].map((t) => t.textContent.trim()),
    })),
  );
const enviar = () => clicEn(".tb-ini-c .tb-iniciar");

try {
  ok(await hasta(() => document.querySelectorAll(".pie button").length >= 4, "el pie"), "la app abrió");
  ok(await abrirTablero(), "el Tablero abre con sus tarjetas");
  ok(await en((h) => !document.querySelector(`.tb-card[data-id="${h}"] .tb-btns`) || getComputedStyle(document.querySelector(`.tb-card[data-id="${h}"] .tb-btns`)).display === "none", H), "sin pasarle el mouse, la tarjeta no muestra botones");

  // --- Una tarea: ▶, confirmar, y el líder ---
  const mensajeA = esperado([A], "atlas");
  ok(await botonDe(A, ".tb-play"), "clic en el ▶ de una tarjeta");
  ok(await hasta(() => !!document.querySelector(".tb-ini-c"), "la confirmación"), "aparece la confirmación antes de mandar nada");
  let c = await confirmacion();
  ok(c.length === 1 && c[0].proyecto === "atlas" && c[0].tareas.length === 1 && c[0].tareas[0].includes(`#${A}`) && c[0].tareas[0].includes("Revisar el arranque en frío"), `dice qué tarea va (${JSON.stringify(c[0]?.tareas)})`);
  ok(c[0]?.destino === "líder nuevo en atlas" && !c[0].selector, `y a dónde: ${c[0]?.destino}`);
  ok(item(A).columna === "bandeja" && lanzados() === 0, "todavía no se mandó ni se movió nada");
  await foto("1-confirmar-una");
  ok(await enviar(), "clic en Enviar");
  ok(await hastaDisco(() => item(A).columna === "en-curso", "mover A"), "el item pasó a en-curso (`tablero mover`)");
  ok(await hasta(() => !document.querySelector(".tb") && !!document.querySelector(".lider[data-activa]"), "el líder abierto"), "el Tablero se cierra y queda el líder a la vista");
  let ls = await lideres();
  const L1 = await liderAbierto();
  ok(ls.length === 1 && ls[0].carpeta === "atlas" && ls[0].id === L1, `hay un líder, en la carpeta atlas (${JSON.stringify(ls)})`);
  ok(await hastaDisco(() => carpetaDe(L1) === "atlas", "nombres.json"), "y su carpeta quedó guardada");
  ok(await hasta(() => [...document.querySelectorAll(".conv-zona")].some((z) => z.clientHeight > 0 && z.querySelector(".conv .yo")), "el mensaje"), "la conversación tiene el mensaje");
  await hastaRecibidos(L1, 1);
  let d = recibidos(L1);
  ok(d.length === 1 && d[0] === mensajeA && (await propios()) === 1, "el primer mensaje es la tarea, letra por letra lo que arma `promptIniciar`");
  if (d[0] !== mensajeA) console.log(`      se esperaba: ${mensajeA}\n      llegó:       ${d[0]}`);
  ok(
    mensajeA.includes(`- Tarea #${A}: Revisar el arranque en frío`) && mensajeA.includes("- Detalle: Tarda 4 s en abrir.") && mensajeA.includes("- Cómo se prueba: atlas --arrancar") && mensajeA.includes(`tablero cerrar ${A}`),
    "y trae el título, el detalle, la prueba y el id del tablero",
  );
  ok(await hasta(() => [...document.querySelectorAll(".conv-zona")].some((z) => z.clientHeight > 0 && [...z.querySelectorAll(".conv .el")].some((e) => e.textContent.includes("eco:"))), "la respuesta"), "el líder (falso) lo recibió y contesta");
  ok(lanzados() === 1, `se lanzó un solo claude (${lanzados()})`);
  await foto("2-lider-una");

  // --- Tres marcadas de dos proyectos: dos líderes ---
  await abrirTablero();
  ok(await en((a) => !!document.querySelector(`.tb-col[data-columna="en-curso"] .tb-card[data-id="${a}"]`), A), "de vuelta en el Tablero, la tarea está en En curso");
  for (const id of [D, E, F]) await botonDe(id, ".tb-marca");
  ok(await hasta(() => document.querySelector(".tb-ini-m span")?.textContent === "3 marcadas", "3 marcadas"), "con tres marcadas, la franja las cuenta");
  ok(await en(() => document.querySelector(".tb-ini-m .tb-iniciar")?.textContent.trim() === "Iniciar 3"), 'y ofrece "Iniciar 3"');
  await foto("3-marcadas");
  const mensajeFaro = esperado([D, E], "faro");
  const mensajeNube = esperado([F], "nube");
  await clicEn(".tb-ini-m .tb-iniciar");
  await hasta(() => !!document.querySelector(".tb-ini-c"), "la confirmación de tres");
  c = await confirmacion();
  ok(c.length === 2 && c[0].proyecto === "faro-web" && c[0].tareas.length === 2 && c[1].proyecto === "nube" && c[1].tareas.length === 1, `la confirmación las junta por proyecto (${c.map((g) => `${g.proyecto}: ${g.tareas.length}`).join(", ")})`);
  ok(c[0]?.destino === "líder nuevo en faro" && c[1]?.destino === "líder nuevo en nube", `cada proyecto con su líder (${c.map((g) => g.destino).join(" | ")})`);
  await foto("4-confirmar-tres");
  await enviar();
  ok(await hastaDisco(() => [D, E, F].every((id) => item(id).columna === "en-curso"), "mover las tres"), "las tres pasaron a en-curso");
  ok((await hastaLideres(3)) && (await hasta(() => !document.querySelector(".tb"), "el panel cerrado")), "se abrieron dos líderes más");
  ls = await lideres();
  const LF = ls.find((l) => l.carpeta === "faro")?.id;
  const LN = ls.find((l) => l.carpeta === "nube")?.id;
  ok(!!LF && !!LN && lanzados() === 3, `uno en faro y otro en nube (${JSON.stringify(ls.map((l) => l.carpeta))}; ${lanzados()} claude lanzados)`);
  ok((await liderAbierto()) === LF, "queda a la vista el primero");
  await hasta(() => [...document.querySelectorAll(".conv-zona")].some((z) => z.clientHeight > 0 && z.querySelector(".conv .yo")), "el mensaje de faro");
  await hastaRecibidos(LF, 1);
  d = recibidos(LF);
  ok(d.length === 1 && d[0] === mensajeFaro && (await propios()) === 1, "el de faro recibió sus dos tareas en un solo mensaje");
  if (d[0] !== mensajeFaro) console.log(`      se esperaba: ${mensajeFaro}\n      llegó:       ${d[0]}`);
  ok(mensajeFaro.includes(`1. #${D}: Probar la exportación`) && mensajeFaro.includes(`2. #${E}: Paginar la lista`) && mensajeFaro.includes("- Proyecto: faro-web"), "numeradas, con el nombre que el proyecto tiene en el tablero");
  await foto("5-lider-faro");
  await en((sid) => document.querySelector(`.lider[data-lider="${sid}"]`)?.click(), LN);
  await hasta((sid) => document.querySelector(".lider[data-activa]")?.dataset.lider === sid && [...document.querySelectorAll(".conv-zona")].some((z) => z.clientHeight > 0 && z.querySelector(".conv .yo")), "el de nube", LN);
  await hastaRecibidos(LN, 1);
  d = recibidos(LN);
  ok(d.length === 1 && d[0] === mensajeNube && (await propios()) === 1, "el de nube recibió la suya");
  if (d[0] !== mensajeNube) console.log(`      se esperaba: ${mensajeNube}\n      llegó:       ${d[0]}`);

  // --- Reusar: otra tarea de atlas va al líder que ya está ---
  await abrirTablero();
  const mensajeB = esperado([B], "atlas");
  await botonDe(B, ".tb-play");
  await hasta(() => !!document.querySelector(".tb-ini-c"), "la confirmación de B");
  c = await confirmacion();
  ok(c.length === 1 && c[0].selector && !c[0].destino.includes("líder nuevo"), `con un líder ya en la carpeta, lo propone a él (${c[0]?.destino})`);
  await enviar();
  ok(await hastaDisco(() => item(B).columna === "en-curso", "mover B"), "la tarea pasó a en-curso");
  ok(await hasta((sid) => !document.querySelector(".tb") && document.querySelector(".lider[data-activa]")?.dataset.lider === sid, "el mismo líder", L1), "y se abre el líder que ya estaba");
  ok(await hasta(() => [...document.querySelectorAll(".conv-zona")].some((z) => z.clientHeight > 0 && z.querySelectorAll(".conv .yo:not(.encolado)").length === 2), "el segundo mensaje"), "que recibe un segundo mensaje");
  await hastaRecibidos(L1, 2);
  d = recibidos(L1);
  ok(d.length === 2 && d[0] === mensajeA && d[1] === mensajeB, "con la tarea nueva, después de la primera");
  ok(lanzados() === 3 && (await lideres()).length === 3, "sin lanzar otro líder");

  // --- Elegir "líder nuevo" aunque haya uno ---
  await abrirTablero();
  await botonDe(C, ".tb-play");
  await hasta(() => !!document.querySelector(".tb-ini-c .tb-ini-d .pbtn"), "el selector");
  await clicEn(".tb-ini-c .tb-ini-d .pbtn");
  ok(await hasta(() => document.querySelectorAll('.tb-ini-c [role="listbox"] .op').length === 2, "el menú"), "el selector ofrece el líder que está y uno nuevo");
  await foto("6-selector");
  await en(() => [...document.querySelectorAll('.tb-ini-c [role="listbox"] .op')].at(-1).click());
  ok(await hasta(() => document.querySelector(".tb-ini-c .tb-ini-d .pbtn")?.textContent.includes("líder nuevo en atlas"), "elegido"), 'se elige "líder nuevo en atlas"');
  await enviar();
  ok(await hastaDisco(() => item(C).columna === "en-curso" && lanzados() === 4, "otro líder"), "y la tarea va a un líder nuevo");
  await hastaLideres(4);
  // El panel se cierra solo al mandar: hasta que no lo hizo, el botón del pie lo cerraría en vez de abrirlo.
  await hasta(() => !document.querySelector(".tb"), "el panel cerrado");
  ls = await lideres();
  ok(ls.filter((l) => l.carpeta === "atlas").length === 2, "que queda en la misma carpeta, al lado del otro");

  // --- Un área (trama no le tiene carpeta): desde el detalle, a un líder en Inicio ---
  await abrirTablero();
  const mensajeG = esperado([G], null);
  await clicEn(tarjeta(G));
  ok(await hasta(() => !!document.querySelector(".tb-det .tb-iniciar"), "el detalle"), "el detalle de una tarea tiene su botón Iniciar");
  await clicEn(".tb-det .tb-iniciar");
  await hasta(() => !!document.querySelector(".tb-ini-c"), "la confirmación del área");
  c = await confirmacion();
  // La carpeta de ~ se llama como el usuario (o "Inicio"), igual que en la barra.
  ok(c.length === 1 && c[0].proyecto === "casa" && !c[0].selector && [`líder nuevo en ${os.userInfo().username}`, "líder nuevo en Inicio"].includes(c[0].destino), `lo de un área va a un líder nuevo en la carpeta de ~ (${c[0]?.destino})`);
  await foto("7-confirmar-area");
  await enviar();
  ok(await hastaDisco(() => item(G).columna === "en-curso" && lanzados() === 5, "el del área"), "se manda y pasa a en-curso");
  await hastaLideres(5);
  await hasta(() => !document.querySelector(".tb"), "el panel cerrado");
  ls = await lideres();
  const LG = ls.find((l) => l.carpeta === "general")?.id;
  ok(!!LG && (await liderAbierto()) === LG, `el líder quedó en la carpeta de ~ y a la vista (${JSON.stringify(ls.map((l) => l.carpeta))})`);
  await hastaRecibidos(LG, 1);
  d = recibidos(LG);
  ok(d.length === 1 && d[0] === mensajeG && mensajeG.includes("- Proyecto: casa (no es un proyecto del registry"), "y el mensaje le avisa que no es un proyecto del registry");

  // --- Cancelar no manda nada ---
  await abrirTablero();
  await botonDe(H, ".tb-play");
  ok(await hasta(() => !!document.querySelector(".tb-ini-c"), "la confirmación de H"), "otra tarea: la confirmación");
  await clicEn(".tb-ini-b .btn2:not(.tb-iniciar)");
  ok(await hasta(() => !document.querySelector(".tb-ini-c") && !!document.querySelector(".tb"), "cancelada"), "Cancelar saca la confirmación y deja el Tablero");
  await botonDe(H, ".tb-play");
  await hasta(() => !!document.querySelector(".tb-ini-c"), "la confirmación otra vez");
  await en(() => document.activeElement?.blur());
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".tb-ini-c") && !!document.querySelector(".tb"), "Esc"), "Esc también, sin cerrar el panel");
  await espera(300);
  ok(item(H).columna === "espera-dueno" && lanzados() === 5, "y no se movió ni se lanzó nada");

  // --- Vuelta atrás: Iniciar desde el detalle; Cancelar lo reabre (sin perder lo elegido) y la confirmación ofrece un modelo ---
  await clicEn(tarjeta(H));
  await hasta(() => !!document.querySelector(".tb-det .tb-iniciar"), "el detalle de H");
  await clicEn(".tb-det .tb-iniciar");
  ok(await hasta(() => !!document.querySelector(".tb-ini-c") && !document.querySelector(".tb-det"), "la confirmación"), "Iniciar desde el detalle abre la confirmación");
  ok(await en(() => !!document.querySelector(".tb-ini-c li[data-proyecto] .tb-ini-m2 .pbtn")), "y trae un selector de modelo");
  await clicEn(".tb-ini-b .btn2:not(.tb-iniciar)");
  ok(await hasta(() => !document.querySelector(".tb-ini-c") && !!document.querySelector(".tb-det"), "de vuelta"), "Cancelar vuelve al detalle de donde salió");
  await en(() => document.activeElement?.blur());
  await tecla("Escape");
  await espera(300);
  ok(item(H).columna === "espera-dueno" && lanzados() === 5, "y sigue sin moverse ni lanzarse nada");
} catch (e) {
  ok(false, String(e?.stack ?? e));
} finally {
  ws.close();
  app.kill();
  console.log(`tablero temporal: ${env.TABLERO_DIR}`);
  console.log(fallas ? `${fallas} fallas` : "todo ok");
  process.exit(fallas ? 1 : 0);
}
