// Corre `node --test` sobre tests/*.test.ts sin depender del shell (cmd.exe no expande globs
// ni entiende comillas simples). Pasa por el entorno y los argumentos extra tal cual.
//
// Cada archivo corre en su propio `node --test`, con un tope de tiempo: un archivo que se cuelga (un servidor que no
// existe, un hijo que no muere) se corta y cuenta como falla en vez de dejar el job de CI esperando horas.
// TRAMA_TEST_ARCHIVO_S cambia el tope por archivo (default 300 s); TRAMA_TEST_PARALELO, cuántos a la vez;
// TRAMA_TEST_DIR, otra carpeta de archivos (lo usa tests/runner-tope.test.ts).
//
// Ningún proceso de un archivo queda vivo al terminar, ni cortado ni sano: se mata su grupo (POSIX) o su árbol
// (taskkill /T /F). Lo que se desprendió con setsid no está en el grupo: en Linux se lo encuentra por una marca en el
// entorno (TRAMA_TEST_MARCA=<pid del runner>:<n>) que heredan los hijos. Si el runner muere sin avisar (SIGKILL, como
// cuando el tool corta el comando), un vigía desprendido barre lo que quedó con su marca.
import { readdirSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARCA = "TRAMA_TEST_MARCA";
const POSIX = process.platform !== "win32";
const LINUX = process.platform === "linux";
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// `node scripts/test.mjs --vigilar <pid> <prefijo>`: el vigía de un runner (ver `vigilar`); no corre la suite.
if (process.argv[2] === "--vigilar") {
  await vigilar(Number(process.argv[3]), process.argv[4]);
  process.exit(0);
}

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.resolve(raiz, process.env.TRAMA_TEST_DIR || "tests");
const archivos = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => path.relative(raiz, path.join(dir, f)));

const env = { ...process.env };
for (const k of Object.keys(env)) {
  // NODE_TEST_CONTEXT: lo pone `node --test` en sus hijos; con él el `node --test` de cada archivo no corre nada.
  if (k.startsWith("PA_") || k === "TRAMA_LOCAL" || k === MARCA || k === "NODE_TEST_CONTEXT") delete env[k];
}
env.TRAMA_GO_SIN_RED = "1"; // las pruebas no leen opencode.ai/go (los topes de Go salen del caché de cada prueba o del respaldo)

const TOPE_MS = Math.max(1, Number(env.TRAMA_TEST_ARCHIVO_S) || 300) * 1000;
const PARALELO = Math.max(1, Number(env.TRAMA_TEST_PARALELO) || Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1));
const extra = process.argv.slice(2);

/** Linux: los pids cuyo entorno cumple `coincide` (los hijos heredan la marca; un zombie no tiene entorno). */
function marcados(coincide) {
  if (!LINUX) return [];
  const r = [];
  for (const n of readdirSync("/proc")) {
    if (!/^\d+$/.test(n) || Number(n) === process.pid) continue;
    try {
      if (readFileSync(`/proc/${n}/environ`, "latin1").split("\0").some(coincide)) r.push(Number(n));
    } catch {
      /* murió mientras tanto, o es de otro usuario */
    }
  }
  return r;
}
const marcadosDe = (clave) => marcados((e) => e === `${MARCA}=${clave}`);

function matarPid(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* ya murió */
  }
}

/** Mata el archivo entero: su grupo (POSIX) o su árbol (Windows), y lo que se desprendió con su marca. */
function matar(pid, clave) {
  if (pid) {
    try {
      if (POSIX) process.kill(-pid, "SIGKILL");
      else spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      matarPid(pid);
    }
  }
  marcadosDe(clave).forEach(matarPid);
}

/** Los procesos del archivo que siguen vivos tras `graciaMs` (un hijo que ya se iba sale solo). */
async function esperarVacio(clave, graciaMs) {
  let vivos = marcadosDe(clave);
  for (let t = 0; vivos.length && t < graciaMs; t += 100) {
    await dormir(100);
    vivos = marcadosDe(clave);
  }
  return vivos;
}

function vivoPid(pid) {
  try {
    process.kill(pid, 0);
  } catch (e) {
    return e.code === "EPERM";
  }
  return true;
}

/** El vigía: espera a que el runner `pid` se vaya y barre lo que quedó con su marca (`prefijo`). Un SIGKILL no deja correr nada del runner. */
async function vigilar(pid, prefijo) {
  while (vivoPid(pid)) await dormir(500);
  marcados((e) => e.startsWith(prefijo)).forEach(matarPid);
}

