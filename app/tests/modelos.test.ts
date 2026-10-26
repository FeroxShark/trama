// La tabla única de modelos (src/hilo/modelos.ts): niveles de esfuerzo por modelo, reajuste al cambiar y los locales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defDe, effortDeModelo, EMPRESAS, esGratisOpencode, esOpencode, nombreOpencode, effortPara, effortsDe, EFFORTS_CLAUDE, EFFORTS_LOCAL, esDsh, esLocal, familiaDe, partirGeminiId, ponerConfig, reajustarEffort, sinWorkers, TABLA } from "../src/hilo/modelos.ts";

// Los locales de llama-server no vienen en el código: los declara `locales.json` y el main manda sólo ids y nombres. Acá, dos de ejemplo.
const LLAMA = [
  { id: "modelo-local-ejemplo", nombre: "Modelo local de ejemplo", empresa: "Empresa de ejemplo" },
  { id: "modelo-local-chico", nombre: "Modelo local chico", empresa: "Otra empresa" },
];
const CON = { gemini: false, locales: [], llama: LLAMA, lider: null };
ponerConfig(CON);

test("sin locales declarados la tabla son los cuatro de Claude", () => {
  try {
    assert.equal(ponerConfig(null), null);
    assert.deepEqual(TABLA.map((m) => m.id), ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
    assert.equal(esLocal("modelo-local-ejemplo"), false);
  } finally {
    ponerConfig(CON);
  }
});

test("los locales de una misma empresa quedan juntos en la tabla", () => {
  try {
    ponerConfig({ gemini: false, locales: [], llama: [{ id: "a", nombre: "A", empresa: "X" }, { id: "b", nombre: "B", empresa: "Y" }, { id: "c", nombre: "C", empresa: "X" }], lider: null });
    assert.deepEqual(TABLA.filter((m) => m.local).map((m) => m.id), ["a", "c", "b"]);
  } finally {
    ponerConfig(CON);
  }
});

test("la tabla, en el orden de los selectores: Fable, Opus, Sonnet, Haiku y después los locales declarados; ningún Haiku 4.5", () => {
  const ids = TABLA.map((m) => m.id);
  assert.deepEqual(ids, ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "modelo-local-ejemplo", "modelo-local-chico"]);
  // El default sigue siendo Opus (routing), aunque no vaya primero.
  assert.equal(TABLA.find((m) => m.rec)?.id, "claude-opus-5-5");
  // Los locales, juntos al final.
  const primerLocal = TABLA.findIndex((m) => m.local);
  assert.ok(primerLocal > 0 && TABLA.slice(primerLocal).every((m) => m.local), "los locales cierran la tabla, sin un Claude en el medio");
  assert.equal(defDe("claude-haiku-5-5")?.nombre, "Haiku 5.5");
  assert.equal(defDe("modelo-local-ejemplo")?.nombre, "Modelo local de ejemplo");
  assert.equal(defDe("modelo-local-chico")?.nombre, "Modelo local chico");
  assert.ok(!JSON.stringify(TABLA).includes("4.5") && !JSON.stringify(TABLA).includes("4-5"));
  assert.equal(TABLA.filter((m) => m.rec).length, 1);
});

test("el menú agrupa por empresa: cada una en filas contiguas, Anthropic primero, y los locales declarados van en el grupo de su empresa", () => {
  const empresas = TABLA.map((m) => m.empresa);
  assert.deepEqual([...new Set(empresas)], ["anthropic", "local"]);
  // Contiguas: una empresa que reaparece después de otra partiría su divisor en dos.
  assert.deepEqual(
    empresas.filter((e, i) => e !== empresas[i - 1]),
    ["anthropic", "local"],
  );
  assert.deepEqual(EMPRESAS, { anthropic: "Anthropic", google: "Google", local: "Local", ollama: "Ollama", dsh: "DeepSeek Harness", opencode: "OpenCode" });
  assert.deepEqual(TABLA.filter((m) => m.local).map((m) => m.empresaNombre), ["Empresa de ejemplo", "Otra empresa"]);
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
  assert.deepEqual(effortsDe("modelo-local-ejemplo"), ["off", "low", "medium", "xhigh"]);
  assert.deepEqual(effortsDe("modelo-local-chico"), EFFORTS_LOCAL);
  assert.ok(!effortsDe("modelo-local-ejemplo").includes("high") && !effortsDe("modelo-local-ejemplo").includes("max"));
  assert.ok(!effortsDe("claude-sonnet-5-5").includes("off"));
  // El default de cada fila existe en su lista.
  for (const m of TABLA) assert.ok(m.efforts.includes(m.effortDefecto), m.id);
});

