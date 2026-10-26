// ~/.config/trama/modelos.json (electron/modelos-config.ts): lo que se lee, lo que se descarta y lo que llega al renderer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claseDeModelo, idAgy, leerLider as leerConfig, localOllama, modeloAgy, partirGemini, vistaModelos } from "../electron/modelos-config.ts";

const ejemplo = {
  version: 1,
  lider: { modelo: "gemini-4-argon-high", effort: "xhigh" },
  workers: { mecanico: { modelo: "claude-haiku-5-5", effort: "xhigh" } },
  locales: [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", url: "http://localhost:11434", modelo: "qwen3-coder:30b" }],
  gemini: { cupo_max: 5, sin_claude: false },
};

test("el contrato v1: líder, locales y Gemini", () => {
  const c = leerConfig(JSON.stringify(ejemplo))!;
  assert.deepEqual(c.lider, { modelo: "gemini-4-argon-high", effort: "xhigh" });
  assert.equal(c.gemini, true);
  assert.deepEqual(c.locales, [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", url: "http://localhost:11434", modelo: "qwen3-coder:30b" }]);
  assert.equal(localOllama("ollama:qwen3-coder:30b", c)?.url, "http://localhost:11434");
  assert.equal(localOllama("ollama:otro", c), null);
});

test("lo que no se entiende deja todo como siempre: otra versión, JSON roto, no objeto", () => {
  for (const t of ["", "no json", "[]", "3", "null", JSON.stringify({ ...ejemplo, version: 2 }), JSON.stringify({ lider: {} })]) assert.equal(leerConfig(t), null, t);
  // Sin secciones: una config válida y vacía.
  assert.deepEqual(leerConfig('{"version":1}'), { lider: null, locales: [], gemini: false });
});

test("un local roto se descarta solo: sin prefijo ollama:, url rara, espacios o guion al inicio, repetido", () => {
  const malos = [
    { id: "qwen", nombre: "x", url: "http://a", modelo: "qwen" },
    { id: "ollama:a", nombre: "x", url: "file:///etc/passwd", modelo: "a" },
    { id: "ollama:b", nombre: "x", url: "no es url", modelo: "b" },
    { id: "ollama:c d", nombre: "x", url: "http://a", modelo: "c d" },
    { id: "ollama:e", nombre: "x", url: "http://a", modelo: "--dangerously" },
    { id: "ollama:f", nombre: "x", url: "http://a" },
  ];
  const bueno = { id: "ollama:ok", nombre: "  ", url: "https://srv:11434", modelo: "ok" };
  const c = leerConfig(JSON.stringify({ version: 1, locales: [...malos, bueno, bueno] }))!;
  assert.deepEqual(c.locales.map((l) => l.id), ["ollama:ok"]);
  assert.equal(c.locales[0]!.nombre, "ok", "sin nombre, el del modelo");
  // Un líder con un modelo que empieza con guion no entra (iría como flag).
  assert.equal(leerConfig(JSON.stringify({ version: 1, lider: { modelo: "--model", effort: "high" } }))!.lider, null);
});

test("clases de modelo y el id que se le pasa a agy", () => {
  assert.equal(claseDeModelo("claude-opus-5-5"), "claude");
  assert.equal(claseDeModelo("modelo-local-ejemplo"), "claude");
  assert.equal(claseDeModelo("gemini-3.8-flash"), "gemini");
  assert.equal(claseDeModelo("gemini-4-argon-low"), "gemini");
  assert.equal(claseDeModelo("ollama:llama3"), "ollama");
  assert.deepEqual(partirGemini("gemini-3.8-flash-medium"), { modelo: "gemini-3.8-flash", effort: "medium" });
  assert.deepEqual(partirGemini("gemini-4-argon", "low"), { modelo: "gemini-4-argon", effort: "low" });
  assert.deepEqual(partirGemini("gemini-4-argon", "xhigh"), { modelo: "gemini-4-argon", effort: "high" }, "un nivel que Gemini no tiene vuelve al default");
  assert.equal(idAgy("gemini-3.8-flash", "low"), "gemini-3.8-flash-low");
  assert.equal(idAgy("gemini-3.8-flash", "max"), "gemini-3.8-flash-high");
  assert.equal(claseDeModelo("agy:claude-opus-5-5-high"), "gemini");
  assert.equal(claseDeModelo("agy:gpt-oss-120b"), "gemini");
  assert.deepEqual(partirGemini("agy:claude-opus-5-5-high"), { modelo: "agy:claude-opus-5-5", effort: "high" });
  assert.deepEqual(partirGemini("agy:gpt-oss-120b"), { modelo: "agy:gpt-oss-120b", effort: "medium" });
  assert.equal(idAgy("agy:claude-opus-5-5", "high"), "agy:claude-opus-5-5-high");
  assert.equal(modeloAgy("agy:claude-opus-5-5-high"), "claude-opus-5-5-high");
  assert.equal(modeloAgy("agy:claude-sonnet-5-5-medium"), "claude-sonnet-5-5-medium");
  assert.equal(modeloAgy("agy:gpt-oss-120b-high"), "gpt-oss-120b-medium");
  assert.equal(claseDeModelo("agy:claude-opus-5-5-high"), "gemini");
  assert.equal(claseDeModelo("agy:gpt-oss-120b"), "gemini");
  assert.deepEqual(partirGemini("agy:claude-opus-5-5-high"), { modelo: "agy:claude-opus-5-5", effort: "high" });
  assert.deepEqual(partirGemini("agy:gpt-oss-120b"), { modelo: "agy:gpt-oss-120b", effort: "medium" });
  assert.equal(idAgy("agy:claude-opus-5-5", "high"), "agy:claude-opus-5-5-high");
  assert.equal(modeloAgy("agy:claude-opus-5-5-high"), "claude-opus-5-5-high");
  assert.equal(modeloAgy("agy:claude-sonnet-5-5-medium"), "claude-sonnet-5-5-medium");
  assert.equal(modeloAgy("agy:gpt-oss-120b-high"), "gpt-oss-120b-medium");
});

test("al renderer sólo llegan ids y nombres: ninguna url; Gemini se habilita con la sección o con el líder", () => {
  const v = vistaModelos(leerConfig(JSON.stringify(ejemplo)));
  assert.deepEqual(v!.locales, [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", modelo: "qwen3-coder:30b" }]);
  assert.ok(!JSON.stringify(v).includes("11434") && !JSON.stringify(v).includes("http"));
  assert.equal(v!.gemini, true);
  assert.equal(vistaModelos(leerConfig('{"version":1}'))!.gemini, false);
  assert.equal(vistaModelos(leerConfig('{"version":1,"lider":{"modelo":"gemini-3.8-flash-low"}}'))!.gemini, true, "el líder por defecto es de Gemini");
  assert.equal(vistaModelos(null), null, "sin archivo y sin agy, nada cambia");
  assert.deepEqual(vistaModelos(null, true), { version: 1, gemini: true, dsh: false, locales: [], llama: [], lider: null }, "con agy instalado se habilita sin modelos.json");
  assert.equal(vistaModelos(null, false, [], true)!.dsh, true, "con dsh instalado se ofrece sin modelos.json");
  assert.equal(vistaModelos(leerConfig('{"version":1}'))!.dsh, false);
  assert.equal(vistaModelos(leerConfig('{"version":1}'), false, [], true)!.dsh, true);
  assert.equal(vistaModelos(leerConfig('{"version":1,"lider":{"modelo":"dsh:opencode/big-pickle"}}'))!.dsh, true, "el líder por defecto es de dsh");
});
