// Los renglones de una prueba (src/datos/tablero-renglones.ts): se leen de `prueba` como los deja `tablero probar`.
import assert from "node:assert/strict";
import test from "node:test";
import { conTilde, hechos, renglonesDe, tildarRenglon } from "../src/datos/tablero-renglones.ts";

test("renglonesDe: lee los numerados con [ ] y [x]", () => {
  const rs = renglonesDe("1. [ ] Abrir la barra a 360 px\n2. [x] Que el chat no salte\n3. [ ] Cerrar y volver a abrir");
  assert.deepEqual(rs, [
    { n: 1, texto: "Abrir la barra a 360 px", hecho: false },
    { n: 2, texto: "Que el chat no salte", hecho: true },
    { n: 3, texto: "Cerrar y volver a abrir", hecho: false },
  ]);
  assert.equal(hechos(rs!), 1);
});

test("renglonesDe: un item viejo (texto suelto o comando) no tiene renglones", () => {
  assert.equal(renglonesDe(""), null);
  assert.equal(renglonesDe("npm run dev -- --mapa grande"), null);
  assert.equal(renglonesDe("1. Abrir algo"), null);
  assert.equal(renglonesDe("Probá esto:\n1. [ ] algo"), null);
});

test("renglonesDe: numeración salteada no es una lista del CLI", () => {
  assert.equal(renglonesDe("1. [ ] uno\n3. [ ] tres"), null);
});

test("renglonesDe: una línea sin número sigue al renglón anterior; CRLF y [X] valen", () => {
  const rs = renglonesDe("1. [X] primero\r\n   sigue acá\r\n2. [ ] segundo");
  assert.deepEqual(rs, [
    { n: 1, texto: "primero sigue acá", hecho: true },
    { n: 2, texto: "segundo", hecho: false },
  ]);
});

test("conTilde: cambia sólo el renglón pedido y no toca la lista original", () => {
  const rs = renglonesDe("1. [ ] a\n2. [ ] b")!;
  const nuevo = conTilde(rs, 2, true);
  assert.deepEqual(nuevo.map((r) => r.hecho), [false, true]);
  assert.deepEqual(rs.map((r) => r.hecho), [false, false]);
});

test("tildarRenglon: llama a tildar con el id, el número y el sentido, y devuelve la lista nueva", async () => {
  const llamadas: unknown[][] = [];
  const fuente = { tildar: async (...a: [number | string, number[], boolean]) => void llamadas.push(a) };
  const rs = renglonesDe("1. [ ] a\n2. [ ] b")!;
  const nuevo = await tildarRenglon(fuente, 41, rs, 2, true);
  assert.deepEqual(llamadas, [[41, [2], true]]);
  assert.deepEqual(nuevo.map((r) => r.hecho), [false, true]);
  const sin = await tildarRenglon(fuente, "dell:41", nuevo, 2, false);
  assert.deepEqual(llamadas[1], ["dell:41", [2], false]);
  assert.equal(hechos(sin), 0);
});

test("tildarRenglon: si el CLI falla rechaza con su mensaje; un renglón que no existe ni lo llama", async () => {
  const rs = renglonesDe("1. [ ] a")!;
  await assert.rejects(tildarRenglon({ tildar: async () => Promise.reject(new Error("tablero: no pude escribir")) }, 1, rs, 1, true), /no pude escribir/);
  let llamado = false;
  await assert.rejects(tildarRenglon({ tildar: async () => void (llamado = true) }, 1, rs, 5, true), /no hay renglón 5/);
  assert.equal(llamado, false);
});
