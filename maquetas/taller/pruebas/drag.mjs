// Prueba de arrastre real por CDP contra Chrome sin ventana.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const URL = "file:///home/ferox/.cache/trama-plan/roast/direcciones/e-taller.html";
const PUERTO = 9333;
const chrome = spawn("/usr/bin/google-chrome-stable", ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PUERTO}`, "--user-data-dir=/tmp/taller-e/perfil-cdp", "--window-size=1920,1080", "about:blank"], { stdio: "ignore" });
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
const raton = (type, x, y, extra = {}) => cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
const foto = async (nombre) => { const r = await cmd("Page.captureScreenshot", { format: "png" }); writeFileSync(`/home/ferox/.cache/trama-plan/roast/direcciones/img/${nombre}.png`, Buffer.from(r.result.data, "base64")) };
const layout = async () => JSON.stringify(await ev("window.__taller.estado.layout"));
const punto = (sel) => ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
async function arrastrar(selOrigen, hasta, { foto: f, dx = 0 } = {}) {
  const o = await punto(selOrigen); const x0 = o.l + 70, y0 = o.y;
  await raton("mouseMoved", x0, y0); await raton("mousePressed", x0, y0);
  const pasos = 14;
  for (let i = 1; i <= pasos; i++) { await raton("mouseMoved", x0 + (hasta.x - x0) * i / pasos, y0 + (hasta.y - y0) * i / pasos); await dormir(15) }
  await dormir(100);
  const estadoMov = await ev("document.body.classList.contains('moviendo')");
  if (f) await foto(f);
  await raton("mouseReleased", hasta.x, hasta.y); await dormir(150);
  return estadoMov;
}
const res = [];
const ok = (n, c, extra = "") => { res.push((c ? "OK   " : "FALLA") + " " + n + (extra ? " · " + extra : "")); };
try {
  await conectar();
  await cmd("Page.enable"); await cmd("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cmd("Page.navigate", { url: URL }); await dormir(1800);
  await ev("localStorage.clear()"); await cmd("Page.navigate", { url: URL }); await dormir(1500);
  ok("arranque: chats izq, contexto+cupo der", (await layout()) === '{"izq":["chats"],"der":["contexto","cupo"],"abajo":[]}', await layout());

  // 1. Chats -> derecha, arriba de Contexto (entre nada y Contexto)
  let m = await arrastrar("#p-chats .ph h2", { x: 1700, y: 120 }, { foto: "e-taller-arrastrando" });
  ok("el cuerpo marca 'moviendo' durante el arrastre", m === true);
  ok("chats a la derecha, antes de contexto", (await layout()) === '{"izq":[],"der":["chats","contexto","cupo"],"abajo":[]}', await layout());
  // 2. Contexto -> izquierda (zona vacía)
  m = await arrastrar("#p-contexto .ph h2", { x: 200, y: 500 });
  ok("contexto a la izquierda (zona vacía)", (await layout()) === '{"izq":["contexto"],"der":["chats","cupo"],"abajo":[]}', await layout());
  // 3. Cupo -> abajo
  m = await arrastrar("#p-cupo .ph h2", { x: 1000, y: 1000 }, { foto: "e-taller-arrastrando-abajo" });
  ok("cupo abajo", (await layout()) === '{"izq":["contexto"],"der":["chats"],"abajo":["cupo"]}', await layout());
  await foto("e-taller-tras-arrastres");
  // 4. Reordenar: chats a la izquierda, debajo de contexto (mitad inferior)
  const pc = await punto("#p-contexto");
  await arrastrar("#p-chats .ph h2", { x: pc.x, y: pc.b - 30 });
  ok("reordenar: chats abajo de contexto en la izquierda", (await layout()) === '{"izq":["contexto","chats"],"der":[],"abajo":["cupo"]}', await layout());
  // 5. Zona derecha quedó vacía: se oculta
  ok("zona derecha vacía se oculta", await ev("document.querySelector('#z-der').hidden === true"));
  // 6. Divisor de ancho izquierdo
  const w0 = await ev("document.querySelector('#z-izq').offsetWidth");
  const d = await punto("#dv-izq");
  await raton("mouseMoved", d.x, d.y); await raton("mousePressed", d.x, d.y); for (let i = 1; i <= 6; i++) { await raton("mouseMoved", d.x + i * 20, d.y); await dormir(15) } await raton("mouseReleased", d.x + 120, d.y); await dormir(100);
  const w1 = await ev("document.querySelector('#z-izq').offsetWidth");
  ok("divisor: la zona izquierda se ensancha ~120 px", Math.abs(w1 - w0 - 120) < 6, w0 + " -> " + w1);
  // 7. Divisor entre paneles apilados (alto)
  const h0 = await ev("document.querySelector('#p-contexto').offsetHeight");
  const dp = await punto("#z-izq .dvz.h");
  await raton("mouseMoved", dp.x, dp.y); await raton("mousePressed", dp.x, dp.y); for (let i = 1; i <= 6; i++) { await raton("mouseMoved", dp.x, dp.y - i * 25); await dormir(15) } await raton("mouseReleased", dp.x, dp.y - 150); await dormir(100);
  const h1 = await ev("document.querySelector('#p-contexto').offsetHeight");
  ok("divisor entre paneles: Contexto se achica ~150 px", Math.abs(h0 - h1 - 150) < 8, h0 + " -> " + h1);
  // 8. Divisor de alto de la zona de abajo
  const a0 = await ev("document.querySelector('#z-abajo').offsetHeight");
  const da = await punto("#dv-abajo");
  await raton("mouseMoved", da.x, da.y); await raton("mousePressed", da.x, da.y); for (let i = 1; i <= 5; i++) { await raton("mouseMoved", da.x, da.y - i * 20); await dormir(15) } await raton("mouseReleased", da.x, da.y - 100); await dormir(100);
  const a1 = await ev("document.querySelector('#z-abajo').offsetHeight");
  // cupo está plegado (zona con todo plegado = alto auto): se despliega antes
  ok("zona de abajo plegada: alto automático", a0 < 120, String(a0));
  await ev("document.querySelector('#p-cupo .plg').click()"); await dormir(100);
  const a2 = await ev("document.querySelector('#z-abajo').offsetHeight");
  ok("divisor inerte con todo plegado; al desplegar la zona vuelve a 340 px", a2 >= 330 && a2 <= 345, a0 + " -> " + a1 + " -> " + a2);
  // 9. Menú ⋯ sin arrastrar
  await ev("document.querySelector('#p-cupo .mp').click()"); await dormir(150);
  await foto("e-taller-menu-panel");
  const items = await ev("[...document.querySelectorAll('.menu .mi')].map(b=>b.textContent.trim().replace(/\\s+/g,' ')).join(' | ')");
  ok("menú ⋯ con movimientos y cerrar", /Mover a la izquierda/.test(items) && /Mover a la derecha/.test(items) && /Mover abajo/.test(items) && /Cerrar panel/.test(items), items);
  await ev("[...document.querySelectorAll('.menu .mi')].find(b=>/a la derecha/.test(b.textContent)).click()"); await dormir(150);
  ok("menú: mover Cupo a la derecha", (await layout()) === '{"izq":["contexto","chats"],"der":["cupo"],"abajo":[]}', await layout());
  // 10. Cerrar y reabrir desde «Paneles»
  await ev("document.querySelector('#p-chats .cx').click()"); await dormir(100);
  ok("cerrar Chats", (await layout()) === '{"izq":["contexto"],"der":["cupo"],"abajo":[]}', await layout());
  await ev("document.querySelector('#b-paneles').click()"); await dormir(150);
  await foto("e-taller-menu-paneles");
  await ev("[...document.querySelectorAll('.menu .mi')].find(b=>/^\\s*Chats/.test(b.textContent)).click()"); await dormir(150);
  ok("reabrir Chats desde Paneles (vuelve a su zona)", (await layout()) === '{"izq":["contexto","chats"],"der":["cupo"],"abajo":[]}', await layout());
  // 11. Esc cancela el arrastre
  const o = await punto("#p-chats .ph h2"); await raton("mouseMoved", o.x, o.y); await raton("mousePressed", o.x, o.y);
  for (let i = 1; i <= 8; i++) { await raton("mouseMoved", o.x + i * 120, o.y - 20); await dormir(10) }
  await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await raton("mouseReleased", o.x + 960, o.y);
  await dormir(100);
  ok("Esc cancela el arrastre: nada cambió", (await layout()) === '{"izq":["contexto","chats"],"der":["cupo"],"abajo":[]}', await layout());
  // 12. Persistencia: recargar
  await cmd("Page.navigate", { url: URL }); await dormir(1500);
  ok("tras recargar queda el acomodo guardado", (await layout()) === '{"izq":["contexto","chats"],"der":["cupo"],"abajo":[]}', await layout());
  // 13. Restablecer
  await ev("document.querySelector('#restablecer').click()"); await dormir(150);
  ok("Restablecer vuelve al acomodo de fábrica", (await layout()) === '{"izq":["chats"],"der":["contexto","cupo"],"abajo":[]}', await layout());
  // 14. Soltar fuera de las zonas (sobre el chat): no cambia
  m = await arrastrar("#p-chats .ph h2", { x: 1000, y: 400 });
  ok("soltar sobre el chat (fuera de zonas) no mueve nada", (await layout()) === '{"izq":["chats"],"der":["contexto","cupo"],"abajo":[]}', await layout());
} catch (e) { res.push("ERROR " + e.stack) }
console.log(res.join("\n"));
try { ws && ws.close() } catch {}
chrome.kill("SIGTERM");
process.exit(0);
