// Lo puro de programar y posponer en la ventana (src/programados-logica.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cuentas, deLider, leerHora, resumen, sinPospuestas } from "../src/programados-logica.ts";

const T0 = new Date(2026, 10, 1, 10, 0, 0, 0).getTime();
const msg = (id: number, sid: string) => ({ id, sid, texto: "t", modelo: "m", effort: "e", cuando: T0 + id, creado: T0 });

test("las pospuestas se esconden de la lista, y sin ninguna es la misma lista (no rearma el árbol)", () => {
  const ls = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(sinPospuestas(ls, []), ls);
  assert.equal(sinPospuestas(ls, [{ sid: "zzz", hasta: T0, desde: T0 }]), ls);
  assert.deepEqual(sinPospuestas(ls, [{ sid: "b", hasta: T0, desde: T0 }]).map((l) => l.id), ["a", "c"]);
});

test("los programados de una conversación y los totales del pie", () => {
  const e = { mensajes: [msg(1, "a"), msg(2, "b"), msg(3, "a")], pospuestos: [{ sid: "c", hasta: T0 + 1, desde: T0 }] };
  assert.deepEqual(deLider(e, "a").map((m) => m.id), [1, 3]);
  assert.deepEqual(cuentas(e), { mensajes: 3, pospuestos: 1 });
});

test("leerHora: vacío es nada, lo que no se entiende es error y lo bueno trae la hora", () => {
  assert.equal(leerHora("   ", T0), null);
  assert.deepEqual(leerHora("blah", T0), { error: true });
  assert.deepEqual(leerHora("en 10 min", T0), { cuando: T0 + 600_000 });
});

test("resumen: una línea, cortada con puntos suspensivos", () => {
  assert.equal(resumen("hola\n\n  mundo"), "hola mundo");
  assert.equal(resumen("x".repeat(200), 10), "xxxxxxxxx…");
});
