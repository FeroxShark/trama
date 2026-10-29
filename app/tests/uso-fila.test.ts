// La lógica de una fila del uso (src/barra/usoFila.ts): con porcentaje nunca es "sin dato"; sin hora de
// reinicio el número va solo; "sin dato" sólo cuando no hay ni porcentaje. Puro, sin React.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filaDe, formatearFalta, formatearFaltaCorto, formatearHasta } from "../src/barra/usoFila.ts";

const U = { d: "d", h: "h", min: "min", s: "s", ya: "ya" };

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

test("lo que falta: dos unidades como mucho, la mayor primero, exacto y corto", () => {
  const texto = (r: number) => formatearFalta(r, U).texto;
  assert.equal(texto(59), "59 s");
  assert.equal(texto(60), "1 min");
  assert.equal(texto(12 * 60), "12 min");
  assert.equal(texto(4 * 3600 + 23 * 60), "4 h 23 min");
  assert.equal(texto(3600), "1 h 0 min");
  assert.equal(texto(86_400), "1 d 0 h");
  assert.equal(texto(6 * 86_400 + 14 * 3600), "6 d 14 h");
  // Lo que falta se trunca, nunca se redondea para arriba: a 4 h 23 min 40 s todavía son 4 h 23 min.
  assert.equal(texto(4 * 3600 + 23 * 60 + 40), "4 h 23 min");
  assert.equal(texto(0.4), "1 s");
});

test("lo pasado dice ya y no vuelve a cambiar", () => {
  assert.deepEqual(formatearFalta(0, U), { texto: "ya", en: Infinity });
  assert.deepEqual(formatearFalta(-30, U), { texto: "ya", en: Infinity });
});

test("en: cuántos segundos hasta que cambia el texto (en el último minuto, cada segundo; después, cada minuto o cada hora)", () => {
  assert.equal(formatearFalta(59.25, U).en, 0.25);
  assert.equal(formatearFalta(720.5, U).en, 0.5);
  assert.equal(formatearFalta(4 * 3600 + 23 * 60 + 40, U).en, 40);
  assert.equal(formatearFalta(6 * 86_400 + 14 * 3600 + 1800, U).en, 1800);
});

test("la falta abreviada para la celda: horas con minutos pegados, y desde un día, días con horas", () => {
  const texto = (r: number) => formatearFaltaCorto(r, U).texto;
  assert.equal(texto(45), "45 s");
  assert.equal(texto(20 * 60), "20 min");
  assert.equal(texto(3600 + 20 * 60), "1 h20");
  assert.equal(texto(4 * 3600 + 5 * 60), "4 h05");
  // Nunca "2 d" a secas: los días llevan sus horas, como en la falta larga.
  assert.equal(texto(2 * 86_400 + 17 * 3600 + 900), "2 d 17 h");
  assert.equal(texto(4 * 86_400 + 3 * 3600), "4 d 3 h");
  assert.equal(texto(86_400), "1 d 0 h");
  assert.equal(formatearFaltaCorto(2 * 86_400 + 17 * 3600 + 900, U).en, 900);
  assert.deepEqual(formatearFaltaCorto(0, U), { texto: "ya", en: Infinity });
});
