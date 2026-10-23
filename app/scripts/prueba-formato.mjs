#!/usr/bin/env node
// Prueba del texto de los mensajes: abre la app offscreen (HILOS_PRUEBA, sin ventana) con la
// conversación de muestra (captura `lider-formato`, fixtures) y mide por CDP, en el ancho de la
// ventana y en 360 px con el dedo, que nada se salga de su mensaje (lo que no tiene espacios se
// parte adentro; sólo los bloques de código y las tablas se deslizan, en su caja), que cada forma
// del markdown esté, que un enlace salga al navegador (de mentira: HILOS_ABRIR) sin que la
// ventana navegue, y que Copiar copie. No toca `pa`, ni el navegador, ni el portapapeles de verdad.
//   npm run build && node scripts/prueba-formato.mjs
//   FOTOS=<carpeta>   además deja una captura de cada caso
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
/** El blanco del dedo: 2.75rem (44 px), con un px de gracia por el redondeo. */
const DEDO = 43;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

/** Abre la app con la conversación de muestra (`variante`: "" o "pegado") y devuelve cómo manejarla. */
async function abrir(variante) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-formato-"));
  const puerto = 9300 + Math.floor(Math.random() * 600);
  const abiertos = path.join(tmp, "abiertos");
  const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
    env: {
      ...process.env,
      HILOS_PRUEBA: "60",
      HILOS_CAPTURA: "lider-formato",
      // En modo captura la app se cierra sola a los 8 s: acá vive lo que dure la prueba.
      HILOS_CAPTURA_MS: "90000",
      HILOS_VARIANTE: variante,
      HILOS_IDIOMA: "es",
      HILOS_TAM: "1280 900",
      HILOS_STATE: path.join(tmp, "hilos"),
      HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
      HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
      PA_STATE: path.join(tmp, "pa"),
      HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
      HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
      HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
      HILOS_TABLERO: "/bin/false",
      HILOS_ABRIR: abiertos,
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
  /** La pantalla: la de la ventana (mouse) o la de un teléfono (dedo). */
  async function pantalla(ancho, alto, dedo) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: dedo ? 2 : 1, mobile: dedo });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: dedo, maxTouchPoints: 5 });
    await espera(250);
  }
  /** El centro del primer `sel` visible, traído a la vista. */
  const centro = (sel) =>
    en((sel) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length);
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getClientRects()[0];
      return { x: Math.round(r.left + Math.min(r.width / 2, 20)), y: Math.round(r.top + r.height / 2) };
    }, sel);
  async function clic(sel) {
    const p = await centro(sel);
    if (!p) return false;
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
    await espera(80);
    return true;
  }
  async function tocar(sel) {
    const p = await centro(sel);
    if (!p) return false;
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await espera(80);
    return true;
  }
  async function foto(nombre) {
    if (!fotos) return;
    await espera(300);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
  }
  const paginas = async () => (await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json()).filter((t) => t.type === "page").length;
  const abrio = () => (existsSync(abiertos) ? readFileSync(abiertos, "utf8").trim().split("\n").filter(Boolean) : []);
  const cerrar = () => {
    ws.close();
    app.kill();
    rmSync(tmp, { recursive: true, force: true });
  };
  return { cdp, en, hasta, pantalla, clic, tocar, foto, paginas, abrio, cerrar };
}

// --- Lo que se mira en la página (se manda como texto) ----------------------------------------

/**
 * Lo que se sale: del documento, de la columna de la conversación o de su mensaje. Lo que está
 * adentro de una caja que se desliza de costado (un bloque de código, una tabla) no cuenta: la
 * caja sí, y además tiene que poder recorrerse.
 */
const desbordes = () => {
  const mal = [];
  const zona = document.querySelector(".conv-zona");
  const conv = document.querySelector(".conv");
  if (!zona || !conv) return ["no hay conversación"];
  if (document.documentElement.scrollWidth > innerWidth) mal.push(`documento: ${document.documentElement.scrollWidth} en ${innerWidth}`);
  if (zona.scrollWidth > zona.clientWidth + 1) mal.push(`la columna: ${zona.scrollWidth} en ${zona.clientWidth}`);
  const nombre = (el) => `${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(" ")[0]}`;
  const deslizable = (el) => {
    for (let p = el.parentElement; p && p !== conv; p = p.parentElement) if (["auto", "scroll"].includes(getComputedStyle(p).overflowX)) return true;
    return false;
  };
  const c = conv.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(conv).paddingRight);
  for (const el of conv.querySelectorAll("*")) {
    if (mal.length >= 8) break;
    if (!el.getClientRects().length || deslizable(el)) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.position === "absolute") continue;
    // Renglón por renglón: un enlace que da la vuelta mide lo que su renglón más largo.
    for (const r of el.getClientRects()) {
      if (r.right > c.right - pad + 1 || r.left < c.left + pad - 1) {
        mal.push(`${nombre(el)} ${Math.round(r.left)}..${Math.round(r.right)} fuera de la columna ${Math.round(c.left + pad)}..${Math.round(c.right - pad)}`);
        break;
      }
      const caja = el.closest(".yo, .el, .pregunta");
      if (caja && caja !== el) {
        const b = caja.getBoundingClientRect();
        if (r.right > b.right + 1 || r.left < b.left - 1) {
          mal.push(`${nombre(el)} ${Math.round(r.left)}..${Math.round(r.right)} fuera de su mensaje ${Math.round(b.left)}..${Math.round(b.right)}`);
          break;
        }
      }
    }
  }
  // Lo recortado sin forma de llegar: más ancho que su caja, que no se recorre ni avisa con "…".
  for (const el of conv.querySelectorAll("*")) {
    if (mal.length >= 8) break;
    const s = getComputedStyle(el);
    if (!["hidden", "clip"].includes(s.overflowX) || s.textOverflow === "ellipsis" || !el.getClientRects().length || el.clientWidth <= 1) continue;
    if (el.scrollWidth > el.clientWidth + 1) mal.push(`cortado: ${nombre(el)} ${el.scrollWidth} en ${el.clientWidth}`);
  }
  return mal;
};

