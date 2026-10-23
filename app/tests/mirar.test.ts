// El watcher que se cae se rearma solo con espera creciente (tope 30 s) y lo deja en el log, con un
// watcher y un reloj de mentira (electron/mirar.ts).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { Bitacora, Nivel } from "../electron/bitacora.ts";
import { ESPERA_MIN_MS, ESPERA_TOPE_MS, mirarCarpeta } from "../electron/mirar.ts";

function armar(opciones: { fallaAlCrear?: (n: number) => Error | null } = {}) {
  const entradas: { nivel: Nivel; donde: string; detalle: string }[] = [];
  const log: Bitacora = { archivo: "", escribir: (nivel, donde, detalle) => void entradas.push({ nivel, donde, detalle: String(detalle) }) };
  const watchers: (EventEmitter & { close(): void; cerrado: boolean; fn: (t: string, n: string | null) => void })[] = [];
  let intentos = 0;
  const pendientes: { fn: () => void; ms: number }[] = [];
  const esperas: number[] = [];
  let ahora = 0;
  const eventos: string[] = [];
  let rearmados = 0;
  const m = mirarCarpeta("/carpeta", (_t, n) => void eventos.push(String(n)), {
    donde: "prueba",
    alRearmar: () => void rearmados++,
    log,
    watch: (_d, fn) => {
      const e = opciones.fallaAlCrear?.(++intentos);
      if (e) throw e;
      const w = Object.assign(new EventEmitter(), {
        cerrado: false,
        fn,
        close() {
          if (w.cerrado) return;
          w.cerrado = true;
          w.emit("close");
        },
      });
      watchers.push(w);
      return w as never;
    },
    esperar: (fn, ms) => {
      const p = { fn, ms };
      pendientes.push(p);
      esperas.push(ms);
      return p;
    },
    cancelar: (p) => void pendientes.splice(pendientes.indexOf(p as never), 1),
    ahora: () => ahora,
  });
  const correr = () => pendientes.shift()!.fn();
  return { m, watchers, entradas, pendientes, esperas, correr, eventos, pasar: (ms: number) => (ahora += ms), rearmados: () => rearmados };
}

test("un error del watcher lo rearma después de la espera y relee (alRearmar)", () => {
  const t = armar();
  t.watchers[0].fn("change", "a");
  assert.deepEqual(t.eventos, ["a"]);
  t.watchers[0].emit("error", new Error("EMFILE"));
  assert.equal(t.watchers.length, 1, "todavía no: espera");
  assert.deepEqual(t.esperas, [ESPERA_MIN_MS]);
  assert.match(t.entradas[0].detalle, /EMFILE/);
  assert.equal(t.entradas[0].donde, "mirar prueba");
  t.correr();
  assert.equal(t.watchers.length, 2);
  assert.equal(t.rearmados(), 1);
  t.watchers[1].fn("change", "b");
  assert.deepEqual(t.eventos, ["a", "b"], "el nuevo watcher entrega");
});

test("cerrarse solo cuenta como caída; cerrarlo uno no", () => {
  const t = armar();
  t.watchers[0].emit("close");
  assert.equal(t.pendientes.length, 1);
  t.correr();
  t.m!.cerrar();
  assert.equal(t.watchers[1].cerrado, true);
  assert.equal(t.pendientes.length, 0, "cerrar no deja un rearmado pendiente");
  assert.equal(t.entradas.length, 2, "una caída y un rearmado; el cierre propio no se loguea");
});

test("la espera crece (1, 2, 4 … 30 s) mientras sigue fallando y no pasa del tope", () => {
  const t = armar({ fallaAlCrear: (n) => (n >= 2 ? new Error("EACCES") : null) });
  t.watchers[0].emit("error", new Error("boom"));
  for (let i = 0; i < 8; i++) t.correr();
  assert.deepEqual(t.esperas, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  assert.ok(t.esperas.every((e) => e <= ESPERA_TOPE_MS));
  assert.ok(t.entradas.every((e) => e.nivel === "aviso"));
  assert.ok(t.entradas.length >= 9, "cada fallo queda en el log");
  t.m!.cerrar();
  assert.equal(t.pendientes.length, 0);
});

test("si estuvo sano un buen rato, la caída siguiente empieza de cero", () => {
  const t = armar();
  t.watchers[0].emit("error", new Error("uno"));
  t.correr();
  t.pasar(ESPERA_TOPE_MS + 1);
  t.watchers[1].emit("error", new Error("dos"));
  assert.deepEqual(t.esperas, [1000, 1000]);
});

test("una carpeta que no existe al armar no se reintenta; otra falla inicial sí", () => {
  const sin = armar({ fallaAlCrear: () => Object.assign(new Error("no hay"), { code: "ENOENT" }) });
  assert.equal(sin.m, null);
  assert.equal(sin.pendientes.length, 0);
  const otra = armar({ fallaAlCrear: (n) => (n === 1 ? new Error("EMFILE") : null) });
  assert.ok(otra.m);
  assert.equal(otra.pendientes.length, 1);
  otra.correr();
  assert.equal(otra.watchers.length, 1);
});
