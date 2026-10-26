#!/usr/bin/env node
// Prueba de reordenar la barra arrastrando: abre la app offscreen (HILOS_PRUEBA, sin ventana) con
// el `pa` falso y cuatro líderes de mentira (cada uno un `sleep` con su sesión), y con el mouse de
// verdad por CDP: un clic sin mover sigue abriendo, arrastrar un líder lo cambia de lugar en su
// carpeta (con la línea que dice dónde cae), Escape y soltar afuera cancelan, las carpetas se
// reordenan igual, el orden queda en nombres.json y vuelve tal cual al abrir la app de nuevo.
// No toca `pa`, ni `claude`, ni el estado de verdad.
//   npm run build && node scripts/prueba-orden.mjs
//   FOTOS=<carpeta>   además deja la captura del arrastre a mitad de camino (de un líder y de una carpeta)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-orden-"));

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

for (const d of ["atlas", "brote"]) mkdirSync(path.join(tmp, "proy", d), { recursive: true });
mkdirSync(path.join(tmp, "pa"));
mkdirSync(path.join(tmp, "hilos"));
writeFileSync(
  path.join(tmp, "registry.json"),
  JSON.stringify({
    projects: [
      { name: "atlas", path: path.join(tmp, "proy", "atlas"), desc: "La web" },
      { name: "brote", path: path.join(tmp, "proy", "brote"), desc: "El jardín" },
    ],
  }),
);

// Cuatro líderes de terminal de mentira: un `sleep` cada uno, con su sesión (pid y arranque reales).
// Tres viven en atlas (los movió el usuario: nombres.json) y el cuarto en brote, con los workers del `pa` falso.
const LIDERES = [
  { sid: "0a000000-0000-4000-8000-000000000001", nombre: "ana-uno", carpeta: "atlas" },
  { sid: "0a000000-0000-4000-8000-000000000002", nombre: "ana-dos", carpeta: "atlas" },
  { sid: "0a000000-0000-4000-8000-000000000003", nombre: "ana-tres", carpeta: "atlas" },
  { sid: "0a000000-0000-4000-8000-000000000004", nombre: "ana-cuatro", carpeta: "brote" },
];
const [UNO, DOS, TRES, CUATRO] = LIDERES.map((l) => l.sid);
const sesiones = path.join(tmp, "sesiones");
mkdirSync(sesiones);
const procesos = LIDERES.map((l, i) => {
  const p = spawn("sleep", ["300"], { stdio: "ignore" });
  const arranque = Number(readFileSync(`/proc/${p.pid}/stat`, "utf8").split(") ").at(-1).split(" ")[19]);
  writeFileSync(
    path.join(sesiones, `${p.pid}.json`),
    JSON.stringify({
      pid: p.pid,
      sessionId: l.sid,
      cwd: path.join(tmp, "proy", l.carpeta),
      kind: "interactive",
      entrypoint: "cli",
      name: l.nombre,
      // Creados con una hora de diferencia: el orden por defecto es uno, dos, tres.
      startedAt: Date.now() - (LIDERES.length - i) * 3_600_000,
      updatedAt: Date.now(),
      procStart: arranque,
    }),
  );
  return p;
});
const nombresJson = path.join(tmp, "hilos", "nombres.json");
// Orden fijo desde el arranque: de fábrica el orden es por prioridad y ahí no se arrastra.
writeFileSync(nombresJson, JSON.stringify({ version: 1, titulos: {}, proyectos: Object.fromEntries(LIDERES.map((l) => [l.sid, l.carpeta])), ocultos: [], orden: { carpetas: [], lideres: {}, prioridad: false } }));
const guardado = () => {
  try {
    return JSON.parse(readFileSync(nombresJson, "utf8"));
  } catch {
    return null;
  }
};

