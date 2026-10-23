#!/usr/bin/env node
// Prueba de punta a punta de trama por la tailnet (electron/remoto.ts), con el `pa` y el `claude`
// falsos: abre la app offscreen con un remoto.json temporal, le pide por la IP de Tailscale de
// ESTA máquina (http pelado y un Chrome sin ventana manejado por CDP, como el celular) y mira
// que: sin estar anotado no entra nadie, por otra IP (LAN, loopback) el puerto ni contesta, la
// página carga con datos en vivo, y lo que se le escribe a un líder desde el navegador se ve en
// la ventana de la PC y al revés. Nada toca `pa`, el tablero ni un líder de verdad.
// Necesita Tailscale andando (si no, avisa y sale bien) y, para la parte del navegador, Chrome.
//   npm run build && node scripts/prueba-remoto.mjs
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tailscale = process.env.HILOS_TAILSCALE ?? "tailscale";
let yo;
try {
  yo = JSON.parse(execFileSync(tailscale, ["status", "--json", "--peers=false"], { encoding: "utf8" }));
} catch {}
if (yo?.BackendState !== "Running") {
  console.log("sin Tailscale andando: no se prueba");
  process.exit(0);
}
const ip = yo.Self.TailscaleIPs.find((x) => !x.includes(":"));
const nombre = yo.Self.DNSName.replace(/\.$/, "").toLowerCase();
const corto = nombre.split(".")[0];

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-remoto-"));
const azar = (base) => base + Math.floor(Math.random() * 600);
const puerto = azar(21000);
for (const d of ["proy/atlas", "proy/brote", "pa", "hilos", "sesiones", "tablero"]) mkdirSync(path.join(tmp, d), { recursive: true });
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
const logClaude = path.join(tmp, "claude-falso.log");

/** La app offscreen con sus fakes; entran sólo los `dispositivos`. */
function lanzar(dispositivos, cdp) {
  writeFileSync(path.join(tmp, "hilos", "remoto.json"), JSON.stringify({ version: 1, puerto, dispositivos }));
  return spawn(path.join(raiz, "node_modules/electron/dist/electron"), [raiz, `--remote-debugging-port=${cdp}`], {
    env: {
      ...process.env,
      HILOS_PRUEBA: "120",
      HILOS_FIXTURES: "0",
      HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
      PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
      PA_STATE: path.join(tmp, "pa"),
      HILOS_STATE: path.join(tmp, "hilos"),
      HILOS_PRUEBA_PERFIL: path.join(tmp, `perfil-${cdp}`),
      PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
      HILOS_SESIONES: path.join(tmp, "sesiones"),
      HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
      HILOS_CLAUDE_SETTINGS: path.join(tmp, "settings.json"),
      HILOS_PA_PLAN: path.join(tmp, "plan"),
      AVISO_CONTEXTO: "",
      TRAMA_FALSO_LOG: logClaude,
      HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
      HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
      NPM_FALSO_LOG: path.join(tmp, "npm-falso.log"),
      HILOS_TABLERO: "/bin/false",
      TABLERO_DIR: path.join(tmp, "tablero"),
    },
    stdio: "ignore",
  });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};

/** Un pedido http a `a` (IP), con las cabeceras que se digan. `null` si ni conecta. */
function pedir(a, ruta, x = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: a, port: puerto, path: ruta, method: x.metodo ?? "GET", headers: Object.fromEntries(Object.entries(x.cabeceras ?? {}).filter(([, v]) => v !== undefined)), timeout: 3000 }, (res) => {
      let cuerpo = "";
      res.setEncoding("utf8");
      res.on("data", (d) => {
        cuerpo += d;
        if (x.hasta?.(cuerpo)) {
          resolve({ codigo: res.statusCode, cuerpo });
          req.destroy();
        }
      });
      res.on("end", () => resolve({ codigo: res.statusCode, cuerpo }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.end(x.cuerpo);
    x.alAbrir?.();
  });
}
const rpc = (canal, args = [], cabeceras = {}) =>
  pedir(ip, "/rpc", {
    metodo: "POST",
    cabeceras: { "content-type": "application/json", origin: `http://${ip}:${puerto}`, "x-trama-cliente": "abcdef0123456789", ...cabeceras },
    cuerpo: JSON.stringify({ canal, args }),
  });
