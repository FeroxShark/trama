// CTX-15: los prompts de los líderes que no son de Claude (Gemini, DeepSeek/dsh, OpenCode, ChatGPT) no dan por hecha ninguna suscripción
// y mandan a `reparto --resumen` (la tabla entera es más larga).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { PROMPT_CODEX, PROMPT_DSH, PROMPT_GEMINI, PROMPT_OPENCODE } from "../electron/contexto-local.ts";

describe("prompts de líderes sin Claude", () => {
  for (const [nombre, texto] of [["Gemini", PROMPT_GEMINI], ["dsh", PROMPT_DSH], ["OpenCode", PROMPT_OPENCODE], ["Codex", PROMPT_CODEX]] as const) {
    test(`${nombre}: no dice que el líder sea de Anthropic ni que los workers gasten Claude`, () => {
      assert.doesNotMatch(texto, /modelo de Anthropic/);
      assert.doesNotMatch(texto, /cupo semanal de Claude/);
      assert.doesNotMatch(texto, /workers gastan lo mismo/);
    });
    test(`${nombre}: manda a reparto --resumen y no a --tabla`, () => {
      assert.match(texto, /reparto --resumen/);
      assert.doesNotMatch(texto, /reparto --tabla/);
    });
    test(`${nombre}: conserva el manejo del plan semanal`, () => {
      assert.match(texto, /pa --plan ver/);
      assert.match(texto, /pa --plan ausente/);
    });
  }
});
