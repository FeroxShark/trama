import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// La cabecera de un chat de líder (src/hilo/Lider.tsx, `.lider-linea`, y la ruta de la barra de arriba):
// su nombre es la primera línea del primer mensaje, que puede ser un párrafo entero sin saltos. Tiene
// que quedar en una sola línea con elipsis y no partir ni correr lo de al lado (el modelo, el caché).
// Este test sólo fija las reglas del CSS; el efecto se midió en la app con un primer mensaje largo.
const css = readFileSync(path.resolve(import.meta.dirname, "..", "src/index.css"), "utf8");

/** El bloque de una regla exacta del CSS (`sel {` … `}`), sin comentarios ni reglas vecinas. */
function bloque(sel: string): string {
  const i = css.indexOf(`\n${sel} {`);
  assert.ok(i >= 0, `falta la regla ${sel}`);
  return css.slice(i, css.indexOf("}", i));
}

test("el nombre del líder es una sola línea con elipsis", () => {
  const b = bloque(".lider-linea b");
  assert.match(b, /white-space: nowrap;/);
  assert.match(b, /text-overflow: ellipsis;/);
  assert.match(b, /overflow: hidden;/);
  assert.match(b, /min-width: 0;/);
});

test("lo de al lado del nombre (modelo, esfuerzo, caché) no se parte ni se achica", () => {
  const b = bloque(".lider-linea > :not(b)");
  assert.match(b, /flex: none;/);
  assert.match(b, /white-space: nowrap;/);
});

test("la ruta de la barra de arriba corta el nombre con elipsis y no se sale de su franja", () => {
  const b = bloque(".ruta b");
  assert.match(b, /text-overflow: ellipsis;/);
  assert.match(b, /overflow: hidden;/);
  assert.match(bloque(".ruta"), /white-space: nowrap;/);
});