/** ¿Hay alguien escuchando en `a`? */
const conecta = (a) =>
  new Promise((resolve) => {
    const s = net.connect({ host: a, port: puerto, timeout: 1500 });
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
    s.on("timeout", () => (s.destroy(), resolve(false)));
  });
async function arriba() {
  for (let i = 0; i < 150; i++) {
    if (await conecta(ip)) return true;
    await espera(100);
  }
  return false;
}

/** Una página manejada por CDP (la de la app o la del navegador). */
async function pagina(cdpPuerto, url = null) {
  let wsUrl = null;
  for (let i = 0; i < 150 && !wsUrl; i++) {
    try {
      const ts = await (await fetch(`http://127.0.0.1:${cdpPuerto}/json/list`)).json();
      wsUrl = ts.find((t) => t.type === "page" && (!url || t.url.startsWith(url)))?.webSocketDebuggerUrl ?? null;
    } catch {}
    if (!wsUrl) await espera(100);
  }
  if (!wsUrl) throw new Error(`no hay página en el puerto de CDP ${cdpPuerto}`);
  const ws = new WebSocket(wsUrl);
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
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "error en la página");
    return r.result?.result?.value;
  }
  async function hasta(fn, que, ...args) {
    for (let i = 0; i < 150; i++) {
      const v = await en(fn, ...args).catch(() => null);
      if (v) return v;
      await espera(100);
    }
    console.log(`      (se esperó en vano: ${que})`);
    return null;
  }
  const tecla = async (key, modifiers = 0) => {
    const k = { key, modifiers, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
    await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...k });
  };
  const mandar = async (texto) => {
    await hasta(() => !!document.querySelector(".caja-zona textarea:not([readonly])"), "caja libre");
    await en((texto) => {
      const el = document.querySelector(".caja-zona textarea");
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, texto);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, texto);
    return en(() => {
      const b = document.querySelector(".caja-zona button.prim");
      if (!b || b.disabled) return false;
      b.click();
      return true;
    });
  };
  const dice = (texto) => hasta((t) => [...document.querySelectorAll(".conv .el")].some((e) => e.textContent.includes(t)), texto, texto);
  return { en, hasta, tecla, mandar, dice, cerrar: () => ws.close() };
}

