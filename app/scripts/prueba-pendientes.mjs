#!/usr/bin/env node
// Prueba de punta a punta del tablero nuevo ("Te esperan"): abre la app offscreen (HILOS_PRUEBA, sin ventana),
// la maneja por CDP con el mouse (1280 px) y con el dedo (360 px) y verifica lo que el CLI `tablero` tiene
// escrito, el número del pie, lo que queda en la caja de cada líder y que lo tocado sobrevive a un reinicio.
// El tablero es TEMPORAL (`TABLERO_DIR` en /tmp, con `tablero init`) y los líderes son el `claude` falso: el
// tablero real no se toca y no se lanza nada de verdad. `pa` es el falso; PA_STATE, HILOS_STATE, el perfil y el
// registry, temporales.
//   npm run build && node scripts/prueba-pendientes.mjs      (FOTOS=<carpeta> deja capturas)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
// Antes de crear nada en /tmp. Sin CLI no es una falla: se salta.
const candidatos = [...(process.env.PATH ?? "").split(":"), path.join(os.homedir(), ".local/bin")].map((d) => path.join(d, "tablero"));
const bin = process.env.HILOS_TABLERO ?? [...candidatos, path.join(import.meta.dirname, "..", "..", "motor", "bin", "tablero")].find((f) => existsSync(f));
if (!bin) {
  console.log("no está el CLI `tablero`: nada que probar");
  process.exit(0);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-pendientes-"));
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
for (const d of ["pa", "sesiones", "proy/atlas", "proy/faro"]) mkdirSync(path.join(tmp, d), { recursive: true });
const proy = (name, carpeta) => ({ name, path: path.join(tmp, "proy", carpeta), desc: "" });
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [proy("atlas", "atlas"), proy("faro-web", "faro")] }));

const env = {
  ...process.env,
  TABLERO_DIR: path.join(tmp, "tablero"),
  PA_STATE: path.join(tmp, "pa"),
  PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
  HILOS_TABLERO: bin,
  HILOS_PRUEBA: "170",
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
const pendientesJson = () => {
  try {
    return JSON.parse(readFileSync(path.join(env.HILOS_STATE, "pendientes.json"), "utf8"));
  } catch {
    return null;
  }
};

tablero("init");
const agregar = (...a) => Number(tablero("agregar", "--columna=espera-dueno", ...a));
const Q1 = agregar("--proyecto=atlas", "--tipo=pregunta", "--simple=Cómo ordenamos los mapas", "--contexto=Hoy salen sin orden y cuesta encontrarlos.", "--opcion=Por fecha", "--opcion=Por nombre", "--opcion=Por tamaño", "--defecto=1", "--", "Orden de los mapas en la lista");
const Q2 = agregar("--proyecto=atlas", "--tipo=pregunta", "--simple=Subimos la versión ahora", "--opcion=Sí", "--opcion=No", "--opcion=Más tarde", "--defecto=2", "--", "Subir la versión");
const Q3 = agregar("--proyecto=atlas", "--detalle=Los mapas viejos se guardaron con un formato que ya nadie lee y hay que ver si se migran de una vez o se dejan morir con el tiempo; depende de cuántos quedan en uso y de si alguien los pide. ".repeat(2), "--", "Decidir qué hacemos con el formato viejo de los mapas guardados porque no queda claro si conviene migrarlos todos juntos o ir de a poco según se usen");
const P1 = agregar("--proyecto=atlas", "--tipo=prueba", "--simple=Probar la exportación", "--prueba=atlas --exportar ejemplo.csv", "--", "Exportar a csv");
const P2 = agregar("--proyecto=atlas", "--tipo=prueba", "--simple=Probar el zoom", "--prueba=atlas --zoom 3", "--", "Zoom del mapa");
const Q4 = agregar("--proyecto=faro-web", "--tipo=pregunta", "--simple=Cambiamos el logo", "--opcion=Sí", "--opcion=No", "--", "Logo nuevo");
const TOTAL = 6;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

// --- La app y su CDP (se puede cerrar y volver a abrir con el mismo HILOS_STATE) ---
let app = null;
let ws = null;
let n = 0;
const pend = new Map();

async function lanzar() {
  const puerto = 9300 + Math.floor(Math.random() * 600);
  app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], { env, stdio: "ignore" });
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
  n = 0;
  pend.clear();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    }
  });
}
async function cerrar() {
  ws?.close();
  const a = app;
  if (!a) return;
  const salio = new Promise((r) => a.once("exit", r));
  a.kill();
  await Promise.race([salio, espera(5000)]);
  app = null;
}
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

