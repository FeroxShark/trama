#!/usr/bin/env node
// statusline-espejo.mjs — port a Node (sin jq, sin bash, sin flock) de statusline-espejo.sh: misma entrada, misma salida y los
// mismos archivos de estado. Envuelve el statusline que ya haya y deja una copia de los datos que Claude Code sólo le pasa al
// statusline (uso del plan, caché de la sesión) para la app `hilos`. Uso en settings.json:
//   "command": "node ~/.claude/hooks/statusline-espejo.mjs <statusline original…>"
//
// Escribe $PA_STATE/statusline/<session_id>.json (atómico, formato versionado de este repo):
//   {version, ts, session_id, cwd, modelo, prompt_cache, config_dir, rate_limits:{five_hour,seven_day}}
// y suma a $PA_STATE/statusline/historial.jsonl {ts, h5, h5_reset, sem, sem_reset[, config_dir]} cuando cambian.
// config_dir = $CLAUDE_CONFIG_DIR de la sesión (null = la cuenta de siempre).
// Nunca rompe el statusline: si algo falla, sigue y muestra lo del original.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const env = process.env;
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function leerStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** `a.b.c` de jq: null si falta o si pasa por null; tira si pasa por algo que no es objeto (jq da error). */
function ruta(o, ...claves) {
  for (const k of claves) {
    if (o === null || o === undefined) return null;
    if (typeof o !== "object" || Array.isArray(o)) throw new Error("jq: no se puede indexar");
    o = Object.hasOwn(o, k) ? o[k] : null;
  }
  return o === undefined ? null : o;
}
/** `a // b` de jq: a salvo que sea null o false. */
const alt = (a, b) => (a === null || a === undefined || a === false ? b : a);

/** `jq -r '.session_id // empty'`: "" si no hay o no se puede leer. */
function sesion(doc) {
  try {
    const v = alt(ruta(doc, "session_id"), null);
    if (v === null) return "";
    return typeof v === "string" ? v : typeof v === "object" ? "" : String(v);
  } catch {
    return "";
  }
}

/** mv -f: en Windows el antivirus/indexador deja el archivo tomado un rato (EBUSY/EPERM/EACCES). */
function renombrar(de, a) {
  const fin = Date.now() + 2000;
  let espera = 10;
  for (;;) {
    try {
      renameSync(de, a);
      return;
    } catch (e) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(e.code) || Date.now() + espera > fin) throw e;
      dormir(espera);
      espera = Math.min(espera * 2, 250);
    }
  }
}

/** Candado por carpeta (reemplaza al flock): espera hasta `maxMs`; false si no lo consiguió. Uno colgado hace más de 30 s se rompe. */
function conCandado(dir, maxMs, f) {
  const fin = Date.now() + maxMs;
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") return false;
      try {
        if (Date.now() - statSync(dir).mtimeMs > 30_000) rmSync(dir, { recursive: true, force: true });
      } catch {}
      if (Date.now() >= fin) return false;
      dormir(20);
    }
  }
  try {
    f();
  } finally {
    try {
      rmdirSync(dir);
    } catch {}
  }
  return true;
}

function espejar(entrada) {
  const home = process.platform === "win32" ? env.USERPROFILE || env.HOME || homedir() : env.HOME || homedir();
  const estado =
    env.PA_STATE ||
    (process.platform === "win32"
      ? path.win32.join(env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "trama", "estado", "pa")
      : path.join(home, ".local", "state", "pa"));
  const dir = path.join(estado, "statusline");

  let doc;
  try {
    doc = JSON.parse(entrada);
  } catch {
    return;
  }
  const sid = sesion(doc);
  if (!sid || !/^[A-Za-z0-9_-]+$/.test(sid)) return;
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${sid}.${process.pid}`);
  let salida;
  try {
    const cd = env.CLAUDE_CONFIG_DIR ?? "";
    salida = {
      version: 1,
      ts: Math.floor(Date.now() / 1000),
      session_id: ruta(doc, "session_id"),
      cwd: alt(ruta(doc, "workspace", "current_dir"), alt(ruta(doc, "cwd"), null)),
      modelo: alt(ruta(doc, "model", "id"), null),
      prompt_cache: alt(ruta(doc, "prompt_cache"), null),
      config_dir: cd === "" ? null : cd,
      rate_limits: {
        five_hour: alt(ruta(doc, "rate_limits", "five_hour"), null),
        seven_day: alt(ruta(doc, "rate_limits", "seven_day"), null),
      },
    };
    writeFileSync(tmp, `${JSON.stringify(salida)}\n`);
  } catch {
    rmSync(tmp, { force: true });
    return;
  }
  renombrar(tmp, path.join(dir, `${sid}.json`));

  // Historial de la cuota (para "cuánto de la semana fue cada cosa" en la app): una línea sólo cuando cambia algún % o el
  // reset; todas las sesiones escriben el mismo archivo.
  let fila;
  try {
    const h5 = ruta(salida, "rate_limits", "five_hour", "used_percentage");
    const sem = ruta(salida, "rate_limits", "seven_day", "used_percentage");
    fila = {
      ts: salida.ts,
      h5,
      h5_reset: ruta(salida, "rate_limits", "five_hour", "resets_at"),
      sem,
      sem_reset: ruta(salida, "rate_limits", "seven_day", "resets_at"),
    };
    if (salida.config_dir) fila.config_dir = salida.config_dir;
    if (h5 === null && sem === null) fila = null;
  } catch {
    fila = null;
  }
  if (!fila) return;
  const historial = path.join(dir, "historial.jsonl");
  conCandado(path.join(dir, ".historial.lock.d"), 2000, () => {
    let ultima = null;
    try {
      const lineas = readFileSync(historial, "utf8").replace(/\n+$/, "").split("\n");
      ultima = JSON.parse(lineas[lineas.length - 1] ?? "");
    } catch {}
    const sinTs = (o) => {
      if (!o || typeof o !== "object" || Array.isArray(o)) return JSON.stringify(o ?? null);
      const { ts: _ts, ...resto } = o;
      return JSON.stringify(resto);
    };
    if (sinTs(fila) !== sinTs(ultima)) appendFileSync(historial, `${JSON.stringify(fila)}\n`);
  });
}

// `entrada=$(cat)`: sin los saltos de línea del final.
const entrada = leerStdin().replace(/\n+$/, "");
try {
  espejar(entrada);
} catch {}

const comando = process.argv.slice(2);
if (comando.length === 0) process.exit(0);
const r = spawnSync(comando[0], comando.slice(1), { input: entrada, stdio: ["pipe", "inherit", "inherit"] });
if (r.error) {
  process.stderr.write(`statusline-espejo: no pude correr ${comando[0]}: ${r.error.message}\n`);
  process.exit(127);
}
process.exit(r.status ?? 1);