const procesos = [];
try {
  // --- 1. Sin estar anotado no entra nadie: ni esta misma máquina ---------------------
  let app = lanzar(["no-es-esta-maquina"], azar(9300));
  procesos.push(app);
  ok(await arriba(), `escucha en la IP de Tailscale (${ip}:${puerto})`);
  for (const ruta of ["/", "/remoto.js", "/assets/", "/eventos?c=abcdef0123456789", "/manifest.webmanifest"]) ok((await pedir(ip, ruta))?.codigo === 403, `dispositivo sin anotar: ${ruta} → 403`);
  const negado = await rpc("hilos:leer");
  ok(negado?.codigo === 403 && !negado.cuerpo.includes("hilos"), "dispositivo sin anotar: un pedido → 403, sin datos");
  ok((await rpc("hilos:leer", [], { "x-forwarded-for": "192.0.2.1" }))?.codigo === 403, "y decir otra IP en X-Forwarded-For no lo arregla");
  app.kill();
  for (let i = 0; i < 50 && (await conecta(ip)); i++) await espera(100);

  // --- 2. Anotada esta máquina: carga, datos, avisos en vivo --------------------------
  const cdpApp = azar(9300);
  app = lanzar([corto], cdpApp);
  procesos.push(app);
  ok(await arriba(), "con esta máquina anotada, escucha");
  const otras = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i.family === "IPv4" && !yo.Self.TailscaleIPs.includes(i.address))
    .map((i) => i.address);
  for (const a of otras) ok(!(await conecta(a)), `por ${a.startsWith("127.") ? "loopback" : "la LAN"} (${a}) el puerto no contesta`);
  ok(otras.some((a) => !a.startsWith("127.")), "había una IP de LAN para probarlo");

  const inicio = await pedir(ip, "/");
  ok(inicio?.codigo === 200 && inicio.cuerpo.includes("remoto.js") && inicio.cuerpo.includes('rel="manifest"'), "la página carga, con el puente y el manifest");
  ok((await pedir(ip, "/", { cabeceras: { host: `${nombre}:${puerto}` } }))?.codigo === 200, "también por el nombre de MagicDNS");
  ok((await pedir(ip, "/", { cabeceras: { host: `${corto}:${puerto}` } }))?.codigo === 200, "y por el nombre corto");
  ok((await pedir(ip, "/", { cabeceras: { host: `otro-sitio.example:${puerto}` } }))?.codigo === 403, "con otro Host (DNS rebinding) → 403");
  const manifest = await pedir(ip, "/manifest.webmanifest");
  ok(manifest?.codigo === 200 && JSON.parse(manifest.cuerpo).name === "Trama", "el manifest dice Trama");
  ok((await pedir(ip, "/icon-192.png"))?.codigo === 200, "y el ícono está");
  const js = await pedir(ip, "/remoto.js");
  ok(js?.codigo === 200 && js.cuerpo.includes("exposeInMainWorld"), "el puente trae el preload");

  const hilos = await rpc("hilos:leer");
  ok(hilos?.codigo === 200 && JSON.parse(hilos.cuerpo).ok && hilos.cuerpo.includes("20261003-100300-44444"), `un pedido trae los hilos de pa-falso: ${hilos?.codigo} ${hilos?.cuerpo.slice(0, 200)}`);
  ok((await rpc("hilos:leer", [], { origin: "https://otro-sitio.example" }))?.codigo === 403, "un pedido de otro origen → 403");
  ok((await rpc("hilos:leer", [], { origin: undefined }))?.codigo === 403, "un pedido sin Origin → 403");
  const salir = await rpc("app:salir", [true]);
  ok(salir?.codigo === 200 && !JSON.parse(salir.cuerpo).ok && (await conecta(ip)), "salir de trama no se puede pedir por red");

  const vivo = await pedir(ip, "/eventos?c=abcdef0123456789", {
    hasta: (t) => t.includes('"c":"hilos:cambio"') || t.includes('"c":"eventos:ids"'),
    alAbrir: () => setTimeout(() => appendFileSync(path.join(tmp, "pa", "eventos.jsonl"), `${JSON.stringify({ version: 1, ts: Math.floor(Date.now() / 1000), tipo: "fin", id: "20261003-100300-44444", proyecto: "brote" })}\n`), 700),
  });
  ok(vivo?.codigo === 200 && vivo.cuerpo.includes("event: hola") && /"c":"(hilos:cambio|eventos:ids)"/.test(vivo.cuerpo), "un evento de pa llega solo por el flujo de avisos");

  // --- 3. Un navegador de verdad, como el celular --------------------------------------
  const chrome = ["google-chrome-stable", "chromium", "chromium-browser"].map((b) => ["/usr/bin", "/usr/local/bin"].map((d) => path.join(d, b))).flat().find(existsSync);
  if (!chrome) {
    console.log("      (sin Chrome: la parte del navegador no se prueba)");
  } else {
    const cdpNav = azar(10000);
    const url = `http://${ip}:${puerto}/`;
    const nav = spawn(chrome, ["--headless=new", `--remote-debugging-port=${cdpNav}`, `--user-data-dir=${path.join(tmp, "chrome")}`, "--no-first-run", "--disable-gpu", "--window-size=412,915", url], { stdio: "ignore" });
    procesos.push(nav);
    const celu = await pagina(cdpNav, url);
    const pc = await pagina(cdpApp);
    ok(await celu.hasta(() => typeof window.hilos?.lider?.mandar === "function" && !("require" in window), "window.hilos"), "navegador: está window.hilos (y no es Electron)");
    ok(await celu.hasta(() => document.querySelectorAll("[data-fila]").length >= 3, "filas"), "navegador: llegan las filas de pa-falso");
    ok(await celu.en(() => document.documentElement.lang === "es" || new URLSearchParams(location.search).has("idioma")), "navegador: la página recibió la configuración de la ventana");
    ok(await celu.en(() => !!document.querySelector('link[rel="manifest"]')), "navegador: el manifest está enlazado");

    // Desde el "celular": un líder nuevo, un mensaje, y la respuesta llega.
    await celu.tecla("n", 2);
    ok(await celu.hasta(() => !!document.querySelector(".caja-zona textarea"), "caja"), "navegador: Ctrl+N abre un líder nuevo");
    ok(await celu.mandar("hola desde el celu"), "navegador: se le escribe al líder");
    ok(await celu.dice("eco: hola desde el celu"), "navegador: la respuesta del líder llega");
    const arranques = () => (existsSync(logClaude) ? readFileSync(logClaude, "utf8").split("\n").filter((l) => l.includes('"args"')).length : 0);
    ok(arranques() >= 1, "el líder es el claude falso");

    // En la ventana de la PC aparece ese líder, con lo que contestó.
    const sid = await pc.hasta(() => document.querySelector(".lider[data-lider]:not([data-lider='s-falso-lider'])")?.dataset.lider, "líder en la barra de la PC");
    ok(!!sid, `PC: el líder que abrió el celular está en la barra (${sid})`);
    await pc.en((sid) => (document.querySelector(`.lider[data-lider="${sid}"] .wbtn`) ?? document.querySelector(`.lider[data-lider="${sid}"]`)).click(), sid);
    ok(await pc.dice("eco: hola desde el celu"), "PC: se ve lo que contestó");

    // Y al revés: desde la PC se le sigue hablando y el celular lo ve en vivo.
    ok(await pc.mandar("y esto desde la pc"), "PC: se le escribe al mismo líder");
    ok(await pc.dice("eco: y esto desde la pc"), "PC: la respuesta llega");
    ok(await celu.dice("eco: y esto desde la pc"), "navegador: la respuesta a lo de la PC se ve sin tocar nada");
    ok(await pc.hasta(() => document.querySelectorAll("[data-fila]").length >= 3, "filas de la PC"), "PC: la ventana sigue con sus filas");

    // El texto del líder se ve mientras llega, también por la red: los pedazos salen juntados por el flujo de avisos.
    // El falso no escribe transcript: a los 2 s de terminar la vista suelta lo del stream y la conversación queda
    // vacía. Por eso nada se mira "después" con un sondeo (le gana la carrera): un observador anota, en el instante
    // en que aparece el final, cuántos mensajes lo tenían, y los largos que tuvo el texto mientras crecía.
    const vigilar = (pagina) =>
      pagina.en(() => {
        window.__largos = new Set();
        window.__fin = null;
        new MutationObserver(() => {
          const els = [...document.querySelectorAll(".conv .el")];
          window.__largos.add(els[els.length - 1]?.textContent.length ?? 0);
          const con = els.filter((e) => e.textContent.includes("Fin de la novela.")).length;
          if (con && !window.__fin) window.__fin = { con };
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      });
    await vigilar(celu);
    await vigilar(pc);
    ok(await celu.mandar("novela"), "navegador: pide una respuesta larga");
    const vio = (pagina) => pagina.hasta(() => !!window.__fin, "Fin de la novela.");
    ok(await vio(celu), "navegador: llega entera");
    const largos = await celu.en(() => window.__largos.size);
    ok(largos >= 8, `navegador: se la vio crecer mientras llegaba (${largos} largos distintos)`);
    ok((await celu.en(() => window.__fin?.con)) === 1, "navegador: un solo mensaje");
    ok(await vio(pc), "PC: la misma respuesta");

    celu.cerrar();
    pc.cerrar();
  }
} catch (e) {
  ok(false, String(e?.stack ?? e));
} finally {
  for (const p of procesos) p.kill();
  console.log(`carpeta: ${tmp}`);
  console.log(fallas ? `${fallas} fallas` : "todo ok");
  process.exit(fallas ? 1 : 0);
}
