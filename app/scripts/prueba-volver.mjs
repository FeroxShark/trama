#!/usr/bin/env node
// Prueba de punta a punta de "nada se pierde al reiniciar": una trama residente de verdad, escondida, con su
// propio perfil (HILOS_PERFIL), su estado y los fakes. Se escribe en la caja de un líder, se sube el scroll de su
// conversación y se la mata de golpe (SIGKILL: como un apagón, sin tiempo de guardar nada al salir). La que
// arranca de nuevo, SIN el cartel de la actualización de por medio, vuelve con:
//   1. la misma conversación abierta, lo escrito sin mandar y el scroll en el mismo punto;
//   2. si lo que quedó abierto ya no existe, abre normal (sin conversación, sin error);
//   3. salir de verdad (Ctrl+Q) con algo recién escrito también lo conserva.
// No abre ninguna ventana ni toca `pa`, Claude, el tablero ni la trama de verdad. Sólo se matan, por pid
// exacto, los procesos que lanzó esta prueba.
//   npm run build && node scripts/prueba-volver.mjs   (FOTOS=<carpeta> deja capturas)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hilos-volver-")));
const puerto = 9900 + Math.floor(Math.random() * 500);
const electron = path.join(raiz, "node_modules/electron/dist/electron");
const perfil = path.join(tmp, "perfil");
const estado = path.join(tmp, "hilos");
for (const d of ["proy/atlas", "pa", "sesiones", "claude", "tablero", "build/dist-electron", "build/dist"]) mkdirSync(path.join(tmp, d), { recursive: true });
writeFileSync(path.join(tmp, "registry.json"), JSON.stringify({ projects: [{ name: "Atlas Web", path: path.join(tmp, "proy", "atlas"), desc: "La web" }] }));
writeFileSync(path.join(tmp, "settings.json"), "{}");
writeFileSync(path.join(tmp, "CLAUDE.md"), "");
// El build de mentira que mira la app (sin esto miraría el dist/ de este checkout): no cambia en toda la prueba.
writeFileSync(path.join(tmp, "build/dist-electron/main.js"), "// v1\n");
writeFileSync(path.join(tmp, "build/dist/index.html"), '<script src="/assets/index-v1.js"></script>\n');
const fotos = process.env.FOTOS ? path.resolve(process.env.FOTOS) : null;
if (fotos) mkdirSync(fotos, { recursive: true });

const BORRADOR = "esto lo dejé a medio escribir ñ";
const AGREGADO = " y esto, justo antes de salir";

