// src/hilo/punto-logica.ts: a qué punto de control corresponde un turno, qué se restaura al volver y el diff en filas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { archivosAlVolver, parsearDif, puntoDeTurno, sumaDe } from "../src/hilo/punto-logica.ts";
import { puntosValidos, type PuntoControl } from "../src/datos/contrato.ts";

const p = (id: string, ts: number, fin: number | null, archivos: PuntoControl["archivos"] = []): PuntoControl => ({ id, ts, fin, terminado: fin !== null, archivos });

test("puntoDeTurno: el turno cae en el punto que salió antes que él y todavía corría", () => {
  const ps = [p("a", 100_000, 150_000), p("b", 200_000, 260_000), p("c", 300_000, null)];
  assert.equal(puntoDeTurno(ps, 101)?.id, "a");
  assert.equal(puntoDeTurno(ps, 200.4)?.id, "b");
  // Un mensaje mandado a mitad del turno es del mismo punto.
  assert.equal(puntoDeTurno(ps, 230)?.id, "b");
  assert.equal(puntoDeTurno(ps, 301)?.id, "c");
  assert.equal(puntoDeTurno(ps, 90), null, "antes del primero: no pasó por la app");
  assert.equal(puntoDeTurno(ps, 180), null, "entre dos turnos que no son de la app");
  assert.equal(puntoDeTurno(ps, null), null);
});

test("archivosAlVolver: lo de ese turno y los siguientes, sin repetir", () => {
  const ps = [
    p("a", 1, 2, [{ ruta: "x.ts", estado: "M", mas: 1, menos: 0 }]),
    p("b", 3, 4, [{ ruta: "x.ts", estado: "M", mas: 2, menos: 1 }, { ruta: "n.ts", estado: "A", mas: 5, menos: 0 }]),
    p("c", 5, 6, [{ ruta: "z.ts", estado: "D", mas: 0, menos: 3 }]),
  ];
  assert.deepEqual(archivosAlVolver(ps, "b").map((a) => a.ruta), ["x.ts", "n.ts", "z.ts"]);
  assert.deepEqual(archivosAlVolver(ps, "c").map((a) => a.ruta), ["z.ts"]);
  assert.deepEqual(archivosAlVolver(ps, "nada"), []);
  assert.deepEqual(sumaDe(ps[1].archivos), { mas: 7, menos: 1 });
});

test("parsearDif: números de línea de cada lado, hunks separados y sin encabezados", () => {
  const dif = [
    "diff --git a/a.txt b/a.txt",
    "index 111..222 100644",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,3 +1,3 @@ función",
    " uno",
    "-dos",
    "+DOS",
    " tres",
    "@@ -10 +10,2 @@",
    " diez",
    "+once",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  assert.deepEqual(parsearDif(dif), [
    { t: " ", a: 1, b: 1, x: "uno" },
    { t: "-", a: 2, b: null, x: "dos" },
    { t: "+", a: null, b: 2, x: "DOS" },
    { t: " ", a: 3, b: 3, x: "tres" },
    { t: "~", a: null, b: null, x: "@@ -10 +10,2 @@" },
    { t: " ", a: 10, b: 10, x: "diez" },
    { t: "+", a: null, b: 11, x: "once" },
  ]);
  assert.deepEqual(parsearDif("diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n"), []);
});

test("puntosValidos: se queda con lo que cierra y descarta el resto", () => {
  const r = puntosValidos([
    { id: "a", ts: 5, fin: 9, despues: "abc", antes: "def", archivos: [{ ruta: "x", estado: "M", mas: 1, menos: "2" }, { ruta: "y", estado: "?" }, null], vuelto: 11 },
    { id: 3, ts: 1 },
    { id: "b", ts: 7, fin: null, despues: null, archivos: "no" },
    null,
  ]);
  assert.deepEqual(r, [
    { id: "a", ts: 5, fin: 9, terminado: true, archivos: [{ ruta: "x", estado: "M", mas: 1, menos: 2 }], vuelto: 11 },
    { id: "b", ts: 7, fin: null, terminado: false, archivos: [] },
  ]);
  assert.deepEqual(puntosValidos("x"), []);
});
