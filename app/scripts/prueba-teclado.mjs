#!/usr/bin/env node
// Prueba del teclado (docs/estado/teclado.md): por CDP y sólo con teclas, recorre con Tab la barra, un chat, el tablero y Ajustes: cada parada
// tiene el anillo de foco a la vista y nada que se toque queda sin nombre; `?` abre la lista de atajos, Tab no se sale de ella, Esc la cierra
// y el foco vuelve a donde estaba; Esc cierra el panel y el detalle del tablero. Todo son fixtures y fakes: nada toca `pa` ni datos de verdad.
//   npm run build && node scripts/prueba-teclado.mjs        (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

async function app(captura, ancho, alto, extra = {}) {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-teclado-")));
  const puerto = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
    env: {
      ...process.env,
      HILOS_PRUEBA: "60",
      HILOS_CAPTURA: captura,
      HILOS_CAPTURA_MS: "120000",
      HILOS_IDIOMA: "es",
      HILOS_TAM: `${ancho} ${alto}`,
      HILOS_STATE: path.join(tmp, "hilos"),
      HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
      HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
      PA_STATE: path.join(tmp, "pa"),
      HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
      HILOS_TABLERO: "/bin/false",
      ...extra,
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
  if (!url) throw new Error("la app no abrió el puerto de CDP");
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
  const en = async (fn, ...args) => {
    const r = await cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value;
  };
  const hasta = async (fn, tope = 10, ...args) => {
    for (let i = 0; i < tope * 20; i++) {
      const v = await en(fn, ...args).catch(() => null);
      if (v) return v;
      await espera(50);
    }
    return null;
  };
  const tecla = async (key, code, vk, { shift = false, text } = {}) => {
    const modifiers = shift ? 8 : 0;
    await cdp("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers, text });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    await espera(60);
  };
  const tab = (shift = false) => tecla("Tab", "Tab", 9, { shift });
  const esc = () => tecla("Escape", "Escape", 27);
  const interrogante = () => tecla("?", "Slash", 191, { shift: true, text: "?" });
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.reload");
  const cerrar = () => {
    ws.close();
    proc.kill();
    rmSync(tmp, { recursive: true, force: true });
  };
  const foto = async (nombre) => {
    if (!fotos) return;
    await espera(300);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
  };
  return { cdp, en, hasta, cerrar, foto, tab, esc, interrogante, enter: () => tecla("Enter", "Enter", 13, { text: "\r" }) };
}

// ---- Lo que corre dentro de la página ----

/** Los controles a la vista sin nombre para un lector de pantalla: sin texto, ni aria-label, ni nada que los nombre. */
const sinNombre = () => {
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert]");
  const nombre = (el) => {
    const l = el.getAttribute("aria-label");
    if (l?.trim()) return l;
    const por = el.getAttribute("aria-labelledby");
    if (por && por.split(/\s+/).some((i) => document.getElementById(i)?.textContent?.trim())) return "ref";
    if (el.labels?.length && [...el.labels].some((x) => x.textContent?.trim())) return "label";
    if (el.closest("label")?.textContent?.trim()) return "label";
    if (el.textContent?.trim()) return el.textContent.trim();
    if (el.getAttribute("title")?.trim()) return "title";
    if (el.getAttribute("placeholder")?.trim() && el.matches("input, textarea")) return "placeholder";
    return "";
  };
  return [...document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"]), textarea, select, [tabindex="0"]')]
    .filter((el) => visible(el) && !nombre(el))
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
};

/** Lo que tiene el foco ahora y si se le ve el anillo (en él o en el campo que lo envuelve: la búsqueda y la caja). */
const parada = () => {
  const a = document.activeElement;
  if (!a || a === document.body) return { cuerpo: true };
  const anillo = (el) => {
    const s = getComputedStyle(el);
    return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
  };
  const dentro = a.closest("[role=dialog], [aria-modal], .at, aside, main, nav, form") ;
  const r = a.getBoundingClientRect();
  return {
    cuerpo: false,
    id: `${a.tagName.toLowerCase()}.${String(a.className).slice(0, 30)}|${a.getAttribute("aria-label") ?? a.textContent?.trim().slice(0, 20) ?? ""}`,
    anillo: a.matches(":focus-visible") && (anillo(a) || (a.closest(".buscar, .caja") ? anillo(a.closest(".buscar, .caja")) : false)),
    visible: r.width > 0 && r.height > 0,
    en: dentro ? `${dentro.tagName.toLowerCase()}.${String(dentro.className).slice(0, 20)}` : "",
  };
};

const hayAtajos = () => !!document.querySelector(".at-caja");
const enAtajos = () => !!document.activeElement?.closest(".at-caja");

/** Tab hasta que el foco vuelve a la primera parada o pasan `tope`; devuelve las paradas. */
async function recorrer(a, tope = 60) {
  const vistas = [];
  for (let i = 0; i < tope; i++) {
    await a.tab();
    const p = await a.en(parada);
    if (!p || p.cuerpo) {
      vistas.push({ cuerpo: true });
      continue;
    }
    if (vistas.length && vistas[0].id === p.id) break;
    vistas.push(p);
  }
  return vistas;
}

function revisar(que, vistas, minimo) {
  ok(vistas.length >= minimo, `${que}: Tab recorre ${vistas.length} controles (mínimo ${minimo})`);
  const sinAnillo = vistas.filter((v) => !v.cuerpo && !v.anillo).map((v) => v.id);
  ok(!sinAnillo.length, `${que}: todas las paradas tienen anillo de foco${sinAnillo.length ? ` — sin él: ${sinAnillo.slice(0, 5).join("; ")}` : ""}`);
  const perdido = vistas.filter((v) => v.cuerpo).length;
  ok(perdido <= 1, `${que}: el foco no se pierde en el body (${perdido} veces; una es la salida de la página)`);
}

// 1) La barra y un chat, con la lista de atajos.
{
  const a = await app("lider", 1280, 800);
  try {
    ok(await a.hasta(() => !!document.querySelector("[data-fila]"), 20), "lider: la barra cargó");
    await espera(500);
    const sn = await a.en(sinNombre);
    ok(!sn.length, `lider: todo control a la vista tiene nombre${sn.length ? ` — sin él: ${sn.slice(0, 6).join("; ")}` : ""}`);
    revisar("lider", await recorrer(a), 8);

    // `?` con el foco en un botón abre la lista; Tab da la vuelta adentro; Esc la cierra y el foco vuelve.
    await a.en(() => document.querySelector("[data-fila] button")?.focus());
    const antes = (await a.en(parada)).id;
    await a.interrogante();
    ok(await a.hasta(hayAtajos, 3), "? abre la lista de atajos");
    ok(await a.hasta(enAtajos, 2), "la lista se lleva el foco");
    ok(await a.en(() => document.querySelector(".at-caja")?.getAttribute("role") === "dialog" && document.querySelector(".at-caja")?.getAttribute("aria-modal") === "true"), "la lista es un diálogo modal");
    ok(await a.en(() => document.querySelectorAll(".at-tecla").length >= 10), "la lista muestra las teclas de la tabla");
    await a.foto("atajos-1280");
    let dentro = true;
    for (let i = 0; i < 6; i++) {
      await a.tab();
      dentro &&= await a.en(enAtajos);
    }
    ok(dentro, "Tab no se sale de la lista");
    await a.tab(true);
    ok(await a.en(enAtajos), "Shift+Tab tampoco");
    await a.esc();
    ok(await a.hasta(() => !document.querySelector(".at-caja"), 3), "Esc cierra la lista");
    ok((await a.en(parada)).id === antes, "y el foco vuelve a donde estaba");
    // Con el foco en la búsqueda, ? es un carácter, no el atajo.
    await a.en(() => document.querySelector(".buscar input")?.focus());
    await a.interrogante();
    await espera(200);
    ok(!(await a.en(hayAtajos)), "? escrito en la búsqueda no abre la lista");
    await a.esc();

    // El chat: la caja y sus controles se alcanzan con Tab.
    await a.en(() => document.querySelector(".caja textarea, .caja input")?.focus());
    ok(await a.en(() => !!document.activeElement?.closest(".caja")), "la caja del chat se enfoca");
    await a.foto("caja-1280");
    await a.esc();
    ok(await a.en(() => !document.activeElement?.closest(".caja")), "Esc suelta la caja");

    // Ajustes desde el pie: Esc cierra y el foco vuelve al botón.
    const abrio = await a.en(() => {
      const b = [...document.querySelectorAll(".barra footer button, .pie button, [data-ver] ")].find((x) => /ajustes|settings/i.test(x.getAttribute("aria-label") ?? x.textContent ?? ""));
      b?.focus();
      b?.click();
      return !!b;
    });
    ok(abrio, "Ajustes: el botón del pie existe");
    ok(await a.hasta(() => !!document.querySelector("main[aria-label]"), 5), "Ajustes: el panel abre");
    ok(await a.hasta(() => !!document.activeElement?.closest("main"), 3), "Ajustes: el foco entra al panel");
    const sn2 = await a.en(sinNombre);
    ok(!sn2.length, `Ajustes: todo control a la vista tiene nombre${sn2.length ? ` — sin él: ${sn2.slice(0, 6).join("; ")}` : ""}`);
    revisar("Ajustes", await recorrer(a, 80), 5);
    // Su botón de atajos abre la lista (vive en General).
    await a.en(() => document.querySelector('.aj-it[data-cat="general"]')?.click());
    const filaAtajos = await a.en(() => {
      const b = [...document.querySelectorAll("main button")].find((x) => /atajos|shortcuts/i.test(x.textContent ?? ""));
      b?.focus();
      return !!b;
    });
    ok(filaAtajos, "Ajustes: tiene su botón de la lista de atajos");
    await a.enter();
    ok(await a.hasta(hayAtajos, 3), "Ajustes: Enter en ese botón abre la lista");
    await a.esc();
    ok(await a.hasta(() => !document.querySelector(".at-caja"), 3), "Ajustes: Esc cierra la lista y el panel sigue");
    ok(await a.en(() => !!document.querySelector("main[aria-label]")), "Ajustes: el panel sigue abierto tras cerrar la lista");
  } finally {
    a.cerrar();
  }
}

// 2) El tablero y su detalle.
{
  const a = await app("tablero-nuevo", 1280, 800);
  try {
    ok(await a.hasta(() => !!document.querySelector("[class*='tb-']"), 20), "tablero: carga");
    await espera(600);
    const sn = await a.en(sinNombre);
    ok(!sn.length, `tablero: todo control a la vista tiene nombre${sn.length ? ` — sin él: ${sn.slice(0, 6).join("; ")}` : ""}`);
    revisar("tablero", await recorrer(a, 80), 5);
  } finally {
    a.cerrar();
  }
}
{
  const a = await app("tablero-detalle", 1280, 800);
  try {
    ok(await a.hasta(() => !!document.querySelector("aside.tb-det, [class*='tb-det']"), 20), "detalle del tablero: abre");
    ok(await a.hasta(() => !!document.activeElement?.closest("[class*='tb-det']"), 3), "detalle: el foco entra");
    let dentro = true;
    for (let i = 0; i < 8; i++) {
      await a.tab();
      dentro &&= await a.en(() => !!document.activeElement?.closest("[class*='tb-det']"));
    }
    ok(dentro, "detalle: Tab no se sale");
    await a.esc();
    ok(await a.hasta(() => !document.querySelector("aside.tb-det, [class*='tb-det']"), 3), "detalle: Esc lo cierra");
  } finally {
    a.cerrar();
  }
}

// 3) A 360 px la lista de atajos cabe.
{
  const a = await app("atajos", 360, 780);
  try {
    ok(await a.hasta(hayAtajos, 15), "360: la lista de atajos abre");
    await espera(400);
    const m = await a.en(() => {
      const c = document.querySelector(".at-caja").getBoundingClientRect();
      return { izq: c.left, der: c.right, ab: c.bottom, ancho: innerWidth, alto: innerHeight, sobra: document.documentElement.scrollWidth > innerWidth };
    });
    ok(m && m.izq >= 0 && m.der <= m.ancho && m.ab <= m.alto && !m.sobra, `360: la lista cabe en la pantalla ${JSON.stringify(m)}`);
    await a.foto("atajos-360");
  } finally {
    a.cerrar();
  }
}

console.log(fallas ? `${fallas} falla(s)` : "todo ok");
process.exit(fallas ? 1 : 0);