test("un modelo que la tabla no conoce usa los niveles de Claude; el id de un hilo (con fecha o [1m]) se reconoce por su clave", () => {
  assert.deepEqual(effortsDe("claude-raro-9"), EFFORTS_CLAUDE);
  assert.deepEqual(effortsDe(null), EFFORTS_CLAUDE);
  assert.equal(defDe("claude-haiku-5-5-20261001")?.id, "claude-haiku-5-5");
  assert.equal(defDe("claude-opus-5-5[1m]")?.id, "claude-opus-5-5");
  assert.equal(esLocal("modelo-local-ejemplo"), true);
  assert.equal(esLocal("modelo-local-chico"), true);
  assert.equal(esLocal("claude-opus-5-5"), false);
  assert.equal(esLocal(undefined), false);
});

test("effortDeModelo: el nivel si el modelo lo tiene, si no null", () => {
  assert.equal(effortDeModelo("modelo-local-ejemplo", "off"), "off");
  assert.equal(effortDeModelo("modelo-local-ejemplo", "high"), null);
  assert.equal(effortDeModelo("claude-opus-5-5", "off"), null);
  assert.equal(effortDeModelo("claude-opus-5-5", "max"), "max");
  assert.equal(effortDeModelo("claude-opus-5-5", null), null);
});

test("effortPara: lo último elegido para ese modelo si todavía vale; si no, el de la tabla", () => {
  assert.equal(effortPara("claude-opus-5-5", {}), "high");
  assert.equal(effortPara("modelo-local-ejemplo", {}), "medium");
  assert.equal(effortPara("modelo-local-chico", { "modelo-local-chico": "xhigh" }), "xhigh");
  // Una preferencia que el modelo no tiene (se guardó con otra tabla) se ignora.
  assert.equal(effortPara("modelo-local-ejemplo", { "modelo-local-ejemplo": "high" }), "medium");
  assert.equal(effortPara("modelo-raro", {}), "high");
});

test("reajustarEffort: al cambiar de modelo vuelve el que le toca a ese modelo, siempre un nivel suyo", () => {
  // Se recuerda por modelo: el de un modelo no pisa al de otro.
  assert.equal(reajustarEffort("claude-opus-5-5", "medium", {}), "high");
  assert.equal(reajustarEffort("claude-sonnet-5-5", "high", { "claude-sonnet-5-5": "medium" }), "medium");
  // `high` y `max` no existen en un local, `off` no existe en Claude.
  assert.equal(reajustarEffort("modelo-local-ejemplo", "high", {}), "medium");
  assert.equal(reajustarEffort("modelo-local-ejemplo", "max", { "modelo-local-ejemplo": "max" }), "medium");
  assert.equal(reajustarEffort("modelo-local-chico", "max", { "modelo-local-chico": "low" }), "low");
  assert.equal(reajustarEffort("claude-opus-5-5", "off", {}), "high");
  assert.equal(reajustarEffort("claude-haiku-5-5", "off", { "claude-haiku-5-5": "medium" }), "medium");
  for (const m of TABLA) for (const e of [...EFFORTS_CLAUDE, ...EFFORTS_LOCAL, null]) assert.ok(m.efforts.includes(reajustarEffort(m.id, e, {})), `${m.id} ← ${e}`);
});

