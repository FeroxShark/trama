#!/usr/bin/env node
// Prueba de punta a punta de "trama siempre viva" y del cartel de la actualización: una trama residente
// de verdad (no HILOS_PRUEBA), escondida como la arranca la unidad (`--escondida`), con su propio perfil
// (HILOS_PERFIL: otro candado de instancia única, no le abre la ventana a la de Ana), su propio estado
// y los fakes. Mira un build de mentira (HILOS_BUILD) y se le cambia:
//   1. NO se reinicia sola: aparece el cartel "Update available" con Restart, uno solo aunque llegue otro build;
//   2. Restart con un líder respondiendo (el `claude` falso, lento): dice a quién espera (por su nombre), no corta el
//      turno, Cancel deja de esperar, y pedido de nuevo se reinicia cuando el turno termina;
//   3. vuelve como estaba: el mismo tamaño de ventana, la misma conversación abierta y lo escrito sin mandar;
//   4. Restart sin nada corriendo: se reinicia en el acto; el mismo build de nuevo no avisa nada.
// Y de paso: arranca sin ventana, una segunda instancia escondida no la muestra, y la de la unidad
// (TRAMA_UNIDAD=1) que pierde el candado sale con 3 (lo que systemd no reintenta).
// No abre ninguna ventana ni toca `pa`, Claude, el tablero ni la trama de verdad. Sólo se matan,
// por pid exacto, los procesos que lanzó esta prueba.
//   npm run build && node scripts/prueba-relanzar.mjs   (FOTOS=<carpeta> deja capturas)
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-relanzar-")));
const puerto = 9300 + Math.floor(Math.random() * 600);
const electron = path.join(raiz, "node_modules/electron/dist/electron");
const perfil = path.join(tmp, "perfil");
const logClaude = path.join(tmp, "claude-falso.log");
for (const d of ["proy/atlas", "pa", "sesiones", "claude", "tablero", "build/dist-electron", "build/dist"]) mkdirSync(path.join(tmp, d), { recursive: true });
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [{ name: "Atlas Web", path: path.join(tmp, "proy", "atlas"), desc: "La web" }] }));
writeFileSync(path.join(tmp, "settings.json"), "{}");
writeFileSync(path.join(tmp, "CLAUDE.md"), "");

/** `npm run build` de mentira: deja otro build en el checkout que mira la app. */
function build(v) {
  writeFileSync(path.join(tmp, "build/dist-electron/main.js"), `// ${v}\n`);
  writeFileSync(path.join(tmp, "build/dist/index.html"), `<script src="/assets/index-${v}.js"></script>\n`);
}
build("v1");
// Como si viniera de un reinicio con la ventana (escondida) de 1000×700: el tamaño tiene que salir de acá
// y no del default (900×640). La ventana de la prueba nunca se muestra, así que no se puede agrandar a mano.
const TAM = [1000, 700];
const BORRADOR = "esto lo dejé a medio escribir";
mkdirSync(path.join(tmp, "hilos"), { recursive: true });
writeFileSync(
  path.join(tmp, "hilos", "volver.json"),
  JSON.stringify({ version: 1, cuando: Date.now(), ventana: { ancho: TAM[0], alto: TAM[1], visible: false, foco: false, lugar: null }, vistas: {} }),
);
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });

