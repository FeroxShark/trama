"use strict";
// La parte de la carcasa de la salud de Trama: anota en el MISMO archivo que lee el canal `salud:eventos` del motor
// (app/electron/salud-eventos.ts: `%LOCALAPPDATA%\trama\estado\hilos\salud-eventos.jsonl`, una línea JSON `{t, tipo, ...datos}`, las últimas 200).
// En Windows la carcasa sólo sabe lo de la vuelta de versión (`vuelta-version`); reinicios, líderes cortados y avisos descartados los
// anota el motor. El canal no se repite acá: la página lo pide al motor por /rpc. Escribir nunca tira la carcasa.

const fs = require("node:fs");
const path = require("node:path");

const MAX_EVENTOS = 200;

/** `{ tipo: "vuelta-version", version?, motivo? }` al final del archivo; nunca lanza. */
function anotar(archivo, e, { t = Date.now(), sistema = fs } = {}) {
  try {
    let antes = [];
    try {
      antes = sistema.readFileSync(archivo, "utf8").split("\n").filter(Boolean);
    } catch {
      // Sin archivo todavía.
    }
    sistema.mkdirSync(path.dirname(archivo), { recursive: true });
    // Se reescribe entero (son pocas líneas): una última línea cortada a medias no se pega con la nueva.
    sistema.writeFileSync(archivo, `${[...antes, JSON.stringify({ t, ...e })].slice(-MAX_EVENTOS).join("\n")}\n`);
  } catch {
    // La salud no puede romper lo que mide.
  }
}

/** La ruta, la misma que `estadoHilos()` en win32 (windows/src/nativo.js `rutasNativas().dueno` vive en la misma carpeta). */
const archivoSalud = (rutas) => path.win32.join(path.win32.dirname(rutas.dueno), "salud-eventos.jsonl");

module.exports = { anotar, archivoSalud, MAX_EVENTOS };
