// "Te espera" (electron/espera.ts): cuándo un líder espera a Ana y cuándo deja de esperar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearEspera } from "../electron/espera.ts";
import type { EsperaLider } from "../src/datos/contrato.ts";

type L = { id: string; vivo: boolean; ocupado: boolean; pide?: boolean; espera?: EsperaLider };
const A = "a1111111-0000-4000-8000-000000000001";
const B = "b2222222-0000-4000-8000-000000000002";
const lider = (id: string, c: Partial<L> = {}): L => ({ id, vivo: true, ocupado: false, ...c });

function armar() {
  let reloj = 1000;
  const e = crearEspera(() => reloj);
  return {
    e,
    avanzar: (ms: number) => (reloj += ms),
    /** Una lectura de la lista: lo que queda en cada líder. */
    leer(...ls: L[]) {
      e.aplicar(ls);
      return Object.fromEntries(ls.map((l) => [l.id, l.espera ?? null]));
    },
  };
}

test("un líder que se ve por primera vez ocioso no espera (ocioso hace rato no es urgente)", () => {
  const h = armar();
  assert.equal(h.leer(lider(A))[A], null);
  assert.equal(h.leer(lider(A))[A], null);
});

test("al terminar su turno espera (listo), con la hora en que terminó, y sigue igual en lecturas siguientes", () => {
  const h = armar();
  h.leer(lider(A, { ocupado: true }));
  h.avanzar(5000);
  assert.deepEqual(h.leer(lider(A))[A], { motivo: "listo", desde: 6000 });
  h.avanzar(60_000);
  assert.deepEqual(h.leer(lider(A))[A], { motivo: "listo", desde: 6000 });
});

test("mientras trabaja no espera, y al volver a trabajar (Ana le escribió) se apaga", () => {
  const h = armar();
  assert.equal(h.leer(lider(A, { ocupado: true }))[A], null);
  h.leer(lider(A));
  assert.equal(h.leer(lider(A, { ocupado: true }))[A], null);
});

test("un permiso o una pregunta sin contestar: espera (pide) aunque siga ocupado", () => {
  const h = armar();
  h.leer(lider(A, { ocupado: true }));
  h.avanzar(100);
  assert.deepEqual(h.leer(lider(A, { ocupado: true, pide: true }))[A], { motivo: "pide", desde: 1100 });
  // Contestado: sigue el turno, deja de esperar.
  assert.equal(h.leer(lider(A, { ocupado: true }))[A], null);
});

test("un pedido pendiente al arrancar la app ya espera", () => {
  const h = armar();
  assert.equal(h.leer(lider(A, { ocupado: true, pide: true }))[A]?.motivo, "pide");
});

test("de pide a listo dentro de un mismo tramo sin ver: conserva la hora (una sola notificación por turno)", () => {
  const h = armar();
  h.leer(lider(A, { ocupado: true }));
  h.avanzar(10);
  const p = h.leer(lider(A, { ocupado: true, pide: true }))[A]!;
  h.avanzar(10);
  // Terminal: dejó de pedir y de trabajar a la vez.
  const l = h.leer(lider(A))[A]!;
  assert.equal(l.motivo, "listo");
  assert.equal(l.desde, p.desde);
});

test("visto apaga la espera, y no vuelve en las lecturas siguientes", () => {
  const h = armar();
  h.leer(lider(A, { ocupado: true }));
  h.leer(lider(A));
  assert.equal(h.e.visto(A), true);
  assert.equal(h.leer(lider(A))[A], null);
  assert.equal(h.e.visto(A), false, "ya estaba apagada");
  assert.equal(h.e.cuantos(), 0);
});

test("un pedido visto no vuelve a esperar mientras siga el mismo; uno nuevo sí", () => {
  const h = armar();
  h.leer(lider(A, { ocupado: true, pide: true }));
  assert.equal(h.e.visto(A), true);
  assert.equal(h.leer(lider(A, { ocupado: true, pide: true }))[A], null);
  // Lo contesta y llega otro.
  h.leer(lider(A, { ocupado: true }));
  assert.equal(h.leer(lider(A, { ocupado: true, pide: true }))[A]?.motivo, "pide");
});

test("un turno nuevo después de visto vuelve a esperar al terminar", () => {
  const h = armar();
  h.leer(lider(A, { ocupado: true }));
  h.leer(lider(A));
  h.e.visto(A);
  h.leer(lider(A, { ocupado: true }));
  h.avanzar(1000);
  assert.deepEqual(h.leer(lider(A))[A], { motivo: "listo", desde: 2000 });
});

test("con algo en cola que sale solo, terminar el turno no es esperar", () => {
  const h = armar();
  h.leer(lider(A, { ocupado: true }));
  const l = lider(A);
  h.e.aplicar([l], new Set([A]));
  assert.equal(l.espera, undefined);
});

test("un líder sin proceso no espera, y cuantos cuenta sólo los que esperan", () => {
  const h = armar();
  h.leer(lider(A, { ocupado: true }), lider(B, { ocupado: true }));
  h.leer(lider(A), lider(B, { vivo: false }));
  assert.equal(h.e.cuantos(), 1);
  assert.equal(h.leer(lider(A), lider(B, { vivo: false }))[B], null);
});

test("un líder que desaparece de la lista se olvida", () => {
  const h = armar();
  h.leer(lider(A, { ocupado: true }));
  h.leer(lider(A));
  h.leer();
  assert.equal(h.e.cuantos(), 0);
  // Si vuelve, se lo ve como nuevo: ocioso, no espera.
  assert.equal(h.leer(lider(A))[A], null);
});
