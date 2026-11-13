// Prueba por CDP de temas y cupos, y capturas de cada tema.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const BASE = "file:///home/ferox/.cache/trama-plan/roast/direcciones/e-taller.html";
const PUERTO = 9334;
const chrome = spawn("/usr/bin/google-chrome-stable", ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PUERTO}`, "--user-data-dir=/tmp/taller-e/perfil-cdp2", "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const esperando = new Map();
async function conectar() {
  for (let i = 0; i < 40; i++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json();
      const pag = lista.find((p) => p.type === "page");
      if (pag) { ws = new WebSocket(pag.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j }); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && esperando.has(d.id)) { esperando.get(d.id)(d); esperando.delete(d.id) } }; return }
    } catch {}
    await dormir(250);
  }
  throw new Error("sin Chrome");
}
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; esperando.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async (expr) => (await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
const raton = (type, x, y) => cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const IMG = "/home/ferox/.cache/trama-plan/roast/direcciones/img/";
const foto = async (nombre, clip) => { const r = await cmd("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); writeFileSync(IMG + nombre + ".png", Buffer.from(r.result.data, "base64")) };
const punto = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
const clic = async (sel) => { const p = await punto(sel); if (!p) throw new Error("no hay " + sel); await raton("mouseMoved", p.x, p.y); await raton("mousePressed", p.x, p.y); await raton("mouseReleased", p.x, p.y); await dormir(120) };
const tecla = (key, code, vk, extra = {}) => cmd("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, ...extra }).then(() => cmd("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, ...extra }));
const cargar = async (hash = "") => { await cmd("Page.navigate", { url: "about:blank" }); await dormir(250); await cmd("Page.navigate", { url: BASE + hash }); await dormir(1700) };
const v = (k) => ev(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(k)}).trim()`);
const res = [];
const ok = (n, c, extra = "") => res.push((c ? "OK   " : "FALLA") + " " + n + (extra ? " · " + extra : ""));
const TOK = ["--ground","--sheet","--block","--raised","--hover","--border","--rule","--control","--text","--soft","--muted","--accent","--ok","--warn","--bad","--probar","--naranja","--m-opus","--m-son","--m-hai","--gold","--ink","--on-accent"];
const todos = () => ev(`(()=>{const o={};${JSON.stringify(TOK)}.forEach(k=>o[k]=getComputedStyle(document.documentElement).getPropertyValue(k).trim());return o})()`);
const modo = process.argv[2] || "todo";
try {
  await conectar();
  await cmd("Page.enable"); await cmd("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  if (modo === "todo" || modo === "pruebas") {
    await cargar(); await ev("localStorage.clear()"); await cargar();
    ok("arranca en Grafito (--ground #08080a, --accent #8fb5f0)", (await v("--ground")) === "#08080a" && (await v("--accent")) === "#8fb5f0");
    ok("el panel de temas arranca cerrado", (await ev("document.getElementById('tema').hidden")) === true);
    await clic("#b-tema"); await dormir(150);
    ok("botón Tema abre el panel", (await ev("!document.getElementById('tema').hidden")) === true);
    ok("hay 10 fichas de fábrica", (await ev("document.querySelectorAll('#fichas .ficha').length")) === 10);
    ok("el foco entró al panel", (await ev("document.getElementById('tema').contains(document.activeElement)")) === true);
    await clic('#fichas .ficha[data-id="tokyo"]'); await dormir(150);
    ok("elegir Tokyo Night cambia --ground y --accent", (await v("--ground")) === "#16161e" && (await v("--accent")) === "#7aa2f7", `${await v("--ground")} ${await v("--accent")}`);
    ok("el tema queda marcado (aria-checked) y guardado", (await ev("document.querySelector('#fichas .ficha[aria-checked=true]').dataset.id")) === "tokyo" && (await ev("JSON.parse(localStorage.getItem('trama-taller-tema')).id")) === "tokyo");
    ok("el botón de la franja dice el tema", (await ev("document.querySelector('#b-tema .tn').textContent")) === "Tokyo Night");
    // acento: sólo cambia --accent (y el texto sobre el acento, que se calcula solo)
    const antes = await todos();
    await clic('#muestras .mu[data-c="#9ad48a"]'); await dormir(150);
    const desp = await todos();
    const dif = TOK.filter((k) => antes[k] !== desp[k]);
    ok("elegir una muestra de acento cambia sólo --accent (y --on-accent derivado)", dif.every((k) => k === "--accent" || k === "--on-accent") && dif.includes("--accent") && desp["--accent"] === "#9ad48a", dif.join(","));
    ok("texto sobre el acento claro es oscuro", desp["--on-accent"] === desp["--ground"], desp["--on-accent"]);
    await clic('#fichas .ficha[data-id="dracula"]'); await dormir(100);
    ok("elegir otro tema repone el acento del tema", (await v("--accent")) === "#8be9fd", await v("--accent"));
    // personalizado: mover un color cambia la variable
    await ev(`(()=>{const i=document.querySelector('input[data-r="fondo"]');i.value="#101820";i.dispatchEvent(new Event("input",{bubbles:true}))})()`); await dormir(120);
    ok("mover Fondo del personalizado cambia --ground", (await v("--ground")) === "#101820", await v("--ground"));
    ok("las superficies se derivan solas (color-mix)", (await v("--sheet")).includes("color-mix"), (await v("--sheet")).slice(0, 40));
    ok("Guardar y Volver se habilitan al editar", (await ev("!document.getElementById('t-guardar').disabled && !document.getElementById('t-volver').disabled")) === true);
    await ev(`(()=>{const i=document.querySelector('input[data-r="texto"]');i.value="#2a3340";i.dispatchEvent(new Event("input",{bubbles:true}))})()`); await dormir(120);
    ok("aviso de poco contraste con texto parecido al fondo", (await ev("!document.getElementById('aviso-c').hidden")) === true);
    await foto("e-taller-tema-poco-contraste");
    await ev(`(()=>{const i=document.querySelector('input[data-r="texto"]');i.value="#e8eef5";i.dispatchEvent(new Event("input",{bubbles:true}))})()`); await dormir(120);
    ok("el aviso se va con buen contraste", (await ev("document.getElementById('aviso-c').hidden")) === true);
    await clic("#t-guardar"); await dormir(150);
    ok("Guardar como mi tema agrega la ficha «Mío»", (await ev("[...document.querySelectorAll('#fichas .ficha')].map(f=>f.dataset.id).includes('mio')")) === true);
    await cargar();
    ok("«Mío» sobrevive a recargar (--ground #101820)", (await v("--ground")) === "#101820" && (await ev("JSON.parse(localStorage.getItem('trama-taller-tema')).mio.r.fondo")) === "#101820", await v("--ground"));
    await clic("#b-tema"); await dormir(150);
    ok("tras recargar la ficha Mío existe y está elegida", (await ev("document.querySelector('#fichas .ficha[aria-checked=true]').dataset.id")) === "mio");
    // volver
    await ev(`(()=>{const i=document.querySelector('input[data-r="acento"]');i.value="#ff00aa";i.dispatchEvent(new Event("input",{bubbles:true}))})()`); await dormir(100);
    await clic("#t-volver"); await dormir(120);
    ok("Volver a <tema> descarta lo editado", (await v("--accent")) !== "#ff00aa" && (await ev("document.getElementById('t-guardar').disabled")) === true, await v("--accent"));
    // trampa de foco
    await ev("document.querySelector('#tema .btn.pri').disabled=false;document.querySelector('#t-volver').disabled=false;document.getElementById('tema-x').focus()");
    await ev("document.querySelector('#t-volver').focus()");
    await tecla("Tab", "Tab", 9); await dormir(80);
    ok("Tab desde el último control vuelve al primero (foco atrapado)", (await ev("document.getElementById('tema').contains(document.activeElement)")) === true, await ev("document.activeElement.id||document.activeElement.className"));
    await tecla("Escape", "Escape", 27); await dormir(150);
    ok("Escape cierra el panel", (await ev("document.getElementById('tema').hidden")) === true);
    ok("al cerrar el foco vuelve al botón Tema", (await ev("document.activeElement.id")) === "b-tema", await ev("document.activeElement.id"));
    await clic("a.ric[data-tema]"); await dormir(150);
    ok("el engranaje «Ajustes» del riel también abre el panel", (await ev("!document.getElementById('tema').hidden")) === true);
    await raton("mouseMoved", 700, 500); await raton("mousePressed", 700, 500); await raton("mouseReleased", 700, 500); await dormir(150);
    ok("clic afuera cierra el panel", (await ev("document.getElementById('tema').hidden")) === true);
    await cargar("#tema=nord");
    ok("hash tema=nord aplica Nord sin guardar", (await v("--ground")) === "#1e222a" && (await ev("JSON.parse(localStorage.getItem('trama-taller-tema')).id")) !== "nord", await v("--ground"));
    // cupos
    await cargar(); await ev("localStorage.removeItem('trama-taller-tema')");
    await clic('label[for="c3"]'); await dormir(100);
    ok("selector Cupos: Arcos muestra los arcos y oculta los anillos", (await ev("getComputedStyle(document.querySelector('.ej.e-arc')).display")) !== "none" && (await ev("getComputedStyle(document.querySelector('.ej.e-an')).display")) === "none");
    await cargar();
    ok("Cupos recuerda la última elección tras recargar", (await ev("document.getElementById('c3').checked")) === true);
    await cargar("#cupos=doble");
    ok("hash cupos=doble manda", (await ev("document.getElementById('c2').checked")) === true);
    await ev("localStorage.clear()");
    // tarjeta de cupos al pasar el mouse
    await cargar("#cupos=anillos");
    const p = await punto(".ej.e-an .cb:first-child");
    await raton("mouseMoved", p.x, p.y); await dormir(150);
    ok("al pasar el mouse sobre un anillo aparece la tarjeta con el texto completo", (await ev("getComputedStyle(document.querySelector('.cc')).display")) !== "none" && (await ev("document.querySelector('.cc').innerText")).includes("vuelve en 2 h 14 min") && (await ev("document.querySelector('.cc').innerText")).includes("se acaba el viernes 20 h"));
    await clic(".cc .btn"); await dormir(150);
    ok("«Ver cupo» abre el panel Cupo", (await ev("!document.getElementById('p-cupo').hasAttribute('data-plegado')")) === true);
  }
  if (modo === "todo" || modo === "fotos") {
    await cargar(); await ev("localStorage.clear()");
    for (const t of ["shell", "catppuccin", "tokyo", "gruvbox", "nord", "rosepine", "dracula", "tinta", "carbon"]) { await cargar("#tema=" + t + "&abierto=cupo"); await foto("e-taller-tema-" + t); }
    // recortes del pie del riel por ejecución, con la tarjeta abierta
    for (const [c, sel] of [["anillos", ".ej.e-an .cb:nth-child(1)"], ["doble", ".ej.e-dob .cb:nth-child(1)"], ["arcos", ".ej.e-arc .cb:nth-child(1)"]]) {
      await cargar("#cupos=" + c); const p = await punto(sel); await raton("mouseMoved", p.x, p.y); await dormir(200);
      await foto("e-taller-riel-" + c, { x: 0, y: 700, width: 440, height: 380 });
    }
    await cargar("#panelTema=1"); await foto("e-taller-tema-panel");
    await cargar("#cupos=anillos"); await foto("e-taller");
    await cargar("#cupos=doble"); await foto("e-taller-cupos-doble");
    await cargar("#cupos=arcos"); await foto("e-taller-cupos-arcos");
  }
} catch (e) { res.push("ERROR " + e.message) }
console.log(res.join("\n"));
chrome.kill();
