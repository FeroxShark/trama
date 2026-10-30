// agyAJson (electron/cli/pa/motores/salida.ts): el inputTokens de agy no resta la caché. En agy input_tokens ya excluye
// cache_read_tokens (hay steps con más caché que input, así que restar daba negativo). Claude reporta lo mismo en su
// modelUsage (inputTokens sin caché), así que la forma del .json de agy tiene que ser la de Claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agyAJson } from "../electron/cli/pa/motores/salida.ts";

const linea = (o: object) => JSON.stringify(o);
const paso = (usage: object) =>
  linea({ event: "step_update", step_update: { conversation_id: "conv-1", state: "DONE", step_type: "agent_response", usage } });
const uso = (salida: ReturnType<typeof agyAJson>, modelo: string) => (salida.modelUsage as Record<string, any>)[modelo];

test("agy: el inputTokens es el input de los steps tal cual, sin restar la caché (que va aparte)", () => {
  const stream = [
    paso({ input_tokens: 14548, output_tokens: 250, thinking_tokens: 0, cache_read_tokens: 5179, total_tokens: 14798 }),
    paso({ input_tokens: 7789, output_tokens: 221, thinking_tokens: 0, cache_read_tokens: 13572, total_tokens: 8010 }),
  ].join("\n");
  const m = uso(agyAJson(stream, "", "gemini-4-argon-high", 0), "gemini-4-argon-high");
  assert.equal(m.inputTokens, 22337);
  assert.equal(m.cacheReadInputTokens, 18751);
  assert.equal(m.outputTokens, 471);
  assert.ok(m.inputTokens >= 0);
});

test("agy: un step con más caché que input no da negativo", () => {
  const stream = paso({ input_tokens: 7789, output_tokens: 221, thinking_tokens: 0, cache_read_tokens: 13572, total_tokens: 8010 });
  const m = uso(agyAJson(stream, "", "gemini-3.8-flash-low", 0), "gemini-3.8-flash-low");
  assert.equal(m.inputTokens, 7789);
  assert.equal(m.cacheReadInputTokens, 13572);
  assert.ok(m.inputTokens >= 0);
});

test("agy: sin steps DONE, el uso sale de result.usage y el input tampoco resta la caché", () => {
  const stream = linea({
    event: "result",
    result: { status: "SUCCESS", response: "ok", duration_seconds: 2, usage: { input_tokens: 159142, output_tokens: 21443, cache_read_tokens: 2069574 } },
  });
  const m = uso(agyAJson(stream, "", "agy:claude-sonnet-5-5-medium", 0), "agy:claude-sonnet-5-5-medium");
  assert.equal(m.inputTokens, 159142);
  assert.equal(m.cacheReadInputTokens, 2069574);
  assert.equal(m.outputTokens, 21443);
});

test("agy con la forma de Claude: input sin caché (4) + caché leída (22732) + salida (191), como el modelUsage de un .json de claude", () => {
  // Fixture con la forma del modelUsage de un .json real de `claude -p`: inputTokens 4, cacheReadInputTokens 22732, outputTokens 191.
  const stream = paso({ input_tokens: 4, output_tokens: 191, thinking_tokens: 0, cache_read_tokens: 22732, total_tokens: 195 });
  const m = uso(agyAJson(stream, "", "agy:claude-sonnet-5-5-medium", 0), "agy:claude-sonnet-5-5-medium");
  assert.deepEqual(
    { inputTokens: m.inputTokens, cacheReadInputTokens: m.cacheReadInputTokens, outputTokens: m.outputTokens },
    { inputTokens: 4, cacheReadInputTokens: 22732, outputTokens: 191 },
  );
});
