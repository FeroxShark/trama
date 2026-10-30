import assert from "node:assert/strict";
import test from "node:test";
import { tituloTarea } from "../electron/titulo-tarea.ts";

test("tituloTarea: toma la línea «Objetivo:» del brief, sin el rótulo", () => {
  const brief = "Contexto: usuario Ana (Windows), PC accesible por `ssh ana@pc`, nada de esto es el título\nObjetivo: arreglar el popover de workers\nArchivos: app/src/barra/\nListo cuando: pasan los tests";
  assert.equal(tituloTarea(brief), "arreglar el popover de workers");
  // Un objetivo que sigue en las líneas de abajo hasta el próximo rótulo.
  assert.equal(tituloTarea("Objetivo: arreglar el popover\nque se corta\nArchivos: x"), "arreglar el popover que se corta");
});

test("tituloTarea: con el brief aplastado en una línea (sin saltos), corta en el próximo rótulo", () => {
  assert.equal(tituloTarea("Contexto: algo largo Objetivo: sacar el título del brief Archivos: a.ts Listo cuando: ok"), "sacar el título del brief");
});

test("tituloTarea: sin «Objetivo:», la primera línea que no sea «Contexto:»", () => {
  assert.equal(tituloTarea("Contexto: mucho texto\n\nRevisar el instalador de Windows\notra línea"), "Revisar el instalador de Windows");
  assert.equal(tituloTarea("hacé esto"), "hacé esto");
  // Sólo «Contexto:»: mejor ese texto que nada.
  assert.equal(tituloTarea("Contexto: sólo esto"), "sólo esto");
  assert.equal(tituloTarea(""), "");
  assert.equal(tituloTarea(null), "");
});

test("tituloTarea: recorta a ~60 caracteres en una palabra entera", () => {
  const t = tituloTarea("Objetivo: " + "palabra ".repeat(20));
  assert.ok(t.length <= 60, t);
  assert.ok(t.endsWith("…"));
  assert.ok(!t.includes("palabr…"));
  assert.equal(tituloTarea("[x] Objetivo: " + "a".repeat(100)).length, 60);
});