let dedo = false;
/** Marca el primer `sel` visible que contenga `texto` (si se da) y devuelve dónde tocarlo. */
const centro = (sel, texto = null) =>
  en(
    (sel, texto) => {
      document.querySelectorAll("[data-toque]").forEach((e) => e.removeAttribute("data-toque"));
      const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length && (texto === null || e.textContent.includes(texto)));
      if (!el || el.disabled) return null;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      el.setAttribute("data-toque", "");
      const c = el.getBoundingClientRect();
      return c.width ? { x: Math.round(c.left + c.width / 2), y: Math.round(c.top + Math.min(c.height / 2, 14)) } : null;
    },
    sel,
    texto,
  );
const raton = (type, p, apretado) => cdp("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: type === "mouseMoved" && !apretado ? "none" : "left", buttons: apretado ? 1 : 0, clickCount: 1 });
/** Un clic de mouse (o un toque del dedo, a 360 px) en el primer `sel` visible que contenga `texto`. */
async function tocar(sel, texto = null) {
  const p = await centro(sel, texto);
  if (!p) return false;
  if (dedo) {
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await raton("mouseMoved", p, false);
    await raton("mousePressed", p, true);
    await raton("mouseReleased", p, false);
  }
  return true;
}
/** Escribe en un campo de React (un `input` o `textarea`) como si se tipeara. */
const escribir = (sel, texto, indice = 0) =>
  en(
    (sel, texto, indice) => {
      const el = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length)[indice];
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, texto);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    sel,
    texto,
    indice,
  );

// --- Lo que se ve ---
const numerito = () => en(() => document.querySelector('.pie button[aria-label^="Tablero"] .pie-n')?.textContent ?? null);
const abrirTablero = async () => {
  await en(() => document.querySelector('.pie button[aria-label^="Tablero"]')?.click());
  return hasta(() => !!document.querySelector(".pd .tb-vistas"), "el tablero nuevo");
};
const filas = () => en(() => [...document.querySelectorAll(".pd-fila")].map((f) => ({ nombre: f.querySelector(".pd-nombre")?.textContent ?? "", texto: f.querySelector(".pd-nums")?.textContent ?? "" })));
const abrirProyecto = async (nombre) => {
  await hasta((nombre) => [...document.querySelectorAll(".pd-fila")].some((f) => f.textContent.includes(nombre)), "la fila", nombre);
  return (await tocar(".pd-fila", nombre)) && hasta(() => !!document.querySelector(".pd-proy"), "el proyecto");
};
const card = (titulo) => en((t) => !![...document.querySelectorAll(".pd-card")].find((c) => c.querySelector(".pd-tit")?.textContent.includes(t)), titulo);
/** Marca la tarjeta con ese título para poder apuntarle con un selector. */
const marcarCard = (titulo) =>
  en((t) => {
    document.querySelectorAll("[data-card]").forEach((e) => e.removeAttribute("data-card"));
    const c = [...document.querySelectorAll(".pd-card")].find((c) => c.querySelector(".pd-tit")?.textContent.includes(t));
    c?.setAttribute("data-card", "");
    return !!c;
  }, titulo);
const enCard = async (titulo, sel, texto = null) => (await marcarCard(titulo)) && tocar(`[data-card] ${sel}`, texto);
const textoPie = () => en(() => document.querySelector(".pd-mandar")?.textContent.trim() ?? null);
const mandarHabilitado = () => en(() => !document.querySelector(".pd-mandar")?.disabled);
const cajas = () => en(() => [...document.querySelectorAll(".caja textarea")].filter((t) => t.getClientRects().length).map((t) => t.value));
const caja = async () => (await cajas())[0] ?? null;
async function tecla(key, vk) {
  for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: vk });
}

