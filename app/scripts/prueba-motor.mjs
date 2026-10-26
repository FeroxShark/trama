#!/usr/bin/env node
// El motor sin ventana y la ventana como cliente, de punta a punta, con los fakes y todo en un tmp (estado,
// socket, perfil, registry, tailscale e `ip`): nunca el motor, la trama ni las unidades del usuario.
//   1. Cambio de IP de Tailscale (`HILOS_TAILSCALE` e `HILOS_IP` falsos, en 127.0.0.x): el motor escucha por la
//      tailnet en la IP primera y, al avisar el monitor de direcciones, deja la vieja y escucha en la nueva.
//   2. Matar la ventana (SIGKILL a la trama residente): el `/rpc` del motor sigue contestando; una ventana nueva
//      se hace cliente de nuevo.
//   3. Reiniciar el motor (SIGTERM): la página dice "Reconnecting to trama engine…" y, con otro motor, vuelve sola.
//   4. Un build nuevo: el motor avisa y, tocado Reiniciar, dice "saliendo" y sale (bajo la unidad, la prueba hace de systemd y lo levanta a los 0,5 s); la ventana cliente anota
//      cómo estaba (volver.json) y se relanza apenas cae el motor, sin esperar al nuevo (la nueva espera al motor nuevo
//      mientras arranca Electron), otro proceso, otro candado de perfil, otra vez como cliente, con las marcas de cada paso.
// Sólo se matan, por pid exacto, los procesos que lanzó esta prueba.
//   npm run build && node scripts/prueba-motor.mjs
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-motor-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
const estado = path.join(tmp, "hilos");
const carpetaSock = path.join(tmp, "run");
const sock = path.join(carpetaSock, "motor.sock");
const perfil = path.join(tmp, "perfil");
const electron = path.join(raiz, "node_modules/electron/dist/electron");
for (const d of ["pa", "sesiones", "claude", "hilos", "proy/atlas", "build/dist-electron", "build/dist"]) mkdirSync(path.join(tmp, d), { recursive: true });
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [{ name: "Atlas Web", path: path.join(tmp, "proy", "atlas"), desc: "La web" }] }));

/** `npm run build` de mentira: el build que mira el motor. */
function build(v) {
  writeFileSync(path.join(tmp, "build/dist-electron/main.js"), `// ${v}\n`);
  writeFileSync(path.join(tmp, "build/dist/index.html"), `<script src="/assets/index-${v}.js"></script>\n`);
}
build("v1");

// Tailscale de mentira: la IP sale de un archivo, y el monitor de direcciones avisa cuando aparece `aviso`.
const ipArchivo = path.join(tmp, "ip");
const aviso = path.join(tmp, "aviso");
writeFileSync(ipArchivo, "127.0.0.1");
const tailscale = path.join(tmp, "tailscale");
writeFileSync(
  tailscale,
  `#!/bin/sh
[ "$1" = status ] || exit 1
printf '{"BackendState":"Running","MagicDNSSuffix":"x.ts.net.","Self":{"TailscaleIPs":["%s"],"DNSName":"maquina.x.ts.net.","UserID":1}}' "$(cat '${ipArchivo}')"
`,
);
const ipFalso = path.join(tmp, "ip-falso");
writeFileSync(ipFalso, `#!/bin/sh\nwhile [ ! -e '${aviso}' ]; do sleep 0.2; done\necho '5: tailscale0    inet 127.0.0.2/32'\nexec sleep 600\n`);
chmodSync(tailscale, 0o755);
chmodSync(ipFalso, 0o755);
const puertoRemoto = 8700 + Math.floor(Math.random() * 200);
writeFileSync(path.join(estado, "remoto.json"), JSON.stringify({ version: 1, puerto: puertoRemoto, dispositivos: ["cel"] }));