const env = {
  ...process.env,
  HILOS_FIXTURES: "0",
  HILOS_IDIOMA: "en",
  HILOS_VISTA: "todo",
  HILOS_PERFIL: perfil,
  HILOS_BUILD: path.join(tmp, "build"),
  HILOS_PA: path.join(raiz, "scripts/pa-falso.sh"),
  PA_FALSO_N: "0",
  PA_FALSO_LOG: path.join(tmp, "pa-falso.log"),
  PA_STATE: path.join(tmp, "pa"),
  HILOS_STATE: estado,
  PROYECTOS_REGISTRY: path.join(tmp, "registry.json"),
  HILOS_SESIONES: path.join(tmp, "sesiones"),
  HILOS_CLAUDE: path.join(raiz, "scripts/claude-falso.mjs"),
  HILOS_CLAUDE_SETTINGS: path.join(tmp, "settings.json"),
  HILOS_CLAUDE_MD: path.join(tmp, "CLAUDE.md"),
  HILOS_PA_PLAN: path.join(tmp, "plan"),
  CLAUDE_CONFIG_DIR: path.join(tmp, "claude"),
  AVISO_CONTEXTO: "",
  TRAMA_FALSO_LOG: path.join(tmp, "claude-falso.log"),
  TRAMA_FALSO_MS: "20",
  TRAMA_FALSO_TOKEN_MS: "1",
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
/** Es de esta prueba: lleva el puerto de CDP que eligió ella. */
const mio = (pid) => {
  try {
    return pid > 0 && readFileSync(`/proc/${pid}/cmdline`, "utf8").split(/[\0 ]/).includes(`--remote-debugging-port=${puerto}`);
  } catch {
    return false;
  }
};
/** Los procesos con el estado de esta prueba en el entorno (el `claude` falso de un líder que quedó huérfano). */
const huerfanos = () => {
  const r = [];
  for (const d of readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try {
      if (readFileSync(`/proc/${d}/environ`, "utf8").split("\0").includes(`HILOS_STATE=${estado}`)) r.push(Number(d));
    } catch {}
  }
  return r.filter((p) => p !== process.pid);
};
const mios = new Set();
async function limpiar() {
  for (const pid of mios) if (mio(pid)) process.kill(pid, "SIGKILL");
  for (const pid of huerfanos()) process.kill(pid, "SIGKILL");
  await espera(300);
  rmSync(tmp, { recursive: true, force: true });
}
setTimeout(() => (console.log("FALLA la prueba tardó más de 3 minutos"), limpiar().then(() => process.exit(1))), 180_000).unref();

/** Lanza una trama residente escondida; devuelve su proceso. */
function lanzar() {
  const p = spawn(electron, [raiz, "--escondida", `--remote-debugging-port=${puerto}`], { env, stdio: "ignore" });
  mios.add(p.pid);
  p.salio = new Promise((r) => p.on("exit", r));
  return p;
}
/** Mata por pid y espera a que se vaya (nada de guardar al salir). */
async function matar(p) {
  // Puede haberse ido sola (Ctrl+Q forzado): matar a un pid que ya salió no es un fallo.
  try {
    process.kill(p.pid, "SIGKILL");
  } catch {}
  await p.salio;
  for (const h of huerfanos()) process.kill(h, "SIGKILL");
  await espera(300);
}

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
  const foto = async (nombre) => {
    if (!fotos) return;
    const r = await Promise.race([cdp("Page.captureScreenshot", { format: "png" }), espera(5000).then(() => null)]);
    if (r?.result?.data) writeFileSync(path.join(fotos, `${nombre}.png`), Buffer.from(r.result.data, "base64"));
  };
  // La ventana de la prueba nunca se ve: con `content-visibility: auto` el navegador salta todos los mensajes (cada uno
  // mide su alto de reserva) y la conversación no alcanza para scrollear. Se apagan para medir el scroll de verdad.
  const estilo = `document.documentElement.appendChild(Object.assign(document.createElement("style"), { textContent: ".conv > * { content-visibility: visible !important; }" }))`;
  await cdp("Page.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: estilo });
  await cdp("Runtime.evaluate", { expression: estilo });
  return { en, hasta, cdp, foto, cerrar: () => ws.close() };
}

// Lo que se mide dentro de la página.
const listo = () => !!window.hilos && !!document.querySelector("#root")?.firstChild;
const visible = (e) => !!e && e.getClientRects().length > 0;
/** La caja de la conversación que se ve. */
const escrito = () => [...document.querySelectorAll(".caja-zona textarea")].find((t) => t.getClientRects().length)?.value ?? null;
/** Cuántos px faltan para el final de la conversación que se ve (`null`: no hay). */
const faltan = () => {
  const z = [...document.querySelectorAll(".conv-zona")].find((e) => e.getClientRects().length);
  return z ? Math.round(z.scrollHeight - z.clientHeight - z.scrollTop) : null;
};
const archivo = (nombre) => {
  try {
    return JSON.parse(readFileSync(path.join(estado, nombre), "utf8"));
  } catch {
    return null;
  }
};

try {
  // --- Primera vida: líder, conversación larga, algo escrito, scroll arriba -----------------
  let app = lanzar();
  let pag = await pagina();
  ok(await pag.hasta(listo, 20), "arranca y carga la interfaz");
  await pag.en(() => {
    window.__fin = false;
    window.hilos.lider.alEvento((x) => x?.e?.tipo === "fin" && (window.__fin = true));
  });
  const sid = await pag.en(() => window.hilos.lider.nuevo({ modelo: "sonnet", effort: "medium", texto: "contame una novela" }));
  ok(typeof sid === "string" && sid.length > 8, "un líder de la app contesta una conversación larga");
  // El `claude` falso no escribe transcript: lo deja la prueba, como Claude Code (de ahí lee la trama que vuelve).
  const carpetaT = path.join(tmp, "claude", "projects", "-prueba");
  mkdirSync(carpetaT, { recursive: true });
  const ts = new Date().toISOString();
  const larga = Array.from({ length: 40 }, (_, i) => `Párrafo ${i + 1} de la novela: ${"texto de relleno inventado ".repeat(8)}`).join("\n\n");
  writeFileSync(
    path.join(carpetaT, `${sid}.jsonl`),
    JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content: "contame una novela" } }) +
      "\n" +
      JSON.stringify({ type: "assistant", timestamp: ts, message: { id: "msg_falso_1", model: "claude-opus-5-5", role: "assistant", content: [{ type: "text", text: larga }] } }) +
      "\n",
  );
  ok(await pag.hasta(() => window.__fin, 30), "el turno termina");
  ok(await pag.hasta((sid) => !!document.querySelector(`.lider[data-lider="${sid}"]`), 8, sid), "y el líder aparece en la barra");
  await pag.en((sid) => document.querySelector(`.lider[data-lider="${sid}"]`).click(), sid);
  ok(await pag.hasta((sid) => document.querySelector(`.lider[data-lider="${sid}"]`)?.hasAttribute("data-activa") && !!document.querySelector(".caja-zona textarea"), 5, sid), "se abre su conversación");
  ok(
    await pag.hasta(() => {
      const z = [...document.querySelectorAll(".conv-zona")].find((e) => e.getClientRects().length);
      return !!z && z.scrollHeight > z.clientHeight * 2;
    }, 10),
    `la conversación es más alta que la ventana (${JSON.stringify(await pag.en(() => [...document.querySelectorAll(".conv-zona")].map((e) => [e.scrollHeight, e.clientHeight, e.getClientRects().length])))})`,
  );
  await espera(300);
  ok((await pag.en(faltan)) < 8, "abre pegada al fondo, como siempre");

  await pag.en(() => [...document.querySelectorAll(".caja-zona textarea")].find((t) => t.getClientRects().length)?.focus());
  await pag.cdp("Input.insertText", { text: BORRADOR });
  ok((await pag.hasta(escrito, 3)) === BORRADOR, "queda algo escrito sin mandar en su caja");
  // Sube a la mitad. En una ventana escondida el navegador puede no entregar el evento `scroll` (no pinta cuadros): se lo da el script.
  await pag.en(() => {
    const z = [...document.querySelectorAll(".conv-zona")].find((e) => e.getClientRects().length);
    z.scrollTop = Math.round((z.scrollHeight - z.clientHeight) / 2);
    z.dispatchEvent(new Event("scroll"));
  });
  const arriba = await pag.en(faltan);
  ok(arriba > 200, `y se sube la conversación (faltan ${arriba} px para el final)`);
  await pag.foto("antes");

  // Pasada la demora, sin que nadie pida nada, ya está en disco.
  await espera(1200);
  const b = archivo("borradores.json");
  ok(b?.borradores?.[`lider:${sid}`]?.texto === BORRADOR, "pasados ~500 ms, lo escrito ya está en borradores.json");
  const vol = archivo("volver.json");
  ok(vol?.vistas?.ventana?.activa === `lider:${sid}`, "y la conversación abierta, en volver.json");
  ok(Math.abs((vol?.vistas?.ventana?.scrolls?.[`lider:${sid}`] ?? -1) - arriba) <= 8, "con el punto de la conversación");
  ok(!!vol?.ventana?.ancho, "y el tamaño de la ventana");

  // --- Se la mata de golpe y arranca otra: sin cartel, sin Reiniciar -------------------
  pag.cerrar();
  await matar(app);
  ok(!vive(app.pid), "la trama se fue de golpe (SIGKILL)");
  app = lanzar();
  pag = await pagina();
  ok(await pag.hasta(listo, 20), "la nueva carga la interfaz");
  ok(await pag.hasta((sid) => !!document.querySelector(`.lider[data-lider="${sid}"][data-activa]`), 10, sid), "con la misma conversación abierta");
  const vuelto = await pag.hasta(escrito, 8);
  ok(vuelto === BORRADOR, `y con lo que estaba escrito sin mandar (\"${vuelto}\")`);
  const alVolver = await pag.hasta(() => {
    const z = [...document.querySelectorAll(".conv-zona")].find((e) => e.getClientRects().length);
    const f = z ? Math.round(z.scrollHeight - z.clientHeight - z.scrollTop) : 0;
    return f > 100 ? f : 0;
  }, 10);
  ok(Math.abs(alVolver - arriba) <= 40, `y la conversación en el mismo punto (faltan ${alVolver} px; antes ${arriba})`);
  await pag.foto("despues");
  ok(!(await pag.en(() => !!document.querySelector(".rei"))), "sin cartel de actualización: no hizo falta Reiniciar");

  // --- Ctrl+Q con algo recién escrito ---------------------------
  await pag.en(() => [...document.querySelectorAll(".caja-zona textarea")].find((t) => t.getClientRects().length)?.focus());
  await pag.en(() => {
    const t = [...document.querySelectorAll(".caja-zona textarea")].find((e) => e.getClientRects().length);
    t.setSelectionRange(t.value.length, t.value.length);
  });
  await pag.cdp("Input.insertText", { text: AGREGADO });
  ok((await pag.hasta(escrito, 3)) === BORRADOR + AGREGADO, "se agrega algo al final y se sale");
  // Salir de verdad (Ctrl+Q). Una trama escondida y atada a CDP no termina de irse sola, y la ventana de la prueba nunca
  // se ve (no hay `visibilitychange` que vacíe antes): se le da la demora y se la mata, como a la unidad que no termina.
  await pag.en(() => window.hilos.salir({ modo: "seguir", forzar: true }));
  await espera(1500);
  pag.cerrar();
  await matar(app);
  for (const h of huerfanos()) process.kill(h, "SIGKILL");
  app = lanzar();
  pag = await pagina();
  ok(await pag.hasta(listo, 20), "arranca de nuevo");
  ok(await pag.hasta((sid) => !!document.querySelector(`.lider[data-lider="${sid}"][data-activa]`), 10, sid), "con la conversación abierta");
  const final = await pag.hasta(escrito, 8);
  ok(final === BORRADOR + AGREGADO, `y con lo último que se escribió (\"${final}\")`);

  // --- Lo abierto ya no existe: se abre normal ------------------------------------------
  pag.cerrar();
  await matar(app);
  const v2 = archivo("volver.json");
  v2.vistas.ventana = { ...v2.vistas.ventana, activa: "lider:00000000-0000-4000-8000-000000000000", scrolls: { "lider:00000000-0000-4000-8000-000000000000": 500 } };
  writeFileSync(path.join(estado, "volver.json"), JSON.stringify(v2));
  app = lanzar();
  pag = await pagina();
  ok(await pag.hasta(listo, 20), "con una conversación que ya no existe, arranca igual");
  await espera(1500);
  ok(await pag.en((sid) => !!document.querySelector(`.lider[data-lider="${sid}"]`) && !document.querySelector("[data-activa]"), sid), `abre normal: la lista, sin nada abierto ${JSON.stringify(await pag.en(() => [...document.querySelectorAll("[data-activa]")].map((e) => e.className)))}`);
  await pag.foto("inexistente");
  pag.cerrar();
} catch (e) {
  console.log(`FALLA ${e?.stack ?? e}`);
  fallas++;
} finally {
  await limpiar();
}
console.log(fallas ? `\n${fallas} falla(s)` : "\ntodo ok");
process.exit(fallas ? 1 : 0);
