// «Contexto antes de compactar» también para el líder: mismas reglas que `pa` (por modelo o familia, null = nativo, PA_AUTOCOMPACT pisa),
// el `--autocompact` del argv del líder y el límite del panel de contexto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { topeAutocompact, topeDeEntorno } from "../electron/autocompact-tope.ts";
import { argvLider } from "../electron/lider-arma.ts";
import { conTope } from "../electron/contexto-desglose.ts";
import { umbralDeLider } from "../src/hilo/contexto-logica.ts";

const conf = { defecto: null, por_modelo: { opus: 300000, sonnet: null, "claude-haiku-5-5": 150000 } };

test("el tope sale de la familia: opus 300 000, sonnet nativo, haiku por id; Haiku sin entrada 300 000", () => {
  assert.equal(topeAutocompact("claude-opus-5-5", conf), 300000);
  assert.equal(topeAutocompact("claude-sonnet-5-5", conf), null);
  assert.equal(topeAutocompact("claude-haiku-5-5", conf), 150000);
  assert.equal(topeAutocompact("claude-haiku-4-5", { defecto: null, por_modelo: {} }), 300000);
  assert.equal(topeAutocompact("claude-opus-5-5", null), null);
  assert.equal(topeAutocompact("claude-opus-5-5", { defecto: 200000, por_modelo: {} }), 200000);
});

test("PA_AUTOCOMPACT pisa todo; nativo lo apaga; lo inválido se ignora", () => {
  assert.equal(topeAutocompact("claude-opus-5-5", conf, topeDeEntorno("250000")), 250000);
  assert.equal(topeAutocompact("claude-opus-5-5", conf, topeDeEntorno("nativo")), null);
  assert.equal(topeDeEntorno("50"), null);
  assert.equal(topeAutocompact("claude-opus-5-5", conf, topeDeEntorno("basura")), 300000);
});

test("argvLider pasa --autocompact al arrancar y al reanudar; nativo, local y Ollama no", () => {
  const base = { modelo: "claude-opus-5-5", effort: "high", sid: "11111111-2222-3333-4444-555555555555", nombre: "trama-1" };
  for (const resume of [false, true]) {
    const a = argvLider({ ...base, resume, autocompact: 300000 });
    assert.equal(a[a.indexOf("--autocompact") + 1], "300000");
  }
  assert.equal(argvLider({ ...base, resume: false, autocompact: null }).includes("--autocompact"), false);
  assert.equal(argvLider({ ...base, resume: false }).includes("--autocompact"), false);
  assert.equal(argvLider({ ...base, resume: false, autocompact: 300000, ollama: { url: "http://x", modelo: "q" } }).includes("--autocompact"), false);
});

test("el panel muestra el tope como límite en vez de 1 M (nunca más que la ventana)", () => {
  const d = { fuente: "claude", ventana: 1000000, ventanaEstimada: true } as never;
  const r = conTope(d, 300000) as { ventana: number; ventanaEstimada: boolean; tope: number };
  assert.deepEqual([r.ventana, r.ventanaEstimada, r.tope], [300000, false, 300000]);
  assert.equal((conTope(d, null) as { ventana: number }).ventana, 1000000);
  assert.equal((conTope({ fuente: "claude", ventana: 200000, ventanaEstimada: false } as never, 500000) as { ventana: number }).ventana, 200000);
});

test("el anillo del líder usa el tope de su modelo; sin tope, el autoCompactWindow o la ventana", () => {
  const tope = { conf, env: null };
  assert.equal(umbralDeLider("claude-opus-5-5", tope, 200000, 1000000), 300000);
  assert.equal(umbralDeLider("claude-sonnet-5-5", tope, 200000, 1000000), 200000);
  assert.equal(umbralDeLider("claude-sonnet-5-5", tope, null, 1000000), 1000000);
  assert.equal(umbralDeLider("gemini-4-argon", tope, null, 1000000), 1000000);
});
