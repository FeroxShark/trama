import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// El globito "Workers" de la barra (src/barra/AvisoWorkers.tsx): cada fila lleva el título (la tarea, que puede ser un párrafo)
// y el motivo en horizontal, y el botón de relanzar en su propia fila, sin pisar el texto. Este test sólo fija las reglas del CSS.
const css = readFileSync(path.resolve(import.meta.dirname, "..", "src/index.css"), "utf8");
const tsx = readFileSync(path.resolve(import.meta.dirname, "..", "src/barra/AvisoWorkers.tsx"), "utf8");

/** El bloque de una regla exacta del CSS (`sel {` … `}`). */
function bloque(sel: string): string {
  const i = css.indexOf(`\n${sel} {`);
  assert.ok(i >= 0, `falta la regla ${sel}`);
  return css.slice(i, css.indexOf("}", i));
}

test("el título de un aviso largo se corta en dos líneas con elipsis", () => {
  const b = bloque(".avs-n");
  assert.match(b, /-webkit-line-clamp: 2;/);
  assert.match(b, /overflow: hidden;/);
  assert.match(b, /overflow-wrap: anywhere;/);
});

test("la fila es una grilla: el texto puede achicarse y el botón va en su propia fila", () => {
  assert.match(bloque(".avs-f"), /display: grid;/);
  assert.match(bloque(".avs-f"), /minmax\(0, 1fr\)/);
  assert.match(bloque(".avs-x"), /min-width: 0;/);
  const a = bloque(".avs-a");
  assert.match(a, /grid-column: 1 \/ -1;/);
  assert.match(a, /max-width: 100%;/);
});

test("el globito de workers es más ancho que el de un aviso común", () => {
  assert.match(bloque(".avs .avc-g"), /width: min\(20rem,/);
});

test("el título lleva el texto completo en title y el descartar va antes del botón en el marcado", () => {
  assert.match(tsx, /className="avs-n" title=/);
  assert.ok(tsx.indexOf('className="avs-d"') < tsx.indexOf('className="avs-a"'));
});