/** Cuánto hay de cada forma del texto en la conversación. */
const formas = () => {
  const n = (sel) => document.querySelectorAll(`.conv ${sel}`).length;
  const color = (sel) => {
    const el = document.querySelector(`.conv ${sel}`);
    return el ? getComputedStyle(el).color : "";
  };
  const pre = [...document.querySelectorAll(".conv .codigo pre")];
  return {
    titulos: n(".el h4"),
    niveles: new Set([...document.querySelectorAll(".conv .el h4")].map((h) => `${h.dataset.n}:${getComputedStyle(h).fontSize}`)).size,
    ol: n(".el ol"),
    anidada: n(".el li ul"),
    casillas: n(".el li[data-casilla]"),
    tabla: n(".el .tabla table"),
    enlaces: n(":is(.el, .yo) a[href]"),
    enLinea: n(".el :is(p, li) code"),
    rutas: n(".el code[data-ruta]"),
    bloques: pre.length,
    resaltados: n(".codigo pre span[data-c]"),
    colores: new Set([...document.querySelectorAll(".conv .codigo pre span[data-c]")].map((s) => getComputedStyle(s).color)).size,
    copiar: n(".codigo .codigo-c"),
    cita: n(".el blockquote"),
    regla: n(".el hr"),
    term: n(".yo .term"),
    prompts: n(".yo .term .term-p"),
    cEnlace: color(":is(.el, .yo) a[href]"),
    cTexto: color(".el p"),
    cRuta: color(".el code[data-ruta]"),
    cCodigo: color(".el :is(p, li) code:not([data-ruta])"),
    // Un bloque más ancho que su caja se recorre de costado, no se parte.
    deslizan: pre.filter((p) => p.scrollWidth > p.clientWidth + 1 && getComputedStyle(p).overflowX === "auto" && getComputedStyle(p).whiteSpace === "pre").length,
    partidos: pre.filter((p) => getComputedStyle(p).whiteSpace !== "pre").length,
  };
};

/** La URL larga del mensaje propio: en cuántos renglones quedó y si entra en su globo. */
const urlLarga = () => {
  const a = [...document.querySelectorAll(".conv .yo a[href]")].sort((x, y) => y.textContent.length - x.textContent.length)[0];
  if (!a) return null;
  const yo = a.closest(".yo").getBoundingClientRect();
  const rs = [...a.getClientRects()];
  return { letras: a.textContent.length, renglones: rs.length, adentro: rs.every((r) => r.left >= yo.left - 1 && r.right <= yo.right + 1), globo: Math.round(yo.width) };
};

/** El blanco de Copiar: hasta dónde llega alrededor de su centro (cuenta el `::after`). */
const blancoCopiar = () => {
  const b = document.querySelector(".conv .codigo-c");
  if (!b) return null;
  b.scrollIntoView({ block: "center" });
  const r = b.getBoundingClientRect();
  const d = getComputedStyle(b, "::after");
  const crece = d.content === "none" ? 0 : -parseFloat(d.top || "0");
  return { ancho: r.width + 2 * crece, alto: r.height + 2 * crece, opacidad: getComputedStyle(b).opacity };
};

// --- Las corridas ------------------------------------------------------------------------------

const PANTALLAS = [
  { nombre: "ventana", ancho: 1280, alto: 900, dedo: false },
  { nombre: "360", ancho: 360, alto: 800, dedo: true },
];

