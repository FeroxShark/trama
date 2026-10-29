// Pone al día app/dist-electron antes de correr un CLI compilado (pa, reparto, tablero, cuentas: motor/bin y los .cmd de Windows).
// Si algún .ts de app/electron (o app/tsconfig.electron.json) es más nuevo que el .js que se va a correr, recompila con tsc.
//
//   node app/scripts/asegurar-cli.mjs <app/dist-electron/cli/x.js>   recompila sólo si hace falta
//   node app/scripts/asegurar-cli.mjs --recompilar                    recompila siempre (lo usa `pa --integrar` en el repo de Trama)
//
// Sale con 0 y en silencio cuando anda. Si tsc no compila, avisa por stderr y el .js que hay sigue valiendo: el tsconfig va con
// noEmitOnError, así un error de tipos no pisa el build bueno. Dos procesos que llegan juntos se turnan con un candado (un directorio
// dist-electron/.compilar.lock): el segundo espera y, al tenerlo, mira otra vez si todavía hace falta. En un Trama instalado (payload
// de Windows) no hay app/electron: no hay con qué comparar y no hace nada.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUENTES = path.join(APP, "electron");
const TSCONFIG = path.join(APP, "tsconfig.electron.json");
const DIST = path.join(APP, "dist-electron");
const TSC = path.join(APP, "node_modules", "typescript", "bin", "tsc");
const CANDADO = path.join(DIST, ".compilar.lock");
const CANDADO_VIEJO_MS = 5 * 60_000; // un candado más viejo lo dejó un proceso muerto
const ESPERA_MS = 3 * 60_000;
const TOPE_TSC_MS = 5 * 60_000;
const ENV = { ...process.env, ELECTRON_RUN_AS_NODE: "1" }; // desde la app, process.execPath es Electron

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const avisar = (texto) => process.stderr.write(`${texto}\n`);

/** Los .ts/.cts de app/electron y el tsconfig: lo que lee el build. */
function fuentes() {
  if (!existsSync(FUENTES)) return [];
  const out = existsSync(TSCONFIG) ? [TSCONFIG] : [];
  const rec = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) rec(ruta);
      else if (/\.c?ts$/.test(e.name)) out.push(ruta);
    }
  };
  rec(FUENTES);
  return out;
}

/** ¿Hace falta recompilar para que `entrada` (un .js de dist-electron) esté al día? */
function desactualizado(entrada) {
  if (!existsSync(FUENTES)) return false;
  if (!existsSync(entrada)) return true;
  const t = statSync(entrada).mtimeMs;
  return fuentes().some((f) => statSync(f).mtimeMs > t);
}

/** tsc -p tsconfig.electron.json, sin salida si anda. Devuelve null si anda, si no lo que dijo tsc. */
function compilar() {
  return new Promise((resolver) => {
    let salida = "";
    const h = spawn(process.execPath, [TSC, "-p", TSCONFIG, "--noEmitOnError"], { cwd: APP, env: ENV, stdio: ["ignore", "pipe", "pipe"], timeout: TOPE_TSC_MS });
    h.stdout.on("data", (d) => (salida += d));
    h.stderr.on("data", (d) => (salida += d));
    h.on("error", (e) => resolver(e.message));
    h.on("close", (code) => resolver(code === 0 ? null : salida || `tsc salió con ${code}`));
  });
}

/** Corre `fn` con el candado de dist-electron. Devuelve false si no lo consiguió en ESPERA_MS. */
async function conCandado(fn) {
  mkdirSync(DIST, { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try {
      mkdirSync(CANDADO);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - statSync(CANDADO).mtimeMs > CANDADO_VIEJO_MS) rmSync(CANDADO, { recursive: true, force: true });
        else if (Date.now() - t0 > ESPERA_MS) return false;
        else await dormir(200);
      } catch {
        /* el dueño lo soltó justo ahora: se reintenta */
      }
    }
  }
  try {
    await fn();
    return true;
  } finally {
    rmSync(CANDADO, { recursive: true, force: true });
  }
}

/** Recompila si hace falta (o siempre, con `forzar`), de a uno a la vez. */
async function asegurar(entrada, forzar) {
  if (!existsSync(TSCONFIG) || (!forzar && !desactualizado(entrada))) return;
  const libre = await conCandado(async () => {
    if (!forzar && !desactualizado(entrada)) return; // otro proceso ya compiló mientras esperábamos
    const err = await compilar();
    if (err) avisar(`trama: no pude recompilar app/dist-electron (tsc -p tsconfig.electron.json); sigo con el .js que hay.\n${err.split("\n").slice(0, 15).join("\n")}`);
  });
  if (!libre) avisar("trama: otro proceso sigue compilando app/dist-electron; sigo con el .js que hay.");
}

const args = process.argv.slice(2);
try {
  if (args[0] === "--recompilar") {
    await asegurar(null, true);
  } else if (args[0]) {
    const entrada = path.resolve(args[0]);
    const rel = path.relative(DIST, entrada);
    // sólo lo que vive en app/dist-electron: un TRAMA_PA_JS apuntando a otro .js no se toca
    if (rel && rel.split(path.sep)[0] !== ".." && !path.isAbsolute(rel)) await asegurar(entrada, false);
  }
} catch (e) {
  avisar(`trama: no pude revisar app/dist-electron (${e.message}); sigo con el .js que hay.`);
}
process.exit(0);
