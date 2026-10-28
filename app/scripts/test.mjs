// Corre `node --test` sobre tests/*.test.ts sin depender del shell (cmd.exe no expande globs
// ni entiende comillas simples). Pasa por el entorno y los argumentos extra tal cual.
//
// Cada archivo corre en su propio `node --test`, con un tope de tiempo: un archivo que se cuelga (un servidor que no
// existe, un hijo que no muere) se corta y cuenta como falla en vez de dejar el job de CI esperando horas.
// TRAMA_TEST_ARCHIVO_S cambia el tope por archivo (default 300 s); TRAMA_TEST_PARALELO, cuántos a la vez.
import { readdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(raiz, "tests");
const archivos = readdirSync(dir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => path.join("tests", f));

const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (k.startsWith("PA_") || k === "TRAMA_LOCAL") delete env[k];
}
env.TRAMA_GO_SIN_RED = "1"; // las pruebas no leen opencode.ai/go (los topes de Go salen del caché de cada prueba o del respaldo)

const TOPE_MS = Math.max(1, Number(env.TRAMA_TEST_ARCHIVO_S) || 300) * 1000;
const PARALELO = Math.max(1, Number(env.TRAMA_TEST_PARALELO) || Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1));
const extra = process.argv.slice(2);
const POSIX = process.platform !== "win32";

/** Mata el proceso y todo lo que colgó de él (en Windows `kill` solo deja a los nietos vivos). */
function matar(hijo) {
  if (!hijo.pid) return;
  try {
    if (POSIX) process.kill(-hijo.pid, "SIGKILL");
    else spawnSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    try {
      hijo.kill("SIGKILL");
    } catch {
      /* ya murió */
    }
  }
}

/** Corre un archivo; devuelve { archivo, codigo, colgado, salida }. */
function correr(archivo) {
  return new Promise((resolve) => {
    const hijo = spawn(process.execPath, ["--test", `--test-timeout=${Math.floor(TOPE_MS * 0.8)}`, "--test-force-exit", ...extra, archivo], {
      cwd: raiz,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: POSIX, // su propio grupo: se corta de un golpe con sus hijos
    });
    const trozos = [];
    hijo.stdout.on("data", (d) => trozos.push(d));
    hijo.stderr.on("data", (d) => trozos.push(d));
    let colgado = false;
    const reloj = setTimeout(() => {
      colgado = true;
      matar(hijo);
    }, TOPE_MS);
    const fin = (codigo) => {
      clearTimeout(reloj);
      if (POSIX && hijo.pid) {
        try {
          process.kill(-hijo.pid, "SIGKILL"); // lo que haya quedado vivo del archivo
        } catch {
          /* nada vivo */
        }
      }
      resolve({ archivo, codigo, colgado, salida: Buffer.concat(trozos).toString("utf8") });
    };
    hijo.on("error", (e) => {
      trozos.push(Buffer.from(String(e.message)));
      fin(1);
    });
    hijo.on("close", (codigo) => fin(codigo ?? 1));
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
