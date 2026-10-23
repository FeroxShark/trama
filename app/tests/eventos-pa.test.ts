import { test } from "node:test";
import assert from "node:assert/strict";
import { eventosDe, podarFrenados, sumarFrenados } from "../electron/eventos-pa.ts";

const linea = (o: object) => JSON.stringify(o);

test("eventosDe: las líneas buenas, con su tipo, id, proyecto y hora; lo roto se descarta", () => {
  const texto = [
    linea({ tipo: "inicio", id: "a", proyecto: "atlas", ts: 100 }),
    "{esto no es json",
    linea({ tipo: "parar", id: "b" }),
    linea({ id: "sin-tipo" }),
    linea({ tipo: "fin", id: 7 }),
    "",
  ].join("\n");
  assert.deepEqual(eventosDe(texto), [
    { tipo: "inicio", id: "a", proyecto: "atlas", ts: 100 },
    { tipo: "parar", id: "b", proyecto: "", ts: 0 },
  ]);
});

test("sumarFrenados: sólo los `parar`; el mismo evento dos veces no cambia nada", () => {
  const es = eventosDe([linea({ tipo: "inicio", id: "a", proyecto: "p", ts: 1 }), linea({ tipo: "parar", id: "b", proyecto: "p", ts: 50 })].join("\n"));
  const uno = sumarFrenados({}, es);
  assert.deepEqual(uno, { b: 50 });
  assert.equal(sumarFrenados(uno!, es), null);
  assert.equal(sumarFrenados({}, eventosDe(linea({ tipo: "inicio", id: "a", proyecto: "p", ts: 1 }))), null);
  assert.deepEqual(sumarFrenados({ b: 50 }, [{ tipo: "parar", id: "c", proyecto: "p", ts: 60 }]), { b: 50, c: 60 });
});

test("sumarFrenados: no crece sin tope; se quedan los más nuevos", () => {
  const es = Array.from({ length: 600 }, (_, i) => ({ tipo: "parar", id: `w${i}`, proyecto: "p", ts: 1000 + i }));
  const r = sumarFrenados({}, es)!;
  assert.equal(Object.keys(r).length, 500);
  assert.ok(!("w0" in r) && "w599" in r);
});

test("podarFrenados: se queda con lo que la lista muestra muerto o vivo (o todavía no nombra); lo cerrado se olvida", () => {
  const antes = { muerto: 1, vivo: 2, nuevo: 3, integrado: 4, archivado: 5 };
  const lista = [
    { id: "muerto", estado: "murio" },
    { id: "vivo", estado: "trabajando" },
    { id: "integrado", estado: "integrado" },
    { id: "archivado", estado: "archivado" },
  ];
  assert.deepEqual(podarFrenados(antes, lista), { muerto: 1, vivo: 2, nuevo: 3 });
  assert.equal(podarFrenados({ muerto: 1 }, lista), null);
});

test("eventosDe: si `pa` trae el líder en el evento, se conserva", () => {
  assert.deepEqual(eventosDe(linea({ tipo: "inicio", id: "a", proyecto: "p", ts: 1, jefe_id: "s-1", jefe: "ana-1" })), [
    { tipo: "inicio", id: "a", proyecto: "p", ts: 1, jefe_id: "s-1", jefe: "ana-1" },
  ]);
});