const activos = new Map(); // clave → pid del hijo, de los archivos en curso
// El vigía (Linux) va desprendido y sin stdio: no lo corta el grupo ni el tool que corta al runner.
const vigia = LINUX
  ? spawn(process.execPath, [fileURLToPath(import.meta.url), "--vigilar", String(process.pid), `${MARCA}=${process.pid}:`], {
      detached: true,
      stdio: "ignore",
      env,
    })
  : undefined;
vigia?.unref();
process.on("exit", () => {
  for (const [clave, pid] of activos) matar(pid, clave);
  if (vigia?.pid) {
    try {
      process.kill(-vigia.pid, "SIGKILL");
    } catch {
      /* ya se fue */
    }
  }
});

let seq = 0;
/** Corre un archivo; devuelve { archivo, codigo, colgado, sobraron, salida }. `sobraron`: procesos suyos que seguían vivos al salir (se mataron). */
function correr(archivo) {
  return new Promise((resolve) => {
    const clave = `${process.pid}:${++seq}`;
    const hijo = spawn(process.execPath, ["--test", `--test-timeout=${Math.floor(TOPE_MS * 0.8)}`, "--test-force-exit", ...extra, archivo], {
      cwd: raiz,
      env: { ...env, [MARCA]: clave },
      stdio: ["ignore", "pipe", "pipe"],
      detached: POSIX, // su propio grupo: se corta de un golpe con sus hijos
    });
    activos.set(clave, hijo.pid);
    const trozos = [];
    hijo.stdout.on("data", (d) => trozos.push(d));
    hijo.stderr.on("data", (d) => trozos.push(d));
    let codigo = 1;
    let colgado = false;
    let sobraron = 0;
    let listo = false;
    const fin = () => {
      if (listo) return;
      listo = true;
      clearTimeout(reloj);
      activos.delete(clave);
      hijo.stdout.destroy();
      hijo.stderr.destroy();
      resolve({ archivo, codigo, colgado, sobraron, salida: Buffer.concat(trozos).toString("utf8") });
    };
    const reloj = setTimeout(() => {
      colgado = true;
      matar(hijo.pid, clave);
      fin(); // sin esperar 'close': un hijo que se desprendió puede retener el pipe
    }, TOPE_MS);
    // 'exit' antes que 'close': lo que sigue vivo tras un momento se cuenta como sobrante y se mata; así llega 'close'.
    const salio = new Promise((listoSalio) => {
      hijo.once("exit", async (c) => {
        codigo = c ?? 1;
        sobraron = (await esperarVacio(clave, 1000)).length;
        matar(hijo.pid, clave);
        listoSalio();
      });
      hijo.once("error", (e) => {
        trozos.push(Buffer.from(String(e.message)));
        codigo = 1;
        listoSalio();
        fin();
      });
    });
    hijo.once("close", async () => {
      await salio;
      fin();
    });
  });
}

const cola = [...archivos];
const fallas = [];
const totales = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0 };
/** Suma los «# pass 3» (TAP) o «ℹ pass 3» (spec) que imprime cada node --test, para dar un total como antes. */
function sumar(salida) {
  for (const k of Object.keys(totales)) {
    const m = new RegExp(`^(?:#|ℹ) ${k} (\\d+)\\s*$`, "m").exec(salida);
    if (m) totales[k] += Number(m[1]);
  }
}
let hechos = 0;
async function obrero() {
  while (cola.length) {
    const r = await correr(cola.shift());
    hechos++;
    sumar(r.salida);
    const mal = r.colgado || r.codigo !== 0;
    process.stdout.write(r.salida);
    if (r.colgado) process.stdout.write(`\n##[error]${r.archivo}: sin terminar tras ${TOPE_MS / 1000} s; se cortó\n`);
    // Lo que quedó vivo al salir el archivo ya se mató: se avisa, no falla (algunos tests dejan un hijo sin esperarlo).
    if (r.sobraron) process.stdout.write(`\n##[warning]${r.archivo}: dejó ${r.sobraron} proceso(s) vivo(s); se mataron\n`);
    if (mal) fallas.push(r.colgado ? `${r.archivo} (colgado)` : r.archivo);
    process.stdout.write(`${mal ? "✖" : "✔"} [${hechos}/${archivos.length}] ${r.archivo}\n`);
  }
}
await Promise.all(Array.from({ length: Math.min(PARALELO, archivos.length) }, obrero));

console.log(`\n${archivos.length - fallas.length}/${archivos.length} archivos sin fallas`);
console.log(Object.entries(totales).map(([k, v]) => `# ${k} ${v}`).join("\n"));
if (fallas.length) {
  console.log(`Con fallas:\n  ${fallas.join("\n  ")}`);
  process.exit(1);
}