/** Abre la app sobre el mismo estado y devuelve cómo manejarla. */
async function abrir() {
  const puerto = 9300 + Math.floor(Math.random() * 600);
  const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
    env: {
      ...process.env,
      HILOS_PRUEBA: "90",
      HILOS_FIXTURES: "0",
      HILOS_IDIOMA: "es",
      HILOS_VISTA: "todo",
      HILOS_TAM: "900 760",
      HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
      PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
      PA_FALSO_LIDER: CUATRO,
      PA_STATE: path.join(tmp, "pa"),
      HILOS_STATE: path.join(tmp, "hilos"),
      HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
      PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
      HILOS_SESIONES: sesiones,
      HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
      CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
      TRAMA_FALSO_LOG: path.join(tmp, "claude-falso.log"),
      HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
      HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
      NPM_FALSO_LOG: path.join(tmp, "npm-falso.log"),
      HILOS_TABLERO: "/bin/false",
    },
    stdio: "ignore",
  });
  let url = null;
  for (let i = 0; i < 150 && !url; i++) {
    try {
      const ts = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
      url = ts.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {}
    if (!url) await espera(100);
  }
  if (!url) {
    app.kill();
    throw new Error("la app no abrió el puerto de CDP");
  }
  const ws = new WebSocket(url);
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
  /** La caja de `sel` en la ventana. */
  const caja = (sel) =>
    en((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, sel);
  const raton = (type, p, apretado) =>
    cdp("Input.dispatchMouseEvent", { type, x: Math.round(p.x), y: Math.round(p.y), button: type === "mouseMoved" ? "none" : "left", buttons: apretado ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
  /** Aprieta en `de` y lleva el mouse hasta `a` de a pasos, sin soltar. */
  async function llevar(de, a, pasos = 8) {
    await raton("mouseMoved", de, false);
    await raton("mousePressed", de, true);
    for (let i = 1; i <= pasos; i++) await raton("mouseMoved", { x: de.x + ((a.x - de.x) * i) / pasos, y: de.y + ((a.y - de.y) * i) / pasos }, true);
    await espera(60);
  }
  const soltar = async (p) => {
    await raton("mouseReleased", p, false);
    await espera(350);
  };
  async function foto(nombre) {
    if (!fotos) return;
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
  }
  /** Los líderes de una carpeta y las carpetas, como se ven. */
  const lideresDe = (carpeta) =>
    en((carpeta) => [...document.querySelectorAll(`.proy:has(> [data-carpeta="${carpeta}"]) .lider[data-lider]`)].map((e) => e.dataset.lider), carpeta);
  const carpetas = () => en(() => [...document.querySelectorAll(".proy-nom[data-carpeta]")].map((e) => e.dataset.carpeta));
  const abierto = () => en(() => document.querySelector(".lider[data-activa]")?.dataset.lider ?? null);
  /** Lo que se ve del arrastre: la línea, lo apagado y la marca en la raíz. */
  const arrastrando = () =>
    en(() => {
      const l = document.querySelector(".cae");
      const r = l?.getBoundingClientRect();
      return {
        moviendo: !!document.querySelector(".app[data-moviendo]"),
        movida: document.querySelector("[data-movida]")?.dataset.mueve ?? null,
        linea: !!l?.hasAttribute("data-ve") && getComputedStyle(l).opacity === "1",
        y: r ? r.top + r.height / 2 : null,
        ancho: r?.width ?? 0,
      };
    });
  const cerrar = async () => {
    ws.close();
    app.kill();
    await espera(400);
  };
  return { cdp, en, hasta, caja, raton, llevar, soltar, foto, lideresDe, carpetas, abierto, arrastrando, cerrar };
}

const fila = (sid) => `.lider[data-lider="${sid}"]`;
const centro = (c) => ({ x: c.x + Math.min(c.w / 2, 60), y: c.y + c.h / 2 });
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let a = await abrir();
try {
  await a.hasta((n) => document.querySelectorAll(".lider[data-lider]").length >= n, "los cuatro líderes en la barra", LIDERES.length);
  ok(igual(await a.lideresDe("atlas"), [UNO, DOS, TRES]), `por defecto, por creación: ${JSON.stringify(await a.lideresDe("atlas"))}`);
  const carpetas0 = await a.carpetas();
  ok(carpetas0[0] === "general" && carpetas0.includes("atlas") && carpetas0.includes("brote"), `las carpetas, la del home primera: ${carpetas0.join(", ")}`);

  // Un clic sin mover abre la sesión, como siempre. Antes, que la barra deje de acomodarse (las filas entran animadas).
  let quieta = null;
  for (let i = 0; i < 30; i++) {
    const c = JSON.stringify(await a.caja(fila(DOS)));
    if (c === quieta) break;
    quieta = c;
    await espera(100);
  }
  let p = centro(await a.caja(fila(DOS)));
  await a.raton("mouseMoved", p, false);
  await a.raton("mousePressed", p, true);
  await a.raton("mouseReleased", p, false);
  ok((await a.hasta((sid) => document.querySelector(".lider[data-activa]")?.dataset.lider === sid, "el líder abierto", DOS)) === true, "un clic sin mover abre la sesión");
  // Un temblor de un par de píxeles sigue siendo un clic.
  p = centro(await a.caja(fila(UNO)));
  await a.llevar(p, { x: p.x + 2, y: p.y + 2 }, 2);
  ok(!(await a.arrastrando()).moviendo, "mover un par de píxeles no empieza el arrastre");
  await a.soltar({ x: p.x + 2, y: p.y + 2 });
  ok((await a.abierto()) === UNO, "y abre la sesión igual");
  ok(igual(await a.lideresDe("atlas"), [UNO, DOS, TRES]) && !guardado()?.orden?.lideres?.atlas, "los clics no cambian el orden ni guardan nada");

  // Arrastrar: el tercero arriba del primero.
  const de = centro(await a.caja(fila(TRES)));
  const cajaUno = await a.caja(`.arbol[data-mueve="${UNO}"]`);
  const hasta = { x: de.x + 8, y: cajaUno.y + 4 };
  await a.llevar(de, hasta);
  let v = await a.arrastrando();
  ok(v.moviendo && v.movida === TRES, "pasados unos píxeles empieza el arrastre: la fila queda apagada en su lugar");
  ok(v.linea && Math.abs(v.y - cajaUno.y) <= 6 && v.ancho > 100, `la línea marca dónde cae: arriba del primero (y ${v.y?.toFixed(1)}, la fila en ${cajaUno.y.toFixed(1)})`);
  ok(igual(await a.lideresDe("atlas"), [UNO, DOS, TRES]), "mientras se arrastra nada cambia de lugar");
  await a.foto("arrastre");
  await a.soltar(hasta);
  ok(igual(await a.lideresDe("atlas"), [TRES, UNO, DOS]), `al soltar queda donde decía la línea: ${JSON.stringify(await a.lideresDe("atlas"))}`);
  v = await a.arrastrando();
  ok(!v.moviendo && !v.movida && !v.linea, "y no queda nada del arrastre a la vista");
  ok((await a.abierto()) === UNO, "soltar no abre la sesión arrastrada");
  for (let i = 0; i < 30 && !guardado()?.orden?.lideres?.atlas; i++) await espera(100);
  ok(igual(guardado()?.orden?.lideres?.atlas, [TRES, UNO, DOS]), `nombres.json lo guarda: ${JSON.stringify(guardado()?.orden)}`);
  ok(igual(guardado()?.proyectos?.[UNO], "atlas"), "sin pisar lo demás que había en nombres.json");

  // Escape cancela (y no cierra lo abierto).
  const deDos = centro(await a.caja(fila(DOS)));
  const cajaTres = await a.caja(`.arbol[data-mueve="${TRES}"]`);
  await a.llevar(deDos, { x: deDos.x, y: cajaTres.y + 3 });
  ok((await a.arrastrando()).linea, "otro arrastre: la línea está");
  await a.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await a.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await espera(100);
  v = await a.arrastrando();
  ok(!v.moviendo && !v.linea, "Escape corta el arrastre");
  await a.soltar({ x: deDos.x, y: cajaTres.y + 3 });
  ok(igual(await a.lideresDe("atlas"), [TRES, UNO, DOS]), "y no mueve nada");
  ok((await a.abierto()) === UNO, "ni cierra lo que estaba abierto");

  // Soltar afuera de la barra cancela.
  const deDos2 = centro(await a.caja(fila(DOS)));
  await a.llevar(deDos2, { x: 700, y: cajaTres.y + 3 });
  v = await a.arrastrando();
  ok(v.moviendo && !v.linea, "afuera de la barra no hay línea");
  await a.soltar({ x: 700, y: cajaTres.y + 3 });
  ok(igual(await a.lideresDe("atlas"), [TRES, UNO, DOS]), "soltar afuera no mueve nada");
  // Un líder no cambia de carpeta arrastrando: fuera de la suya tampoco hay dónde caer.
  const otra = await a.caja(`.proy:has(> [data-carpeta="brote"])`);
  const deDos3 = centro(await a.caja(fila(DOS)));
  await a.llevar(deDos3, { x: deDos3.x, y: otra.y + otra.h / 2 });
  ok(!(await a.arrastrando()).linea, "sobre otra carpeta no hay línea");
  await a.soltar({ x: deDos3.x, y: otra.y + otra.h / 2 });
  ok(igual(await a.lideresDe("atlas"), [TRES, UNO, DOS]) && igual(await a.lideresDe("brote"), [CUATRO]), "y el líder sigue en la suya");

  // Las carpetas entre sí: la segunda, arriba de la primera que se mueve (la del home no se mueve).
  const movibles = (await a.carpetas()).filter((c) => c !== "general");
  const ultima = movibles[1];
  const abiertaAntes = await a.en((c) => document.querySelector(`.proy-nom[data-carpeta="${c}"]`)?.getAttribute("aria-expanded"), ultima);
  const deCarpeta = centro(await a.caja(`.proy-nom[data-carpeta="${ultima}"]`));
  const cajaPrimera = await a.caja(`.proy:has(> [data-carpeta="${movibles[0]}"])`);
  const hastaCarpeta = { x: deCarpeta.x + 6, y: cajaPrimera.y + 6 };
  await a.llevar(deCarpeta, hastaCarpeta, 12);
  v = await a.arrastrando();
  ok(v.moviendo && v.movida === ultima && v.linea, `una carpeta se arrastra de su nombre (${ultima}), con su línea`);
  await a.foto("arrastre-carpeta");
  await a.soltar(hastaCarpeta);
  const esperadas = ["general", ultima, movibles[0], ...movibles.slice(2)];
  ok(igual(await a.carpetas(), esperadas), `la carpeta queda donde se soltó: ${(await a.carpetas()).join(", ")}`);
  ok((await a.en((c) => document.querySelector(`.proy-nom[data-carpeta="${c}"]`)?.getAttribute("aria-expanded"), ultima)) === abiertaAntes, "y no se pliega por haberla arrastrado");
  for (let i = 0; i < 30 && !guardado()?.orden?.carpetas?.length; i++) await espera(100);
  ok(igual(guardado()?.orden?.carpetas, esperadas.slice(1)), `nombres.json guarda el orden de las carpetas: ${JSON.stringify(guardado()?.orden?.carpetas)}`);
  // La del home no se arrastra.
  const home = centro(await a.caja(`.proy-nom[data-carpeta="general"]`));
  await a.llevar(home, { x: home.x, y: home.y + 200 });
  ok(!(await a.arrastrando()).moviendo, "la carpeta del home no se arrastra: queda primera");
  await a.soltar({ x: home.x, y: home.y + 200 });
  // El clic de arriba pudo plegarla: se la deja abierta.
  if ((await a.en(() => document.querySelector('.proy-nom[data-carpeta="general"]')?.getAttribute("aria-expanded"))) === "false") {
    await a.raton("mousePressed", home, true);
    await a.raton("mouseReleased", home, false);
  }

  // Cerrar la app y abrirla de nuevo: el mismo orden.
  await a.cerrar();
  a = await abrir();
  await a.hasta((n) => document.querySelectorAll(".lider[data-lider]").length >= n, "los cuatro líderes, otra vez", LIDERES.length);
  ok(igual(await a.lideresDe("atlas"), [TRES, UNO, DOS]), `tras abrir de nuevo, los líderes como quedaron: ${JSON.stringify(await a.lideresDe("atlas"))}`);
  ok(igual(await a.carpetas(), esperadas), `y las carpetas: ${(await a.carpetas()).join(", ")}`);

  // El menú (clic derecho): Subir / Bajar mueven un lugar, Orden por defecto limpia todo lo puesto a mano.
  const menuDe = async (css) => {
    await a.en((css) => {
      const el = document.querySelector(css);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + r.height / 2 }));
    }, css);
    await a.hasta(() => !!document.querySelector('[role="menu"]'), "el menú");
  };
  const elegir = async (accion) => {
    const c = await a.caja(`[role="menu"] [data-accion="${accion}"]`);
    const q = centro(c);
    await a.raton("mouseMoved", q, false);
    await a.raton("mousePressed", q, true);
    await a.raton("mouseReleased", q, false);
    await a.hasta(() => !document.querySelector('[role="menu"]'), "menú cerrado");
    await espera(300);
  };
  const acciones = () => a.en(() => [...document.querySelectorAll('[role="menu"] [data-accion]')].map((e) => e.dataset.accion));
  await menuDe(fila(TRES));
  let ac = await acciones();
  ok(!ac.includes("subir") && ac.includes("bajar") && ac.includes("defecto"), `el primero de su carpeta ofrece Bajar y no Subir (y Orden por defecto, que hay algo a mano): ${ac.join(" ")}`);
  await elegir("bajar");
  ok(igual(await a.lideresDe("atlas"), [UNO, TRES, DOS]), `Bajar lo pasa un lugar: ${JSON.stringify(await a.lideresDe("atlas"))}`);
  for (let i = 0; i < 30 && !igual(guardado()?.orden?.lideres?.atlas, [UNO, TRES, DOS]); i++) await espera(100);
  ok(igual(guardado()?.orden?.lideres?.atlas, [UNO, TRES, DOS]), "nombres.json lo guarda");
  await menuDe(fila(DOS));
  ac = await acciones();
  ok(ac.includes("subir") && !ac.includes("bajar"), `el último ofrece Subir y no Bajar: ${ac.join(" ")}`);
  await elegir("subir");
  ok(igual(await a.lideresDe("atlas"), [UNO, DOS, TRES]), `Subir lo pasa un lugar: ${JSON.stringify(await a.lideresDe("atlas"))}`);
  await menuDe(`.proy-nom[data-carpeta="atlas"]`);
  ac = await acciones();
  ok(ac.includes("subir") && ac.includes("bajar") && ac.includes("defecto"), `la carpeta del medio: Subir, Bajar y Orden por defecto: ${ac.join(" ")}`);
  await a.foto("menu-orden");
  await elegir("bajar");
  ok(igual(await a.carpetas(), ["general", "brote", "cauce", "atlas"]), `Bajar en una carpeta la pasa un lugar: ${(await a.carpetas()).join(", ")}`);
  await menuDe(`.proy-nom[data-carpeta="general"]`);
  ac = await acciones();
  ok(!ac.includes("subir") && !ac.includes("bajar") && ac.includes("defecto"), `la del home no se mueve: ${ac.join(" ")}`);
  await elegir("defecto");
  ok(igual(await a.lideresDe("atlas"), [UNO, DOS, TRES]) && igual(await a.carpetas(), carpetas0), `Orden por defecto: todo vuelve a lo de siempre (${(await a.carpetas()).join(", ")})`);
  for (let i = 0; i < 30 && guardado()?.orden?.carpetas?.length; i++) await espera(100);
  ok(!guardado()?.orden?.carpetas?.length && !Object.keys(guardado()?.orden?.lideres ?? {}).length, `nombres.json queda sin orden: ${JSON.stringify(guardado()?.orden)}`);
  await menuDe(fila(DOS));
  ok(!(await acciones()).includes("defecto"), "sin nada a mano, el menú no ofrece Orden por defecto");
  await a.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await a.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await espera(150);
} finally {
  await a.cerrar();
  for (const p of procesos) p.kill();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fallas ? `\n${fallas} falla(s)` : "\ntodo bien");
process.exit(fallas ? 1 : 0);
