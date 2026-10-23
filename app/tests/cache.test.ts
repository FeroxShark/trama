// El caché de prompt de un líder (`electron/cache.ts`): hasta cuándo vive según el statusline
// y lo que la app vio por el stream, y el numerito que lo dice (`pintorCache`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cacheDe, pedidoDe, ttlDeUso } from "../electron/cache.ts";
import { pintorCache } from "../src/tiempo.ts";

const MIN = 60;
const HORA = 3600;
/** El lunes a las 17:26 de la captura, más o menos. */
const AHORA = 1_791_836_800;

/** Lo que diría la barra a esa hora; `null`, nada (no hay numerito). */
function dice(c: { cache_ttl_s: number | null; cache_vence: number | null }, ahora: number): string | null {
  if (c.cache_vence === null) return null;
  return pintorCache(`t:${c.cache_vence}:${ahora}`, c.cache_vence, c.cache_ttl_s, false)(ahora).texto;
}

test("caché de 1 h, a un minuto del último mensaje: cacheado", () => {
  const c = cacheDe(null, { ultimo: AHORA - MIN, pedido: 0, ttl: HORA });
  assert.deepEqual(c, { cache_ttl_s: HORA, cache_vence: AHORA + 59 * MIN });
  assert.equal(dice(c, AHORA), "59m");
});

test("caché de 1 h, a más de una hora del último mensaje: no cacheado", () => {
  const c = cacheDe(null, { ultimo: AHORA - HORA - MIN, pedido: 0, ttl: HORA });
  assert.equal(c.cache_vence, AHORA - MIN);
  assert.equal(dice(c, AHORA), "Uncached");
});

test("caché de 5 min: vive a los dos minutos, vencido a los seis", () => {
  const c = cacheDe(null, { ultimo: AHORA - 2 * MIN, pedido: 0, ttl: 300 });
  assert.deepEqual(c, { cache_ttl_s: 300, cache_vence: AHORA + 3 * MIN });
  assert.equal(dice(c, AHORA), "3m");
  assert.equal(dice(cacheDe(null, { ultimo: AHORA - 6 * MIN, pedido: 0, ttl: 300 }), AHORA), "Uncached");
});

test("líder a mitad de turno: cada pedido contestado renueva el caché, sin esperar al fin", () => {
  // Su turno anterior terminó hace dos horas; el de ahora lleva pedidos, el último hace 20 s.
  const c = cacheDe(null, { ultimo: AHORA - 2 * HORA, pedido: AHORA - 20, ttl: HORA });
  assert.equal(c.cache_vence, AHORA - 20 + HORA);
  assert.equal(dice(c, AHORA), "59m");
  // Recién lanzado, en su primer turno (nunca terminó uno) y ya con un pedido contestado.
  assert.equal(dice(cacheDe(null, { ultimo: 0, pedido: AHORA - 5, ttl: HORA }), AHORA), "59m");
});

test("un líder traído a la app: su statusline viejo de la terminal no pisa lo que vio la app", () => {
  // El caso real: statusline de 16 h atrás con `expires_at` vencido, y un turno de hace un minuto.
  const viejo = { ttl: HORA, vence: AHORA - 16 * HORA };
  const c = cacheDe(viejo, { ultimo: AHORA - MIN, pedido: 0, ttl: HORA });
  assert.equal(dice(c, AHORA), "59m");
  // Sin TTL propio (el turno sólo leyó caché) vale el del statusline.
  assert.equal(dice(cacheDe(viejo, { ultimo: AHORA - MIN, pedido: 0, ttl: null }), AHORA), "59m");
  // Y al revés: uno de terminal con el statusline al día gana sobre un turno viejo de la app.
  assert.equal(cacheDe({ ttl: HORA, vence: AHORA + 40 * MIN }, { ultimo: AHORA - 3 * HORA, pedido: 0, ttl: HORA }).cache_vence, AHORA + 40 * MIN);
});

test("sin datos no se afirma nada: ni cacheado ni Uncached", () => {
  assert.equal(cacheDe(null, null).cache_vence, null);
  assert.equal(cacheDe({ ttl: null, vence: null }, null).cache_vence, null);
  // Recién lanzado o recién retomado, todavía sin ningún pedido contestado.
  assert.equal(cacheDe(null, { ultimo: 0, pedido: 0, ttl: null }).cache_vence, null);
  assert.equal(dice(cacheDe(null, { ultimo: 0, pedido: 0, ttl: HORA }), AHORA), null);
  // Hubo un turno pero no se sabe con qué TTL, y nada más nuevo lo dice.
  assert.equal(cacheDe(null, { ultimo: AHORA - MIN, pedido: 0, ttl: null }).cache_vence, null);
  assert.equal(cacheDe({ ttl: null, vence: AHORA - 16 * HORA }, { ultimo: AHORA - MIN, pedido: 0, ttl: null }).cache_vence, null);
  // Uno de terminal con el statusline vencido y nada más: eso sí se sabe.
  assert.equal(dice(cacheDe({ ttl: HORA, vence: AHORA - MIN }, null), AHORA), "Uncached");
});

test("ttlDeUso: el TTL sale de con cuál se escribió", () => {
  assert.equal(ttlDeUso({ cache_creation: { ephemeral_1h_input_tokens: 5, ephemeral_5m_input_tokens: 0 } }), HORA);
  assert.equal(ttlDeUso({ cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 9 } }), 300);
  assert.equal(ttlDeUso({ cache_read_input_tokens: 900 }), null);
  assert.equal(ttlDeUso(undefined), null);
});

test("pedidoDe: sólo el mensaje entero del asistente que tocó el caché", () => {
  const linea = (o: unknown) => JSON.stringify(o);
  const uso = { input_tokens: 2, cache_read_input_tokens: 900, cache_creation_input_tokens: 40, cache_creation: { ephemeral_1h_input_tokens: 40, ephemeral_5m_input_tokens: 0 } };
  assert.deepEqual(pedidoDe(linea({ type: "assistant", message: { usage: uso } })), { ttl: HORA });
  // Sólo leyó: lo renueva igual, con el TTL que ya se sabía.
  assert.deepEqual(pedidoDe(linea({ type: "assistant", message: { usage: { cache_read_input_tokens: 900 } } })), { ttl: null });
  // Un subagente tiene su propio prompt; sin caché no hay nada que renovar; el resto no son pedidos.
  assert.equal(pedidoDe(linea({ type: "assistant", parent_tool_use_id: "toolu_1", message: { usage: uso } })), null);
  assert.equal(pedidoDe(linea({ type: "assistant", message: { usage: { input_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })), null);
  assert.equal(pedidoDe(linea({ type: "stream_event", event: { type: "message_start", message: { usage: uso } } })), null);
  assert.equal(pedidoDe(linea({ type: "result", usage: uso })), null);
  assert.equal(pedidoDe('{"type":"assistant","cache_'), null);
  assert.equal(pedidoDe("no es json"), null);
});

test("pedidoDe: en un stream de verdad, un pedido por mensaje del asistente", () => {
  const lineas = readFileSync(path.join(import.meta.dirname, "fixtures", "stream-real.jsonl"), "utf8").split("\n").filter(Boolean);
  const pedidos = lineas.map(pedidoDe).filter((p) => p !== null);
  assert.equal(pedidos.length, 2);
  assert.deepEqual(pedidos, [{ ttl: HORA }, { ttl: HORA }]);
});
