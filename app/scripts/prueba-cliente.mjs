#!/usr/bin/env node
// La ventana como cliente del motor (electron/ventana-cliente.ts), con los fakes y todo en un tmp:
// levanta un motor (`ELECTRON_RUN_AS_NODE=1 electron dist-electron/motor.js`, con su socket en una carpeta
// propia: `HILOS_LOCAL`) y una ventana offscreen con el mismo `HILOS_STATE`, que lo encuentra y se hace
// cliente. Mira que un pedido pase (y llegue al motor: lo que escribe queda en su estado), que un adjunto
// binario llegue entero, que un evento que difunde el motor (pedido por otro cliente del socket) le llegue
// a la página, y que matar el motor (SIGKILL) muestre "Reconectando" y que con un motor nuevo vuelva sola.
// Nunca contra la trama ni el motor del usuario: estado, socket, perfil y registry son temporales.
//   npm run build && node scripts/prueba-cliente.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-cliente-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
const estado = path.join(tmp, "hilos");
const carpetaSock = path.join(tmp, "run");
const sock = path.join(carpetaSock, "motor.sock");
const electron = path.join(raiz, "node_modules/electron/dist/electron");
mkdirSync(path.join(tmp, "pa"));
mkdirSync(path.join(tmp, "build"));
mkdirSync(path.join(tmp, "proy", "atlas"), { recursive: true });
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [{ name: "Atlas Web", path: path.join(tmp, "proy", "atlas"), desc: "La web" }] }));

const env = {
  ...process.env,
  HILOS_STATE: estado,
  HILOS_LOCAL: carpetaSock,
  HILOS_FIXTURES: "0",
  HILOS_IDIOMA: "en",
  HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
  PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
  PA_STATE: path.join(tmp, "pa"),
  PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
  HILOS_SESIONES: path.join(tmp, "sesiones"),
  HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
  CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
  TRAMA_FALSO_LOG: path.join(tmp, "claude-falso.log"),
  HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
  HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
  NPM_FALSO_LOG: path.join(tmp, "npm-falso.log"),
  HILOS_TABLERO: "/bin/false",
  HILOS_TAILSCALE: "/bin/false",
  HILOS_HISTORIAL: "0",
  // El build de mentira: el motor no mira (ni avisa por) el build de verdad.
  HILOS_BUILD: path.join(tmp, "build"),
};
delete env.TRAMA_UNIDAD;
delete env.ELECTRON_RUN_AS_NODE;

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};
const leer = (f) => {
  try {
    return readFileSync(path.join(estado, f), "utf8");
  } catch {
    return "";
  }
};

function lanzarMotor() {
  const p = spawn(electron, [path.join(raiz, "dist-electron", "motor.js")], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "ignore" });
  return p;
}
async function hastaQue(cond, ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return true;
    await espera(100);
  }
  return false;
}
/** Un pedido al motor como otro cliente del socket (no la ventana). */
function rpc(canal, args) {
  return new Promise((ok, mal) => {
    const cuerpo = JSON.stringify({ canal, args });
    const req = http.request(
      { socketPath: sock, path: "/rpc", method: "POST", headers: { "content-type": "application/json", "x-trama-cliente": "abcdef0123456789" } },
      (res) => {
        let t = "";
        res.on("data", (d) => (t += d));
        res.on("end", () => ok(JSON.parse(t)));
      },
    );
    req.on("error", mal);
    req.end(cuerpo);
  });
}

let motor = lanzarMotor();
let app = null;
try {
  ok(await hastaQue(() => existsSync(sock) && !!leer("dueno"), 15_000), "el motor abre el socket y anota dueno");

  app = spawn(electron, [raiz, `--remote-debugging-port=${puerto}`], {
    env: { ...env, HILOS_PRUEBA: "90", HILOS_PRUEBA_PERFIL: path.join(tmp, "perfil") },
    stdio: "ignore",
  });

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
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? "excepción" };
    return r.result?.result?.value;
  }
  const hasta = (fn, s, ...args) => hastaQue(async () => !!(await en(fn, ...args).catch(() => null)), s * 1000);

  ok(await hasta(() => !!document.querySelector(".cx"), 15), "la página cargó");
  ok(/ventana cliente del motor/.test(leer("ventana.log")), "la ventana es cliente del motor y escribe en ventana.log");
  ok(!/trama arrancó/.test(leer("trama.log")) && /trama-motor arrancó/.test(leer("trama.log")), "trama.log es sólo del motor");

  // Un pedido: lo atiende el motor (la ventana no tiene núcleo).
  const prefs = await en(() => window.hilos.preferencias.leer());
  ok(prefs && typeof prefs === "object" && !prefs.error, "un pedido pasa por el motor y vuelve");
  const ruta = await en(() => window.hilos.lider.archivo({ nombre: "bytes.bin", datos: new Uint8Array([0, 1, 2, 250, 255]) }));
  let bytes = null;
  try {
    bytes = [...readFileSync(ruta)];
  } catch {}
  ok(typeof ruta === "string" && ruta.startsWith(path.join(estado, "adjuntos")) && bytes?.join() === "0,1,2,250,255", `un adjunto binario llega entero al motor (${bytes?.join() ?? ruta?.error ?? ruta})`);

  // Un evento: otro cliente del socket cambia el orden de la barra y el motor lo difunde.
  await en(() => {
    window.__ordenes = [];
    window.hilos.nombres.alOrden((o) => window.__ordenes.push(o));
  });
  const r = await rpc("nombres:orden", [{ carpetas: ["atlas"], lideres: {} }]);
  ok(r.ok, "otro cliente del socket pide un cambio");
  ok(await hasta(() => window.__ordenes.some((o) => o?.carpetas?.[0] === "atlas"), 5), "el evento que difunde el motor llega a la página");
  ok(!(await en(() => document.querySelector(".cx")?.hasAttribute("data-caida"))), "conectado: sin Reconectando");

  // Se muere el motor: Reconectando.
  motor.kill("SIGKILL");
  const t0 = Date.now();
  ok(await hasta(() => document.querySelector(".cx")?.hasAttribute("data-caida"), 10), `motor muerto: la página dice Reconectando (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const texto = await en(() => document.querySelector(".cx")?.innerText);
  ok(/Reconnecting to trama/.test(texto ?? ""), `el aviso habla del motor: "${texto}"`);

  // Vuelve un motor: la ventana se reconecta sola y la página se pone al día.
  await espera(1500);
  motor = lanzarMotor();
  const t1 = Date.now();
  ok(await hasta(() => !!document.querySelector(".cx") && !document.querySelector(".cx").hasAttribute("data-caida") && !!window.hilos, 20), `motor de vuelta: sin Reconectando (${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  const otra = await hastaQue(async () => {
    const p = await en(() => window.hilos.preferencias.leer()).catch(() => null);
    return p && typeof p === "object" && !p.error;
  }, 10_000);
  ok(otra, "los pedidos vuelven a andar con el motor nuevo");
  ok(/motor de vuelta/.test(leer("ventana.log")), "ventana.log anota la caída y la vuelta");
  ws.close();
} catch (e) {
  console.error(e);
  fallas++;
} finally {
  app?.kill("SIGKILL");
  motor.kill("SIGTERM");
  await espera(500);
  motor.kill("SIGKILL");
}

console.log(fallas ? `\n${fallas} falla(s) — ${tmp}` : "\ntodo bien");
process.exit(fallas ? 1 : 0);
