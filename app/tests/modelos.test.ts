// La tabla única de modelos (src/hilo/modelos.ts): niveles de esfuerzo por modelo, reajuste al cambiar y los locales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defDe, effortDeModelo, EMPRESAS, effortPara, effortsDe, EFFORTS_CLAUDE, EFFORTS_LOCAL, esLocal, partirGeminiId, ponerConfig, reajustarEffort, sinWorkers, TABLA } from "../src/hilo/modelos.ts";

test("la tabla, en el orden de los selectores: Fable, Opus, Sonnet, Haiku y después Qwen sin censura y Bonsai 2; ningún Haiku 4.5", () => {
  const ids = TABLA.map((m) => m.id);
  assert.deepEqual(ids, ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "qwen-local", "bonsai-local"]);
  // El default sigue siendo Opus (routing), aunque no vaya primero.
  assert.equal(TABLA.find((m) => m.rec)?.id, "claude-opus-5-5");
  // Los locales, juntos al final.
  const primerLocal = TABLA.findIndex((m) => m.local);
  assert.ok(primerLocal > 0 && TABLA.slice(primerLocal).every((m) => m.local), "los locales cierran la tabla, sin un Claude en el medio");
  assert.equal(defDe("claude-haiku-5-5")?.nombre, "Haiku 5.5");
  assert.equal(defDe("qwen-local")?.nombre, "Qwen 3.8 sin censura");
  assert.equal(defDe("bonsai-local")?.nombre, "Bonsai 2");
  assert.ok(!JSON.stringify(TABLA).includes("4.5") && !JSON.stringify(TABLA).includes("4-5"));
  assert.equal(TABLA.filter((m) => m.rec).length, 1);
});

test("el menú agrupa por empresa: cada una en filas contiguas, Anthropic primero, y los locales son Qwen y PrismML", () => {
  const empresas = TABLA.map((m) => m.empresa);
  assert.deepEqual([...new Set(empresas)], ["anthropic", "qwen", "prismml"]);
  // Contiguas: una empresa que reaparece después de otra partiría su divisor en dos.
  assert.deepEqual(
    empresas.filter((e, i) => e !== empresas[i - 1]),
    ["anthropic", "qwen", "prismml"],
  );
  assert.deepEqual(EMPRESAS, { anthropic: "Anthropic", google: "Google", qwen: "Qwen", prismml: "PrismML", ollama: "Ollama" });
  assert.deepEqual(
    TABLA.filter((m) => m.empresa === "anthropic").map((m) => m.clave),
    ["fable", "opus", "sonnet", "haiku"],
  );
  assert.ok(TABLA.filter((m) => m.empresa !== "anthropic").every((m) => m.local), "lo que no es de Anthropic corre en la GPU local");
  assert.ok(TABLA.filter((m) => m.empresa === "anthropic").every((m) => !m.local));
});