try {
  await lanzar();
  ok(await hasta(() => document.querySelectorAll(".pie button").length >= 4, "el pie"), "la app abrió");

  // --- El número del pie ---
  ok(await hasta((t) => document.querySelector('.pie button[aria-label^="Tablero"] .pie-n')?.textContent === String(t), "el numerito", TOTAL), `el botón del Tablero muestra cuántas cosas te esperan (${await numerito()})`);
  ok(await en(() => /te esperan/.test(document.querySelector('.pie button[aria-label^="Tablero"]').getAttribute("aria-label"))), "y su etiqueta lo dice con palabras");

  // --- La lista de proyectos ---
  ok(await abrirTablero(), "el Tablero abre en la vista nueva (no en el kanban)");
  ok(await en(() => document.querySelector(".pd .tb-vistas button[aria-selected=true]")?.textContent === "Te esperan" && !document.querySelector(".tb-cols")), "con 'Te esperan' elegida");
  await hasta(() => document.querySelectorAll(".pd-fila").length === 2, "dos proyectos");
  let fs = await filas();
  ok(fs.length === 2 && fs[0].nombre === "atlas" && fs[1].nombre === "faro-web", `la lista agrupa por proyecto, el que más espera primero (${fs.map((f) => f.nombre).join(", ")})`);
  ok(/3 preguntas/.test(fs[0].texto) && /2 pruebas/.test(fs[0].texto) && /1 pregunta\b/.test(fs[1].texto), `con sus cuentas (${fs.map((f) => f.texto).join(" | ")})`);
  await foto("1-lista");

  // --- Un proyecto: nada se mezcla, lo viejo sale corto, la sugerida no cuenta ---
  ok(await abrirProyecto("atlas"), "clic en atlas");
  ok(!(await card("Cambiamos el logo")), "las cosas de otro proyecto no aparecen");
  ok((await card("Cómo ordenamos los mapas")) && (await card("Subimos la versión ahora")) && (await card("Probar la exportación")) && (await card("Probar el zoom")), "están sus preguntas y pruebas con las palabras simples");
  ok(await en(() => [...document.querySelectorAll(".pd-card")].filter((c) => c.querySelector(".pd-tit").textContent.startsWith("Decidir qué hacemos")).every((c) => c.querySelector(".pd-tit").textContent.length <= 111 && c.querySelector(".pd-tit").textContent.endsWith("…") && !c.querySelector(".pq-op") && !!c.querySelector("input.pd-otra"))), "un item viejo sale con título corto y sólo el campo libre");
  ok(await en(() => document.querySelectorAll(".pd-def").length === 2 && [...document.querySelectorAll(".pd-def")].every((e) => e.textContent === "sugerida")), "las dos preguntas con opción por defecto la marcan 'sugerida'");
  ok(!(await mandarHabilitado()) && (await textoPie()) === "Todavía nada para mandar", "pero sin tocar nada Mandar está apagado: la sugerida no cuenta");
  ok(await en(() => /0 de 3 preguntas · 0 de 2 pruebas/.test(document.querySelector(".pd-pie-n").textContent)), "y el pie cuenta 0 de 3 preguntas · 0 de 2 pruebas");
  ok(await en(() => /no se envía solo/i.test(document.querySelector(".pd-pie-a")?.textContent ?? "")) && (await en(() => /líder nuevo/.test(document.querySelector(".pd-pie-a").textContent))), "y avisa que va a un líder nuevo y no se envía solo");
  await foto("2-proyecto");

  // --- Tocar: una opción, lo libre de un item viejo, anda, no anda con nota ---
  ok(await enCard("Cómo ordenamos los mapas", ".pq-op", "Por nombre"), "clic en una opción");
  ok(await hasta(() => document.querySelector(".pd-mandar")?.textContent.trim() === "Mandar 1 respuesta", "una"), "Mandar cuenta 1 respuesta");
  ok(await en(() => [...document.querySelectorAll(".pd-card")].find((c) => c.querySelector(".pd-tit").textContent.includes("Cómo ordenamos")).querySelector('.pq-op[aria-checked="true"] .pq-l')?.textContent === "Por nombre"), "y la opción queda marcada");
  await marcarCard("Decidir qué hacemos");
  ok(await escribir("[data-card] input.pd-otra", "Migrar de a poco"), "se escribe una respuesta libre en el item viejo");
  ok(await enCard("Probar la exportación", ".pd-res button[data-res=anda]"), "clic en Anda");
  ok(await enCard("Probar el zoom", ".pd-res button[data-res=no-anda]"), "clic en No anda");
  await marcarCard("Probar el zoom");
  ok(await hasta(() => !!document.querySelector("[data-card] input.pd-otra"), "la nota"), "No anda ofrece una nota");
  ok(await escribir("[data-card] input.pd-otra", "Se ve borroso"), "se escribe la nota");
  ok(await hasta(() => document.querySelector(".pd-mandar")?.textContent.trim() === "Mandar 4 respuestas", "cuatro"), "Mandar cuenta 4 respuestas (Subimos la versión no se tocó)");
  ok(await en(() => /2 de 3 preguntas · 2 de 2 pruebas/.test(document.querySelector(".pd-pie-n").textContent)), "y el pie cuenta 2 de 3 preguntas · 2 de 2 pruebas");
  ok(await en(() => !document.querySelector(".pd-avisar, .pd-avisa")), "sin ningún líder vivo en atlas no hay 'Responder y avisar': sólo el flujo de siempre");
  await foto("3-tocado");

  // --- Lo tocado y sin mandar sobrevive a un reinicio ---
  ok(
    await hastaDisco(() => {
      const j = pendientesJson();
      return j && Object.keys(j.q ?? {}).length === 2 && Object.keys(j.p ?? {}).length === 2;
    }, "pendientes.json"),
    "lo tocado queda en pendientes.json (2 preguntas, 2 pruebas)",
  );
  ok(pendientesJson()?.q?.[Q2] === undefined && pendientesJson()?.q?.[Q1]?.op === "b", "sin la sugerida que no se tocó");
  ok([Q1, Q2, Q3, P1, P2].every((id) => !item(id).respuesta), "y todavía ningún item tiene respuesta en el tablero");
  await cerrar();
  await lanzar();
  ok(await hasta(() => document.querySelectorAll(".pie button").length >= 4, "el pie"), "la app volvió a abrir");
  ok(await abrirTablero() && (await abrirProyecto("atlas")), "otra vez en atlas");
  ok(await hasta(() => document.querySelector(".pd-mandar")?.textContent.trim() === "Mandar 4 respuestas", "cuatro después del reinicio"), "las 4 respuestas siguen tocadas");
  ok(
    await en(() => {
      const c = (t) => [...document.querySelectorAll(".pd-card")].find((c) => c.querySelector(".pd-tit").textContent.includes(t));
      return (
        c("Cómo ordenamos").querySelector('.pq-op[aria-checked="true"] .pq-l')?.textContent === "Por nombre" &&
        c("Decidir qué hacemos").querySelector("input.pd-otra").value === "Migrar de a poco" &&
        c("Probar la exportación").querySelector('[data-res=anda][aria-pressed="true"]') !== null &&
        c("Probar el zoom").querySelector("input.pd-otra").value === "Se ve borroso"
      );
    }),
    "con sus opciones, textos y notas",
  );

  // --- Mandar ---
  const antes = lanzados();
  ok(await tocar(".pd-mandar"), "clic en Mandar 4 respuestas");
  ok(await hastaDisco(() => [Q1, Q3, P1, P2].every((id) => item(id).respuesta), "responder"), "cada item tocado tiene su respuesta en el tablero (`tablero responder`)");
  const r = (id) => item(id).respuesta;
  ok(r(Q1)?.opcion === "b" && r(Q1)?.opcion_texto === "Por nombre", "la pregunta con su opción");
  ok(r(Q3)?.texto === "Migrar de a poco", "el item viejo con su texto");
  ok(r(P1)?.anda === true && r(P2)?.anda === false && (r(P2)?.texto ?? r(P2)?.nota ?? "").includes("Se ve borroso"), "las pruebas con anda / no anda y la nota");
  ok(!item(Q2).respuesta && !item(Q4).respuesta, "y lo que no se tocó, sin respuesta (ni la sugerida)");
  ok([Q1, Q3, P1, P2].every((id) => item(id).columna === "espera-dueno"), "mandar no mueve ni cierra: siguen en espera-dueno");
  ok(await hasta(() => !document.querySelector(".pd") && !!document.querySelector(".caja textarea"), "la caja del líder nuevo"), "se abre un líder nuevo y el Tablero se cierra");
  let c = await caja();
  ok(!!c && [Q1, Q3, P1, P2].every((id) => c.includes(`#${id} `)), "la caja tiene el mensaje con el id de cada item tocado");
  ok(!!c && !c.includes(`#${Q2} `) && !c.includes(`#${Q4} `), "y ninguno de los que no se tocaron");
  ok(!!c && /tablero cerrar <id>/.test(c.split("\n").at(-1)) && c.trimEnd().split("\n").at(-1).includes(`#${Q1}, #${Q3}, #${P1}, #${P2}`), "termina pidiendo cerrar cada uno con `tablero cerrar <id>`");
  ok(!!c && c.includes("Por nombre") && c.includes("Migrar de a poco") && c.includes("NO anda") && c.includes("Se ve borroso"), "y dice qué contestó Ana en cada uno");
  await espera(400);
  ok(lanzados() === antes && !existsSync(env.TRAMA_FALSO_DICHO), "no se envió: no se lanzó ningún líder ni le llegó nada");
  await foto("4-caja");
  ok(pendientesJson() === null || (Object.keys(pendientesJson().q ?? {}).length === 0 && Object.keys(pendientesJson().p ?? {}).length === 0), "y lo tocado dejó de figurar en pendientes.json");

  // --- Mandadas: salen de "Te esperan" ---
  ok(await hasta((t) => document.querySelector('.pie button[aria-label^="Tablero"] .pie-n')?.textContent === String(t), "el numerito baja", TOTAL - 4), `el numerito del pie baja a ${TOTAL - 4} (${await numerito()})`);
  await abrirTablero();
  fs = await filas();
  ok(fs[0]?.nombre === "atlas" && /1 pregunta(?!s)/.test(fs[0].texto) && !/prueba/.test(fs[0].texto) && /4 mandadas/.test(fs[0].texto), `en la lista atlas espera 1 y tiene 4 mandadas (${fs[0]?.texto})`);
  await abrirProyecto("atlas");
  ok(!(await card("Cómo ordenamos los mapas")) && (await card("Subimos la versión ahora")), "adentro sólo queda lo que no se contestó");
  ok(await en(() => /0 de 1 preguntas · 0 de 0 pruebas|0 de 1 pregunta/.test(document.querySelector(".pd-pie-n").textContent)), "y el pie cuenta sólo lo pendiente");
  ok(await tocar(".pd-mand-t"), "clic en 'Mandadas (4)'");
  ok(await hasta(() => document.querySelectorAll(".pd-card[data-mandada]").length === 4, "mandadas"), "se despliegan las 4, atenuadas");
  ok(await en(() => [...document.querySelectorAll(".pd-card[data-mandada] .pd-ctx")].some((e) => e.textContent === "Dijiste: Por nombre")), "cada una dice lo que se contestó");
  await foto("5-mandadas");
  ok(await enCard("Probar el zoom", ".pd-dejar"), "clic en 'Volver a contestar'");
  ok(await hastaDisco(() => !item(P2).respuesta, "borrar"), "se borra la respuesta en el tablero (`tablero responder --borrar`)");
  ok(await hasta(() => document.querySelectorAll(".pd-card[data-mandada]").length === 3 && [...document.querySelectorAll(".pd-card")].some((c) => c.querySelector(".pd-tit").textContent.includes("Probar el zoom") && !c.hasAttribute("data-mandada")), "vuelve"), "la prueba vuelve a 'Te esperan'");
  ok(await hasta((t) => document.querySelector('.pie button[aria-label^="Tablero"] .pie-n')?.textContent === String(t), "numerito sube", TOTAL - 3), `y el numerito sube a ${TOTAL - 3} (${await numerito()})`);

  // --- Un líder que ya existe: se manda lo que había en su caja y se suma debajo ---
  await tecla("Escape", 27);
  await hasta(() => !document.querySelector(".pd"), "panel cerrado");
  ok(await hasta(() => !!document.querySelector(".caja textarea"), "la caja"), "la caja del líder nuevo sigue con su mensaje");
  const primera = await caja();
  await en(() => [...document.querySelectorAll(".caja textarea")].find((t) => t.getClientRects().length)?.focus());
  await tecla("Enter", 13);
  ok(await hastaDisco(() => lanzados() === antes + 1, "claude"), "se envía a mano: ahora sí se lanza el líder (falso)");
  ok(await hasta(() => !!document.querySelector(".lider[data-activa]"), "el líder"), "y queda un líder abierto");
  const L = await en(() => document.querySelector(".lider[data-activa]")?.dataset.lider);
  const recibidos = () => {
    try {
      return readFileSync(env.TRAMA_FALSO_DICHO, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.sid === L).map((m) => m.texto);
    } catch {
      return [];
    }
  };
  ok(await hastaDisco(() => recibidos().length === 1, "recibido"), "le llegó el mensaje");
  ok(recibidos()[0]?.trimEnd() === primera?.trimEnd(), "tal cual estaba armado en la caja");
  await hasta(() => [...document.querySelectorAll(".conv-zona")].some((z) => z.clientHeight > 0 && [...z.querySelectorAll(".conv .el")].some((e) => e.textContent.includes("eco:"))), "la respuesta del líder");
  ok(await escribir(".caja textarea", "lo mío"), "se escribe algo en su caja sin enviarlo");
  await espera(200);
  await abrirTablero();
  ok(await abrirProyecto("atlas"), "otra vez en atlas");
  ok(await enCard("Subimos la versión ahora", ".pq-op", "Más tarde"), "se toca una opción");
  const avisoPie = await en(() => document.querySelector(".pd-pie-a")?.textContent ?? "");
  ok(/Abre el chat de/.test(avisoPie), `el pie dice que va al chat de ese líder (${avisoPie.slice(0, 40)})`);
  await tocar(".pd-mandar");
  ok(await hastaDisco(() => item(Q2).respuesta?.opcion === "c", "Q2"), "se guarda la respuesta");
  ok(await hasta(() => !document.querySelector(".pd") && !!document.querySelector(".lider[data-activa]"), "el líder"), "se abre el chat del líder que ya existía");
  ok(await en((L) => document.querySelector(".lider[data-activa]")?.dataset.lider === L, L), "el mismo");
  c = await caja();
  ok(!!c && c.startsWith("lo mío") && c.includes(`#${Q2} `) && c.includes("Más tarde"), "y la caja tiene lo suyo y el mensaje nuevo debajo, sin pisar");
  ok(lanzados() === antes + 1 && recibidos().length === 1, "sin enviar: sigue un solo líder y un solo mensaje recibido");

  // --- La otra pestaña: el kanban de siempre ---
  await abrirTablero();
  ok(await tocar(".pd .tb-vistas button", "Todo"), "clic en 'Todo'");
  ok(await hasta(() => !!document.querySelector(".tb-cols .tb-card"), "el kanban"), "'Todo' es el kanban de siempre");
  await foto("6-todo");
  await tocar(".pd .tb-vistas button", "Te esperan");
  await hasta(() => !!document.querySelector(".pd-lista-zona, .pd-proy"), "volver");

  // --- Con el dedo, a 360 px ---
  const nuevaQ = agregar("--proyecto=faro-web", "--tipo=pregunta", "--simple=Dónde va el botón", "--opcion=Arriba", "--opcion=Abajo", "--defecto=2", "--", "Botón");
  const nuevaP = agregar("--proyecto=faro-web", "--tipo=prueba", "--simple=Probar el menú", "--prueba=faro --menu", "--", "Menú");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  dedo = true;
  await espera(300);
  const chico = () =>
    en((dedo) => {
      const mal = [];
      if (document.documentElement.scrollWidth > innerWidth) mal.push(`documento: ${document.documentElement.scrollWidth}`);
      for (const el of document.querySelectorAll(".pd button, .pd input, .pd [role=radio]")) {
        if (!el.getClientRects().length) continue;
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 1 || r.left < -1) mal.push(`${el.className || el.tagName} se sale (${Math.round(r.left)}..${Math.round(r.right)})`);
        if (r.height < dedo && !el.classList.contains("tb-copiar") && !el.classList.contains("pd-dejar")) mal.push(`${el.className || el.tagName} mide ${Math.round(r.height)} px`);
      }
      return mal.slice(0, 6);
    }, 43);
  ok(await numerito(), "a 360 px el pie sigue mostrando el numerito");
  await en(() => document.querySelector('.pie button[aria-label^="Tablero"]')?.scrollIntoView());
  ok(await tocar('.pie button[aria-label^="Tablero"]'), "toque en el botón del Tablero");
  ok(await hasta(() => !!document.querySelector(".pd .tb-vistas"), "el tablero a 360"), "abre 'Te esperan'");
  ok(await hasta(() => [...document.querySelectorAll(".pd-fila")].some((f) => f.textContent.includes("faro-web") && /2 preguntas/.test(f.textContent)), "faro con 2 preguntas"), "faro-web ya tiene 2 preguntas y 1 prueba");
  let mal = await chico();
  ok(mal.length === 0, `la lista: nada se sale y todo mide para el dedo${mal.length ? `: ${mal.join(" | ")}` : ""}`);
  await foto("7-celular-lista");
  ok(await abrirProyecto("faro-web"), "toque en faro-web");
  await espera(250);
  mal = await chico();
  ok(mal.length === 0, `el proyecto: nada se sale y todo mide para el dedo${mal.length ? `: ${mal.join(" | ")}` : ""}`);
  ok(await enCard("Dónde va el botón", ".pq-op", "Arriba"), "toque en una opción");
  ok(await enCard("Probar el menú", ".pd-res button[data-res=anda]"), "toque en Anda");
  ok(await hasta(() => document.querySelector(".pd-mandar")?.textContent.trim() === "Mandar 2 respuestas", "dos"), "Mandar cuenta 2");
  ok(
    await en(() => {
      const r = document.querySelector(".pd-mandar").getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.height >= 43;
    }),
    "y Mandar queda siempre a la vista, grande",
  );
  await foto("8-celular-proyecto");
  ok(await tocar(".pd-mandar"), "toque en Mandar");
  ok(await hastaDisco(() => item(nuevaQ).respuesta?.opcion === "a" && item(nuevaP).respuesta?.anda === true, "faro"), "se guardan las dos respuestas");
  ok(await hasta(() => !document.querySelector(".pd") && !!document.querySelector(".caja textarea"), "la caja a 360"), "se abre el líder nuevo de faro con la caja a la vista");
  c = await caja();
  ok(!!c && c.includes(`#${nuevaQ} `) && c.includes(`#${nuevaP} `) && !c.includes(`#${Q4} `) && !c.includes(`#${Q2} `), "con sólo lo tocado de faro");
  await foto("9-celular-caja");
  ok(lanzados() === antes + 1, "y sin enviar");

  // --- Responder y avisar: a un líder vivo del proyecto, sólo al tocar ---
  await cdp("Emulation.clearDeviceMetricsOverride");
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  dedo = false;
  await espera(300);
  const recibidosDe = (sid) => {
    try {
      return readFileSync(env.TRAMA_FALSO_DICHO, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.sid === sid).map((m) => m.texto);
    } catch {
      return [];
    }
  };
  const Q5 = agregar("--proyecto=atlas", "--tipo=pregunta", "--simple=Cómo llamamos a la capa", "--opcion=Capa base", "--opcion=Capa fina", "--", "Nombre de la capa");
  const Q6 = agregar("--proyecto=atlas", "--tipo=pregunta", "--simple=Qué formato de fecha", "--opcion=Día primero", "--opcion=Año primero", "--", "Formato de fecha");
  const esperarCard = (t) => hasta((t) => [...document.querySelectorAll(".pd-card")].some((c) => c.querySelector(".pd-tit")?.textContent.includes(t)), `la tarjeta ${t}`, t);
  const hayAvisar = () => en(() => !!document.querySelector(".pd-avisar"));
  const textoAvisar = () => en(() => document.querySelector(".pd-avisar")?.textContent.trim() ?? null);
  const enAtlas = async () => {
    await abrirTablero();
    return abrirProyecto("atlas");
  };

  // Con uno: el líder de atlas que dejó el Mandar de arriba (L, Sesión jefe).
  await tecla("Escape", 27);
  ok(await enAtlas(), "otra vez en atlas, con un líder en su carpeta");
  ok((await esperarCard("Cómo llamamos a la capa")) && (await enCard("Cómo llamamos a la capa", ".pq-op", "Capa fina")), "se toca una opción de la pregunta nueva");
  ok(await hasta(() => !!document.querySelector(".pd-avisar"), "el botón"), "con un líder vivo en la carpeta la tarjeta ofrece 'Responder y avisar'");
  const txt1 = await textoAvisar();
  ok(/^Responder y avisar a \S+/.test(txt1 ?? "") && !(await en(() => !!document.querySelector(".pd-avisa-d"))), `dice a quién (${txt1}) y con uno solo no hay selector`);
  await foto("10-avisar-uno");
  const antesL = recibidosDe(L).length;
  await espera(400);
  ok(recibidosDe(L).length === antesL && !item(Q5).respuesta, "tocar una opción no manda nada ni guarda nada: falta tocar el botón");
  ok((await en(() => document.querySelectorAll(".pd-avisar").length)) === 1, "el botón aparece una sola vez (sólo en la tarjeta contestada)");
  ok(await tocar(".pd-avisar"), "clic en 'Responder y avisar'");
  ok(await hastaDisco(() => item(Q5).respuesta?.opcion === "b", "Q5"), "la respuesta queda en el tablero (`tablero responder`)");
  ok(await hastaDisco(() => recibidosDe(L).length === antesL + 1, "aviso"), "y el líder recibe un mensaje más");
  const aviso = recibidosDe(L)[antesL] ?? "";
  ok(aviso.includes(`#${Q5} `) && aviso.includes("Capa fina") && aviso.includes(`tablero cerrar ${Q5}`) && aviso.split("\n").length <= 3, "corto: el item, lo que contestó Ana y cómo cerrarlo");
  ok(item(Q5).columna === "espera-dueno", "avisar no cierra el item: lo cierra el líder");
  ok(await hasta(() => !!document.querySelector(".pd") && /ya sabe/.test(document.querySelector(".pd-pie-a")?.textContent ?? ""), "avisado"), "el Tablero sigue abierto y el pie dice que ya sabe");
  ok(await hasta((t) => ![...document.querySelectorAll(".pd-card:not([data-mandada])")].some((c) => c.querySelector(".pd-tit")?.textContent.includes(t)), "pasó a Mandadas", "Cómo llamamos a la capa"), "la pregunta salió de 'Te esperan' (pasó a Mandadas)");
  await foto("11-avisado");

  // Con varios: se elige a cuál. Un segundo líder en la carpeta atlas, creado como lo hace Iniciar (líder + su carpeta).
  await espera(1100);
  const A1 = await en(async () => {
    const s = await window.hilos.lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola A1" });
    await window.hilos.nombres.proyecto(s, "atlas");
    return s;
  });
  ok(!!A1 && A1 !== L && (await hastaDisco(() => recibidosDe(A1).length >= 1, "A1")), "un segundo líder en la carpeta atlas");
  // La barra lee las carpetas de nombres.json al arrancar: se recarga para que vea la del líder nuevo.
  await cdp("Page.reload");
  await espera(500);
  ok(await hasta(() => document.querySelectorAll(".pie button").length >= 4, "el pie"), "la ventana recargada");
  ok(await enAtlas(), "otra vez en atlas");
  ok((await esperarCard("Qué formato de fecha")) && (await enCard("Qué formato de fecha", ".pq-op", "Año primero")), "se toca una opción de la otra pregunta");
  ok(await hasta(() => !!document.querySelector(".pd-avisa-d .pbtn") && !!document.querySelector(".pd-avisar"), "selector"), "con dos líderes aparece el selector y el botón sin nombre");
  ok(/^Responder y avisar$/.test((await textoAvisar()) ?? ""), `el botón no elige por Ana (${await textoAvisar()})`);
  await foto("12-avisar-varios");
  ok(await tocar(".pd-avisa-d .pbtn"), "se abre el selector");
  const opciones = await hasta(() => {
    const o = [...document.querySelectorAll(".pd-avisa-d .op")].map((o) => o.getAttribute("aria-selected"));
    return o.length === 2 ? o : null;
  }, "las opciones");
  ok(!!opciones, "con un renglón por líder");
  ok(await tocar(".pd-avisa-d .op[aria-selected=false]"), "se elige el otro, no el de entrada");
  await espera(300);
  const antesA = [recibidosDe(L).length, recibidosDe(A1).length];
  ok(await tocar(".pd-avisar"), "clic en 'Responder y avisar a …'");
  ok(await hastaDisco(() => item(Q6).respuesta?.opcion === "b", "Q6"), "la respuesta queda en el tablero");
  await hastaDisco(() => recibidosDe(L).length + recibidosDe(A1).length === antesA[0] + antesA[1] + 1, "uno recibió");
  const delta = [recibidosDe(L).length - antesA[0], recibidosDe(A1).length - antesA[1]];
  ok(delta[0] + delta[1] === 1, `le llega a uno solo (${delta.join(" / ")})`);
  const elElegido = delta[0] === 1 ? L : A1;
  ok(elElegido === L && (recibidosDe(elElegido).at(-1) ?? "").includes(`#${Q6} `), "y es el que se eligió (no el de entrada, el más reciente), con el item y la respuesta");
} catch (e) {
  ok(false, String(e?.stack ?? e));
} finally {
  await cerrar();
  console.log(`tablero temporal: ${env.TABLERO_DIR}`);
  console.log(fallas ? `${fallas} fallas` : "todo ok");
  process.exit(fallas ? 1 : 0);
}
