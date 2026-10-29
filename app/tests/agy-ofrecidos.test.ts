// Los modelos de agy dependen de la cuenta: el selector y el lanzamiento usan los que `agy models` ofrece, no una lista fija.
// La lista de ejemplo es la de otra cuenta (tests/fixtures/agy-models-cuenta-b.txt), tal como la devuelve `reparto --agy-modelos --json`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearAgyOfrecidos } from "../electron/agy-ofrecidos.ts";
import { idAgy, modeloAgy, recordarAgySinNivel, vistaModelos } from "../electron/modelos-config.ts";
import { agyDeCuenta, effortsDe, ponerConfig, TABLA } from "../src/hilo/modelos.ts";

const SALIDA = JSON.stringify({
  modelos: [
    { id: "gemini-3.8-flash-high", nombre: "Gemini 3.8 Flash (High)", reparto: "gemini-3.8-flash-high" },
    { id: "gemini-3.8-flash-medium", nombre: "Gemini 3.8 Flash (Medium)", reparto: "gemini-3.8-flash-medium" },
    { id: "gemini-3.8-flash-low", nombre: "Gemini 3.8 Flash (Low)", reparto: "gemini-3.8-flash-low" },
    { id: "claude-sonnet-4-6-thinking", nombre: "Claude Sonnet 4.6 (Thinking)", reparto: "agy:claude-sonnet-4-6-thinking" },
    { id: "claude-opus-4-6-thinking", nombre: "Claude Opus 4.6 (Thinking)", reparto: "agy:claude-opus-4-6-thinking" },
    { id: "gpt-oss-120b-medium", nombre: "GPT-OSS 120B (Medium)", reparto: "agy:gpt-oss-120b-medium" },
  ],
});

test("parsearAgyOfrecidos: los ids de pa y los nombres; lo roto o vacío es null", () => {
  const l = parsearAgyOfrecidos(SALIDA)!;
  assert.equal(l.length, 6);
  assert.deepEqual(l[3], { id: "agy:claude-sonnet-4-6-thinking", nombre: "Claude Sonnet 4.6 (Thinking)" });
  assert.equal(parsearAgyOfrecidos("no es json"), null);
  assert.equal(parsearAgyOfrecidos('{"modelos":[]}'), null);
  assert.equal(parsearAgyOfrecidos('{"modelos":[{"reparto":"--model x"}]}'), null, "un id con espacios o flag no entra");
});

test("el selector muestra sólo los modelos de la cuenta, con sus niveles", () => {
  try {
    ponerConfig({ gemini: true, agyModelos: parsearAgyOfrecidos(SALIDA)!, locales: [], lider: null });
    const google = TABLA.filter((m) => m.empresa === "google");
    assert.deepEqual(
      google.map((m) => m.id),
      ["gemini-3.8-flash", "agy:claude-sonnet-4-6-thinking", "agy:claude-opus-4-6-thinking", "agy:gpt-oss-120b"],
    );
    assert.ok(!TABLA.some((m) => m.id === "agy:claude-sonnet-5-5"), "los que la cuenta no ofrece no aparecen");
    assert.ok(!TABLA.some((m) => m.id === "gemini-4-argon"));
    assert.deepEqual(effortsDe("gemini-3.8-flash"), ["low", "medium", "high"]);
    assert.deepEqual(effortsDe("agy:gpt-oss-120b"), ["medium"]);
    assert.deepEqual(effortsDe("agy:claude-opus-4-6-thinking"), [], "sin nivel en el nombre, sin selector de esfuerzo");
    assert.equal(google[1]!.nombre, "Claude Sonnet 4.6 (Thinking) · por Google");
  } finally {
    ponerConfig(null);
  }
});

test("sin la lista de la cuenta, los de Gemini son los de siempre", () => {
  try {
    ponerConfig({ gemini: true, locales: [], lider: null });
    assert.ok(TABLA.some((m) => m.id === "agy:claude-sonnet-5-5"));
    assert.equal(agyDeCuenta([]).length, 0);
  } finally {
    ponerConfig(null);
  }
});

test("el main manda la lista sólo si hay agy", () => {
  const l = parsearAgyOfrecidos(SALIDA)!;
  assert.equal(vistaModelos(null, true, [], false, [], {}, "gratis", l)!.agyModelos!.length, 6);
  assert.equal(vistaModelos(null, false, [], true, [], {}, "gratis", l)!.agyModelos, undefined);
});

test("un modelo de la cuenta sin nivel en el nombre se lanza tal cual (no se le pega -high)", () => {
  try {
    recordarAgySinNivel(parsearAgyOfrecidos(SALIDA)!.map((m) => m.id));
    assert.equal(idAgy("agy:claude-opus-4-6-thinking", "high"), "agy:claude-opus-4-6-thinking");
    assert.equal(modeloAgy("agy:claude-opus-4-6-thinking"), "claude-opus-4-6-thinking");
    assert.equal(idAgy("gemini-3.8-flash", "low"), "gemini-3.8-flash-low", "los que sí tienen niveles siguen igual");
    assert.equal(modeloAgy("agy:gpt-oss-120b-medium"), "gpt-oss-120b-medium");
  } finally {
    recordarAgySinNivel([]);
  }
});
