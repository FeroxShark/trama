// Las cuentas de la interfaz sobre el gasto de los subagentes de un líder (src/hilo/gasto-sub-logica.ts), con los 2 subagentes inventados de
// los fixtures del panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claveEstadoSub, ordenSubs, pctContexto, porLlamada, tipoEstadoSub } from "../src/hilo/gasto-sub-logica.ts";
import { subagentesFalsos } from "../src/datos/fixtures-contexto.ts";

test("las llamadas Agent de la conversación encuentran a su subagente por el tool_use_id", () => {
  const g = subagentesFalsos("sesion-ejemplo");
  const m = porLlamada(g);
  assert.equal(m.size, 2);
  assert.equal(m.get("toolu_auditar")?.modelo, "Haiku 5.5");
  assert.equal(m.get("toolu_mapear")?.estado, "corriendo");
  assert.equal(m.get("toolu_nada"), undefined);
  assert.equal(porLlamada(null).size, 0);
});

test("el total del líder junta a los dos y el contexto final es un porcentaje de su ventana", () => {
  const g = subagentesFalsos("s");
  assert.equal(g.total.total, g.subagentes[0].tokens.total + g.subagentes[1].tokens.total);
  // Haiku tiene ventana de 200 mil: 71.200 pesa 36 %; el de Sonnet usa 28.700 de un millón.
  assert.equal(pctContexto(g.subagentes[0]), 36);
  assert.equal(pctContexto(g.subagentes[1]), 3);
  assert.equal(pctContexto({ ...g.subagentes[0], contexto: null }), null);
});

test("los que corren van primero; el estado siempre tiene su palabra y su punto", () => {
  const g = subagentesFalsos("s");
  assert.deepEqual(ordenSubs(g.subagentes).map((s) => s.estado), ["corriendo", "terminado"]);
  assert.equal(tipoEstadoSub("corriendo"), "trab");
  assert.equal(tipoEstadoSub("terminado"), "term");
  assert.equal(tipoEstadoSub("error"), "frenado");
  assert.equal(tipoEstadoSub("parado"), "frenado");
  assert.equal(claveEstadoSub("parado"), "sub.parado");
});
