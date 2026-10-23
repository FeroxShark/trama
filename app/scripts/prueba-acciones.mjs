#!/usr/bin/env node
// Prueba de punta a punta de las acciones con el `pa` y el `claude` falsos: abre
// la app offscreen (HILOS_PRUEBA, sin ventana), la maneja por CDP como lo haría
// Ana (Ctrl+N, escribir, elegir en los selectores, clics, Esc) y verifica el
// argv que anotaron scripts/pa-falso.sh y scripts/claude-falso.mjs. Desde B12:
// Ctrl+N abre un líder, el worker se lee nomás (Parar, Pasárselo a un líder) y
// los gatillos del claude falso dan los avisos en línea. El Archivar de un líder de
// terminal (esconderlo sin tocar su proceso) lo cubre tests/arbol.test.ts. Nada
// toca `pa` de verdad: PA_STATE, HILOS_STATE, el perfil de Chromium y el
// registry son temporales.
//   npm run build && node scripts/prueba-acciones.mjs
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-acciones-"));
// HOME y XDG vacíos en /tmp, como manda CLAUDE.md (prueba-todas ya lo hace). Si la app ve el HOME de verdad,
// electron/aislar.ts le da otro: el líder en `~` tiene que correr donde corre esta prueba (`os.homedir()`).
const casa = path.join(tmp, "casa");
mkdirSync(casa);
Object.assign(process.env, {
  HOME: casa,
  XDG_CONFIG_HOME: path.join(casa, ".config"),
  XDG_DATA_HOME: path.join(casa, ".local/share"),
  XDG_CACHE_HOME: path.join(casa, ".cache"),
  XDG_STATE_HOME: path.join(casa, ".local/state"),
});
const log = path.join(tmp, "pa-falso.log");
const logClaude = path.join(tmp, "claude-falso.log");
const logNpm = path.join(tmp, "npm-falso.log");
const puerto = 9300 + Math.floor(Math.random() * 600);
// "Atlas Web" vive en la carpeta atlas: `pa --hilos` dice "atlas", `pa <proy>` necesita "Atlas Web".
for (const d of ["atlas", "brote"]) mkdirSync(path.join(tmp, "proy", d), { recursive: true });
// El PA_STATE de mentira existe desde antes: la app mira su eventos.jsonl desde que arranca.
mkdirSync(path.join(tmp, "pa"));
// Un statusline de mentira (de una sesión que no vive: sólo da el uso del plan). 5 h en ámbar y la
// semana en rojo, con el reinicio más largo de escribir ("se reinicia en 23 h 50 min").
mkdirSync(path.join(tmp, "pa", "statusline"));
{
  const ahora = Math.floor(Date.now() / 1000);
  const rate_limits = {
    five_hour: { used_percentage: 74, resets_at: ahora + 4 * 3600 },
    seven_day: { used_percentage: 93, resets_at: ahora + 23 * 3600 + 50 * 60 },
  };
  writeFileSync(path.join(tmp, "pa", "statusline", "s-uso-falso.json"), JSON.stringify({ version: 1, ts: ahora, rate_limits }));
}
writeFileSync(
  path.join(tmp, "registry.json"),
  JSON.stringify({
    projects: [
      { name: "Atlas Web", path: path.join(tmp, "proy", "atlas"), desc: "La web", tests: "npm test" },
      { name: "brote", path: path.join(tmp, "proy", "brote"), desc: "El jardín" },
    ],
  }),
);

// El umbral del anillo de contexto (B16): un settings.json de mentira, nunca el de ~/.claude.
const settings = path.join(tmp, "settings.json");
writeFileSync(settings, JSON.stringify({ autoCompactWindow: 200_000 }));
// El del relevo de un líder: el plan de `pa` de mentira (max: 200 mil), sin AVISO_CONTEXTO.
const plan = path.join(tmp, "plan");
writeFileSync(plan, "max\n");

// El líder "ana-prueba" es este mismo proceso: una sesión interactiva viva
// (pid y arranque reales) en la carpeta de brote. Lanzó 33333 y 44444.
const sesiones = path.join(tmp, "sesiones");
mkdirSync(sesiones);
const arranque = Number(readFileSync("/proc/self/stat", "utf8").split(") ").at(-1).split(" ")[19]);
writeFileSync(
  path.join(sesiones, `${process.pid}.json`),
  JSON.stringify({
    pid: process.pid,
    sessionId: "s-falso-lider",
    cwd: path.join(tmp, "proy", "brote"),
    kind: "interactive",
    entrypoint: "cli",
    name: "ana-prueba",
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    procStart: arranque,
  }),
);

const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
  env: {
    ...process.env,
    HILOS_PRUEBA: "90",
    HILOS_FIXTURES: "0",
    HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
    PA_FALSO_LOG: log,
    // B22: 13131 choca con main (80, se actualiza y entra), 14141 da tests rojos.
    PA_FALSO_INTEGRAR: "13131:80,14141:93",
    PA_STATE: path.join(tmp, "pa"),
    HILOS_STATE: path.join(tmp, "hilos"),
    HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
    PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
    HILOS_SESIONES: sesiones,
    HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
    HILOS_CLAUDE_SETTINGS: settings,
    HILOS_PA_PLAN: plan,
    AVISO_CONTEXTO: "",
    TRAMA_FALSO_LOG: logClaude,
    HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
    HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
    NPM_FALSO_LOG: logNpm,
  },
  stdio: process.env.PRUEBA_VERBOSO ? "inherit" : "ignore",
});

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// Si la app se cierra sola (HILOS_PRUEBA: 90 s) o se cae, el CDP no contesta nunca más y el script
// terminaba mudo (código 13, "unsettled top-level await"): que diga qué pasó y falle.
app.on("exit", (codigo, senal) => {
  if (cerrando) return;
  console.log(`FALLA la app se cerró sola a mitad de la prueba (código ${codigo}, señal ${senal})`);
  process.exit(1);
});
let cerrando = false;
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
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "error en la página");
  return r.result?.result?.value;
}

/** Espera hasta que `fn` devuelva algo verdadero (tope 15 s). */
async function hasta(fn, que, ...args) {
  for (let i = 0; i < 150; i++) {
    const v = await en(fn, ...args).catch(() => null);
    if (v) return v;
    await espera(100);
  }
  console.log(`      (se esperó en vano: ${que})`);
  return null;
}

const lineas = () => {
  try {
    return readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
};
/** Lo que no es leer (`--hilos`, `--hilo`). */
const acciones = () => lineas().filter((l) => !/ --hilos?( |$)/.test(l));
async function nuevas(desde) {
  for (let i = 0; i < 80 && acciones().length === desde; i++) await espera(100);
  return acciones().slice(desde).join("\n");
}

const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9, Home: 36, End: 35 };
async function tecla(key, modifiers = 0) {
  const k = { key, modifiers, code: key.length === 1 ? `Key${key.toUpperCase()}` : key };
  k.windowsVirtualKeyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : VK[key];
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
}
const CTRL = 2;
const SHIFT = 8;

/** Escribir en un campo de React: el setter nativo y un evento input. */
const escribir = (sel, texto) =>
  en(
    (sel, texto) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, texto);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    sel,
    texto,
  );

/** Clic en el primer `sel` que contenga `texto` (si se da). */
const clic = (sel, texto = null) =>
  en(
    (sel, texto) => {
      const el = [...document.querySelectorAll(sel)].find((e) => texto === null || e.textContent.includes(texto));
      if (!el || el.disabled) return false;
      el.click();
      return true;
    },
    sel,
    texto,
  );

/** Abre el selector número `i` de `zona` y elige la opción que dice `opcion`. */
async function elegir(zona, i, opcion) {
  await en((zona, i) => document.querySelectorAll(`${zona} .pick > .pbtn`)[i]?.click(), zona, i);
  await hasta(() => !!document.querySelector('[role="option"]'), "menú abierto");
  return clic('[role="option"]', opcion);
}

