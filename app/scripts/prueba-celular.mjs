#!/usr/bin/env node
// Prueba de Trama en un celular de mentira: abre la app offscreen (HILOS_PRUEBA, sin ventana),
// le pone por CDP la pantalla de un teléfono (360, 400 y 430 px de ancho, táctil: `pointer: coarse`)
// y la maneja con toques. Dos corridas: con fixtures (la barra llena: una cosa a la vez, nada más
// ancho que la pantalla, blancos para el dedo, ir y volver) y con el `pa` y el `claude` falsos
// (escribirle a un líder y mandarlo con el teclado abierto). Nada toca `pa` de verdad.
//   npm run build && node scripts/prueba-celular.mjs
//   FOTOS=<carpeta>   además deja capturas de cada paso (default: no saca)
// Y un caso por máquina (la PC y la otra máquina, `maquinas.json` de cada una): la app anda igual de angosta y la página que
// sirve la red lleva su título, su color, su manifest y su ícono, así el celular tiene un acceso directo por máquina.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });
const ANCHOS = [360, 400, 430];
const ALTO = 800;
/** Lo que deja el teclado en pantalla abierto. */
const ALTO_TECLADO = 460;
/** El blanco del dedo: 2.75rem (44 px), con un px de gracia por el redondeo. */
const DEDO = 43;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

/** Abre la app con `env` (y, si se da, ese `maquinas.json` en su estado propio) y devuelve cómo manejarla. */
async function abrir(env, maquinas = null) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-celular-"));
  if (maquinas) {
    mkdirSync(path.join(tmp, "hilos"));
    writeFileSync(path.join(tmp, "hilos", "maquinas.json"), JSON.stringify(maquinas));
  }
  const puerto = 9300 + Math.floor(Math.random() * 600);
  for (const d of ["atlas", "brote"]) mkdirSync(path.join(tmp, "proy", d), { recursive: true });
  mkdirSync(path.join(tmp, "pa"));
  mkdirSync(path.join(tmp, "sesiones"));
  writeFileSync(
    path.join(tmp, "registry.json"),
    JSON.stringify({
      projects: [
        { name: "Atlas Web", path: path.join(tmp, "proy", "atlas"), desc: "La web", tests: "npm test" },
        { name: "brote", path: path.join(tmp, "proy", "brote"), desc: "El jardín" },
      ],
    }),
  );
  writeFileSync(path.join(tmp, "settings.json"), JSON.stringify({ autoCompactWindow: 200_000 }));
  writeFileSync(path.join(tmp, "plan"), "max\n");
  writeFileSync(path.join(tmp, "CLAUDE.md"), "");
  const app = spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${puerto}`], {
    env: {
      ...process.env,
      HILOS_PRUEBA: "90",
      HILOS_IDIOMA: "es",
      HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
      PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
      PA_STATE: path.join(tmp, "pa"),
      HILOS_STATE: path.join(tmp, "hilos"),
      HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil"),
      PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
      HILOS_SESIONES: path.join(tmp, "sesiones"),
      HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
      HILOS_CLAUDE_SETTINGS: path.join(tmp, "settings.json"),
      HILOS_CLAUDE_MD: path.join(tmp, "CLAUDE.md"),
      HILOS_PA_PLAN: path.join(tmp, "plan"),
      HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
      HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
      HILOS_TABLERO: "/bin/false",
      AVISO_CONTEXTO: "",
      ...env,
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
  /** La pantalla del teléfono: ancho, alto y el dedo en vez del mouse. */
  async function pantalla(ancho, alto = ALTO) {
    await cdp("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: 2, mobile: true });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await espera(150);
  }
  /** Dónde tocar: el centro del primer `sel` visible que contenga `texto` (si se da). */
  const centro = (sel, texto = null) =>
    en(
      (sel, texto) => {
        const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length && (texto === null || e.textContent.includes(texto)));
        if (!el || el.disabled) return null;
        el.scrollIntoView({ block: "nearest" });
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      },
      sel,
      texto,
    );
  /** Un toque con el dedo; con `ms`, mantenido. */
  async function tocar(sel, texto = null, ms = 0) {
    const p = await centro(sel, texto);
    if (!p) return false;
    await tocarEn(p.x, p.y, ms);
    return true;
  }
  /** Un toque en un punto de la pantalla. */
  async function tocarEn(x, y, ms = 0) {
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    if (ms) await espera(ms);
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await espera(60);
  }
  async function foto(nombre) {
    if (!fotos) return;
    // Que termine lo que se está moviendo (la lista se desliza 220 ms).
    await espera(350);
    const r = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
  }
  const cerrar = () => {
    ws.close();
    app.kill();
  };
  return { cdp, en, hasta, pantalla, tocar, tocarEn, foto, cerrar, tmp };
}

// --- Lo que se mira en la página (se manda como texto) ----------------------------------------

/** Qué se ve: la lista o lo abierto. */
const seVe = () => {
  const visible = (el) => !!el && getComputedStyle(el).visibility !== "hidden" && el.getClientRects().length > 0;
  const hilo = [...document.querySelectorAll(".app > .hilo")].find(visible);
  const lista = !document.querySelector(".app").hasAttribute("data-oculta");
  const w = (el) => Math.round(el.getBoundingClientRect().width);
  return { lista, abierto: !!hilo && !lista, anchoLista: w(document.querySelector(".barra-cuerpo")), anchoHilo: hilo ? w(hilo) : 0, ancho: innerWidth };
};

/** Lo que se sale de la pantalla por un costado sin que nada lo recorte (hasta 6). */
const desbordes = () => {
  const mal = [];
  if (document.documentElement.scrollWidth > innerWidth) mal.push(`documento: ${document.documentElement.scrollWidth}`);
  const recortado = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== "visible" || s.visibility === "hidden") return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.opacity === "0" || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > innerWidth + 1 || r.left < -1) && !recortado(el)) mal.push(`${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(" ")[0]} ${Math.round(r.left)}..${Math.round(r.right)}`);
    if (mal.length >= 6) break;
  }
  // Y lo que queda cortado sin forma de llegar: más ancho que su caja, que no se recorre ni avisa con "…".
  for (const el of document.querySelectorAll("body *")) {
    if (mal.length >= 6) break;
    const s = getComputedStyle(el);
    if (!["hidden", "clip"].includes(s.overflowX) || s.textOverflow === "ellipsis" || !el.getClientRects().length || el.clientWidth <= 1) continue;
    if (s.visibility === "hidden" || el.closest(".barra") && document.querySelector(".app").hasAttribute("data-oculta")) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) mal.push(`cortado: ${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className).split(" ")[0]} ${el.scrollWidth} en ${el.clientWidth}`);
  }
  return mal;
};

/** Lo que se toca y mide menos que el dedo (contando el `::after` que agranda a los chiquitos). */
const chicos = (dedo) => {
  const mal = new Set();
  for (const el of document.querySelectorAll("button, summary, textarea, input:not([hidden]), [role='button'], [role='option'], [role='menuitem']")) {
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.pointerEvents === "none" || !el.getClientRects().length || el.closest("[inert]")) continue;
    let oculto = false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const sp = getComputedStyle(p);
      if (sp.visibility === "hidden" || sp.opacity === "0") oculto = true;
    }
    if (oculto) continue;
    // El campo de texto dentro de su etiqueta: se toca la etiqueta entera.
    const r = ((el.tagName === "INPUT" && el.closest("label")) || el).getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const a = getComputedStyle(el, "::after");
    const extra = a.content !== "none" && a.position === "absolute" ? -(parseFloat(a.top || "0") + parseFloat(a.bottom || "0")) : 0;
    const alto = r.height + (extra > 0 ? extra : 0);
    if (alto < dedo) mal.add(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ${Math.round(r.width)}×${Math.round(alto)}`);
  }
  return [...mal];
};

