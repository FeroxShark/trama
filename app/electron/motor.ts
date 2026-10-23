// El motor de trama, sin ventana: el núcleo (electron/nucleo.ts) corriendo en Node puro, con el
// binario de Electron que ya está instalado y sin Chromium:
//   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron dist-electron/motor.js
// Atiende por el socket local (electron/local.ts) y, con `remoto.json`, por la tailnet (remoto-armar.ts).
// Los líderes de la app viven acá: cerrar o reiniciar la ventana no los toca.
//   - Candado: el socket. Si ya hay un motor escuchando, sale con 3 (`RestartPreventExitStatus`).
//   - Dueño: `$HILOS_STATE/dueno` (pid y `procStart`): quién tiene la cola, los líderes y el remoto.
//   - SIGTERM / SIGINT: guarda (leídos), corta los chequeos, cierra a los líderes (tope 10 s) y sale con 0.
//   - Build nuevo: el mismo cartel y la misma espera que la ventana (reinicio.ts); al irse, bajo la unidad
//     (`TRAMA_UNIDAD=1`) alcanza con salir; suelto, se lanza de nuevo él mismo.
// Sin `electron`: lo prueba tests/motor.test.ts.
import "./aislar.js"; // primero: en una corrida de prueba, ningún módulo toca los datos del usuario sin que quede anotado
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { baseConsulta, crearConsulta } from "./consulta.js";
import { vigilarProceso } from "./contencion.js";
import { abrirLocal, arranqueDe } from "./local.js";
import { log, silencio } from "./log.js";
import { armarNucleo, correrSalida, escuchar, esperarSalida, llamarLocal, soltarLocal, TOPE_SALIDA_MS } from "./nucleo.js";
import { ESTADO, escribirAtomico } from "./pa.js";
import { armarRelanzo } from "./reinicio.js";
import { marcar } from "./reinicio-marcas.js";
import { armarRemoto } from "./remoto-armar.js";

const aqui = import.meta.dirname;
const DUENO = path.join(ESTADO, "dueno");
const unidad = process.env.TRAMA_UNIDAD === "1";
delete process.env.TRAMA_UNIDAD;
// Sólo sirve para arrancar este proceso: si quedara en el entorno lo heredarían los líderes, sus workers y todo Electron que
// ellos abran (capturas, `npm run visual`, pruebas), que arrancaría como Node y saldría con 1 sin decir por qué.
delete process.env.ELECTRON_RUN_AS_NODE;

/** Borra `dueno` si todavía es de este proceso. */
function soltarDueno() {
  try {
    const j = JSON.parse(readFileSync(DUENO, "utf8"));
    if (j?.pid === process.pid) rmSync(DUENO, { force: true });
  } catch {}
}

async function arrancar() {
  // Si viene de un reinicio por un build nuevo, la hora de verdad en que arrancó este proceso (electron/reinicio-marcas.ts).
  marcar("motor", "motor-arranco", undefined, Math.round(Date.now() - process.uptime() * 1000));
  vigilarProceso(log);
  process.title = "trama-motor";
  // Las señales se atienden desde el primer instante: quien vea `dueno` y el socket ya puede mandar SIGTERM.
  let local: Awaited<ReturnType<typeof abrirLocal>> | undefined;
  let apagando = false;
  /** Guardar, cortar, cerrar a los líderes (con su tope) y salir; `despues` va justo antes de salir. */
  async function apagar(motivo: string, despues?: () => void) {
    if (apagando) return;
    apagando = true;
    log.escribir("info", "motor", `trama-motor sale (${motivo})`);
    // Red de última instancia: si algo se cuelga al cerrar, a los 3 s del tope se sale igual.
    setTimeout(() => process.exit(0), TOPE_SALIDA_MS + 3000).unref();
    correrSalida();
    await esperarSalida()?.catch(silencio("motor"));
    marcar("motor", "lideres-cerrados");
    await local?.cerrar().catch(silencio("motor"));
    soltarDueno();
    marcar("motor", "motor-sale");
    despues?.();
    process.exit(0);
  }
  process.on("SIGTERM", () => void apagar("SIGTERM"));
  process.on("SIGINT", () => void apagar("SIGINT"));
  // Sin terminal: que se cierre la que lo lanzó no lo baja.
  process.on("SIGHUP", () => {});

  local = await abrirLocal({ llamar: llamarLocal, seFue: soltarLocal });
  if (!local) {
    console.error("[motor] ya hay un motor escuchando: éste no arranca");
    process.exit(3);
  }
  await escribirAtomico(DUENO, JSON.stringify({ version: 1, pid: process.pid, procStart: arranqueDe(process.pid), desde: Date.now() }) + "\n");
  log.escribir("info", "motor", `trama-motor arrancó (pid ${process.pid}, node ${process.versions.node}, ${local.ruta})`);
  marcar("motor", "motor-escucha");

  escuchar(local.difundir);
  armarNucleo();
  armarRemoto({
    dist: path.join(aqui, "..", "dist"),
    preload: path.join(aqui, "preload.cjs"),
    consulta: crearConsulta(baseConsulta(process.env.HILOS_FIXTURES === "1"), false),
  });

  armarRelanzo({
    raiz: process.env.HILOS_BUILD || path.join(aqui, ".."),
    quien: "motor",
    irse: () =>
      void apagar("build nuevo", () => {
        // Bajo la unidad, Restart=always lo levanta; suelto, se lanza él mismo (ya soltó el socket).
        if (!unidad) spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).unref();
      }),
  });
}

void arrancar().catch((e) => {
  log.escribir("error", "motor", e);
  process.exit(1);
});
