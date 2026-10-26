// La línea que resume el trabajo de un turno (src/hilo/resumen-pasos.ts): cuenta por clase de herramienta, singular / plural, es / en,
// y las tareas de fondo aparte con las que cortaron.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contar, enFondo, resumenPasos } from "../src/hilo/resumen-pasos.ts";
import { cambiarIdioma } from "../src/i18n/index.ts";
import type { Uso } from "../src/hilo/herramientas.ts";

const uso = (nombre: string, entrada: Record<string, unknown> = {}, resultado?: { texto: string; error: boolean }): Uso => ({
  nombre,
  resumen: "",
  det: { nombre, entrada, ...(resultado ? { resultado } : {}) },
});
const ok = { texto: "", error: false };
const mal = { texto: "x", error: true };

const muestra = (): Uso[] => [
  ...Array.from({ length: 5 }, () => uso("Bash", {}, ok)),
  ...Array.from({ length: 3 }, () => uso("Read")),
  uso("Edit"),
  uso("Write"),
  ...Array.from({ length: 4 }, () => uso("Grep")),
];

test("cuenta por clase", () => {
  const c = contar([...muestra(), uso("WebFetch"), uso("Agent"), uso("TodoWrite")]);
  assert.deepEqual([c.comandos, c.leidos, c.editados, c.busquedas, c.web, c.delegadas, c.otras], [5, 3, 2, 4, 1, 1, 1]);
});

test("en español y en inglés, con singular y plural", () => {
  cambiarIdioma("es");
  assert.equal(resumenPasos(muestra()), "Corrió 5 comandos, leyó 3 archivos, editó 2 archivos, buscó 4 veces");
  assert.equal(resumenPasos([uso("Bash"), uso("Read")]), "Corrió un comando, leyó un archivo");
  cambiarIdioma("en");
  assert.equal(resumenPasos(muestra()), "Ran 5 commands, read 3 files, edited 2 files, searched 4 times");
  assert.equal(resumenPasos([uso("Bash"), uso("Read")]), "Ran a command, read a file");
  assert.equal(resumenPasos([]), "");
});

test("las tareas de fondo van aparte, con las cortadas", () => {
  const fondo = (r?: { texto: string; error: boolean }) => uso("Bash", { run_in_background: true }, r);
  assert.equal(enFondo(fondo()), true);
  assert.equal(enFondo(uso("Bash", { run_in_background: false })), false);
  assert.equal(enFondo(uso("Read", { run_in_background: true })), false);
  cambiarIdioma("en");
  assert.equal(resumenPasos([uso("Bash", {}, ok), fondo(mal)]), "Ran a command, finished a background task (1 stopped)");
  assert.equal(resumenPasos([fondo(ok), fondo(ok)]), "Finished 2 background tasks");
  assert.equal(resumenPasos([fondo()]), "Started a background task");
  cambiarIdioma("es");
  assert.equal(resumenPasos([uso("Bash", {}, ok), fondo(mal), fondo(ok)]), "Corrió un comando, terminó 2 tareas de fondo (1 cortada)");
  cambiarIdioma("en");
});