/**
 * La fila de abajo de la caja (adjuntar, modo, modelo, esfuerzo, contexto, Parar, enviar): una
 * sola fila, sin encimarse, con el enviar último a la derecha y todo dentro de la pantalla.
 */
const filaCaja = () => {
  const fila = document.querySelector(".caja .barra-c");
  if (!fila) return { ok: false, que: "sin fila" };
  const cs = [...fila.children].filter((e) => e.getClientRects().length && !e.classList.contains("esp"));
  const r = cs.map((e) => e.getBoundingClientRect());
  const f = fila.getBoundingClientRect();
  const medio = (x) => x.top + x.height / 2;
  const unaFila = r.every((x) => Math.abs(medio(x) - medio(r[0])) < 4);
  const sinEncimar = r.every((x, i) => i === 0 || x.left >= r[i - 1].right - 0.5);
  const dentro = r.every((x) => x.left >= f.left - 0.5 && x.right <= f.right + 0.5) && f.right <= innerWidth;
  // Los selectores, con su texto entero (ceder ancho es sólo el último recurso).
  const entero = [...fila.querySelectorAll(".pbtn")].every((b) => !b.getClientRects().length || b.scrollWidth <= b.clientWidth + 1);
  const ultimo = cs.at(-1);
  const enviar = !!ultimo?.classList.contains("prim") && f.right - r.at(-1).right < 2;
  const que = cs.map((e, i) => `${String(e.className).split(" ")[0] || e.tagName.toLowerCase()} ${Math.round(r[i].left)}-${Math.round(r[i].right)}@${Math.round(r[i].top)}`).join(", ");
  return { ok: unaFila && sinEncimar && dentro && enviar && entero, entero, unaFila, sinEncimar, dentro, enviar, modo: fila.querySelector(".modo")?.textContent ?? "", que: `fila ${Math.round(f.left)}-${Math.round(f.right)}: ${que}` };
};

