// La actividad de un líder de la app es su último turno real, y al arrancar Trama sólo se levantan los dormidos que tuvieron uno en las
// últimas 24 h, o tienen workers vivos, o algo en la cola (electron/actividad-lider.ts). El caso con procesos de verdad: tests/lider-reinicio.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actividadApp, debeLevantarse, DORMIR_S } from "../electron/actividad-lider.ts";

const AHORA = 2_000_000_000;
const H = 3600;

test("actividad: el último turno, nunca que se haya levantado el proceso", () => {
  const ultimo = AHORA - 106 * H;
  // Reposo: la sesión y el statusline recién escritos por un `--resume` (ahora) no cuentan.
  assert.equal(actividadApp({ ultimo, creado: ultimo - 5 * H, enCurso: false, delProceso: [AHORA, AHORA] }), ultimo);
  // Sin turnos todavía: vale su creación.
  assert.equal(actividadApp({ ultimo: 0, creado: AHORA - 2 * H, enCurso: false, delProceso: [AHORA] }), AHORA - 2 * H);
});

test("actividad: mientras responde o pide un permiso, vale además lo que dice el proceso", () => {
  const ultimo = AHORA - 3 * H;
  assert.equal(actividadApp({ ultimo, creado: ultimo, enCurso: true, delProceso: [AHORA - 10, 0] }), AHORA - 10);
  assert.equal(actividadApp({ ultimo, creado: ultimo, enCurso: true, delProceso: [] }), ultimo);
  assert.equal(actividadApp({ ultimo, creado: ultimo, enCurso: true, delProceso: [Number.NaN] }), ultimo);
});

test("qué se levanta: el de las últimas 24 h sí, el de más no", () => {
  const d = (haceH: number, extra: { conWorkers?: boolean; enCola?: boolean } = {}) => ({ ultimo: AHORA - haceH * H, creado: AHORA - 200 * H, conWorkers: false, enCola: false, ...extra });
  assert.equal(debeLevantarse(d(1), AHORA), true);
  assert.equal(debeLevantarse(d(23), AHORA), true);
  assert.equal(debeLevantarse(d(24), AHORA), false, `${DORMIR_S} s justos ya no`);
  assert.equal(debeLevantarse(d(106), AHORA), false);
});

test("qué se levanta: con workers vivos o con algo en la cola vuelve aunque sea viejo", () => {
  const viejo = { ultimo: AHORA - 106 * H, creado: AHORA - 200 * H };
  assert.equal(debeLevantarse({ ...viejo, conWorkers: true, enCola: false }, AHORA), true);
  assert.equal(debeLevantarse({ ...viejo, conWorkers: false, enCola: true }, AHORA), true);
  assert.equal(debeLevantarse({ ...viejo, conWorkers: false, enCola: false }, AHORA), false);
});

test("qué se levanta: uno sin turnos vale por su creación", () => {
  assert.equal(debeLevantarse({ ultimo: 0, creado: AHORA - 2 * H, conWorkers: false, enCola: false }, AHORA), true);
  assert.equal(debeLevantarse({ ultimo: 0, creado: AHORA - 90 * H, conWorkers: false, enCola: false }, AHORA), false);
});