const env = {
  ...process.env,
  HILOS_STATE: estado,
  HILOS_LOCAL: carpetaSock,
  HILOS_PERFIL: perfil,
  HILOS_FIXTURES: "0",
  HILOS_IDIOMA: "en",
  HILOS_VISTA: "todo",
  HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
  PA_FALSO_N: "0",
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
  HILOS_TAILSCALE: tailscale,
  HILOS_IP: ipFalso,
  HILOS_HISTORIAL: "0",
  // El build de mentira: ni el motor ni la ventana miran el build de verdad.
  HILOS_BUILD: path.join(tmp, "build"),
  HILOS_RELANZAR_MS: "500",
};
for (const k of ["TRAMA_UNIDAD", "ELECTRON_RUN_AS_NODE", "HILOS_PRUEBA", "HILOS_BENCH", "HILOS_GUION", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG", "HILOS_DEV_URL"]) delete env[k];

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
async function hastaQue(cond, ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return true;
    await espera(100);
  }
  return false;
}
const vive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** El pid del motor, el que dice `dueno`. */
const duenoPid = () => {
  try {
    return Number(JSON.parse(leer("dueno")).pid) || 0;
  } catch {
    return 0;
  }
};
/** El pid de la trama que tiene el candado de este perfil (Chromium lo anota como `host-pid`). */
const ventanaPid = () => {
  try {
    return Number(readlinkSync(path.join(perfil, "SingletonLock")).split("-").pop());
  } catch {
    return 0;
  }
};
/** Es de esta prueba: vive y lleva el puerto de CDP que eligió ella (también la que se relanza sola). */
const mia = (pid) => {
  try {
    return pid > 0 && readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0 ]/).includes(`--remote-debugging-port=${puerto}`);
  } catch {
    return false;
  }
};
const motoresMios = new Set();
const ventanasMias = new Set();

/** `unidad`: como bajo systemd, sale sin lanzarse de nuevo (la prueba hace de `Restart=always`, con su RestartSec). */
function lanzarMotor(unidad = false) {
  const p = spawn(electron, [path.join(raiz, "dist-electron", "motor.js")], { env: { ...env, ELECTRON_RUN_AS_NODE: "1", ...(unidad ? { TRAMA_UNIDAD: "1" } : {}) }, stdio: "ignore" });
  motoresMios.add(p.pid);
  return p;
}
function lanzarVentana() {
  const p = spawn(electron, [raiz, "--escondida", `--remote-debugging-port=${puerto}`], { env, stdio: "ignore" });
  ventanasMias.add(p.pid);
  return p;
}
/** Un pedido al motor como otro cliente del socket (no la ventana). */
function rpc(canal, args = []) {
  return new Promise((res, mal) => {
    const cuerpo = JSON.stringify({ canal, args });
    const req = http.request({ socketPath: sock, path: "/rpc", method: "POST", headers: { "content-type": "application/json", "x-trama-cliente": "abcdef0123456789" } }, (r) => {
      let t = "";
      r.on("data", (d) => (t += d));
      r.on("end", () => {
        try {
          res(JSON.parse(t));
        } catch (e) {
          mal(e);
        }
      });
    });
    req.on("error", mal);
    req.end(cuerpo);
  });
}
/** ¿Alguien escucha en esa IP y puerto? */
const escucha = (ip, p) =>
  new Promise((res) => {
    const s = net.connect({ host: ip, port: p, timeout: 800 });
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("timeout", () => (s.destroy(), res(false)));
    s.once("error", () => res(false));
  });

/** La página de la trama que esté ahora en el puerto de CDP, con `en` (correr en ella) y `hasta` (esperar a que se cumpla). */
async function pagina() {
  let url = null;
  for (let i = 0; i < 200 && !url; i++) {
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
  async function en(fn, ...args) {
    const r = await cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? "excepción" };
    return r.result?.result?.value;
  }
  const hasta = (fn, s, ...args) => hastaQue(async () => !!(await en(fn, ...args).catch(() => null)), s * 1000);
  return { en, hasta, cerrar: () => ws.close() };
}
const cargada = (p) => p.hasta(() => !!document.querySelector(".cx") && !!window.hilos, 20);