async function correr(variante) {
  const que = variante || "formato";
  const a = await abrir(variante);
  try {
    await a.hasta(() => !!document.querySelector(".conv :is(.el, .yo)"), "la conversación");
    // El portapapeles de verdad no se toca: uno de mentira, que anota lo que le dan. Y una captura
    // no atiende al puntero (`pointer-events-none` en `.app`): acá sí, que hay que tocar.
    await a.en(() => {
      document.head.appendChild(document.createElement("style")).textContent = ".app.pointer-events-none { pointer-events: auto !important; }";
      window.__copiado = null;
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => void (window.__copiado = t) } });
    });
    for (const p of PANTALLAS) {
      const en = `${que} a ${p.nombre}`;
      await a.pantalla(p.ancho, p.alto, p.dedo);
      await a.hasta((w) => innerWidth === w, "el ancho", p.ancho);
      if (p.dedo) {
        // En angosto la lista tapa lo abierto si quedó a la vista: se entra al líder.
        await a.en(() => document.querySelector(".app")?.setAttribute("data-oculta", ""));
        await espera(300);
      }
      // Los pasos del turno, abiertos: ahí también hay un comando sin espacios.
      await a.en(() => document.querySelectorAll(".conv details.trabajo").forEach((d) => (d.open = true)));
      await espera(200);
      const mal = await a.en(desbordes);
      ok(mal.length === 0, `${en}: nada se sale de su mensaje ni de la columna${mal.length ? `: ${mal.join("; ")}` : ""}`);
      const f = await a.en(formas);

      if (variante === "pegado") {
        const u = await a.en(urlLarga);
        ok(!!u && u.letras > 380 && u.renglones > 3 && u.adentro, `${en}: la URL de ${u?.letras} letras se parte adentro del globo (${u?.renglones} renglones, globo de ${u?.globo} px)`);
        ok(f.term === 1 && f.prompts === 3, `${en}: lo pegado de la terminal va como terminal, un renglón por renglón (${f.prompts} prompts)`);
        ok(f.tabla === 1, `${en}: la tabla con una celda sin espacios`);
      } else {
        ok(f.titulos >= 3 && f.niveles >= 3, `${en}: títulos de ${f.niveles} tamaños (${f.titulos})`);
        ok(f.ol >= 1 && f.anidada >= 1 && f.casillas === 3, `${en}: lista numerada, una adentro y tareas`);
        ok(f.tabla === 1 && f.cita === 1 && f.regla === 1, `${en}: tabla, cita y regla`);
        ok(f.enlaces >= 1 && f.cEnlace !== f.cTexto, `${en}: el enlace con su color (${f.cEnlace})`);
        ok(f.enLinea >= 3 && f.rutas >= 2 && f.cRuta !== f.cCodigo, `${en}: código en línea (${f.enLinea}) y rutas con su color (${f.rutas})`);
        ok(f.bloques === 3 && f.copiar === 3 && f.resaltados > 10 && f.colores >= 4, `${en}: tres bloques resaltados (${f.resaltados} pedazos, ${f.colores} colores) con Copiar`);
        ok(f.partidos === 0 && (p.dedo ? f.deslizan >= 1 : true), `${en}: un bloque no se parte${p.dedo ? `; ${f.deslizan} se deslizan de costado` : ""}`);

        // Copiar: el primer bloque, entero.
        const b = await a.en(blancoCopiar);
        if (p.dedo) ok(!!b && b.opacidad === "1" && b.ancho >= DEDO && b.alto >= DEDO, `${en}: Copiar a la vista y del tamaño del dedo (${b?.ancho}×${b?.alto})`);
        await a.en(() => void (window.__copiado = null));
        await (p.dedo ? a.tocar(".conv .codigo-c") : a.clic(".conv .codigo-c"));
        const copiado = await a.hasta(() => window.__copiado, "lo copiado");
        const codigo = await a.en(() => document.querySelector(".conv .codigo pre").textContent);
        ok(!!copiado && copiado === codigo && copiado.includes("export function ordenar"), `${en}: Copiar copia el bloque entero`);
        ok(await a.hasta(() => document.querySelector(".conv .codigo-c")?.hasAttribute("data-hecho"), "el tilde"), `${en}: y lo dice con el tilde`);
      }

      // El enlace sale al navegador (de mentira) y la ventana se queda donde estaba.
      const antes = a.abrio().length;
      const aca = await a.en(() => location.href);
      const destino = await a.en(() => document.querySelector(".conv :is(.el, .yo) a[href]").href);
      await (p.dedo ? a.tocar(".conv :is(.el, .yo) a[href]") : a.clic(".conv :is(.el, .yo) a[href]"));
      for (let i = 0; i < 30 && a.abrio().length === antes; i++) await espera(100);
      const abiertos = a.abrio();
      ok(abiertos.length === antes + 1 && abiertos.at(-1) === destino, `${en}: el enlace sale al navegador del sistema`);
      ok((await a.en(() => location.href)) === aca && (await a.paginas()) === 1, `${en}: y la ventana ni navega ni abre otra`);
      await a.foto(`${que}-${p.nombre}`);
    }
  } finally {
    a.cerrar();
  }
}

await correr("");
await correr("pegado");
console.log(fallas ? `\n${fallas} falla(s)` : "\ntodo bien");
process.exit(fallas ? 1 : 0);
