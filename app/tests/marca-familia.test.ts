import assert from "node:assert/strict";
import { test } from "node:test";
import { familiaDe } from "../src/barra/marca-familia.ts";

test("familiaDe reconoce Opus, Sonnet, Haiku y Fable por id o nombre sin distinguir mayúsculas", () => {
  assert.equal(familiaDe("claude-opus-5-5"), "opus");
  assert.equal(familiaDe("claude-opus-5-5[1m]"), "opus");
  assert.equal(familiaDe("agy:claude-opus-5-5"), "opus");
  assert.equal(familiaDe("Opus 5.5"), "opus");
  assert.equal(familiaDe("OPUS 5"), "opus");

  assert.equal(familiaDe("claude-sonnet-5-5"), "sonnet");
  assert.equal(familiaDe("claude-sonnet-5-5[1m]"), "sonnet");
  assert.equal(familiaDe("Sonnet 5.5"), "sonnet");

  assert.equal(familiaDe("claude-haiku-5-5"), "haiku");
  assert.equal(familiaDe("Haiku 5.5"), "haiku");

  assert.equal(familiaDe("claude-fable-5-1"), "fable");
  assert.equal(familiaDe("claude-fable-5-2"), "fable");
  assert.equal(familiaDe("Fable 5.2"), "fable");
});

test("familiaDe manda a otro los demás motores, iniciales sueltas y vacíos", () => {
  for (const id of [
    "gemini-3.8-flash-high",
    "gemini-4-argon",
    "gemini-4-argon-high",
    "codex:gpt-6.1-sol",
    "ollama:qwen3-coder:30b",
    "ollama:llama3.2:3b",
    "opencode:opencode/deepseek-v4.1-flash-free",
    "opencode:opencode/big-pickle",
    "dsh:deepseek/deepseek-v4-flash",
    "modelo-local-ejemplo",
    "octopus-7b",
    "O",
    "S",
    "",
    null,
    undefined,
  ]) {
    assert.equal(familiaDe(id), "otro", String(id));
  }
});