try {
  ok(await hasta(() => document.querySelectorAll("[data-fila]").length >= 4, "filas"), "llegan las filas de pa-falso --hilos");

  // --- El árbol: el líder vivo con su worker vivo; lo que terminó se esconde solo (B15) ---
  ok(
    await hasta(
      () => document.querySelector('.lider[data-lider="s-falso-lider"]')?.textContent.includes("ana-prueba"),
      "líder",
    ),
    "el líder vivo aparece con su nombre",
  );
  const cuelgan = (ids) => ids.every((id) => !!document.querySelector(`[data-fila="${id}"]`)?.closest(".arbol")?.querySelector(".lider"));
  const sinFila = (ids) => ids.every((id) => !document.querySelector(`[data-fila="${id}"]`));
  const TERMINADOS = ["20261003-100200-33333", "20261003-100500-77777"];
  // "Sólo líderes": el "+N" de su fila. La vista de todo: "N terminados" (en inglés "N done", la app arranca en inglés)
  // al final de sus workers, en `.pliegue`.
  const mas = '.mas[data-mas-lider="s-falso-lider"]';
  const pliegue = '.arbol:has([data-lider="s-falso-lider"]) .pliegue .mini-pliegue';
  // Con `hasta`: al aparecer el líder, las filas que estaban como huérfanas salen animadas y un rato hay dos.
  ok(await hasta(cuelgan, "worker bajo el líder", ["20261003-100300-44444"]), "su worker vivo cuelga de él");
  ok(await hasta(sinFila, "terminados sin fila", TERMINADOS), "los que terminaron bajo el líder no tienen fila");
  ok(await hasta((s) => document.querySelector(s)?.textContent.trim().startsWith("2 "), "2 terminados", pliegue), 'el líder los cuenta: "2 terminados"');
  await clic(pliegue);
  ok(await hasta(cuelgan, "desplegados", TERMINADOS), "un clic en los 2 terminados los despliega bajo su líder");
  await clic(pliegue);
  ok(await hasta(sinFila, "plegados", TERMINADOS), "otro clic los vuelve a esconder");
  ok(await en(sinFila, ["20261003-100100-22222"]), "lo terminado sin rama y sin líder también se esconde");
  ok(
    await en(() => !!document.querySelector('[data-fila="20261003-100400-66666"]') && !!document.querySelector('[data-fila="20261003-100000-11111"]')),
    "una rama con commits sin integrar y sin líder vivo queda a la vista",
  );
  // --- Clic derecho (B20): el menú de la fila, renombrar en línea y el de la carpeta ---
  const F6 = '[data-fila="20261003-100400-66666"]';
  const derecho = (sel) =>
    en((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 }));
      return true;
    }, sel);
  const opciones = () => en(() => [...document.querySelectorAll('[role="menu"] [data-accion]')].map((e) => e.dataset.accion));
  ok(await derecho(`${F6} .wbtn`), "clic derecho en una fila terminada con rama");
  ok(await hasta(() => !!document.activeElement?.closest('[role="menu"]'), "menú"), "abre el menú con el foco adentro");
  const ops6 = (await opciones()).join(" ");
  ok(ops6.includes("renombrar") && ops6.includes("copiar") && ops6.includes("borrar") && ops6.includes("descartar") && !ops6.includes("parar"), `acciones de la fila: ${ops6}`);
  await tecla("ArrowDown");
  ok(await en(() => document.activeElement?.dataset.accion !== undefined && document.activeElement !== document.querySelector('[role="menu"] [role="menuitem"]')), "↓ mueve el foco");
  await clic('[role="menu"] [data-accion="renombrar"]');
  ok(await hasta(() => document.activeElement?.classList.contains("renombre"), "campo"), "Renombrar abre el campo en línea, con el foco");
  ok(await en(() => !document.querySelector('[role="menu"]')), "y cierra el menú");
  await escribir("input.renombre", "Título de Ana");
  await tecla("Enter");
  ok(await hasta((s) => document.querySelector(`${s} .l1 .t`)?.textContent === "Título de Ana", "título", F6), "Enter guarda: la fila muestra el título nuevo");
  const nombresJson = () => {
    try {
      return JSON.parse(readFileSync(path.join(tmp, "hilos", "nombres.json"), "utf8"));
    } catch {
      return null;
    }
  };
  for (let i = 0; i < 30 && nombresJson()?.titulos?.["20261003-100400-66666"] !== "Título de Ana"; i++) await espera(100);
  ok(nombresJson()?.titulos?.["20261003-100400-66666"] === "Título de Ana", `nombres.json lo guarda: ${JSON.stringify(nombresJson())}`);
  await derecho(`${F6} .wbtn`);
  await hasta(() => !!document.querySelector('[role="menu"] [data-accion="renombrar"]'), "menú otra vez");
  await clic('[role="menu"] [data-accion="renombrar"]');
  await hasta(() => document.activeElement?.classList.contains("renombre"), "campo otra vez");
  await escribir("input.renombre", "otra cosa");
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector("input.renombre"), "sin campo"), "Esc cancela");
  ok(await en((s) => document.querySelector(`${s} .l1 .t`)?.textContent === "Título de Ana", F6), "y deja el título como estaba");
  await derecho(`${F6} .wbtn`);
  await hasta(() => !!document.querySelector('[role="menu"] [data-accion="renombrar"]'), "menú, tercera");
  ok(await clic('[role="menu"] [data-accion="renombrar"]'), "Renombrar otra vez");
  await hasta(() => document.activeElement?.classList.contains("renombre"), "campo, tercera");
  await escribir("input.renombre", "");
  await tecla("Enter");
  ok(await hasta((s) => document.querySelector(`${s} .l1 .t`)?.textContent === "Rama para descartar", "original", F6), "vacío vuelve a la tarea de pa");
  ok(await derecho('[data-carpeta="cauce"]'), "clic derecho en la carpeta");
  await hasta(() => !!document.querySelector('[role="menu"] [data-accion]'), "menú de carpeta");
  const opsC = (await opciones()).join(" ");
  // De fábrica el orden de la barra es por prioridad: la carpeta ofrece "Orden fijo" y no Subir / Bajar (docs/estado/orden-prioridad.md).
  ok(opsC === "nueva ocultar prioridad", `la carpeta ofrece Nueva tarea aquí, Ocultar terminados y Orden fijo (de fábrica, por prioridad): ${opsC}`);
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector('[role="menu"]'), "cerrado"), "Esc cierra el menú");
  // --- Claude Code nuevo: el falso dice 2.1.287, el npm falso 2.1.300 -------------------
  ok(await hasta(() => document.querySelector(".avc-b")?.textContent === "Claude Code 2.1.300 available", "aviso"), "el pie avisa Claude Code 2.1.300");
  await en(() => document.querySelector(".avc-b").click());
  ok(
    await hasta(() => document.querySelector(".avc-g .avc-v")?.textContent.replace(/\s+/g, "") === "2.1.287→2.1.300", "globito"),
    "el globito dice instalada → nueva",
  );
  // B23: Actualizar corre `claude update` (el falso pasa a 2.1.300) y dice qué sigue, en el mismo globito.
  ok(await clic(".avc-u", "Update"), "Update en el globito");
  ok(await hasta(() => document.querySelector(".avc-ok")?.textContent.includes("2.1.300"), "actualizado"), "dice que quedó en 2.1.300, ahí mismo");
  ok(await en(() => !document.querySelector(".avc-d")), "actualizado, ya no hay Dismiss");
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".avc"), "sin aviso"), "cerrado, el aviso se va del pie");
  const cv = JSON.parse(readFileSync(path.join(tmp, "hilos", "claude-version.json"), "utf8"));
  ok(cv.instalada === "2.1.300" && cv.chequeado > 0, `claude-version.json: ${JSON.stringify(cv)}`);
  ok(readFileSync(logNpm, "utf8").trim().split("\n").length === 1, "a npm se le preguntó una sola vez");
  // --- Idioma: arranca en inglés (no hay nada guardado); Ajustes lo pasa a español al toque ---
  const fila55 = () => document.querySelector('[data-fila="20261003-100400-55555"]')?.textContent ?? "";
  const relojes = () => [...document.querySelectorAll("[data-fila]")].map((f) => f.textContent).join("|");
  ok(await en(fila55).then((t) => t.includes("Needs you")), "sin idioma guardado arranca en inglés (Needs you)");
  ok(/ ago/.test(await en(relojes)), "el reloj de las filas habla en inglés");
  ok(await clic(".pie button", "Settings"), "el pie abre Settings");
  ok(await hasta(() => !!document.querySelector(".pn .pick > .pbtn"), "selector de idioma"), "Settings tiene el selector de idioma");
  // B21: cambiar de idioma no mueve nada. Con los datos ya llegados (la nota), la geometría de Ajustes, del uso y del pie.
  ok(await hasta(() => !!document.querySelector(".pn-nota") && document.querySelectorAll(".pn-dato").length >= 8, "datos de Ajustes"), "Settings trae sus datos");
  const geometria = () =>
    [".pn-nota", ".pn-sec", ".pn-dato", ".pn-nom", ".pn-que", ".pn-h", ".pn .pbtn", ".pn-volver", ".usos", ".uso", ".releer", ".pie button", ".buscar, .busca"]
      .flatMap((s) => [...document.querySelectorAll(s)].map((e) => {
        const r = e.getBoundingClientRect();
        return `${s} ${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`;
      }))
      .join("\n");
  await espera(300); // que termine la entrada del panel (transform)
  const geoEn = await en(geometria);
  ok(await elegir(".pn", 0, "Español"), "se elige Español");
  ok(await hasta(() => document.querySelector(".migas .ruta b")?.textContent === "Ajustes", "título en español"), "el panel cambia a Ajustes sin reiniciar");
  await espera(100);
  const geoEs = await en(geometria);
  const distintas = geoEn.split("\n").flatMap((l, i) => (l === geoEs.split("\n")[i] ? [] : [`${l} → ${geoEs.split("\n")[i]}`]));
  ok(geoEn.split("\n").length > 30 && distintas.length === 0, `ES ↔ EN no mueve nada (${geoEn.split("\n").length} cajas): ${distintas.slice(0, 3).join(" | ")}`);
  ok(await en(fila55).then((t) => t.includes("Te necesita")), "la barra cambia al toque (Te necesita)");
  ok(!/ ago/.test(await en(relojes)), "el reloj repinta en español");
  let prefsIdioma = null;
  for (let i = 0; i < 30 && prefsIdioma !== "es"; i++) {
    try {
      prefsIdioma = JSON.parse(readFileSync(path.join(tmp, "hilos", "preferencias.json"), "utf8")).idioma;
    } catch {}
    if (prefsIdioma !== "es") await espera(100);
  }
  ok(prefsIdioma === "es", `preferencias.json guarda el idioma: ${prefsIdioma}`);

  // --- Tamaño de letra y fuentes (B14): Ajustes y Ctrl+= / Ctrl+- / Ctrl+0; al toque y a preferencias.json ---
  const letraDe = () => ({
    letra: document.documentElement.style.getPropertyValue("--letra"),
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    texto: parseFloat(getComputedStyle(document.querySelector(".app")).fontSize),
    ancho: innerWidth,
    marcado: document.querySelector('.pn-letra [aria-checked="true"]')?.textContent,
  });
  const prefsCon = async (listo) => {
    let p = null;
    for (let i = 0; i < 30; i++) {
      try {
        p = JSON.parse(readFileSync(path.join(tmp, "hilos", "preferencias.json"), "utf8"));
      } catch {}
      if (p && listo(p)) break;
      await espera(100);
    }
    return p;
  };
  const cerca = (a, b) => Math.abs(a - b) < 0.01;
  const l13 = await en(letraDe);
  ok(l13.letra === "13" && l13.rem === 16 && l13.texto === 13 && l13.marcado === "13", `sin nada guardado, letra de 13 px: ${JSON.stringify(l13)}`);
  await tecla("=", CTRL);
  const l14 = await en(letraDe);
  ok(l14.letra === "14" && cerca(l14.texto, 14) && cerca(l14.rem, (16 * 14) / 13), `Ctrl+= agranda la letra a 14 px al toque: ${JSON.stringify(l14)}`);
  ok(l14.ancho === l13.ancho, "Ctrl+= no es el zoom de Chromium (la ventana mide lo mismo en px de CSS)");
  ok(l14.marcado === "14", "Ajustes marca el 14");
  ok((await prefsCon((p) => p.letra === 14))?.letra === 14, "preferencias.json guarda la letra de Ctrl+=");
  ok(await clic(".pn-letra button", "17"), "Ajustes: se elige 17");
  const l17 = await en(letraDe);
  ok(l17.letra === "17" && cerca(l17.texto, 17), `el botón de Ajustes la lleva a 17 px: ${JSON.stringify(l17)}`);
  await tecla("-", CTRL);
  ok((await en(letraDe)).letra === "16", "Ctrl+- la achica un paso (16)");
  for (let i = 0; i < 4; i++) await tecla("=", CTRL);
  ok((await en(letraDe)).letra === "18", "Ctrl+= no pasa de 18");
  ok((await prefsCon((p) => p.letra === 18))?.letra === 18, "preferencias.json guarda 18");
  // B24: la cabecera (marca, uso en su renglón) entra con la letra más grande, y también con la barra en su mínimo.
  const cabecera = () => {
    const entra = (e) => e.scrollWidth <= e.clientWidth;
    const cajas = [...document.querySelectorAll(".top, .cab, .usos, .uso .r")];
    const visto = [...document.querySelectorAll(".uso .cuando")].filter((e) => getComputedStyle(e).display !== "none");
    return {
      usos: document.querySelectorAll(".uso").length,
      logo: !!document.querySelector(".cab svg.logo"),
      botones: document.querySelectorAll(".cab .lado, .usos .releer").length,
      desborda: cajas.filter((e) => !entra(e)).map((e) => e.className),
      cortado: visto.filter((e) => !entra(e)).length,
      corto: visto.length === 2 && visto.every((e) => e.classList.contains("corto")),
      texto: visto.map((e) => e.textContent).join(" | "),
      niveles: [...document.querySelectorAll(".uso")].map((e) => e.dataset.nivel).join(","),
    };
  };
  const teclaTirador = (key, n = 1) =>
    en((key, n) => {
      for (let i = 0; i < n; i++) document.querySelector(".tirador").dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }, key, n);
  let cab = await en(cabecera);
  ok(cab.logo && cab.usos === 2 && cab.botones === 2, `la cabecera trae la marca, los dos usos y sus dos botones: ${JSON.stringify(cab)}`);
  ok(cab.niveles === "ambar,rojo", `74 % va en ámbar y 93 % en rojo: ${cab.niveles}`);
  ok(!cab.corto && !cab.desborda.length && !cab.cortado && /se reinicia en /.test(cab.texto), `a 18 px el uso entra entero: ${JSON.stringify(cab)}`);
  await teclaTirador("Home");
  await espera(100);
  cab = await en(cabecera);
  ok(cab.corto && !cab.desborda.length && !cab.cortado && /^en /.test(cab.texto), `con la barra en su mínimo queda el corto, sin desbordar: ${JSON.stringify(cab)}`);
  await teclaTirador("ArrowRight", 5);
  await tecla("0", CTRL);
  const l0 = await en(letraDe);
  ok(l0.letra === "13" && l0.rem === 16, `Ctrl+0 vuelve al default: ${JSON.stringify(l0)}`);
  await tecla("-", CTRL);
  ok((await en(letraDe)).letra === "13", "Ctrl+- no baja de 13");
  const familias = () => ({
    sans: getComputedStyle(document.querySelector(".app")).fontFamily,
    mono: getComputedStyle(document.querySelector(".pn-val")).fontFamily,
    botones: [...document.querySelectorAll(".pn .pick > .pbtn")].slice(1, 3).map((b) => b.innerText.trim()),
  });
  const f0 = await en(familias);
  ok(/^"?Geist"?,/.test(f0.sans) && /^"?Geist Mono"?,/.test(f0.mono), `default: Geist y Geist Mono: ${JSON.stringify(f0)}`);
  await en(() => document.querySelectorAll(".pn .pick > .pbtn")[1]?.click());
  await hasta(() => !!document.querySelector('[role="option"]'), "menú de fuentes");
  const ops = await en(() => [...document.querySelectorAll('[role="option"] .on1 span[style]')].map((o) => [o.textContent, o.style.fontFamily.split(",")[0].replaceAll('"', "")]));
  ok(ops.length === 6 && ops.slice(0, 5).every(([nombre, fam]) => nombre === fam), `cada fuente del menú va escrita en ella misma: ${JSON.stringify(ops)}`);
  ok(await clic('[role="option"]', "Inter"), "se elige Inter");
  ok(await elegir(".pn", 2, "JetBrains Mono"), "código: se elige JetBrains Mono");
  const f1 = await en(familias);
  ok(/^"?Inter"?,/.test(f1.sans), `la interfaz pasa a Inter al toque: ${f1.sans}`);
  ok(/^"?JetBrains Mono"?,/.test(f1.mono), `lo mono pasa a JetBrains Mono al toque: ${f1.mono}`);
  ok(f1.botones.join("|") === "Inter|JetBrains Mono", `los selectores muestran lo elegido: ${f1.botones}`);
  ok(await en(() => document.fonts.load('13px "Inter"').then((f) => f.length > 0)), "Inter carga del paquete (sin red)");
  const pApar = await prefsCon((p) => p.fuente === "inter" && p.mono === "jetbrains");
  ok(pApar?.fuente === "inter" && pApar?.mono === "jetbrains" && pApar?.letra === 13, `preferencias.json guarda letra y fuentes: ${JSON.stringify(pApar)}`);
  ok(pApar?.idioma === "es", "guardar la letra y las fuentes no pisa el idioma");
  // De vuelta a las de la maqueta: lo que sigue de la prueba corre con el default.
  ok(await elegir(".pn", 1, "Geist"), "vuelve Geist");
  ok(await elegir(".pn", 2, "Geist Mono"), "vuelve Geist Mono");
  ok((await prefsCon((p) => p.fuente === "geist" && p.mono === "geist-mono"))?.mono === "geist-mono", "preferencias.json vuelve al default");
  // --- Mensajes tiernos (B17): prendidos por default; Ajustes los apaga al toque -------
  const tierna = () => document.querySelector('[data-fila="20261003-100300-44444"] .tierno')?.textContent ?? "";
  ok(await en(tierna).then((t) => t.length > 0 && t.length <= 28 && t !== "Trabajando"), "el worker que trabaja dice una frase tierna");
  ok(await elegir(".pn", 3, "Apagados"), "se apagan los mensajes tiernos");
  ok(
    await hasta(() => document.querySelector('[data-fila="20261003-100300-44444"]')?.textContent.includes("Trabajando"), "Trabajando"),
    "la fila vuelve a decir Trabajando",
  );
  ok(await en(() => !document.querySelector(".tierno")), "no queda ninguna frase tierna");
  let prefsTiernos;
  for (let i = 0; i < 30 && prefsTiernos !== false; i++) {
    try {
      prefsTiernos = JSON.parse(readFileSync(path.join(tmp, "hilos", "preferencias.json"), "utf8")).tiernos;
    } catch {}
    if (prefsTiernos !== false) await espera(100);
  }
  ok(prefsTiernos === false, `preferencias.json guarda tiernos: ${prefsTiernos}`);
  ok(await elegir(".pn", 3, "Prendidos"), "se vuelven a prender");
  ok(await hasta(tierna, "frase tierna"), "la frase vuelve al toque");
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".pn"), "sin panel"), "Esc cierra Ajustes");

  // --- Sólo líderes (B15): la tecla W y el control de arriba; se guarda en preferencias.json ---
  await tecla("w");
  ok(await hasta(sinFila, "sólo líderes", ["20261003-100300-44444"]), "W pasa a sólo líderes: el worker vivo pierde su fila");
  ok(
    await en(() => document.querySelector('.lw:has([data-lider="s-falso-lider"]) [data-resumen]')?.textContent.includes("1 trabajando")),
    'el líder lo resume en su fila ("1 trabajando")',
  );
  ok(await en((s) => document.querySelector(s)?.textContent === "+3", mas), 'y cuenta todo lo que esconde: "+3"');
  ok(await en(() => !!document.querySelector('[data-fila="20261003-100400-55555"]')), "lo que no tiene líder sigue a la vista");
  ok(await en(() => document.querySelector('.vista [data-ver="lideres"]')?.getAttribute("aria-pressed") === "true"), "el control de arriba marca Sólo líderes");
  ok((await prefsCon((p) => p.vista === "lideres"))?.vista === "lideres", "preferencias.json guarda la vista");
  await clic(mas);
  ok(await hasta(cuelgan, "desplegados", ["20261003-100300-44444", ...TERMINADOS]), "el +3 despliega todos sus workers ahí mismo");
  ok(await clic('.vista [data-ver="todo"]'), "el control vuelve a Todo");
  ok(await hasta(cuelgan, "todo", ["20261003-100300-44444"]), "vuelve la fila del worker vivo");
  ok(await hasta(sinFila, "plegados", TERMINADOS), "y lo terminado vuelve a quedar escondido");
  ok((await prefsCon((p) => p.vista === "todo"))?.vista === "todo", "preferencias.json guarda la vuelta a Todo");

  ok(
    await en(() => document.querySelector('[data-fila="20261003-100400-55555"]')?.textContent.includes("Te necesita")),
    "lo de la app que pregunta dice Te necesita",
  );

  // --- Ctrl+N abre un LÍDER (los workers los lanza él); Opus/high por default ---------
  await tecla("n", CTRL);
  ok(await hasta(() => document.querySelector(".lider-linea")?.textContent.includes("Nuevo líder"), "Nuevo líder"), "Ctrl+N abre un líder nuevo");
  ok(await en(() => !document.querySelector(".nueva-zona") && !document.querySelector(".combo")), "no hay Nueva tarea de worker ni elegir proyecto");
  const zonaLider = ".caja-zona .barra-c";
  ok(await hasta((z) => document.querySelectorAll(`${z} .pick > .pbtn`).length === 2, "selectores", zonaLider), "la caja del líder tiene modelo y esfuerzo");
  // Esfuerzo por modelo: Sonnet en medium, Opus vuelve a high, Sonnet vuelve a medium.
  const effortBtn = (z) => document.querySelectorAll(`${z} .pick > .pbtn`)[1].textContent;
  ok((await en(effortBtn, zonaLider)) === "high", "Opus arranca en high (default de la tabla)");
  ok(await elegir(zonaLider, 0, "Sonnet"), "se elige Sonnet");
  ok(await elegir(zonaLider, 1, "medium"), "Sonnet en medium");
  ok(await elegir(zonaLider, 0, "Opus"), "se vuelve a Opus");
  ok((await en(effortBtn, zonaLider)) === "high", "Opus vuelve con high");
  ok(await elegir(zonaLider, 0, "Sonnet"), "otra vez Sonnet");
  ok((await en(effortBtn, zonaLider)) === "medium", "Sonnet recuerda medium");
  ok(await elegir(zonaLider, 0, "Haiku"), "el selector ofrece Haiku (la app no prohíbe)");
  ok(await elegir(zonaLider, 0, "Opus"), "Opus para lanzar");
  let prefs = null;
  for (let i = 0; i < 30 && !prefs?.effort; i++) {
    try {
      prefs = JSON.parse(readFileSync(path.join(tmp, "hilos", "preferencias.json"), "utf8"));
    } catch {}
    if (!prefs?.effort) await espera(100);
  }
  ok(prefs?.effort?.["claude-sonnet-5-5"] === "medium", `preferencias.json guarda el esfuerzo por modelo: ${JSON.stringify(prefs)}`);
  ok(prefs?.idioma === "es", `guardar el esfuerzo no pisa el idioma: ${JSON.stringify(prefs)}`);
  ok(await clic(".pie button", "Ramas"), "con el pie se sale del líder nuevo");
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".pn"), "sin panel"), "Esc cierra Ramas");

  // --- Worker de sólo lectura: sin caja; trabajando, Parar ----------------------------
  await clic('[data-fila="20261003-100300-44444"] .wbtn');
  ok(await hasta(() => !!document.querySelector(".caja-zona.solo-lectura .pie-worker"), "pie del worker"), "worker trabajando: pie de sólo lectura");
  ok(await en(() => !document.querySelector(".caja-zona textarea")), "el worker no tiene caja de texto");
  // B16: el anillo de contexto del worker, con el usage de `pa --hilo` (84.622 de 200.000).
  const anilloW = await hasta(() => document.querySelector(".caja-zona.solo-lectura .meta .ctx")?.dataset.pct, "anillo del worker");
  ok(anilloW === "42", `el worker muestra su anillo de contexto: ${anilloW} %`);
  ok(
    await hasta(() => document.querySelectorAll(".conv .yo, .conv .el").length > 0, "conversación"),
    "la conversación de pa --hilo se pinta",
  );
  ok(lineas().some((l) => l.endsWith(" --hilo 20261003-100300-44444 --json -n 50")), "pa --hilo <id> --json -n 50");
  let desde = acciones().length;
  ok(await clic(".pie-worker [data-parar]", "Parar"), "hay Parar, al medio del pie");
  let a = await nuevas(desde);
  ok(a.endsWith(" --parar 20261003-100300-44444"), `Parar → ${a.replace(/^\S+ /, "")}`);

  // --- Terminado: ni caja ni pie; con su botón de cerrar si no tiene líder ------------------
  await clic('[data-fila="20261003-100000-11111"] .wbtn');
  ok(await hasta(() => document.querySelector(".migas .ruta b")?.textContent.includes("Cerrar con rama"), "vista 11111"), "se abre el worker terminado");
  ok(
    await en(() => !document.querySelector(".caja-zona textarea") && !document.querySelector(".pie-worker [data-parar]") && !!document.querySelector(".pie-worker[data-fin] .estado")),
    "terminado: ni caja ni Parar; el pie dice cómo terminó",
  );

  // --- Te necesita sin líder: "Pasárselo a un líder" abre uno con la DECISION entera -----
  await clic('[data-fila="20261003-100400-55555"] .wbtn');
  ok(await hasta(() => !!document.querySelector(".pie-worker [data-pasar]"), "Pasárselo"), "Te necesita: hay Pasárselo a un líder");
  ok(await en(() => !document.querySelector(".caja-zona textarea")), "y no hay caja para responderle");
  ok(await clic(".pie-worker [data-pasar]"), "clic en Pasárselo");
  ok(
    await hasta(
      (xs) => xs.every((x) => document.querySelector(".caja-zona textarea")?.value.includes(x)),
      "pregunta de Pasárselo",
      ["- Id de la corrida: 20261003-100400-55555", "DECISION que me dejó:", "Explicame en criollo qué necesita de mí y seguilo vos."],
    ),
    "abre Nuevo líder con la caja llena (id, DECISION, pedido)",
  );
  ok(await en(() => document.querySelector(".lider-linea")?.textContent.includes("Nuevo líder")), "es un líder nuevo");
  ok(lineas().some((l) => l.endsWith(" --hilo 20261003-100400-55555 --json -n 6")), "el main leyó el final entero con pa --hilo -n 6");

  // --- Integrar / Archivar: sólo lo que no cuelga de un líder; con rama integra -----------------------
  await clic(pliegue);
  ok(await hasta(cuelgan, "desplegados", TERMINADOS), "se despliegan los terminados del líder");
  for (const id of TERMINADOS)
    ok(await en((id) => !document.querySelector(`[data-fila="${id}"] [data-cerrar]`), id), `${id.slice(-5)} (de un líder) no tiene Integrar ni Archivar propio`);
  desde = acciones().length;
  ok(await clic('[data-fila="20261003-100000-11111"] [data-cerrar="integrar"]', "Integrar"), "11111 (con rama) tiene Integrar");
  a = await nuevas(desde);
  ok(a.endsWith(" Atlas\\ Web --integrar 20261003-100000-11111 --tests"), `Integrar 11111 → ${a.replace(/^\S+ /, "")}`);

  // --- Lo que murió no se integra a ciegas: sin commits, Quitar descarta; con commits, Integrar o Quitar --
  // (cauce no está en el registry: sin `tests`, Integrar va sin --tests)
  ok(await en(() => !document.querySelector('[data-fila="20261003-100600-88888"] [data-cerrar]')), "88888 (murió) no tiene Integrar ni Archivar");
  desde = acciones().length;
  ok(await clic('[data-fila="20261003-100600-88888"] [data-quitar]', "Quitar"), "88888 (sin commits) tiene Quitar");
  a = await nuevas(desde);
  ok(a.endsWith(" --descartar 20261003-100600-88888"), `Quitar 88888 → ${a.replace(/^\S+ /, "")}`);
  ok(await en(() => !!document.querySelector('[data-fila="20261003-100700-99999"] [data-integrar]')), "99999 (con commits) tiene Integrar");
  ok(await clic('[data-fila="20261003-100700-99999"] [data-quitar]', "Quitar"), "99999 tiene Quitar");
  ok(await hasta(() => document.querySelector('[data-fila="20261003-100700-99999"] [data-quitar]')?.textContent.includes("¿Quitar?"), "confirmación"), "con commits, Quitar pide un segundo clic");
  ok(!acciones().slice(desde + 1).some((l) => l.includes("99999")), "el primer clic de Quitar no llama a pa");
  desde = acciones().length;
  ok(await clic('[data-fila="20261003-100700-99999"] [data-integrar]', "Integrar"), "Integrar 99999");
  a = await nuevas(desde);
  ok(a.endsWith(" cauce --integrar 20261003-100700-99999"), `Integrar sin tests en el registry → ${a.replace(/^\S+ /, "")}`);

  // --- Ramas: Integrar también le pasa a pa el nombre del registry, no la carpeta ------
  ok(await clic(".pie button", "Ramas"), "el pie abre Ramas");
  const filaRama = '.pn-rama:has(.pn-tarea[data-id="20261003-100400-55555"])';
  ok(await hasta((s) => !!document.querySelector(s), "fila de la rama", filaRama), "Ramas lista la rama de atlas");
  desde = acciones().length;
  ok(await clic(`${filaRama} .pn-acc .mini`, "Integrar"), "la rama tiene Integrar");
  a = await nuevas(desde);
  ok(a.endsWith(" Atlas\\ Web --integrar 20261003-100400-55555 --tests"), `Integrar desde Ramas → ${a.replace(/^\S+ /, "")}`);
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".pn"), "sin panel"), "Esc cierra Ramas");

  // --- Nuevo líder (claude falso: contesta "eco: …") ------------------------------------
  // La carpeta del home: primera, con el usuario del sistema por nombre.
  const usuario = os.userInfo().username;
  ok(
    await en((u) => document.querySelector(".proy")?.getAttribute("aria-label") === u && !!document.querySelector(".proy button[aria-label='Nuevo líder']"), usuario),
    `la carpeta del home (${usuario}) va primera y tiene Nuevo líder`,
  );
  await tecla("N", CTRL | SHIFT);
  ok(await hasta(() => document.querySelector(".lider-linea")?.textContent.includes("Nuevo líder"), "chat nuevo"), "Ctrl+Shift+N también abre un líder nuevo");
  // Lo que pasa por los avisos (el de reintento se va apenas llega la respuesta).
  await en(() => {
    window.__avisos = [];
    new MutationObserver((ms) => {
      for (const m of ms)
        for (const n of m.addedNodes)
          if (n instanceof Element) for (const a of [n, ...n.querySelectorAll(".aviso")]) if (a.matches(".aviso")) window.__avisos.push(a.textContent);
    }).observe(document.body, { childList: true, subtree: true });
  });
  const mandar = async (t) => {
    await escribir(".caja-zona textarea", t);
    return clic('.caja-zona button[aria-label="Mandar"]');
  };
  // Libre: la caja no espera el envío y no hay Parar (mientras responde se puede escribir, no mandar).
  const libre = () =>
    hasta(() => !!document.querySelector(".caja-zona textarea:not([readonly])") && !document.querySelector(".caja-zona .barra-c .btn2"), "libre");
  const chip = () => en(() => document.querySelector(".caja-zona .modo")?.textContent ?? "");
  ok((await chip()).endsWith("bypass permissions on"), `un líder nuevo arranca en bypass: ${await chip()}`);
  // B13: Enter manda (Shift+Enter no).
  await escribir(".caja-zona textarea", "usá una herramienta");
  await tecla("Enter", SHIFT);
  await espera(200);
  ok(await en(() => document.querySelector(".lider-linea")?.textContent.includes("Nuevo líder")), "Shift+Enter no manda");
  await tecla("Enter");
  const eco = (t) => [...document.querySelectorAll(".conv .el")].some((e) => e.textContent.includes(`eco: ${t}`));
  ok(await hasta(eco, "eco", "usá una herramienta"), "la respuesta llega por el stream");
  // La herramienta va colapsada en "Trabajó …", como en la vista de hilo: una línea por llamada (B19).
  await clic(".conv details.trabajo summary");
  ok(
    await hasta(() => {
      const l = document.querySelector(".conv details.trabajo .ll");
      return l?.querySelector(".ll-n")?.textContent === "Bash" && l.querySelector(".ll-r")?.textContent === "ls -la ~";
    }, "Bash"),
    "la herramienta, en su línea",
  );
  // Abierta de entrada (B26: el Bash se abre solo): el comando entero y el final de lo que devolvió (el tool_result del stream).
  ok(
    await hasta(
      () => document.querySelector(".conv .ll-cmd")?.textContent.includes("ls -la ~") && document.querySelector(".conv .ll-res")?.textContent === "ok",
      "comando y resultado",
    ),
    "la llamada abierta: comando y resultado",
  );
  ok(await libre(), "al terminar la caja vuelve");
  ok(await mandar("otra cosa"), "Mandar 2");
  ok(await hasta(eco, "eco 2", "otra cosa"), "el segundo mensaje va al mismo proceso");
  const delLog = () => readFileSync(logClaude, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const arranques = () => delLog().filter((l) => l.args);
  const controles = () => delLog().filter((l) => l.control);
  let arr = arranques();
  ok(arr.length === 1, `un solo arranque (${arr.length})`);
  const [c] = arr;
  const ar = c?.args ?? [];
  ok(
    ["-p", "--dangerously-skip-permissions", "--verbose", "--include-partial-messages"].every((f) => ar.includes(f)) &&
      ar[ar.indexOf("--model") + 1] === "claude-opus-5-5" &&
      ar[ar.indexOf("--effort") + 1] === "high" &&
      /^trama-[0-9a-f]{4}$/.test(ar[ar.indexOf("--name") + 1]),
    `argv del líder: ${ar.join(" ")}`,
  );
  ok(c?.cwd === os.homedir(), "el líder corre en ~");
  ok(!c?.env.some((k) => /^(CLAUDE|ANTHROPIC_)/.test(k)), "sin variables CLAUDE*/ANTHROPIC_*");
  const sid = ar[ar.indexOf("--session-id") + 1];
  const guardados = JSON.parse(readFileSync(path.join(tmp, "hilos", "lideres.json"), "utf8"));
  ok(JSON.stringify(guardados).includes(sid), "lideres.json lo guarda");

  // --- El líder que se está viendo queda a la vista: su carpeta se abre sola al cambiar de carpeta ---
  const marcado = (s) => !!document.querySelector(`.lider[data-activa][data-lider="${s}"]`);
  const carpetaDe = (s) => document.querySelector(`[data-lider="${s}"]`)?.closest(".proy")?.querySelector("[data-carpeta]")?.dataset.carpeta;
  const plegada = (p) => document.querySelector(`[data-carpeta="${p}"]`)?.getAttribute("aria-expanded") === "false";
  const moverA = async (clave) => {
    await derecho(`[data-lider="${sid}"]`);
    await hasta(() => !!document.querySelector('[role="menu"] [data-accion="mover"]'), "menú del líder");
    await clic('[role="menu"] [data-accion="mover"]');
    await hasta((c) => !!document.querySelector(`[role="menu"] [data-accion="${c}"]`), "carpetas", clave);
    return clic(`[role="menu"] [data-accion="${clave}"]`);
  };
  ok(await hasta(marcado, "líder marcado", sid), "el líder abierto está marcado en la barra");
  const casa = await en(carpetaDe, sid);
  await clic('[data-carpeta="cauce"]');
  ok(await hasta(plegada, "cauce plegada", "cauce"), "se pliega otra carpeta a mano");
  ok(await moverA("a:cauce"), "el líder se mueve a la carpeta plegada");
  ok(await hasta((s) => !!document.querySelector(`[data-lider="${s}"]`)?.closest(".proy")?.querySelector('[data-carpeta="cauce"]'), "en cauce", sid), "la carpeta se despliega sola y el líder se ve");
  await clic('[data-carpeta="cauce"]');
  ok(await hasta(plegada, "cauce plegada otra vez", "cauce"), "Ana la pliega con el líder adentro");
  await espera(400);
  ok(await en(plegada, "cauce"), "y se queda plegada: no se vuelve a abrir sola");
  await clic('[data-carpeta="cauce"]');
  await hasta(marcado, "líder otra vez a la vista", sid);
  await clic(`[data-carpeta="${casa}"]`);
  ok(await hasta(plegada, "casa plegada", casa), "se pliega la carpeta de antes");
  ok(await moverA("auto"), "el líder vuelve a su carpeta");
  ok(await hasta((s, c) => !!document.querySelector(`.lider[data-activa][data-lider="${s}"]`)?.closest(".proy")?.querySelector(`[data-carpeta="${c}"]`), "de vuelta", sid, casa), "que también se despliega sola");

  // --- El anillo de contexto (B16): el usage del stream contra el umbral del relevo (plan max) ---
  const anillo = () => {
    const b = document.querySelector(".caja-zona .barra-c .ctx");
    return b ? { pct: Number(b.dataset.pct), nivel: b.dataset.nivel, dice: b.getAttribute("aria-label"), abierto: b.getAttribute("aria-expanded") } : null;
  };
  const an = await hasta(() => {
    const b = document.querySelector(".caja-zona .barra-c .ctx");
    return Number(b?.dataset.pct) > 0 ? b.dataset.pct : null;
  }, "anillo con algo");
  const a1 = await en(anillo);
  ok(a1 && a1.pct >= 30 && a1.pct <= 40 && a1.nivel === "normal", `el anillo se llena con el usage del turno (${an} % de 200.000): ${JSON.stringify(a1)}`);
  ok(a1?.dice === `${a1?.pct}% del contexto`, `y lo dice: ${a1?.dice}`);
  ok(await clic(".caja-zona .barra-c .ctx"), "clic en el anillo");
  const det = await hasta(() => document.querySelector(".ctx-det")?.textContent, "detalle del anillo");
  ok(
    !!det &&
      det.includes("Contexto") &&
      /\d+ k de 200 k — faltan \d+ k para el relevo \(líder nuevo con contexto limpio\)/.test(det) &&
      det.includes("Compacta solo a los200.000") &&
      det.includes("Ventana de Opus") &&
      det.includes("1.000.000") &&
      det.includes("Caché leída") &&
      det.includes("Compactaciones"),
    `el detalle dice cuánto falta para el relevo, el autocompact, la ventana y el desglose: ${det}`,
  );
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".ctx-det"), "detalle cerrado"), "Esc cierra el detalle");
  ok(await en(() => !!document.querySelector(".caja-zona textarea")), "y el chat sigue ahí (el Esc no llegó a la barra)");
  ok(await clic(".caja-zona .barra-c .ctx"), "se abre otra vez");
  ok(await hasta(() => !!document.querySelector(".ctx-det"), "detalle"), "abre");
  ok(await clic(".ctx-w .fondo"), "clic afuera");
  ok(await hasta(() => !document.querySelector(".ctx-det"), "detalle cerrado"), "clic afuera lo cierra");

  // --- Avisos en línea (gatillos del claude falso) -------------------------------------
  ok(await libre(), "libre para el reintento");
  ok(await mandar("probá el reintento"), "Mandar reintento");
  ok(await hasta(eco, "eco reintento", "probá el reintento"), "después del reintento contesta igual");
  const vistos = () => window.__avisos;
  ok((await en(vistos)).some((t) => t.startsWith("API saturada: reintenta (1/10) en")), `aviso de reintento: ${JSON.stringify(await en(vistos))}`);
  ok(await hasta(() => !document.querySelector(".avisos"), "sin reintento"), "el reintento se va al llegar la respuesta");

  ok(await libre(), "libre para el límite");
  ok(await mandar("llegué al límite"), "Mandar límite");
  const enAvisos = () => [...document.querySelectorAll(".avisos .aviso")].map((a) => [a.textContent, a.dataset.tono]);
  ok(await hasta(() => document.querySelector(".avisos .aviso")?.textContent.includes("Límite de 5 horas"), "límite"), "aviso del tope de 5 h");
  ok(await libre(), "después del límite la caja vuelve");
  const lim = await en(enAvisos);
  ok(lim.length === 1 && lim[0][1] === "grave" && /llegaste al tope · se reinicia/.test(lim[0][0]), `una sola línea, en rojo: ${JSON.stringify(lim)}`);

  ok(await mandar("morite"), "Mandar morite");
  ok(
    await hasta(() => document.querySelector(".avisos .aviso")?.textContent === "El proceso salió con código 1: Error: socket hang up", "salio"),
    `el proceso que se muere avisa con código y stderr: ${JSON.stringify(await en(enAvisos))}`,
  );
  // Lo mataron: Murió, sin caja; Retomar lo pasa a la app y recién ahí hay caja (no es "dormido").
  ok(await hasta(() => document.querySelector(".lider-linea .c-fallo")?.textContent === "Murió", "Murió"), "el líder queda Murió");
  ok(await en(() => !document.querySelector(".caja-zona textarea") && !!document.querySelector('.caja[data-caido="murio"] [data-retomar-lider]')), "sin caja: Retomar");
  ok(await clic('.caja[data-caido="murio"] [data-retomar-lider]'), "clic en Retomar");
  ok(await libre(), "y se le puede escribir");
  ok(await mandar("volvé"), "Mandar después de morir");
  ok(await hasta(eco, "eco resume", "volvé"), "escribirle lo retoma");
  arr = arranques();
  const r2 = arr[1]?.args ?? [];
  ok(arr.length === 2 && r2[r2.indexOf("--resume") + 1] === sid && !r2.includes("--name"), `retoma con --resume: ${r2.join(" ")}`);

  // --- La cola: mientras responde, Enter encola; sale sola, de a uno, al terminar el turno ----
  ok(await libre(), "libre para la cola");
  ok(await mandar("despacio, pensalo"), "Mandar algo lento");
  ok(await hasta(() => !!document.querySelector(".caja-zona .barra-c .btn2"), "Parar"), "respondiendo: hay Parar");
  ok(await en(() => !!document.querySelector('.caja-zona button[aria-label="Mandar"]')), "y también Mandar");
  await escribir(".caja-zona textarea", "primero en cola");
  await tecla("Enter");
  ok(await mandar("segundo en cola"), "Mandar mientras responde");
  await escribir(".caja-zona textarea", "tercero en cola");
  await tecla("Enter");
  const enCola = () => [...document.querySelectorAll(".conv .encolado")].map((e) => e.textContent);
  const c1 = await en(enCola);
  ok(c1.length === 3 && ["primero", "segundo", "tercero"].every((t, i) => c1[i].includes(`${t} en cola`)), `los tres quedan en cola, en orden: ${JSON.stringify(c1)}`);
  ok(await en(() => document.querySelector(".caja-zona textarea").value === ""), "y la caja queda vacía");
  const sacar = () => {
    const b = [...document.querySelectorAll(".conv .encolado")].find((e) => e.textContent.includes("segundo"))?.querySelector("button");
    b?.click();
    return !!b;
  };
  ok(await en(sacar), "sacar uno de la cola");
  ok((await en(enCola)).length === 2, "quedan dos");
  ok(await hasta(eco, "eco lento", "despacio, pensalo"), "contesta lo lento");
  ok(await hasta(eco, "eco primero", "primero en cola"), "al terminar sale el primero de la cola");
  ok(await hasta(eco, "eco tercero", "tercero en cola"), "y después el otro");
  const yoN = (t) => [...document.querySelectorAll(".conv .yo:not(.encolado)")].filter((e) => e.textContent.includes(t)).length;
  // Antes de SOLTAR_MS (el falso no escribe transcript: después la tanda se suelta y no queda nada).
  const yos = await en(() => [...document.querySelectorAll(".conv .yo")].map((e) => e.textContent).slice(-6));
  ok((await en(yoN, "primero en cola")) === 1 && (await en(yoN, "tercero en cola")) === 1, `cada mensaje de la cola se ve una vez: ${JSON.stringify(yos)}`);
  ok(await libre(), "libre después de la cola");
  ok(await hasta(() => !document.querySelector(".conv .encolado"), "cola vacía"), "la cola queda vacía");
  ok(!(await en(eco, "segundo en cola")), "lo que se sacó no sale");
  ok(arranques().length === 2, "todo por el mismo proceso");

  // --- B13: modos, comandos con "/", plan y permisos -----------------------------------
  const modoGuardado = () => JSON.parse(readFileSync(path.join(tmp, "hilos", "lideres.json"), "utf8")).lideres.find((l) => l.sid === sid)?.modo;
  const guardadoEs = async (m) => {
    for (let i = 0; i < 50 && modoGuardado() !== m; i++) await espera(100);
    return modoGuardado() === m;
  };
  ok(await libre(), "libre para los modos");
  await en(() => document.querySelector(".caja-zona textarea").focus());
  await tecla("Tab", SHIFT);
  ok(await hasta(() => document.querySelector(".caja-zona .modo")?.textContent.endsWith("default"), "default"), "Shift+Tab: bypass → default");
  ok(await guardadoEs("default"), `set_permission_mode llega al claude y vuelve por el stream (lideres.json: ${modoGuardado()})`);
  await tecla("Tab", SHIFT);
  ok(await hasta(() => document.querySelector(".caja-zona .modo")?.textContent.endsWith("accept edits on"), "accept"), "Shift+Tab: default → accept edits");
  await escribir(".caja-zona textarea", "/");
  ok(await hasta(() => document.querySelectorAll(".menu-cmd .cmd").length > 8, "menú"), "'/' abre el menú de comandos");
  const filas = await en(() => [...document.querySelectorAll(".menu-cmd .cmd-n")].map((e) => e.textContent));
  ok(filas[0] === "/plan" && filas.includes("/review") && filas.includes("/falso-skill") && !filas.includes("/doctor"), `con los de la sesión, sin los de terminal: ${filas.join(" ")}`);
  // B23: End va a la última fila y el menú la trae a la vista; la flecha abajo da la vuelta a la primera.
  const visible = () => {
    const m = document.querySelector(".menu-cmd").getBoundingClientRect();
    const f = document.querySelector('.menu-cmd [aria-selected="true"]').getBoundingClientRect();
    return f.top >= m.top - 1 && f.bottom <= m.bottom + 1;
  };
  await tecla("End");
  ok(await hasta(() => document.querySelector(".menu-cmd").lastElementChild.getAttribute("aria-selected") === "true", "End"), "End elige la última fila");
  ok(await hasta(visible, "a la vista"), "y la deja a la vista");
  await tecla("ArrowDown");
  ok(await hasta(() => document.querySelector(".menu-cmd").firstElementChild.getAttribute("aria-selected") === "true", "vuelta"), "abajo desde la última vuelve a la primera");
  ok(await hasta(visible, "a la vista"), "a la vista también");
  await tecla("Escape");
  ok(await hasta(() => !document.querySelector(".menu-cmd"), "sin menú"), "Esc cierra el menú");
  // B23: /output-style abre su segundo nivel (lo que listó el CLI, el actual marcado) y se aplica en vivo.
  await escribir(".caja-zona textarea", "/output-style ");
  ok(await hasta(() => [...document.querySelectorAll(".menu-cmd .cmd")].some((e) => e.textContent.includes("Concise")), "estilos"), "/output-style lista los estilos del CLI");
  ok(await en(() => document.querySelector('.menu-cmd [aria-current="true"]')?.textContent.includes("default")), "con el actual marcado");
  await escribir(".caja-zona textarea", "/output-style con");
  await tecla("Enter");
  ok(await hasta(() => !!document.querySelector(".caja-nota"), "nota"), "elegido: una nota en la caja");
  const estiloLlego = () => delLog().some((l) => l.control === "update_settings" && l.settings?.outputStyle === "Concise" && l.source === "localSettings");
  for (let i = 0; i < 50 && !estiloLlego(); i++) await espera(100);
  ok(estiloLlego(), "update_settings localSettings llega al claude");
  const estiloGuardado = () => {
    try {
      return JSON.parse(readFileSync(path.join(tmp, "hilos", "comandos.json"), "utf8")).estilos?.actual;
    } catch {
      return null;
    }
  };
  for (let i = 0; i < 30 && estiloGuardado() !== "Concise"; i++) await espera(100);
  ok(estiloGuardado() === "Concise", `comandos.json recuerda el estilo puesto: ${estiloGuardado()}`);
  ok(await en(() => document.querySelector(".caja-zona textarea").value === ""), "y no se manda como texto");
  await escribir(".caja-zona textarea", "/pla");
  await tecla("ArrowDown");
  await tecla("ArrowUp");
  await tecla("Enter");
  ok(await hasta(() => document.querySelector(".caja-zona .modo")?.textContent.endsWith("plan mode on"), "plan"), "/pla + Enter elige /plan");
  ok(await en(() => document.querySelector(".caja-zona textarea").value === ""), "y no se manda como texto");
  ok(await guardadoEs("plan"), "el líder queda en plan");

  ok(await mandar("armá el settle en lote"), "Mandar en plan mode");
  ok(await hasta(() => document.querySelector(".pide[data-plan] h4")?.textContent === "Plan falso", "plan"), "ExitPlanMode: el plan, con su título");
  ok(await clic(".pide button", "Seguir planeando"), "Seguir planeando");
  ok(await hasta(() => !!document.querySelector(".pide-nota textarea"), "nota"), "abre el campo para decir qué cambiar");
  await escribir(".pide-nota textarea", "agregá un test");
  await tecla("Enter");
  const dijo = (t) => [...document.querySelectorAll(".conv .el")].some((e) => e.textContent.includes(t));
  ok(await hasta(dijo, "sigo planeando", "sigo planeando: agregá un test"), "Enter en la nota la manda: el líder sigue planeando");
  ok((await chip()).endsWith("plan mode on"), "sigue en plan");
  ok(await libre(), "libre después de seguir planeando");
  ok(await mandar("con el test"), "Mandar otra vez en plan");
  ok(await hasta(() => !!document.querySelector(".pide[data-plan]"), "plan 2"), "otro plan");
  ok(await clic(".pide button", "Aprobar"), "Aprobar");
  ok(await hasta(dijo, "aprobado", "plan aprobado: con el test"), "aprobado: sigue y lo hace");
  ok(await hasta(() => document.querySelector(".caja-zona .modo")?.textContent.endsWith("bypass permissions on"), "bypass"), "aprobar vuelve a bypass");
  ok(await guardadoEs("bypassPermissions"), "y el líder queda en bypass");

  ok(await libre(), "libre para /model");
  await escribir(".caja-zona textarea", "/default");
  await tecla("Enter");
  ok(await guardadoEs("default"), "/default");
  await escribir(".caja-zona textarea", "/model sonnet");
  await tecla("Enter");
  ok(await hasta(() => document.querySelector(".caja-zona .pick > .pbtn")?.textContent.includes("Sonnet"), "Sonnet"), "/model sonnet cambia el selector");
  await escribir(".caja-zona textarea", "/effort low");
  await tecla("Enter");
  ok(await hasta(() => document.querySelectorAll(".caja-zona .pick > .pbtn")[1]?.textContent.includes("low"), "low"), "/effort low cambia el esfuerzo");
  await escribir(".caja-zona textarea", "/model gpt");
  await tecla("Enter");
  ok(await hasta(() => document.querySelector(".caja-error")?.textContent.includes("gpt"), "error"), "/model con algo raro: error en línea");
  ok(await mandar("usá la herramienta"), "Mandar con otro modelo, en default");
  ok(await hasta(() => document.querySelector(".pide-t")?.textContent.includes("Bash"), "permiso"), "en default, el Bash pide permiso");
  arr = arranques();
  const ctl = controles();
  ok(
    arr.length === 2 &&
      ctl.some((c) => c.control === "set_model" && c.model === "claude-sonnet-5-5") &&
      ctl.some((c) => c.control === "apply_flag_settings" && c.settings?.effortLevel === "low"),
    `otro modelo y esfuerzo van en vivo (set_model, apply_flag_settings), sin relanzar: ${arr.length} arranques, ${JSON.stringify(ctl)}`,
  );
  ok(await clic(".pide button", "Permitir"), "Permitir");
  ok(await hasta(dijo, "eco permitido", "eco: usá la herramienta"), "permitido: lo hace");

  ok(await libre(), "libre para /clear");
  await escribir(".caja-zona textarea", "/clear");
  await tecla("Enter");
  ok(await hasta(() => document.querySelector(".lider-linea")?.textContent.includes("Nuevo líder"), "nuevo"), "/clear abre un líder nuevo, limpio");

  // --- Archivar el líder de la app: quieto y sin workers, lo cierra y lo saca ------------
  ok(await libre(), "quieto");
  ok(await hasta((s) => !!document.querySelector(`.lw:has([data-lider="${s}"]) [data-settle-lider]`), "Archivar del líder", sid), "el líder quieto tiene Archivar");
  ok(
    await en(() => !document.querySelector('.lw:has([data-lider="s-falso-lider"]) :is([data-settle-lider], [data-cerrar-lider])')),
    "el de terminal con un worker trabajando no tiene Archivar ni Cerrar",
  );
  const sigue = () => JSON.stringify(JSON.parse(readFileSync(path.join(tmp, "hilos", "lideres.json"), "utf8"))).includes(sid);
  await en((s) => document.querySelector(`.lw:has([data-lider="${s}"]) [data-settle-lider]`).click(), sid);
  ok(await hasta((s) => !!document.querySelector(`.lw:has([data-lider="${s}"]) .settle-conf`), "confirmación", sid), "Archivar un líder de la app pide un segundo clic");
  await espera(300);
  ok(sigue(), "con un solo clic el líder sigue en lideres.json");
  await en((s) => document.querySelector(`.lw:has([data-lider="${s}"]) [data-settle-lider]`).click(), sid);
  const fuera = () => !JSON.stringify(JSON.parse(readFileSync(path.join(tmp, "hilos", "lideres.json"), "utf8"))).includes(sid);
  for (let i = 0; i < 50 && !fuera(); i++) await espera(100);
  ok(fuera(), "Archivar lo saca de lideres.json");
  ok(readFileSync(path.join(tmp, "hilos", "trama.log"), "utf8").includes(`archivar: `) && readFileSync(path.join(tmp, "hilos", "trama.log"), "utf8").includes(`(${sid})`), "y deja su rastro en trama.log");
  ok(await hasta((s) => !document.querySelector(`[data-lider="${s}"]`), "fuera de la barra", sid), "y de la barra");

  // --- Ramas (B22): integrar solo lo seguro, el analista y Retomar -----------------------
  ok(await clic(".pie button", "Ramas"), "Ramas para lo de B22");
  ok(await hasta(() => document.querySelector(".pn-llave")?.getAttribute("aria-pressed") === "true", "llave"), "Integrar solo lo seguro arranca prendido");
  // Aparecen 12121, 13131 y 14141 (atlas, listas con DECISION: nada): un evento hace releer.
  writeFileSync(path.join(tmp, "pa", "seguras"), "");
  appendFileSync(path.join(tmp, "pa", "eventos.jsonl"), `{"version":1,"ts":${Math.floor(Date.now() / 1000)},"tipo":"fin","id":"20261003-101000-14141","proyecto":"atlas"}\n`);
  const integrarAuto = (id) => lineas().filter((l) => l.includes(" PA_AUTO=1 ") && l.endsWith(` Atlas\\ Web --integrar ${id} --tests`));
  const autoListo = () => integrarAuto("20261003-100800-12121").length >= 1 && integrarAuto("20261003-100900-13131").length >= 2 && integrarAuto("20261003-101000-14141").length >= 1;
  for (let i = 0; i < 300 && !autoListo(); i++) await espera(100);
  ok(integrarAuto("20261003-100800-12121").length === 1, "la segura se integra sola: PA_AUTO=1 pa Atlas\\ Web --integrar 12121 --tests");
  const de13 = lineas().filter((l) => l.includes("20261003-100900-13131") && !/ --hilos?( |$)/.test(l));
  ok(
    de13.length === 3 && de13[0].includes("--integrar") && de13[1].endsWith(" Atlas\\ Web --actualizar 20261003-100900-13131 --async") && de13[1].includes(" PA_AUTO=1 ") && de13[2].includes("--integrar"),
    `con 80: --actualizar --async y un reintento: ${de13.map((l) => l.replace(/^\S+ /, "")).join(" | ")}`,
  );
  ok(integrarAuto("20261003-101000-14141").length === 1, "con tests rojos (93) se intenta una sola vez");
  ok(!lineas().some((l) => l.includes(" PA_AUTO=1 ") && /--integrar 2026\S+-(11111|55555|66666|99999)\b/.test(l)), "lo que no es seguro no se integra solo");
  let autoJson = null;
  for (let i = 0; i < 50; i++) {
    try {
      autoJson = JSON.parse(readFileSync(path.join(tmp, "hilos", "auto.json"), "utf8"));
    } catch {}
    if (autoJson?.integradas?.length === 2 && autoJson?.fallas?.length === 1) break;
    await espera(100);
  }
  ok(
    autoJson?.integradas?.map((x) => x.id).sort().join() === "20261003-100800-12121,20261003-100900-13131" &&
      autoJson?.fallas?.[0]?.id === "20261003-101000-14141" && autoJson?.fallas?.[0]?.rc === 93,
    `auto.json recuerda las integradas solas y la que falló: ${JSON.stringify(autoJson)}`,
  );
  ok(await hasta(() => document.querySelector(".pn-sola")?.textContent.startsWith("Integrado solo: "), "Integrado solo"), "Ramas dice \"Integrado solo: …\"");
  ok(
    await hasta(() => !!document.querySelector('.pn-rama:has(.pn-tarea[data-id="20261003-101000-14141"]) .pn-error'), "error de 14141"),
    "la que falló queda en Ramas con el error corto",
  );

  // El analista: un líder de la app en ~, con el brief; los veredictos van al lado de cada rama.
  const antesAn = arranques().length;
  ok(await clic(".pn-analista-btn", "Analizar ramas"), "Analizar ramas");
  // Analizar abre el paso previo: hasta Lanzar no sale ningún líder.
  ok(await hasta(() => !!document.querySelector(".lz-caja"), "paso previo"), "Analizar abre el paso previo (modelo, esfuerzo, texto)");
  await espera(400);
  ok(arranques().length === antesAn, "sin Lanzar no se lanzó ningún líder");
  ok(await clic(".lz-caja .btn2[data-primario]"), "Lanzar");
  ok(await hasta(() => document.querySelectorAll(".pn-juicio").length > 0, "veredictos"), "los veredictos del analista aparecen al lado de las ramas");
  const anArr = arranques();
  ok(anArr.length === antesAn + 1 && anArr.at(-1).cwd === os.homedir(), `el analista es un líder nuevo en ~ (${anArr.length - antesAn})`);
  ok(
    await en(() => [...document.querySelectorAll(".pn-rama:has(.pn-juicio)")].every((r) => r.querySelectorAll(".pn-juicio + * button, .pn-acc .pn-primario, .pn-acc .mini").length >= 1)),
    "cada veredicto trae su botón",
  );
  ok(
    await en(() => !!document.querySelector('.pn-rama:has(.pn-tarea[data-id="20261003-101000-14141"]) .pn-juicio')),
    "el brief lleva las ramas sin integrar (también la que falló sola)",
  );

  // Se le puede seguir hablando: lo de Ana se ve, el brief y el json no.
  await escribir(".pn-analista-chat textarea", "y la de cauce?");
  await tecla("Enter");
  ok(
    await hasta(() => [...document.querySelectorAll(".pn-analista-chat .conv .yo")].some((e) => e.textContent.includes("y la de cauce?")) && [...document.querySelectorAll(".pn-analista-chat .conv .el")].some((e) => e.textContent.includes("eco: y la de cauce?")), "seguir charlando"),
    "al analista se le sigue hablando (lo de Ana se ve)",
  );
  ok(await en(() => ![...document.querySelectorAll(".pn-analista-chat .conv")].some((c) => c.textContent.includes("Sos el analista") || c.textContent.includes('"veredicto"'))), "en el chat no se ven el brief ni el json");
  // Retomar desde el veredicto: abre un líder con el prompt de retomar (el falso lo devuelve con "eco: ").
  const idR = await en(() => document.querySelector('.pn-rama:has(.pn-juicio[data-veredicto="retomar"]) .pn-tarea')?.dataset.id);
  ok(!!idR, `algún veredicto dice retomar: ${idR}`);
  const antesR = arranques().length;
  ok(await clic(`.pn-rama:has(.pn-tarea[data-id="${idR}"]) .pn-primario`, "Retomar"), "el veredicto retomar trae Retomar");
  ok(await hasta(() => !!document.querySelector(".lz-caja"), "paso previo"), "Retomar abre el paso previo");
  await espera(400);
  ok(arranques().length === antesR, "sin Lanzar, Retomar no lanzó nada");
  ok(await clic(".lz-caja .btn2[data-primario]"), "Lanzar"); // Enter con el default lo cubre prueba-lanzar.mjs
  ok(
    await hasta((id) => [...document.querySelectorAll(".conv .el")].some((e) => e.textContent.includes(`--seguir --id ${id}`)), "prompt de retomar", idR),
    "Retomar abre un líder con el prompt (mirar la rama, --seguir)",
  );
  ok(arranques().length === antesR + 1, "Retomar lanza un líder nuevo");
} catch (e) {
  ok(false, String(e?.stack ?? e));
} finally {
  cerrando = true;
  ws.close();
  app.kill();
  console.log(`log: ${log}`);
  console.log(fallas ? `${fallas} fallas` : "todo ok");
  process.exit(fallas ? 1 : 0);
}
