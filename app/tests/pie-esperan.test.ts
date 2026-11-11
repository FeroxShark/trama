// El número del pie de la barra (el botón del Tablero): sólo las preguntas de `espera-dueno` sin respuesta,
// nunca las pruebas, y sin tope «99+» (electron/tablero-cuenta.ts). Lo que pinta la barra: src/barra/Barra.tsx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { esPregunta, preguntasEsperan } from "../electron/tablero-cuenta.ts";

const preg = (id: number, extra: object = {}) => ({ id, tipo: "pregunta", prueba: "", respuesta: null, ...extra });
const prueba = (id: number, extra: object = {}) => ({ id, tipo: "prueba", prueba: "atlas --exportar ejemplo.csv", respuesta: null, ...extra });

test("3 preguntas y 10 pruebas dan 3", () => {
  const items = [1, 2, 3].map((id) => preg(id)).concat(Array.from({ length: 10 }, (_, k) => prueba(100 + k)));
  assert.equal(preguntasEsperan(items), 3);
});

test("una pregunta ya contestada no cuenta, ni una prueba ya contestada", () => {
  assert.equal(preguntasEsperan([preg(1), preg(2, { respuesta: { tipo: "pregunta", opcion: "a" } })]), 1);
  assert.equal(preguntasEsperan([prueba(1, { respuesta: { tipo: "prueba", anda: true } })]), 0);
});

test("con 120 preguntas cuenta 120: el número no tiene tope", () => {
  assert.equal(preguntasEsperan(Array.from({ length: 120 }, (_, k) => preg(k + 1))), 120);
});

test("sin tipo: prueba si trae qué probar, si no pregunta (la regla del CLI)", () => {
  assert.equal(esPregunta({ prueba: "atlas --x" }), false);
  assert.equal(esPregunta({ prueba: "  " }), true);
  assert.equal(esPregunta({}), true);
  assert.equal(esPregunta({ tipo: "pregunta", prueba: "algo" }), true);
  assert.equal(esPregunta({ tipo: "prueba", prueba: "" }), false);
});

test("una lista que no es lista, o entradas que no son items, cuentan 0", () => {
  for (const rara of [null, undefined, {}, "no", 7]) assert.equal(preguntasEsperan(rara), 0);
  assert.equal(preguntasEsperan([null, 3, "x", preg(1)]), 1);
});

test("la barra no pinta «99+»", () => {
  const barra = readFileSync(fileURLToPath(new URL("../src/barra/Barra.tsx", import.meta.url)), "utf8");
  assert.doesNotMatch(barra, /99\+/);
});
