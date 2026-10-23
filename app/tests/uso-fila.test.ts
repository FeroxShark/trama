// La lógica de una fila del uso (src/barra/usoFila.ts): con porcentaje nunca es "sin dato"; sin hora de
// reinicio el número va solo; "sin dato" sólo cuando no hay ni porcentaje. Puro, sin React.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filaDe, formatearHasta } from "../src/barra/usoFila.ts";

test("sin ventana (ni porcentaje): sin dato, y nada más", () => {
  assert.deepEqual(filaDe(null), { cuando: "sinDato", pct: null, hasta: null });
  assert.deepEqual(filaDe(undefined), { cuando: "sinDato", pct: null, hasta: null });
});

test("con hora de reinicio: el número y la hora", () => {
  assert.deepEqual(filaDe({ pct: 44, resets_at: 1_792_026_600 }), { cuando: "hora", pct: 44, hasta: 1_792_026_600 });
});

test("con porcentaje y sin hora de reinicio: el número va solo, nunca sin dato", () => {
  assert.deepEqual(filaDe({ pct: 44, resets_at: null }), { cuando: "sinHora", pct: 44, hasta: null });
  // Un porcentaje siempre se muestra, con o sin hora.
  for (const resets_at of [null, 1_792_026_600]) assert.notEqual(filaDe({ pct: 0, resets_at }).cuando, "sinDato");
});

test("el número va redondeado y entre 0 y 100", () => {
  assert.equal(filaDe({ pct: 43.6, resets_at: null }).pct, 44);
  assert.equal(filaDe({ pct: 130, resets_at: 1 }).pct, 100);
  assert.equal(filaDe({ pct: -3, resets_at: null }).pct, 0);
});

test("formatearHasta extrae día y mes de YYYY-MM-DD", () => {
  assert.deepEqual(formatearHasta("2026-11-02"), { d: 2, m: 11 });
  assert.equal(formatearHasta(undefined), null);
  assert.equal(formatearHasta("invalida"), null);
});
