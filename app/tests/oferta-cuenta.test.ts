// Qué cuenta usa cada chat: la oferta de pasar a otra cuando la del chat llega al tope (nunca sola), las dos ventanas juntas de cada cuenta
// («sin dato» si falta una) y los textos que dicen que «Usar» vale para los chats nuevos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { lineasCuentas, ofertaDeCambio, type CuentaRiel } from "../src/barra/cupos-riel-logica.ts";
import { carrilesCompletos } from "../src/paneles/cupos-tejido.ts";
import { es } from "../src/i18n/es.ts";

const cuenta = (id: string, h5: number | null, sem: number | null, enUso = false): CuentaRiel => ({ id, nombre: id, enUso, h5: { pct: h5, hasta: 0 }, sem: { pct: sem, hasta: 0 }, ts: 1 });

test("ofertaDeCambio: la cuenta del chat en el tope ofrece la que tiene más lugar", () => {
  const todas = [cuenta("claude", 10, 90, true), cuenta("trabajo", 30, 20), cuenta("estudio", 5, 10)];
  const o = ofertaDeCambio(todas, "claude");
  assert.equal(o?.otra.id, "estudio");
  assert.equal(o?.nivel, "ambar");
  assert.equal(o?.ventana, "7d");
});

test("ofertaDeCambio: manda la ventana agotada; la de 5 h sola se dice como 5 h", () => {
  assert.deepEqual(
    (({ nivel, ventana }) => ({ nivel, ventana }))(ofertaDeCambio([cuenta("a", 100, 40), cuenta("b", 1, 1)], "a")!),
    { nivel: "rojo", ventana: "5h" },
  );
  assert.equal(ofertaDeCambio([cuenta("a", 100, 100), cuenta("b", 1, 1)], "a")?.ventana, "7d");
});

test("ofertaDeCambio: la cuenta del chat, no la «en uso» de los nuevos, decide", () => {
  // «En uso» (los chats nuevos) está llena, pero este chat corre con otra que está bien: nada que ofrecer.
  const todas = [cuenta("claude", 100, 100, true), cuenta("trabajo", 10, 10)];
  assert.equal(ofertaDeCambio(todas, "trabajo"), null);
  assert.equal(ofertaDeCambio(todas, "claude")?.otra.id, "trabajo");
});

test("ofertaDeCambio: sin tope, sin a dónde pasar o sin cuenta conocida no ofrece nada", () => {
  assert.equal(ofertaDeCambio([cuenta("a", 50, 79), cuenta("b", 1, 1)], "a"), null);
  assert.equal(ofertaDeCambio([cuenta("a", 95, 10), cuenta("b", 90, 10)], "a"), null, "la otra también está en el tope");
  assert.equal(ofertaDeCambio([cuenta("a", 95, 10), cuenta("b", null, null)], "a"), null, "la otra no tiene dato: no se la promete");
  assert.equal(ofertaDeCambio([cuenta("a", 95, 10), cuenta("b", 1, 1)], "desconocida"), null);
});

test("lineasCuentas: cada cuenta trae sus dos ventanas, también cuando una falta", () => {
  const [l] = lineasCuentas([cuenta("a", 1, 1, true), cuenta("b", 12, null)]);
  assert.equal(l.h5?.pct, 12);
  assert.equal(l.sem?.pct, null);
});

test("carrilesCompletos: 5 h y semana siempre juntas; la que falta queda sin dato", () => {
  const sin = (v: { id: string; pct: number | null } | null) => (v ? [v.id, v.pct] : null);
  assert.deepEqual(carrilesCompletos([]).map(sin), [["5h", null], ["7d", null]]);
  assert.deepEqual(carrilesCompletos([{ id: "5h", pct: 30, vuelve: null }]).map(sin), [["5h", 30], ["7d", null]]);
  assert.deepEqual(carrilesCompletos([{ id: "7d", pct: 60, vuelve: null }]).map(sin), [["5h", null], ["7d", 60]]);
  // Un proveedor con una ventana mensual no inventa 5 h ni semana.
  assert.deepEqual(carrilesCompletos([{ id: "1m", pct: 20, vuelve: null }]).map(sin), [["1m", 20], null]);
});

test("«Usar» dice que vale para los chats nuevos (texto y tooltip) y el chat nombra su cuenta", () => {
  assert.match(es["cu.usarPrimero"], /nuevos/);
  assert.match(es["cu.usarPrimeroQue"], /chats nuevos/);
  assert.match(es["cu.usarPrimeroQue"], /conservan su cuenta/);
  assert.match(es["riel.noCambia"], /chats nuevos/);
  assert.match(es["cuenta.lider.etiqueta"], /este chat/);
});

test("el chat monta la oferta y no cambia de cuenta sin que la persona toque el botón", () => {
  const src = readFileSync(new URL("../src/hilo/Lider.tsx", import.meta.url), "utf8");
  assert.match(src, /<OfertaCuenta oferta=\{ofertaCuenta\} alPasar=\{\(\) => elegirCuenta\(/);
});
