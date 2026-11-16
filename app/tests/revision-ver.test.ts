// «Ver la tarjeta» de una revisión (la lógica de RevisionVista sin React): la tarjeta del revisor es la última del chat, y si todavía
// no llegó (entrega por la cola del líder) el clic no va a ninguna parte: se espera a que aparezca.
import { test } from "node:test";
import assert from "node:assert/strict";
import { llego, SELECTOR_TARJETAS, verTarjeta, type ZonaChat } from "../src/hilo/revision-ver.ts";

type Tarjeta = { id: string; scrollIntoView(opciones: ScrollIntoViewOptions): void };

/** Un chat de mentira: `ids` son las tarjetas de `.conv`; cualquier otro selector no encuentra nada (la sección viva no es del chat). */
function chat(ids: string[]): ZonaChat<Tarjeta> {
  return {
    querySelectorAll: (selector) => (selector === SELECTOR_TARJETAS ? ids.map((id) => ({ id, scrollIntoView() {} })) : []),
  };
}

test("llego: con base cuenta sólo lo que apareció después; sin base, cualquier tarjeta sirve", () => {
  assert.equal(llego(2, 2), false, "las que ya había no cuentan");
  assert.equal(llego(2, 3), true, "la nueva sí");
  assert.equal(llego(null, 0), false);
  assert.equal(llego(null, 1), true);
});

test("«Ver la tarjeta» con la tarjeta ya en el chat: va a la última, no a una de una revisión anterior", () => {
  const zona = chat(["vieja", "nueva"]);
  assert.equal(verTarjeta(1, zona)?.id, "nueva");
});

test("«Ver la tarjeta» antes de que llegue (entrega encolada): no va a ninguna y la encuentra al llegar", () => {
  const ids = ["vieja"];
  const zona: ZonaChat<Tarjeta> = { querySelectorAll: (s) => (s === SELECTOR_TARJETAS ? ids.map((id) => ({ id, scrollIntoView() {} })) : []) };
  assert.equal(verTarjeta(1, zona), null, "no hay tarjeta nueva: el botón espera");
  ids.push("nueva");
  assert.equal(verTarjeta(1, zona)?.id, "nueva", "al llegar, la tarjeta de esta revisión");
});

test("sin base (la revisión se abrió con el chat ya armado): va a la última si hay alguna, y espera si no hay ninguna", () => {
  assert.equal(verTarjeta(null, chat([])), null);
  assert.equal(verTarjeta(null, chat(["unica"]))?.id, "unica");
});