const env = {
  ...process.env,
  HILOS_FIXTURES: "0",
  HILOS_IDIOMA: "en",
  HILOS_VISTA: "todo",
  HILOS_PERFIL: perfil,
  HILOS_BUILD: path.join(tmp, "build"),
  HILOS_RELANZAR_MS: "500",
  // Los 20 min sin eventos que piden "Reiniciar igual", en 4 s (un turno del falso suelta un evento por segundo).
  HILOS_COLGADO_MS: "4000",
  HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
  PA_FALSO_N: "0",
  PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
  PA_STATE: path.join(tmp, "pa"),
  HILOS_STATE: path.join(tmp, "hilos"),
  PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
  HILOS_SESIONES: path.join(tmp, "sesiones"),
  HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
  HILOS_CLAUDE_SETTINGS: path.join(tmp, "settings.json"),
  HILOS_CLAUDE_MD: path.join(tmp, "CLAUDE.md"),
  HILOS_PA_PLAN: path.join(tmp, "plan"),
  CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
  AVISO_CONTEXTO: "",
  TRAMA_FALSO_LOG: logClaude,
  // Tres deltas por respuesta: un turno de unos 6 s.
  TRAMA_FALSO_MS: "2000",
  HILOS_NPM: path.join(raiz, "scripts/npm-falso.sh"),
  HILOS_AGY: "/nonexistent/agy", // sin agy instalado: el aviso de agy no sale ni toca la red
  NPM_FALSO_LOG: path.join(tmp, "npm-falso.log"),
  HILOS_TABLERO: "/bin/false",
  TABLERO_DIR: path.join(tmp, "tablero"),
};
for (const k of ["TRAMA_UNIDAD", "HILOS_PRUEBA", "HILOS_BENCH", "HILOS_GUION", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG", "HILOS_DEV_URL"]) delete env[k];

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let fallas = 0;
const ok = (cond, que) => {
  console.log(`${cond ? "ok   " : "FALLA"} ${que}`);
  if (!cond) fallas++;
};
const vive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** El pid de la trama que tiene el candado de este perfil (Chromium lo anota como `host-pid`). */
const duenio = () => {
  try {
    return Number(readlinkSync(path.join(perfil, "SingletonLock")).split("-").pop());
  } catch {
    return 0;
  }
};
/**
 * Es de esta prueba: vive y lleva el puerto de CDP que eligió esta prueba (la primera y las que se
 * relanzan solas lo llevan en sus argumentos). Por el entorno no se puede: Chromium lo pisa en /proc,
 * y a los argumentos de la relanzada los deja en un solo renglón, separados por espacios.
 */
const mio = (pid) => {
  try {
    return pid > 0 && readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0 ]/).includes(`--remote-debugging-port=${puerto}`);
  } catch {
    return false;
  }
};
/** Todo lo que lanzó esta prueba (la primera y las que se relanzaron solas): lo único que se mata. */
const mios = new Set();
/** Cierra, por pid, sólo las tramas de esta prueba; la que quedó viva tiene el candado de este perfil. */
async function limpiar() {
  mios.add(duenio());
  for (const pid of mios) if (mio(pid)) process.kill(pid, "SIGTERM");
  await espera(1500);
  for (const pid of mios) if (mio(pid)) process.kill(pid, "SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
}

const app = spawn(electron, [raiz, "--escondida", `--remote-debugging-port=${puerto}`], { env, stdio: "ignore" });
// Pase lo que pase, esta prueba termina: nada de quedarse colgada con una trama de más corriendo.
setTimeout(() => (console.log("FALLA la prueba tardó más de 2 minutos"), limpiar().then(() => process.exit(1))), 120_000).unref();
mios.add(app.pid);
let salio = 0;
app.on("exit", () => (salio = Date.now()));

/** Conecta por CDP a la página de la trama que esté ahora en el puerto. */
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
  await new Promise((r, no) => (ws.addEventListener("open", r, { once: true }), ws.addEventListener("error", no, { once: true })));
  let n = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) (pend.get(m.id)(m), pend.delete(m.id));
  });
  const cdp = (method, params = {}) =>
    new Promise((r) => {
      const id = ++n;
      pend.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  // Con tope: si la app se va a mitad de un pedido, nadie contesta.
  const en = async (fn, ...args) =>
    (
      await Promise.race([
        cdp("Runtime.evaluate", { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }),
        espera(5000).then(() => null),
      ])
    )?.result?.result?.value;
  const hasta = async (fn, tope, ...args) => {
    for (let i = 0; i < tope * 10; i++) {
      const v = await en(fn, ...args).catch(() => null);
      if (v) return v;
      await espera(100);
    }
    return null;
  };
  /** Una foto de la página (sólo con FOTOS). */
  const foto = async (nombre) => {
    if (!fotos) return;
    const r = await Promise.race([cdp("Page.captureScreenshot", { format: "png" }), espera(5000).then(() => null)]);
    if (r?.result?.data) writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
  };
  return { en, hasta, cdp, foto, cerrar: () => ws.close() };
}
/** Espera a que el candado pase a otra trama (se relanzó) y devuelve su pid; 0 si no pasa. */
async function otra(antes, tope) {
  for (let i = 0; i < tope * 10; i++) {
    const p = duenio();
    if (p && p !== antes && mio(p)) return p;
    await espera(100);
  }
  return 0;
}
/** Las ventanas que Hyprland le ve a un pid (`null` si no hay Hyprland a mano). */
const ventanas = (pid) => {
  try {
    return JSON.parse(execFileSync("hyprctl", ["clients", "-j"], { encoding: "utf8", timeout: 3000 })).filter((c) => c.pid === pid).length;
  } catch {
    return null;
  }
};
/** Una segunda instancia con el mismo perfil: devuelve con qué código sale. */
const segunda = (args, extra = {}) =>
  new Promise((r) => {
    const p = spawn(electron, [raiz, ...args], { env: { ...env, ...extra }, stdio: "ignore" });
    const tope = setTimeout(() => (p.kill("SIGKILL"), r(-1)), 15_000);
    p.on("exit", (c) => (clearTimeout(tope), r(c)));
  });

try {
  // --- Arranca escondida -------------------------------------------------------
  let pag = await pagina();
  ok(await pag.hasta(() => !!window.hilos && !!document.querySelector("#root")?.firstChild, 20), "arranca y carga la interfaz");
  ok(duenio() === app.pid, "es residente: tiene el candado de instancia única de su perfil");
  const v0 = ventanas(app.pid);
  if (v0 === null) console.log("       (sin hyprctl: no se comprueba que no haya ventana)");
  else ok(v0 === 0, "escondida: Hyprland no le ve ninguna ventana");

  ok((await segunda(["--escondida"])) === 0, "una segunda instancia escondida sale sola");
  ok((await segunda(["--escondida"], { TRAMA_UNIDAD: "1" })) === 3, "la de la unidad, si ya hay una trama, sale con 3 (systemd no insiste)");
  await espera(300);
  const v1 = ventanas(app.pid);
  if (v1 !== null) ok(v1 === 0, "y ninguna de las dos le abrió la ventana a la que estaba");
  ok(duenio() === app.pid && vive(app.pid), "la primera sigue siendo la que corre");

  const tam = await pag.en(() => [innerWidth, innerHeight]);
  ok(tam?.[0] === TAM[0] && tam?.[1] === TAM[1], `vuelve del tamaño que tenía la que se reinició (${tam?.join("×")}, no 900×640)`);
  ok(existsSync(path.join(tmp, "hilos", "volver.json")), "y lo anotado NO se gasta al leerlo: vale en cualquier arranque");

  /** El cartel: su texto y el de su botón, y cuántos hay. */
  const cartel = () => {
    const c = document.querySelectorAll(".rei");
    return c.length ? { n: c.length, texto: c[0].querySelector(".rei-t")?.textContent ?? "", boton: c[0].querySelector("button")?.textContent ?? "" } : null;
  };
  const tocar = () => document.querySelector(".rei button")?.click();
  /** La caja de la conversación que se ve. */
  const escrito = () => [...document.querySelectorAll(".caja-zona textarea")].find((t) => t.getClientRects().length)?.value ?? null;

  // --- Un líder respondiendo, su conversación abierta y algo a medio escribir ----------
  await pag.en(() => {
    window.__ev = [];
    window.hilos.lider.alEvento((x) => window.__ev.push({ t: Date.now(), tipo: x?.e?.tipo }));
  });
  ok((await pag.en(cartel)) === null, "sin build nuevo no hay cartel");
  const t0 = Date.now();
  const sid = await pag.en(() => window.hilos.lider.nuevo({ modelo: "sonnet", effort: "medium", texto: "hola, contame algo largo" }));
  ok(typeof sid === "string" && sid.length > 8, "un líder de la app empieza a responder");
  ok(await pag.hasta((sid) => !!document.querySelector(`.lider[data-lider="${sid}"]`), 8, sid), "y aparece en la barra");
  await pag.en((sid) => document.querySelector(`.lider[data-lider="${sid}"]`).click(), sid);
  ok(await pag.hasta((sid) => document.querySelector(`.lider[data-lider="${sid}"]`)?.hasAttribute("data-activa") && !!document.querySelector(".caja-zona textarea"), 5, sid), "se abre su conversación");
  await pag.en(() => [...document.querySelectorAll(".caja-zona textarea")].find((t) => t.getClientRects().length)?.focus());
  await pag.cdp("Input.insertText", { text: BORRADOR });
  ok((await pag.hasta(escrito, 3)) === BORRADOR, "queda algo escrito sin mandar en su caja");

  // --- Build nuevo: avisa, no se reinicia ---------------------------------------------
  build("v2");
  const visto = await pag.hasta(cartel, 5);
  ok(visto?.texto === "Update available" && visto.boton === "Restart", `build más nuevo: aparece el cartel (\"${visto?.texto}\", botón \"${visto?.boton}\")`);
  await pag.foto("cartel");
  build("v3");
  await espera(2500);
  ok(vive(app.pid) && duenio() === app.pid && !salio, "y la trama NO se reinicia sola: 2,5 s y otro build después sigue la misma");
  ok((await pag.en(cartel))?.n === 1, "otro build encima: sigue siendo un solo cartel");
  ok((await pag.en(escrito)) === BORRADOR, "lo escrito sigue ahí");

  // --- Restart con el líder respondiendo: espera, y se puede cancelar -------------------
  ok(!(await pag.en(() => window.__ev.some((x) => x.tipo === "fin"))), "el turno sigue en curso");
  await pag.en(tocar);
  const esperando = await pag.hasta(() => (document.querySelector(".rei[data-espera]") ? document.querySelector(".rei-t").textContent : null), 3);
  ok(/^Waiting for \S+ to finish$/.test(esperando ?? ""), `Restart con un líder respondiendo: dice a quién espera, por su nombre (\"${esperando}\")`);
  await pag.foto("cartel-espera");
  ok((await pag.en(cartel))?.boton === "Cancel", "el botón pasa a Cancel");
  await pag.en(tocar);
  ok((await pag.hasta(() => !document.querySelector(".rei[data-espera]") && document.querySelector(".rei-t")?.textContent, 3)) === "Update available", "Cancel: deja de esperar, el cartel sigue");
  await pag.en(tocar);
  ok(!!(await pag.hasta(() => !!document.querySelector(".rei[data-espera]"), 3)), "Restart otra vez: vuelve a esperar");
  await espera(1000);
  ok(vive(app.pid) && duenio() === app.pid && !salio, "mientras tanto sigue la misma trama: no corta el turno");
  const fin = await pag.hasta(() => window.__ev.find((x) => x.tipo === "fin")?.t ?? 0, 20);
  ok(fin > 0, `el turno termina entero (${((fin - t0) / 1000).toFixed(1)} s)`);
  const segundaTrama = await otra(app.pid, 20);
  mios.add(segundaTrama);
  ok(segundaTrama > 0, `terminado el turno, se reinicia (${salio && fin ? ((salio - fin) / 1000).toFixed(1) : "?"} s después)`);
  ok(salio > 0 && fin > 0 && salio > fin, "la vieja salió después del final del turno, nunca antes");
  pag.cerrar();

  // --- La que volvió: como estaba -----------------------------------------------------
  pag = await pagina();
  ok(await pag.hasta(() => !!window.hilos && !!document.querySelector("#root")?.firstChild, 20), "la reiniciada carga la interfaz");
  const v2 = ventanas(segundaTrama);
  if (v2 !== null) ok(v2 === 0, "vuelve escondida (no tenía la ventana a la vista)");
  const tam2 = await pag.en(() => [innerWidth, innerHeight]);
  ok(tam2?.[0] === TAM[0] && tam2?.[1] === TAM[1], `con el mismo tamaño (${tam2?.join("×")})`);
  ok(await pag.hasta((sid) => !!document.querySelector(`.lider[data-lider="${sid}"][data-activa]`), 10, sid), "con la misma conversación abierta");
  const vuelto = await pag.hasta(escrito, 5);
  ok(vuelto === BORRADOR, `y con lo que estaba escrito sin mandar (\"${vuelto}\")`);
  ok((await pag.en(cartel)) === null, "ya corre el build nuevo: no hay cartel");
  await pag.foto("vuelta");
  const lideres = readFileSync(path.join(tmp, "hilos", "lideres.json"), "utf8");
  ok(lideres.includes(sid), "el líder sigue anotado: se lo retoma con el próximo mensaje");

  // --- Build nuevo sin nadie respondiendo: tampoco se reinicia sola; Restart, en el acto ---
  build("v4");
  ok((await pag.hasta(cartel, 5))?.texto === "Update available", "otro build más nuevo: otra vez el cartel");
  await espera(2500);
  ok(duenio() === segundaTrama && vive(segundaTrama), "sin nadie respondiendo tampoco se reinicia sola");
  const t1 = Date.now();
  await pag.en(tocar);
  const tercera = await otra(segundaTrama, 15);
  mios.add(tercera);
  ok(tercera > 0, `Restart sin nada corriendo: se reinicia en el acto (${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  pag.cerrar();
  pag = await pagina();
  ok(await pag.hasta(() => !!window.hilos && !!document.querySelector("#root")?.firstChild, 20), "y vuelve a andar");
  ok((await pag.hasta(escrito, 5)) === BORRADOR, "otra vez con lo escrito");

  // --- El mismo build de nuevo: nada ----------------------------------------------
  build("v4");
  await espera(2500);
  ok(duenio() === tercera && vive(tercera) && (await pag.en(cartel)) === null, "un build que deja lo mismo no avisa ni reinicia nada");

  // --- Un líder colgado (no contesta ni cierra): "Reiniciar igual" y la salida no se cuelga -----
  build("v5");
  ok((await pag.hasta(cartel, 5))?.texto === "Update available", "otro build más nuevo, ahora con un líder colgado: el cartel");
  const colgado = await pag.en(() => window.hilos.lider.nuevo({ modelo: "sonnet", effort: "medium", texto: "colgate" }));
  ok(typeof colgado === "string" && colgado.length > 8, "un líder que no contesta nunca");
  await pag.en(tocar);
  ok(/^Waiting for \S+ to finish$/.test((await pag.hasta(() => (document.querySelector(".rei[data-espera]") ? document.querySelector(".rei-t").textContent : null), 3)) ?? ""), "Restart: espera a que termine, diciendo quién");
  const ofrece = await pag.hasta(() => document.querySelector(".rei[data-colgado]")?.textContent ?? null, 12);
  ok(/Restart anyway/.test(ofrece ?? "") && /No news from it in 20 min/.test(ofrece ?? ""), `sin eventos, el cartel ofrece Reiniciar igual (\"${ofrece}\")`);
  await pag.foto("cartel-colgado");
  const t2 = Date.now();
  await pag.en(() => document.querySelector(".rei-b[data-prim]")?.click());
  const cuarta = await otra(tercera, 20);
  mios.add(cuarta);
  const tardo = (Date.now() - t2) / 1000;
  ok(cuarta > 0, `Reiniciar igual: se reinicia sin esperar al colgado (${tardo.toFixed(1)} s, tope de salida 10 s)`);
  ok(tardo < 14, "y la salida no se colgó con él");
  pag.cerrar();
  pag = await pagina();
  ok(await pag.hasta(() => !!window.hilos && !!document.querySelector("#root")?.firstChild, 20), "la reiniciada carga la interfaz");
  ok(readFileSync(path.join(tmp, "hilos", "lideres.json"), "utf8").includes(colgado), "el líder colgado sigue anotado: se lo retoma con el próximo mensaje");
  pag.cerrar();
} catch (e) {
  console.log(`FALLA ${e?.stack ?? e}`);
  fallas++;
} finally {
  await limpiar();
}
console.log(fallas ? `\n${fallas} falla(s)` : "\ntodo ok");
process.exit(fallas ? 1 : 0);
