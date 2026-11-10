import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { armarCorrector, idiomasCorrector } from "../electron/corrector.ts";

const gemelo = createRequire(import.meta.url)("../../windows/src/corrector.js") as { idiomasCorrector: typeof idiomasCorrector; armarCorrector: typeof armarCorrector };

const LISTA = ["de", "en-GB", "en-US", "es-419", "es-ES", "fr"];

test("pide español e inglés de la lista de disponibles", () => {
  assert.deepEqual(idiomasCorrector(LISTA), ["es-ES", "en-US"]);
});

test("sin es-ES usa otro español; sin en-US, otro inglés", () => {
  assert.deepEqual(idiomasCorrector(["es-MX", "en-GB"]), ["es-MX", "en-GB"]);
  assert.deepEqual(idiomasCorrector(["es", "en"]), ["es", "en"]);
});

test("una lista sin español pide sólo el inglés (no inventa un código)", () => {
  assert.deepEqual(idiomasCorrector(["en-US", "fr"]), ["en-US"]);
});

test("una lista vacía no pide nada", () => {
  assert.deepEqual(idiomasCorrector([]), []);
});

test("armarCorrector llama a la sesión con los dos idiomas, y no la toca si no hay ninguno", () => {
  const pedidos: string[][] = [];
  const ses = (l: string[]) => ({ availableSpellCheckerLanguages: l, setSpellCheckerLanguages: (x: string[]) => void pedidos.push(x) });
  assert.deepEqual(armarCorrector(ses(LISTA)), ["es-ES", "en-US"]);
  assert.deepEqual(pedidos, [["es-ES", "en-US"]]);
  armarCorrector(ses([]));
  assert.equal(pedidos.length, 1);
});

test("el gemelo de la carcasa de Windows elige igual", () => {
  for (const l of [LISTA, ["es-MX", "en-GB"], ["en-US", "fr"], []]) assert.deepEqual(gemelo.idiomasCorrector(l), idiomasCorrector(l));
});