async function limpiar() {
  for (const pid of [...ventanasMias, ventanaPid()]) if (mia(pid)) process.kill(pid, "SIGKILL");
  for (const pid of [...motoresMios, duenoPid()]) {
    // `dueno` es de este tmp: el motor que anota es el que relanzó el anterior.
    if (pid > 0 && vive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
  await espera(300);
  rmSync(tmp, { recursive: true, force: true });
}
setTimeout(() => (console.log("FALLA la prueba tardó más de 3 minutos"), limpiar().then(() => process.exit(1))), 180_000).unref();

let pag = null;
try {
  let motor = lanzarMotor(true);
  ok(await hastaQue(() => existsSync(sock) && !!leer("dueno"), 15_000), "el motor abre el socket y anota dueno");

  // --- 1. La IP de Tailscale cambia ---------------------------------------------
  ok(await hastaQue(() => escucha("127.0.0.1", puertoRemoto), 10_000), "el motor escucha por la tailnet en la IP de Tailscale");
  writeFileSync(ipArchivo, "127.0.0.2");
  writeFileSync(aviso, "");
  ok(await hastaQue(() => escucha("127.0.0.2", puertoRemoto), 10_000), "cambia la IP (el monitor avisa): escucha en la nueva");
  ok(!(await escucha("127.0.0.1", puertoRemoto)), "y deja de escuchar en la vieja");
  ok((await rpc("preferencias:leer")).ok, "el socket local sigue contestando tras el rearme");

  // --- 2. Matar la ventana no toca al motor ---------------------------------------
  let ventana = lanzarVentana();
  pag = await pagina();
  ok(await cargada(pag), "la ventana (trama residente, escondida) cargó");
  ok(/ventana cliente del motor/.test(leer("ventana.log")), "la ventana es cliente del motor");
  const pidMotor = duenoPid();
  const pidVentana = ventanaPid();
  ok(mia(pidVentana), `la ventana tiene el candado del perfil (pid ${pidVentana})`);
  pag.cerrar();
  process.kill(pidVentana, "SIGKILL");
  ok(await hastaQue(() => !vive(pidVentana), 5000), "la ventana muere (SIGKILL)");
  await espera(1500);
  const r1 = await rpc("preferencias:leer");
  ok(r1.ok && vive(pidMotor) && duenoPid() === pidMotor, "el motor sigue vivo y su /rpc contesta sin ventana");
  ventana = lanzarVentana();
  pag = await pagina();
  ok(await cargada(pag), "una ventana nueva carga");
  ok((leer("ventana.log").match(/ventana cliente del motor/g) ?? []).length >= 2, "y se hace cliente del mismo motor");
  ok(duenoPid() === pidMotor, "el motor no cambió");

  // --- 3. Reiniciar el motor: Reconectando y vuelve -------------------------------
  motor.kill("SIGTERM");
  const t0 = Date.now();
  ok(await pag.hasta(() => document.querySelector(".cx")?.hasAttribute("data-caida"), 10), `motor parado: la página dice Reconectando (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  ok(/Reconnecting to trama/.test((await pag.en(() => document.querySelector(".cx")?.innerText)) ?? ""), "y habla del motor de trama");
  ok(await hastaQue(() => !vive(pidMotor), 15_000), "el motor sale tras el SIGTERM");
  motor = lanzarMotor(true);
  const t1 = Date.now();
  ok(await hastaQue(() => duenoPid() > 0 && duenoPid() !== pidMotor, 15_000), "otro motor anota dueno");
  ok(await pag.hasta(() => !!document.querySelector(".cx") && !document.querySelector(".cx").hasAttribute("data-caida") && !!window.hilos, 25), `motor de vuelta: sin Reconectando (${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  ok(await hastaQue(async () => ((await pag.en(() => window.hilos.preferencias.leer()).catch(() => null)) ?? {}).error === undefined, 10_000), "los pedidos vuelven a andar");
  const pidMotor2 = duenoPid();
  ok(vive(pidMotor) === false && vive(pidMotor2), "el viejo no queda vivo y hay un solo motor");

  // --- 4. Un build nuevo: el motor sale y vuelve, la ventana también --------------
  const pidVentana2 = ventanaPid();
  await pag.en(() => {
    window.__vioCaida = false;
    new MutationObserver(() => {
      if (document.querySelector(".cx")?.hasAttribute("data-caida")) window.__vioCaida = true;
    }).observe(document.body, { subtree: true, attributes: true, childList: true });
  });
  build("v2");
  ok(await hastaQue(async () => (await rpc("reinicio:leer")).valor?.hay === true, 10_000), "build nuevo: el motor avisa (cartel Update available)");
  ok(vive(pidMotor2) && ventanaPid() === pidVentana2, "no se reinició sola: el motor y la ventana siguen");
  // El motor se va en el acto: puede cortar la conexión sin contestar.
  await rpc("reinicio:pedir", [false]).catch(() => {});
  const sigueVieja = () => mia(pidVentana2) && vive(pidVentana2);
  // Hace de systemd: a los `restartMs` de morir el motor lo levanta (RestartSec=500ms en la unidad; `RESTART_MS` lo cambia para medir).
  const restartMs = Number(process.env.RESTART_MS) || 500;
  // Hace de systemd (cont.): La ventana no espera ese relevo: se relanza apenas cae el motor.
  let relevo = false;
  const siSeCayo = setInterval(() => {
    if (relevo || vive(pidMotor2)) return;
    relevo = true;
    setTimeout(() => (motor = lanzarMotor(true)), restartMs);
  }, 50);
  const fin = Date.now() + 40_000;
  while (Date.now() < fin && sigueVieja()) await espera(50);
  const motorYaVolvio = duenoPid() > 0;
  ok(!sigueVieja(), "la ventana se fue por el build nuevo");
  ok(!motorYaVolvio, "y se fue sin esperar al motor nuevo (los dos arrancan a la vez)");
  ok(await hastaQue(() => relevo && duenoPid() > 0 && duenoPid() !== pidMotor2, 15_000), "el motor volvió (otro proceso, anotado en dueno)");
  clearInterval(siSeCayo);
  const volver = JSON.parse(leer("volver.json") || "null");
  ok(volver?.version === 1 && volver.ventana?.ancho >= 200 && volver.ventana?.visible === false, "anotó cómo estaba en volver.json (tamaño, escondida)");
  ok(/el motor se va por un build nuevo/.test(leer("ventana.log")) && /se relanza la ventana sin esperarlo/.test(leer("ventana.log")), "ventana.log cuenta el relanzo");
  ok(await hastaQue(() => ventanaPid() > 0 && ventanaPid() !== pidVentana2 && mia(ventanaPid()), 20_000), "la ventana nueva tiene el candado del perfil");
  pag.cerrar();
  pag = await pagina();
  ok(await cargada(pag), "la ventana nueva cargó");
  ok(!(await pag.en(() => document.querySelector(".cx")?.hasAttribute("data-caida"))), "conectada: sin Reconectando");
  ok((await pag.en(() => window.hilos.preferencias.leer()))?.error === undefined, "y sus pedidos pasan por el motor nuevo");
  ok(!(await rpc("reinicio:leer")).valor?.hay, "el motor nuevo ya está en el build nuevo (sin cartel)");
  // Las marcas del reinicio (electron/reinicio-marcas.ts): cada paso quedó, en el orden en que pasó.
  const marcas = (await hastaQue(() => /\blista\n/.test(leer("reinicio-marcas")), 20_000)) ? leer("reinicio-marcas").trim().split("\n").map((l) => l.split(" ")) : [];
  const t = (paso) => Number(marcas.find((m) => m[3] === paso)?.[0] ?? NaN);
  const orden = (...pasos) => pasos.every((p, i) => Number.isFinite(t(p)) && (i === 0 || t(pasos[i - 1]) <= t(p)));
  ok(orden("inicio", "lideres-cerrados", "motor-sale", "motor-arranco", "motor-escucha", "motor-visto", "cliente-armado", "ventana-creada", "pagina-monto", "pagina-conecto", "lista"), "marcas del reinicio: el motor se va y vuelve, y la ventana nueva pasa por cada paso hasta la lista");
  ok(orden("ventana-aviso", "ventana-guardo", "ventana-arranco", "electron-listo", "ventana-creada"), "marcas: la ventana vieja guarda y se va, la nueva arranca Electron");
  ok(Number.isFinite(t("pagina-cargada")) && t("ventana-arranco") < t("motor-escucha"), "marcas: la ventana nueva arrancó antes de que el motor nuevo escuchara (en paralelo)");
  const orde = [...marcas].sort((x, y) => x[0] - y[0]);
  console.log(`      reinicio completo en ${t("lista") - t("inicio")} ms (unidad de mentira a ${restartMs / 1000} s): ${orde.map((m, i) => `${m[3]} +${m[0] - orde[Math.max(0, i - 1)][0]}`).join(", ")}`);
  // `MARCAS_SALIDA=<archivo>`: deja las marcas tal cual para scripts/medir-reinicio.mjs.
  if (process.env.MARCAS_SALIDA) writeFileSync(process.env.MARCAS_SALIDA, leer("reinicio-marcas"));
  pag.cerrar();
} catch (e) {
  console.error(e);
  fallas++;
} finally {
  if (fallas && process.env.PRUEBA_VERBOSO) console.log(`--- ventana.log\n${leer("ventana.log")}\n--- trama.log\n${leer("trama.log")}`);
  await limpiar();
}

console.log(fallas ? `\n${fallas} falla(s)` : "\ntodo bien");
process.exit(fallas ? 1 : 0);