try {
  // --- 1. Con fixtures: la barra llena, en los tres anchos ---------------------------------
  {
    const a = await abrir({ HILOS_FIXTURES: "1" });
    try {
      await a.pantalla(ANCHOS[0]);
      ok(await a.hasta(() => document.querySelectorAll("[data-fila]").length >= 3 && !!document.querySelector(".lider[data-lider]"), "filas"), "llega la barra de fixtures");
      ok(await a.en(() => matchMedia("(pointer: coarse)").matches && matchMedia("(max-width: 35rem)").matches), "la página se cree un celular (angosta y con dedo)");
      for (const ancho of ANCHOS) {
        await a.pantalla(ancho);
        let v = await a.en(seVe);
        ok(v.lista && !v.abierto && v.anchoLista === ancho, `${ancho}: se ve sólo la lista, a todo el ancho (${JSON.stringify(v)})`);
        let d = await a.en(desbordes);
        ok(d.length === 0, `${ancho}: en la lista nada se sale de la pantalla${d.length ? `: ${d.join(" | ")}` : ""}`);
        let c = await a.en(chicos, DEDO);
        ok(c.length === 0, `${ancho}: en la lista todo lo que se toca mide para el dedo${c.length ? `: ${c.join(" | ")}` : ""}`);
        await a.foto(`${ancho}-lista`);

        // Un líder: su chat ocupa la pantalla y la caja no roba el foco (no abre el teclado).
        ok(await a.tocar(".lider[data-lider]"), `${ancho}: toque en un líder`);
        v = await a.hasta(() => document.querySelector(".app").hasAttribute("data-oculta"), "abierto").then(() => espera(300)).then(() => a.en(seVe));
        ok(v.abierto && v.anchoHilo === ancho, `${ancho}: se ve sólo su chat, a todo el ancho (${JSON.stringify(v)})`);
        ok(await a.en(() => document.activeElement?.tagName !== "TEXTAREA"), `${ancho}: abrirlo no enfoca la caja (el teclado no tapa lo que se vino a leer)`);
        d = await a.en(desbordes);
        ok(d.length === 0, `${ancho}: en el chat nada se sale de la pantalla${d.length ? `: ${d.join(" | ")}` : ""}`);
        c = await a.en(chicos, DEDO);
        ok(c.length === 0, `${ancho}: en el chat todo lo que se toca mide para el dedo${c.length ? `: ${c.join(" | ")}` : ""}`);
        await a.foto(`${ancho}-chat`);

        // Las acciones de un mensaje, con el dedo: tocarlo abre su fila debajo (sin tapar el texto) y tocar fuera la cierra.
        const ultimo = await a.en(() => {
          // El último mensaje (el que sigue a la última fila de acciones): puede haber otros avisos debajo, sin fila.
          const m = [...document.querySelectorAll(".conv > .am")].at(-1)?.previousElementSibling;
          if (!m) return null;
          m.scrollIntoView({ block: "center" });
          const r = m.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        if (ultimo) {
          await a.tocarEn(ultimo.x, ultimo.y);
          ok(await a.hasta(() => !!document.querySelector(".conv > .am[data-sobre]"), "fila"), `${ancho}: tocar un mensaje abre su fila de acciones`);
          // La fila se muestra con una transición de 120 ms (opacity).
          await espera(250);
          const fila = await a.en(() => {
            const am = document.querySelector(".conv > .am[data-sobre]");
            const m = am?.previousElementSibling;
            if (!am || !m) return null;
            const f = am.querySelector(".am-fila");
            return { visible: getComputedStyle(f).opacity === "1", debajo: Math.round(f.getBoundingClientRect().top) >= Math.round(m.getBoundingClientRect().bottom) - 1 };
          });
          ok(fila?.visible && fila.debajo, `${ancho}: la fila se ve debajo del mensaje, sin tapar su texto (${JSON.stringify(fila)})`);
          d = await a.en(desbordes);
          ok(d.length === 0, `${ancho}: con la fila abierta nada se sale de la pantalla${d.length ? `: ${d.join(" | ")}` : ""}`);
          await a.foto(`${ancho}-chat-fila`);
          await a.en(() => document.querySelector(".cab").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" })));
          ok(await a.en(() => !document.querySelector(".am[data-sobre]")), `${ancho}: tocar fuera de la conversación cierra la fila`);
        }

        // Los menús de la caja entran en la pantalla.
        if (await a.tocar(".caja .pick > .pbtn")) {
          await a.hasta(() => !!document.querySelector(".caja .menu"), "menú del modelo");
          await espera(250);
          d = await a.en(desbordes);
          ok(d.length === 0, `${ancho}: el menú del modelo entra en la pantalla${d.length ? `: ${d.join(" | ")}` : ""}`);
          await a.foto(`${ancho}-chat-modelo`);
          // Afuera del menú, arriba: el centro de la pantalla cae adentro si el menú es alto.
          await a.tocarEn(ancho / 2, 20);
          ok(await a.hasta(() => !document.querySelector(".caja .menu"), "menú cerrado"), `${ancho}: tocar afuera cierra el menú del modelo`);
        }

        // Volver: la flecha de arriba a la izquierda.
        ok(await a.tocar(".hilo:not(.pn-main) .migas .lado"), `${ancho}: toque en la flecha de volver`);
        ok(await a.hasta(() => !document.querySelector(".app").hasAttribute("data-oculta"), "lista"), `${ancho}: vuelve a la lista`);

        // Un worker: de sólo lectura, con sus botones al pie.
        await espera(300);
        ok(await a.tocar("[data-fila] .wbtn"), `${ancho}: toque en un worker`);
        await a.hasta(() => document.querySelector(".app").hasAttribute("data-oculta"), "abierto");
        await espera(300);
        d = await a.en(desbordes);
        ok(d.length === 0, `${ancho}: en el worker nada se sale de la pantalla${d.length ? `: ${d.join(" | ")}` : ""}`);
        c = await a.en(chicos, DEDO);
        ok(c.length === 0, `${ancho}: en el worker todo lo que se toca mide para el dedo${c.length ? `: ${c.join(" | ")}` : ""}`);
        await a.foto(`${ancho}-worker`);
        // Volver con el "atrás" del teléfono.
        await a.en(() => history.back());
        ok(await a.hasta(() => !document.querySelector(".app").hasAttribute("data-oculta"), "lista"), `${ancho}: el "atrás" del teléfono vuelve a la lista`);
        await espera(300);

        // Los paneles del pie.
        for (const [k, nombre] of ["ajustes", "ramas", "estadisticas", "tablero"].entries()) {
          await a.en((k) => document.querySelectorAll(".pie button")[k]?.scrollIntoView(), k);
          const p = await a.en((k) => {
            const r = document.querySelectorAll(".pie button")[k].getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          }, k);
          await a.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
          await a.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          v = await a.hasta(() => !!document.querySelector(".pn-main") && document.querySelector(".app").hasAttribute("data-oculta"), nombre).then(() => espera(400)).then(() => a.en(seVe));
          d = await a.en(desbordes);
          ok(v.abierto && d.length === 0, `${ancho}: ${nombre} ocupa la pantalla y nada se sale${d.length ? `: ${d.join(" | ")}` : ""}`);
          c = await a.en(chicos, DEDO);
          ok(c.length === 0, `${ancho}: en ${nombre} todo lo que se toca mide para el dedo${c.length ? `: ${c.join(" | ")}` : ""}`);
          await a.foto(`${ancho}-${nombre}`);
          if (nombre === "tablero") {
            // El Tablero abre en "Te esperan" (prueba-pendientes.mjs prueba esa vista); el kanban es la pestaña "Todo".
            ok(await a.tocar(".pd .tb-vistas button", "Todo"), `${ancho}: toque en la pestaña Todo`);
            await a.hasta(() => !!document.querySelector(".tb-card"), "el kanban");
            // Iniciar: con el dedo los dos botones de la tarjeta están siempre; el ▶ abre la confirmación.
            ok(await a.tocar(".tb-card .tb-marca"), `${ancho}: toque en la casilla de una tarjeta`);
            ok(await a.hasta(() => !!document.querySelector(".tb-ini-m") && !document.querySelector(".tb-det"), "marcada"), `${ancho}: la marca y no abre el detalle`);
            ok(await a.tocar(".tb-ini-m .tb-iniciar"), `${ancho}: toque en "Iniciar 1"`);
            ok(await a.hasta(() => !!document.querySelector(".tb-ini-c"), "la confirmación"), `${ancho}: aparece la confirmación`);
            await espera(200);
            d = await a.en(desbordes);
            ok(d.length === 0, `${ancho}: en la confirmación nada se sale de la pantalla${d.length ? `: ${d.join(" | ")}` : ""}`);
            c = await a.en(chicos, DEDO);
            ok(c.length === 0, `${ancho}: en la confirmación todo lo que se toca mide para el dedo${c.length ? `: ${c.join(" | ")}` : ""}`);
            await a.foto(`${ancho}-tablero-iniciar`);
            await a.tocar(".tb-ini-b .btn2:not(.tb-iniciar)");
            ok(await a.hasta(() => !document.querySelector(".tb-ini-c") && !!document.querySelector(".tb-ini-m"), "cancelada"), `${ancho}: Cancelar la saca y deja lo marcado`);
            await a.tocar(".tb-ini-m .btn2:not(.tb-iniciar)");
            await a.hasta(() => !document.querySelector(".tb-ini"), "desmarcadas");
          }
          await a.tocar(".pn-main .migas .lado");
          await a.hasta(() => !document.querySelector(".app").hasAttribute("data-oculta"), "lista");
          await espera(300);
        }
      }

      // Lo del hover y del clic derecho, con el dedo: mantener apretado.
      await a.pantalla(400);
      ok(await a.tocar(".vista button", null, 700), "mantener apretado un botón con tooltip");
      ok(await a.en(() => document.querySelector("#tip")?.hasAttribute("data-visible") && document.querySelector("#tip").getBoundingClientRect().right <= innerWidth), "muestra el tooltip, dentro de la pantalla");
      await a.foto("400-tooltip");
      await espera(2300);
      ok(await a.en(() => !document.querySelector("#tip")?.hasAttribute("data-visible")), "y se va solo");
      // Una fila: su menú (el del clic derecho), que trae lo que en el escritorio sale con el hover.
      await a.tocar("[data-fila] .wbtn", null, 800);
      const menu = await a.hasta(() => !!document.querySelector('[role="menu"]'), "menú de la fila");
      ok(!!menu && (await a.en(() => !document.querySelector(".app").hasAttribute("data-oculta"))), "mantener apretada una fila abre su menú, y no la abre a ella");
      if (menu) {
        const d = await a.en(desbordes);
        const c = await a.en(chicos, DEDO);
        ok(d.length === 0 && c.length === 0, `el menú de la fila entra en la pantalla y mide para el dedo${d.length || c.length ? `: ${[...d, ...c].join(" | ")}` : ""}`);
        await a.foto("400-menu");
      }
      // El orden a mano con el dedo (arrastrar es scrollear): el menú de un líder trae Subir / Bajar con blancos de 44 px y los mueve.
      // De fábrica el orden es por prioridad: su menú no trae Subir / Bajar, sólo "Orden fijo", y es lo que se toca para pasar a mano.
      await a.tocarEn(200, 8);
      await a.hasta(() => !document.querySelector('[role="menu"]'), "menú cerrado");
      const primero = await a.en(() => document.querySelector(".lider[data-lider]")?.dataset.lider ?? null);
      ok(primero !== null && (await a.tocar(`.lider[data-lider="${primero}"]`, null, 800)), "mantener apretado un líder con el orden de fábrica");
      const fijo = await a.hasta(() => !!document.querySelector('[role="menu"] [data-accion="prioridad"]'), "menú del líder (orden de fábrica)");
      ok(!!fijo && (await a.en(() => !document.querySelector('[role="menu"] [data-accion="subir"], [role="menu"] [data-accion="bajar"]'))), "por prioridad, el menú no trae Subir ni Bajar");
      await a.tocar('[role="menu"] [data-accion="prioridad"]');
      await a.hasta(() => !document.querySelector('[role="menu"]'), "menú cerrado tras Orden fijo");
      await a.tocarEn(200, 8);
      await a.hasta(() => !document.querySelector('[role="menu"]'), "menú cerrado");
      const lideres = () => a.en(() => [...document.querySelectorAll(".lider[data-lider]")].map((e) => e.dataset.lider));
      const antes = await lideres();
      // El primero de una carpeta con más de uno: no puede subir, sí bajar.
      const par = await a.en(() => {
        for (const p of document.querySelectorAll(".proy")) {
          const l = p.querySelectorAll(".lider[data-lider]");
          if (l.length >= 2) return l[0].dataset.lider;
        }
        return null;
      });
      ok(par !== null && (await a.tocar(`.lider[data-lider="${par}"]`, null, 800)), "mantener apretado un líder");
      const mo = await a.hasta(() => !!document.querySelector('[role="menu"] [data-accion="bajar"]'), "Bajar en el menú del líder");
      ok(!!mo && (await a.en(() => !document.querySelector('[role="menu"] [data-accion="subir"]'))), "el primero de su carpeta tiene Bajar y no Subir");
      if (mo) {
        const c = await a.en(chicos, DEDO);
        const d = await a.en(desbordes);
        ok(c.length === 0 && d.length === 0, `Subir / Bajar miden para el dedo y entran en la pantalla${c.length || d.length ? `: ${[...c, ...d].join(" | ")}` : ""}`);
        await a.foto("400-menu-orden");
        ok(await a.tocar('[role="menu"] [data-accion="bajar"]'), "toque en Bajar");
        ok(await a.hasta(() => !document.querySelector('[role="menu"]'), "menú cerrado"), "el menú se cierra");
        await espera(400);
        const despues = await lideres();
        ok(despues.join() !== antes.join() && despues.indexOf(par) > antes.indexOf(par), "el líder bajó un lugar en la lista");
        // Ahora hay algo a mano: "Orden por defecto" vuelve a lo de siempre.
        await a.tocar(`.lider[data-lider="${par}"]`, null, 800);
        ok(!!(await a.hasta(() => !!document.querySelector('[role="menu"] [data-accion="defecto"]'), "Orden por defecto")), "con algo a mano, el menú ofrece Orden por defecto");
        ok(await a.tocar('[role="menu"] [data-accion="defecto"]'), "toque en Orden por defecto");
        await a.hasta(() => !document.querySelector('[role="menu"]'), "menú cerrado");
        await espera(400);
        ok((await lideres()).join() === antes.join(), "y la lista vuelve al orden de siempre");
      }
    } finally {
      a.cerrar();
    }
  }

  // --- 2. Con el `claude` falso: escribirle a un líder y mandarlo ---------------------------
  {
    const a = await abrir({ HILOS_FIXTURES: "0" });
    try {
      await a.pantalla(400);
      ok(await a.hasta(() => document.querySelectorAll("[data-fila]").length >= 4, "filas"), "llegan las filas de pa-falso");
      ok(await a.tocar(".nueva"), "toque en Nueva tarea");
      ok(await a.hasta(() => document.querySelector(".app").hasAttribute("data-oculta") && !!document.querySelector(".caja textarea"), "caja"), "abre el líder nuevo, con su caja");
      // La fila de abajo de la caja con el modo de nombre más largo (bypass permissions on): antes el
      // enviar se caía solo a una segunda fila. Una fila, el enviar a la derecha, en los tres anchos.
      for (let i = 0; i < 4 && !(await a.en(() => /bypass/.test(document.querySelector(".caja .modo")?.textContent ?? ""))); i++) await a.tocar(".caja .modo");
      for (const ancho of ANCHOS) {
        await a.pantalla(ancho);
        const f = await a.en(filaCaja);
        ok(f.ok && /bypass/.test(f.modo), `${ancho}: con bypass, la fila de la caja es una sola y el enviar queda a la derecha (${f.que})`);
        const c = await a.en(chicos, DEDO);
        ok(c.length === 0, `${ancho}: y todo lo de la caja mide para el dedo${c.length ? `: ${c.join(" | ")}` : ""}`);
        // El micrófono de dictar está en la fila (por http, el celular no puede grabar: apagado y con su motivo).
        const mic = await a.en(() => {
          const b = document.querySelector(".caja .dic-b");
          return b ? { seguro: isSecureContext, apagado: b.getAttribute("aria-disabled") === "true", tip: b.getAttribute("data-tip") ?? "" } : null;
        });
        ok(!!mic && mic.apagado === !mic.seguro && mic.tip.length > 0, `${ancho}: el micrófono de dictar está en la caja${mic ? ` (${mic.seguro ? "contexto seguro" : "http: apagado, con su motivo"})` : ""}`);
        await a.foto(`${ancho}-caja-bypass`);
      }
      await a.pantalla(400);
      // El teclado abierto: la pantalla se achica (interactive-widget=resizes-content) y la caja sigue a la vista.
      ok(await a.tocar(".caja textarea"), "toque en la caja");
      ok(await a.hasta(() => document.activeElement?.tagName === "TEXTAREA", "foco"), "la enfoca");
      await a.pantalla(400, ALTO_TECLADO);
      const TEXTO = "hola desde el celular despacio";
      await a.cdp("Input.insertText", { text: TEXTO });
      const caja = await a.en(() => {
        const r = document.querySelector(".caja").getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), alto: innerHeight };
      });
      ok(caja.top >= 0 && caja.bottom <= caja.alto, `con el teclado abierto la caja entera queda a la vista (${JSON.stringify(caja)})`);
      let d = await a.en(desbordes);
      ok(d.length === 0, `y nada se sale de la pantalla${d.length ? `: ${d.join(" | ")}` : ""}`);
      await a.foto("400-teclado");
      // Enter es un renglón más (no hay Shift+Enter en el teléfono): se manda con el botón.
      await a.cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await a.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await espera(200);
      ok(await a.en((t) => document.querySelector(".caja textarea").value.startsWith(t) && !document.querySelector(".conv .yo"), TEXTO), "Enter no manda");
      ok(await a.tocar(".caja .prim"), "toque en mandar");
      ok(await a.hasta((t) => document.querySelector(".conv .yo")?.textContent.includes(t), "globo", TEXTO), "el mensaje sale");
      // Mientras responde, Parar está a mano y mide para el dedo.
      const parar = await a.hasta(() => {
        const b = [...document.querySelectorAll(".caja .btn2")].find((e) => e.getClientRects().length);
        return b ? Math.round(b.getBoundingClientRect().height) : 0;
      }, "Parar");
      ok(parar >= DEDO, `mientras responde hay un Parar para el dedo (${parar} px)`);
      let f = await a.en(filaCaja);
      ok(f.ok, `400: respondiendo (con Parar), la fila sigue siendo una sola y el enviar a la derecha (${f.que})`);
      // Lo que se manda mientras responde queda en cola, a la vista, y se lo puede sacar con el dedo.
      const OTRO = "y esto despacio también";
      await a.tocar(".caja textarea");
      await a.cdp("Input.insertText", { text: OTRO });
      ok(await a.tocar(".caja .prim"), "toque en mandar mientras responde");
      ok(await a.hasta((t) => document.querySelector(".conv .yo.encolado")?.textContent.includes(t), "en cola", OTRO), "queda en cola, debajo de la conversación");
      const cc = await a.en(chicos, DEDO);
      ok(cc.length === 0, `y sacarlo de la cola mide para el dedo${cc.length ? `: ${cc.join(" | ")}` : ""}`);
      await a.foto("400-respondiendo");
      ok(await a.hasta((t) => document.querySelector(".conv")?.textContent.includes(`eco: ${t}`), "eco", TEXTO), "y el líder contesta");
      // Terminó el turno: lo de la cola sale solo.
      ok(await a.hasta((t) => !document.querySelector(".conv .yo.encolado") && [...document.querySelectorAll(".conv .yo")].some((e) => e.textContent.includes(t)), "sale de la cola", OTRO), "al terminar el turno, lo de la cola sale solo");
      await a.pantalla(360, ALTO_TECLADO);
      f = await a.en(filaCaja);
      ok(f.ok && f.que.includes("btn2"), `360: respondiendo (con Parar), una sola fila y el enviar a la derecha (${f.que})`);
      await a.foto("360-respondiendo");
      ok(await a.hasta((t) => document.querySelector(".conv")?.textContent.includes(`eco: ${t}`), "eco de la cola", OTRO), "y el líder lo contesta");
      await a.pantalla(400);
      d = await a.en(desbordes);
      ok(d.length === 0, `con la respuesta nada se sale de la pantalla${d.length ? `: ${d.join(" | ")}` : ""}`);
      await a.foto("400-respuesta");
      // De vuelta en la lista, el líder nuevo está en la barra.
      ok(await a.tocar(".hilo:not(.pn-main) .migas .lado"), "toque en la flecha de volver");
      ok(await a.hasta(() => !document.querySelector(".app").hasAttribute("data-oculta") && !!document.querySelector(".lider[data-activa]"), "lista"), "vuelve a la lista, con el líder marcado");
      await a.foto("400-lista-despues");
    } finally {
      a.cerrar();
    }
  }

  // --- 2b. La vista de worker con pasos (terminado y vivo), en los tres anchos ---------------
  for (const captura of ["worker-vista", "worker-vista-vivo"]) {
    const a = await abrir({ HILOS_CAPTURA: captura });
    try {
      for (const ancho of ANCHOS) {
        await a.pantalla(ancho);
        ok(await a.hasta(() => !!document.querySelector(".wk-it"), "pasos"), `${ancho}: ${captura} muestra sus pasos`);
        await espera(300);
        let d = await a.en(desbordes);
        ok(d.length === 0, `${ancho}: ${captura}: nada se sale de la pantalla${d.length ? `: ${d.join(" | ")}` : ""}`);
        let c = await a.en(chicos, DEDO);
        ok(c.length === 0, `${ancho}: ${captura}: todo lo que se toca mide para el dedo${c.length ? `: ${c.join(" | ")}` : ""}`);
        // Un paso con el dedo abre su detalle ahí mismo y sigue sin salirse ni achicarse.
        if (await a.tocar(".wk-li:last-child .wk-it")) {
          await espera(300);
          d = await a.en(desbordes);
          ok(d.length === 0, `${ancho}: ${captura}: con un paso abierto nada se sale${d.length ? `: ${d.join(" | ")}` : ""}`);
          c = await a.en(chicos, DEDO);
          ok(c.length === 0, `${ancho}: ${captura}: con un paso abierto todo mide para el dedo${c.length ? `: ${c.join(" | ")}` : ""}`);
        }
        await a.foto(`${ancho}-${captura}`);
      }
    } finally {
      a.cerrar();
    }
  }

  // --- 3. Una entrada por máquina: la PC y la otra máquina -----------------------------------------
  {
    const { crearRemoto } = await import(path.join(raiz, "dist-electron/remoto.js"));
    const { identidadDe } = await import(path.join(raiz, "dist-electron/identidad.js"));
    const { leerMaquinas } = await import(path.join(raiz, "dist-electron/maquinas-config.js"));
    const MAQUINAS = {
      pc: { version: 1, esta: "pc", maquinas: [{ id: "dell", nombre: "Dell", url: "http://192.0.2.2:4545" }] },
      dell: { version: 1, esta: "dell", maquinas: [] },
    };
    const vistas = {};
    for (const [id, cfg] of Object.entries(MAQUINAS)) {
      const a = await abrir({ HILOS_FIXTURES: "1" }, cfg);
      let servidor = null;
      try {
        await a.pantalla(400);
        ok(await a.hasta(() => document.querySelectorAll("[data-fila]").length >= 3, "filas"), `${id}: con su maquinas.json la app llega con la barra`);
        const mal = await a.en(desbordes);
        ok(mal.length === 0, `${id}: y nada se sale de la pantalla${mal.length ? `: ${mal.join(" | ")}` : ""}`);
        await a.foto(`400-maquina-${id}`);

        // La misma página que sirve la tailnet, de esta máquina: en 127.0.0.1 (la identidad la dice su archivo, la red es de mentira).
        const yo = identidadDe(leerMaquinas(path.join(a.tmp, "hilos", "maquinas.json")));
        const remoto = crearRemoto({
          dist: path.join(raiz, "dist"),
          preload: path.join(raiz, "dist-electron/preload.cjs"),
          nombres: ["127.0.0.1"],
          propias: ["127.0.0.1"],
          entra: async () => true,
          llamar: async () => null,
          consulta: () => ({ fixtures: "1", idioma: "es" }),
          identidad: () => yo,
          seFue: () => {},
          changelog: "",
        });
        servidor = await remoto.escuchar("127.0.0.1", 0);
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const traer = (ruta) =>
          new Promise((resolve, reject) =>
            http
              .get(base + ruta, (res) => {
                const partes = [];
                res.on("data", (d) => partes.push(d));
                res.on("end", () => resolve({ codigo: res.statusCode, cuerpo: Buffer.concat(partes) }));
              })
              .on("error", reject),
          );
        const m = JSON.parse((await traer("/manifest.webmanifest")).cuerpo.toString());
        const ic = await traer("/icon-192.png");
        vistas[id] = { yo, manifest: m, icono: ic.cuerpo };
        ok(m.name === `Trama ${yo.nombre}` && m.theme_color === yo.fondo, `${id}: el manifest dice "${m.name}" y su color (${m.theme_color})`);
        ok(ic.codigo === 200 && ic.cuerpo.subarray(1, 4).toString() === "PNG", `${id}: el ícono es un PNG propio`);
        // La página en el navegador de la prueba: su título y su color son los de la máquina.
        await a.cdp("Page.navigate", { url: base + "/" });
        const t = await a.hasta((titulo) => document.title === titulo && document.querySelector('meta[name="theme-color"]'), "la página servida", yo.titulo);
        ok(!!t, `${id}: la pestaña dice "${yo.titulo}"`);
        const color = await a.en(() => document.querySelector('meta[name="theme-color"]')?.content);
        ok(color === yo.fondo, `${id}: y el color de la barra es ${yo.fondo} (${color})`);
        ok((await a.en(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href"))) === "./manifest.webmanifest", `${id}: apunta a su manifest`);
        await a.foto(`400-pagina-${id}`);
      } finally {
        servidor?.closeAllConnections();
        servidor?.close();
        a.cerrar();
      }
    }
    ok(vistas.pc.yo.titulo !== vistas.dell.yo.titulo && vistas.pc.manifest.name !== vistas.dell.manifest.name, "los dos accesos directos se llaman distinto");
    ok(vistas.pc.yo.fondo !== vistas.dell.yo.fondo && !vistas.pc.icono.equals(vistas.dell.icono), "y tienen otro color y otro ícono");
  }
} catch (e) {
  console.log(`FALLA ${e?.stack ?? e}`);
  fallas++;
}
console.log(fallas ? `\n${fallas} falla(s)` : "\ntodo ok");
process.exit(fallas ? 1 : 0);
