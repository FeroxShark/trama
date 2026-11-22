#!/usr/bin/env node
// hook-compactando.mjs — hook de Claude Code para que Trama sepa quién está compactando su contexto (`electron/compactando.ts`):
// Claude Code no lo deja escrito en ningún lado. Port a Node (sin bash, ni jq; anda igual en Windows) de `app/scripts/hook-compactando.sh`.
// Se registra en los dos eventos, con el mismo comando:
//   PreCompact:  hook-compactando.mjs    deja la marca
//   PostCompact: hook-compactando.mjs    la saca
// Qué evento es lo dice el `hook_event_name` que Claude Code manda por stdin; también se puede decir a mano: `hook-compactando.mjs empieza|termina`.
// La marca es un archivo vacío, `<estado>/compactando/<id>` (`HILOS_STATE`; default `~/.local/state/hilos`, en Windows
// `%LOCALAPPDATA%\trama\estado\hilos`). <id>: en un worker de `pa`, el id de su run (PA_TS, que es el de su fila); si no, el session_id
// (el de la fila de un líder). Nunca falla ni imprime nada: un hook que sale mal no puede frenar un compactado.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const env = process.env;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Estado de la app (misma regla que `nota-compactar.mjs` y `rutas.ts`). */
function estadoHilos(e = env, plat = process.platform) {
  if (e.HILOS_STATE) return e.HILOS_STATE;
  const win = plat === "win32";
  const casa = win ? e.USERPROFILE || e.HOME || homedir() : e.HOME || homedir();
  return win
    ? path.win32.join(e.LOCALAPPDATA || path.win32.join(casa, "AppData", "Local"), "trama", "estado", "hilos")
    : path.posix.join(casa, ".local", "state", "hilos");
}

function leerStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  let accion = process.argv[2] ?? "";
  // A mano, desde una terminal, no hay nada que leer (el .sh tampoco lo espera si stdin es una terminal).
  const entrada = process.stdin.isTTY ? "" : leerStdin();
  if (!accion) accion = /"hook_event_name"\s*:\s*"PreCompact"/.test(entrada) ? "empieza" : "termina";

  let id = "";
  if (env.PA_WORKER === "1" && env.PA_TS) id = env.PA_TS;
  else {
    const m = /"session_id"\s*:\s*"([A-Za-z0-9._-]+)"/.exec(entrada);
    if (m) id = m[1];
  }
  // Sólo un nombre de archivo: nada que pueda salirse de la carpeta.
  if (!ID.test(id) || id.length > 128) return;

  const dir = path.join(estadoHilos(), "compactando");
  if (accion === "empieza") {
    mkdirSync(dir, { recursive: true });
    closeSync(openSync(path.join(dir, id), "w"));
  } else if (accion === "termina") {
    rmSync(path.join(dir, id), { force: true });
  }
}

try {
  main();
} catch {
  /* nunca falla */
}
process.exitCode = 0;