test("modelos.json agrega Gemini y Ollama (cada empresa contigua), mueve el default y se deshace con null", () => {
  try {
    const dev = ponerConfig({ gemini: true, locales: [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B" }, { id: "ollama:haiku-raro", nombre: "Raro" }], llama: LLAMA, lider: { modelo: "gemini-4-argon-low", effort: null } });
    assert.deepEqual(dev, { modelo: "gemini-4-argon", effort: "low" });
    const empresas = TABLA.map((m) => m.empresa);
    assert.deepEqual(empresas.filter((e, i) => e !== empresas[i - 1]), ["anthropic", "local", "google", "ollama"]);
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
    ponerConfig({ gemini: true, locales: [], llama: LLAMA, lider: null });
    assert.equal(TABLA.length, 11);
    assert.equal(TABLA.find((m) => m.rec)?.id, "claude-opus-5-5");
  } finally {
    ponerConfig(CON);
  }
  assert.equal(TABLA.length, 6);
  assert.equal(TABLA.find((m) => m.rec)?.id, "claude-opus-5-5");
  assert.equal(effortPara("claude-opus-5-5", {}), "high");
});

test("un líder por defecto que la tabla no tiene no cambia nada", () => {
  try {
    assert.equal(ponerConfig({ gemini: false, locales: [], llama: LLAMA, lider: { modelo: "gemini-4-argon-high", effort: null } }), null);
    assert.equal(TABLA.find((m) => m.rec)?.id, "claude-opus-5-5");
  } finally {
    ponerConfig(CON);
  }
});

test("DeepSeek Harness: con dsh instalado la tabla suma el de DeepSeek y los Ollama de los locales; sin esfuerzo, con workers, también para los tipos de worker", () => {
  try {
    ponerConfig({ gemini: false, dsh: true, locales: [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", modelo: "qwen3-coder:30b" }, { id: "ollama:viejo", nombre: "Viejo" }], llama: [], lider: null });
    const dsh = TABLA.filter((m) => m.empresa === "dsh");
    assert.deepEqual(
      dsh.map((m) => m.id),
      [
        "dsh:deepseek/deepseek-v4-flash",
        "dsh:ollama/qwen3-coder:30b",
      ],
      "un local sin `modelo` (de un main viejo) no genera su fila de dsh",
    );
    for (const m of dsh) {
      assert.deepEqual(m.efforts, [], m.id);
      assert.ok(!m.soloLider, m.id);
      assert.equal(sinWorkers(m.id), false, `${m.id}: un líder de dsh delega con pa`);
      assert.equal(esDsh(m.id), true);
    }
    assert.equal(EMPRESAS.dsh, "DeepSeek Harness");
    // Los gratis de OpenCode ya no se ofrecen por dsh (OpenCode los rechaza fuera de su programa): van por `opencode:`.
    assert.equal(TABLA.some((m) => m.id.startsWith("dsh:opencode/")), false);
    assert.equal(defDe("dsh:deepseek/deepseek-v4-flash")?.id, "dsh:deepseek/deepseek-v4-flash");
    assert.equal(effortsDe("dsh:deepseek/deepseek-v4-flash").length, 0);
    assert.equal(familiaDe("dsh:opencode/big-pickle"), "dsh");
    assert.equal(familiaDe("gemini-4-argon"), "agy");
    assert.equal(familiaDe("ollama:qwen3-coder:30b"), "claude");
    assert.equal(familiaDe("claude-opus-5-5"), "claude");
    // El de DeepSeek no es de ninguna clave de Claude aunque el id lleve «deepseek».
    assert.equal(defDe("dsh:deepseek/deepseek-v4-flash")?.desc, "modelo.dshDeepseek");
    // Sin dsh instalado, nada de esto aparece.
    ponerConfig({ gemini: false, locales: [], llama: [], lider: null });
    assert.equal(TABLA.some((m) => m.empresa === "dsh"), false);
    // Un líder por defecto de dsh se ofrece aunque el flag falte, y es el default.
    const lider = ponerConfig({ gemini: false, locales: [], llama: [], lider: { modelo: "dsh:opencode/big-pickle", effort: null } });
    assert.deepEqual(lider, { modelo: "dsh:opencode/big-pickle", effort: null });
    assert.equal(TABLA.find((m) => m.rec)?.id, "dsh:opencode/big-pickle");
  } finally {
    ponerConfig(CON);
  }
});

test("OpenCode (el programa opencode): los modelos de `opencode models`, los gratis primero y marcados; sin la lista, nada", () => {
  try {
    ponerConfig({ gemini: false, opencode: ["opencode/gpt-5", "opencode/big-pickle", "opencode/deepseek-v4.1-flash-free", "opencode/nemotron-3.5-super-vl-free", "openrouter/qwen/qwen3-coder"], locales: [], llama: [], lider: null });
    const oc = TABLA.filter((m) => m.empresa === "opencode");
    assert.deepEqual(
      oc.map((m) => m.id),
      ["opencode:opencode/big-pickle", "opencode:opencode/deepseek-v4.1-flash-free", "opencode:opencode/nemotron-3.5-super-vl-free", "opencode:opencode/gpt-5", "opencode:openrouter/qwen/qwen3-coder"],
      "los gratis (-free y big-pickle) primero, en el orden de la lista",
    );
    assert.deepEqual(oc.map((m) => !!m.gratis), [true, true, true, false, false]);
    assert.deepEqual(oc.map((m) => m.nombre), ["Big Pickle · Gratis", "DeepSeek V4.1 Flash · Gratis", "Nemotron 3.5 Super VL · Gratis", "GPT 5 · Zen", "Qwen3 Coder · openrouter"]);
    for (const m of oc) {
      assert.deepEqual(m.efforts, [], m.id);
      assert.ok(!m.soloLider, `${m.id}: sirve de worker (pa -m opencode:…)`);
      assert.equal(sinWorkers(m.id), false);
      assert.equal(esOpencode(m.id), true);
      assert.equal(familiaDe(m.id), "opencode");
    }
    assert.equal(defDe("opencode:opencode/big-pickle")?.desc, "modelo.opencodeGratis");
    assert.equal(defDe("opencode:opencode/gpt-5")?.desc, "modelo.opencode");
    assert.equal(esDsh("opencode:opencode/big-pickle"), false);
    assert.equal(familiaDe("dsh:deepseek/deepseek-v4-flash"), "dsh");
    // Un líder por defecto de opencode se ofrece aunque el programa ya no lo liste, y es el default.
    const lider = ponerConfig({ gemini: false, locales: [], llama: [], lider: { modelo: "opencode:opencode/beam-free", effort: null } });
    assert.deepEqual(lider, { modelo: "opencode:opencode/beam-free", effort: null });
    assert.equal(TABLA.find((m) => m.rec)?.id, "opencode:opencode/beam-free");
    // Sin opencode instalado (sin lista), nada de esto aparece.
    ponerConfig({ gemini: false, locales: [], llama: [], lider: null });
    assert.equal(TABLA.some((m) => m.empresa === "opencode"), false);
  } finally {
    ponerConfig(CON);
  }
});

test("nombreOpencode: el nombre que se lee de un id de opencode models", () => {
  assert.equal(nombreOpencode("opencode/deepseek-v4.1-flash-free"), "DeepSeek V4.1 Flash");
  assert.equal(nombreOpencode("opencode/flint-40b-free"), "Flint 40B");
  assert.equal(nombreOpencode("opencode/glm-5.3-flash-free"), "GLM 5.3 Flash");
  assert.equal(nombreOpencode("opencode/mimo-v2.6-flash-free"), "MiMo V2.6 Flash");
  assert.equal(nombreOpencode("opencode/big-pickle"), "Big Pickle");
  assert.equal(esGratisOpencode("opencode/big-pickle") && esGratisOpencode("opencode/beam-free") && !esGratisOpencode("opencode/gpt-5"), true);
});

test("opencode: los niveles de `opencodeEfforts` llegan a la fila (default medium); sin ellos no hay selector", async () => {
  const { ponerConfig, effortsDe, defDe } = await import("../src/hilo/modelos.ts");
  const c = { gemini: false, opencode: ["opencode/beam-free", "opencode/big-pickle"], opencodeEfforts: { "opencode/beam-free": ["low", "medium", "high"] }, locales: [], lider: null };
  try {
    ponerConfig(c);
    assert.deepEqual(effortsDe("opencode:opencode/beam-free"), ["low", "medium", "high"]);
    assert.equal(defDe("opencode:opencode/beam-free")?.effortDefecto, "medium");
    assert.deepEqual(effortsDe("opencode:opencode/big-pickle"), []);
  } finally {
    ponerConfig(null);
  }
});
