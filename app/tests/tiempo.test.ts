import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiarIdioma } from "../src/i18n/index.ts";
import { cuando, cuandoLargo, pintorCuando, pintorReinicio, pintorResta } from "../src/tiempo.ts";

const MIN = 60;
const HORA = 3600;
const DIA = 86400;

test("lo que falta para el reinicio: se lee, en largo y en corto", () => {
  const largo = pintorReinicio(1_000_000);
  const corto = pintorResta(1_000_000);
  const hace = (falta: number) => [largo(1_000_000 - falta).texto, corto(1_000_000 - falta).texto];
  assert.deepEqual(hace(16 * MIN), ["resets in 16 min", "in 16 min"]);
  assert.deepEqual(hace(13 * HORA + 25 * MIN + 30), ["resets in 13 h 25 min", "in 13 h 25 min"]);
  assert.deepEqual(hace(2 * HORA + 20), ["resets in 2 h", "in 2 h"]);
  assert.deepEqual(hace(20), ["resets in 1 min", "in 1 min"]);
  assert.deepEqual(hace(3 * DIA + 5 * HORA + 40 * MIN), ["resets in 3 d 5 h", "in 3 d 5 h"]);
  assert.deepEqual(hace(0), ["resets now", "now"]);
  cambiarIdioma("es");
  try {
    assert.deepEqual(hace(16 * MIN), ["se reinicia en 16 min", "en 16 min"]);
    assert.deepEqual(hace(13 * HORA + 25 * MIN), ["se reinicia en 13 h 25 min", "en 13 h 25 min"]);
    assert.deepEqual(hace(0), ["se reinicia ya", "ya"]);
  } finally {
    cambiarIdioma("en");
  }
  assert.equal(corto(1_000_050).en, Infinity);
});

test("el reinicio se repinta cuando cambia el texto", () => {
  for (const p of [pintorReinicio(1_000_000), pintorResta(1_000_000)]) {
    assert.equal(p(1_000_000 - (2 * HORA + 10 * MIN + 20)).en, 20);
    assert.equal(p(1_000_000 - 14 * MIN).en, MIN);
    assert.equal(p(1_000_000 - (3 * DIA + 5 * HORA + 40 * MIN)).en, 40 * MIN);
  }
});

test("el tooltip del reinicio dice la hora local exacta: hoy, mañana, o qué día", () => {
  const a = new Date(2026, 9, 3, 16, 34).getTime() / 1000;
  const hoy = pintorCuando(new Date(2026, 9, 3, 16, 50).getTime() / 1000);
  const manana = pintorCuando(new Date(2026, 9, 4, 9, 0).getTime() / 1000);
  const jueves = pintorCuando(new Date(2026, 9, 8, 9, 0).getTime() / 1000);
  assert.equal(hoy(a).texto, "resets today at 16:50");
  assert.equal(hoy(a).en, 16 * MIN);
  assert.equal(hoy(a + 17 * MIN).texto, "resets now");
  assert.equal(manana(a).texto, "resets tomorrow at 09:00");
  assert.equal(jueves(a).texto, "resets Thursday at 09:00");
  // Hasta la medianoche: ahí "mañana" pasa a ser "hoy" y "jueves" a ser "mañana".
  assert.equal(manana(a).en, 7 * HORA + 26 * MIN);
  assert.equal(jueves(a).en, 7 * HORA + 26 * MIN);
  cambiarIdioma("es");
  try {
    assert.equal(hoy(a).texto, "se reinicia hoy 16:50");
    assert.equal(manana(a).texto, "se reinicia mañana 09:00");
    assert.equal(jueves(a).texto, "se reinicia el jueves 09:00");
  } finally {
    cambiarIdioma("en");
  }
});

test("la hora de un mensaje: hoy sólo la hora, ayer, otro día con la fecha, otro año con el año", () => {
  // En hora local, como la muestra la vista.
  const en = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m, d, h, mi).getTime() / 1000;
  const ahora = en(2026, 9, 3, 0, 30);
  assert.equal(cuando(en(2026, 9, 3, 0, 5), ahora), "00:05");
  assert.equal(cuando(en(2026, 9, 2, 22, 41), ahora), "yesterday 22:41", "pasada la medianoche ya es ayer");
  assert.equal(cuando(en(2026, 9, 1, 9, 5), ahora), "Oct 1 09:05");
  assert.equal(cuando(en(2025, 11, 31, 9, 5), ahora), "Dec 31, 2025 09:05");
  assert.equal(cuando(en(2026, 9, 3, 0, 40), ahora), "00:40", "un reloj adelantado no da fechas raras");
  cambiarIdioma("es");
  assert.equal(cuando(en(2026, 9, 2, 22, 41), ahora), "ayer 22:41");
  assert.equal(cuando(en(2026, 9, 1, 9, 5), ahora), "1 oct 09:05");
  assert.match(cuandoLargo(en(2026, 9, 2, 22, 41)), /2 de octubre de 2026.*22:41/);
  cambiarIdioma("en");
});