test("cada modelo tiene sus niveles: los de Claude no cambian y los locales traen off y no traen high ni max", () => {
  assert.deepEqual(effortsDe("claude-opus-5-5"), EFFORTS_CLAUDE);
  assert.deepEqual(effortsDe("claude-haiku-5-5"), ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(effortsDe("qwen-local"), ["off", "low", "medium", "xhigh"]);
  assert.deepEqual(effortsDe("bonsai-local"), EFFORTS_LOCAL);
  assert.ok(!effortsDe("qwen-local").includes("high") && !effortsDe("qwen-local").includes("max"));
  assert.ok(!effortsDe("claude-sonnet-5-5").includes("off"));
  // El default de cada fila existe en su lista.
  for (const m of TABLA) assert.ok(m.efforts.includes(m.effortDefecto), m.id);
});

test("un modelo que la tabla no conoce usa los niveles de Claude; el id de un hilo (con fecha o [1m]) se reconoce por su clave", () => {
  assert.deepEqual(effortsDe("claude-raro-9"), EFFORTS_CLAUDE);
  assert.deepEqual(effortsDe(null), EFFORTS_CLAUDE);
  assert.equal(defDe("claude-haiku-5-5-20261001")?.id, "claude-haiku-5-5");
  assert.equal(defDe("claude-opus-5-5[1m]")?.id, "claude-opus-5-5");
  assert.equal(esLocal("qwen-local"), true);
  assert.equal(esLocal("bonsai-local"), true);
  assert.equal(esLocal("claude-opus-5-5"), false);
  assert.equal(esLocal(undefined), false);
});

test("effortDeModelo: el nivel si el modelo lo tiene, si no null", () => {
  assert.equal(effortDeModelo("qwen-local", "off"), "off");
  assert.equal(effortDeModelo("qwen-local", "high"), null);
  assert.equal(effortDeModelo("claude-opus-5-5", "off"), null);
  assert.equal(effortDeModelo("claude-opus-5-5", "max"), "max");
  assert.equal(effortDeModelo("claude-opus-5-5", null), null);
});

test("effortPara: lo último elegido para ese modelo si todavía vale; si no, el de la tabla", () => {
  assert.equal(effortPara("claude-opus-5-5", {}), "high");
  assert.equal(effortPara("qwen-local", {}), "medium");
  assert.equal(effortPara("bonsai-local", { "bonsai-local": "xhigh" }), "xhigh");
  // Una preferencia que el modelo no tiene (se guardó con otra tabla) se ignora.
  assert.equal(effortPara("qwen-local", { "qwen-local": "high" }), "medium");
  assert.equal(effortPara("modelo-raro", {}), "high");
});

test("reajustarEffort: al cambiar de modelo vuelve el que le toca a ese modelo, siempre un nivel suyo", () => {
  // Se recuerda por modelo: el de un modelo no pisa al de otro.
  assert.equal(reajustarEffort("claude-opus-5-5", "medium", {}), "high");
  assert.equal(reajustarEffort("claude-sonnet-5-5", "high", { "claude-sonnet-5-5": "medium" }), "medium");
  // `high` y `max` no existen en un local, `off` no existe en Claude.
  assert.equal(reajustarEffort("qwen-local", "high", {}), "medium");
  assert.equal(reajustarEffort("qwen-local", "max", { "qwen-local": "max" }), "medium");
  assert.equal(reajustarEffort("bonsai-local", "max", { "bonsai-local": "low" }), "low");
  assert.equal(reajustarEffort("claude-opus-5-5", "off", {}), "high");
  assert.equal(reajustarEffort("claude-haiku-5-5", "off", { "claude-haiku-5-5": "medium" }), "medium");
  for (const m of TABLA) for (const e of [...EFFORTS_CLAUDE, ...EFFORTS_LOCAL, null]) assert.ok(m.efforts.includes(reajustarEffort(m.id, e, {})), `${m.id} ← ${e}`);
});

test("modelos.json agrega Gemini y Ollama (cada empresa contigua), mueve el default y se deshace con null", () => {
  try {
    const dev = ponerConfig({ gemini: true, locales: [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B" }, { id: "ollama:haiku-raro", nombre: "Raro" }], lider: { modelo: "gemini-4-argon-low", effort: null } });
    assert.deepEqual(dev, { modelo: "gemini-4-argon", effort: "low" });
    const empresas = TABLA.map((m) => m.empresa);
    assert.deepEqual(empresas.filter((e, i) => e !== empresas[i - 1]), ["anthropic", "qwen", "prismml", "google", "ollama"]);
    assert.equal(TABLA.filter((m) => m.rec).length, 1);
    assert.equal(TABLA.find((m) => m.rec)?.id, "gemini-4-argon");
    assert.equal(effortPara("gemini-4-argon", {}), "low");
    assert.deepEqual(effortsDe("gemini-3.8-flash"), ["low", "medium", "high"]);
    assert.deepEqual(effortsDe("ollama:qwen3-coder:30b"), []);
    // "haiku" dentro del id de Ollama no lo confunde con Haiku.
    assert.equal(defDe("ollama:haiku-raro")?.empresa, "ollama");
    assert.equal(sinWorkers("ollama:qwen3-coder:30b"), true);
    assert.equal(sinWorkers("gemini-4-argon"), false);
    assert.equal(sinWorkers("claude-opus-5-5"), false);
    assert.deepEqual(partirGeminiId("gemini-3.8-flash-medium"), ["gemini-3.8-flash", "medium"]);
    assert.deepEqual(partirGeminiId("claude-opus-5-5"), ["claude-opus-5-5", null]);
    // Idempotente.
    assert.deepEqual(partirGeminiId("agy:claude-opus-5-5-high"), ["agy:claude-opus-5-5", "high"]);
    assert.equal(defDe("agy:claude-opus-5-5-high")?.id, "agy:claude-opus-5-5");
    assert.equal(defDe("agy:claude-opus-5-5")?.empresa, "google");
    assert.match(defDe("agy:claude-opus-5-5")?.nombre ?? "", /por Google/);
    assert.match(defDe("agy:claude-sonnet-5-5")?.nombre ?? "", /por Google/);
    assert.match(defDe("agy:gpt-oss-120b")?.nombre ?? "", /por Google/);
    assert.equal(effortPara("agy:gpt-oss-120b", {}), "medium");
    ponerConfig({ gemini: true, locales: [], lider: null });
    assert.equal(TABLA.length, 11);
    assert.equal(TABLA.find((m) => m.rec)?.id, "claude-opus-5-5");
  } finally {
    ponerConfig(null);
  }
  assert.equal(TABLA.length, 6);
  assert.equal(TABLA.find((m) => m.rec)?.id, "claude-opus-5-5");
  assert.equal(effortPara("claude-opus-5-5", {}), "high");
});

test("un líder por defecto que la tabla no tiene no cambia nada", () => {
  try {
    assert.equal(ponerConfig({ gemini: false, locales: [], lider: { modelo: "gemini-4-argon-high", effort: null } }), null);
    assert.equal(TABLA.find((m) => m.rec)?.id, "claude-opus-5-5");
  } finally {
    ponerConfig(null);
  }
});
