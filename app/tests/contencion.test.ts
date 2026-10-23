// La red de contención del main (electron/contencion.ts) con emisores de mentira: el renderer que muere
// se recarga, a la tercera del minuto queda el cartel; lo que no carga, no responde o escribe un error en
// su consola queda en el log; un error sin atrapar del proceso se loguea.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { crearTope, type Bitacora, type Nivel } from "../electron/bitacora.ts";
import { vigilarPagina, vigilarProceso } from "../electron/contencion.ts";

function armar() {
  const entradas: { nivel: Nivel; donde: string; detalle: string }[] = [];
  const log: Bitacora = { archivo: "", escribir: (nivel, donde, detalle) => void entradas.push({ nivel, donde, detalle: String(detalle) }) };
  const wc = new EventEmitter();
  const acciones: string[] = [];
  let ahora = 0;
  const tope = crearTope({ ahora: () => ahora });
  vigilarPagina(wc, { log, tope, recargar: () => acciones.push("recargar"), cartel: (d) => acciones.push(`cartel:${d}`) });
  return { wc, entradas, acciones, pasar: (ms: number) => (ahora += ms), tope };
}

test("render-process-gone: recarga las dos primeras y a la tercera del minuto deja el cartel", () => {
  const { wc, entradas, acciones, pasar } = armar();
  wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 133 });
  pasar(5000);
  wc.emit("render-process-gone", {}, { reason: "oom", exitCode: 9 });
  pasar(5000);
  wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 133 });
  pasar(1000);
  wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 133 });
  assert.deepEqual(acciones.map((a) => a.split(":")[0]), ["recargar", "recargar", "cartel", "cartel"]);
  assert.match(acciones[2], /crashed/);
  assert.equal(entradas.length, 4, "las cuatro quedan en el log");
  assert.ok(entradas.every((e) => e.nivel === "error" && e.donde === "renderer render-process-gone"));
  assert.match(entradas[2].detalle, /cartel/);
});

test("render-process-gone: con las muertes espaciadas siempre se recarga; clean-exit no cuenta", () => {
  const { wc, entradas, acciones, pasar } = armar();
  for (let i = 0; i < 5; i++) {
    wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
    pasar(61_000);
  }
  wc.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });
  assert.deepEqual(acciones, Array(5).fill("recargar"));
  assert.equal(entradas.length, 5);
});

test("did-fail-load, unresponsive y console-message de error quedan en el log; lo demás no", () => {
  const { wc, entradas } = armar();
  wc.emit("did-fail-load", {}, -3, "ERR_ABORTED", "file:///x", true);
  wc.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "file:///sub", false);
  assert.equal(entradas.length, 0, "abortada o de un subframe: nada");
  wc.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "file:///index.html", true);
  wc.emit("unresponsive");
  wc.emit("responsive");
  wc.emit("console-message", { level: "info", message: "hola", lineNumber: 1, sourceId: "a.js" });
  wc.emit("console-message", { level: "warning", message: "ojo", lineNumber: 1, sourceId: "a.js" });
  wc.emit("console-message", { level: "error", message: "Uncaught TypeError: x", lineNumber: 7, sourceId: "app.js" });
  assert.deepEqual(
    entradas.map((e) => [e.nivel, e.donde]),
    [
      ["error", "renderer did-fail-load"],
      ["aviso", "renderer"],
      ["info", "renderer"],
      ["error", "renderer console"],
    ],
  );
  assert.match(entradas[0].detalle, /ERR_FILE_NOT_FOUND \(-6\) file:\/\/\/index\.html/);
  assert.equal(entradas[3].detalle, "Uncaught TypeError: x (app.js:7)");
});

test("uncaughtException y unhandledRejection del proceso: se loguean y no tiran nada", () => {
  const entradas: string[] = [];
  const log: Bitacora = { archivo: "", escribir: (nivel, donde, detalle) => void entradas.push(`${nivel} ${donde} ${String((detalle as Error).message ?? detalle)}`) };
  const proc = new EventEmitter();
  vigilarProceso(log, proc);
  assert.doesNotThrow(() => {
    proc.emit("uncaughtException", new Error("uno"));
    proc.emit("unhandledRejection", "dos");
  });
  assert.deepEqual(entradas, ["error main uncaughtException uno", "error main unhandledRejection dos"]);
});
