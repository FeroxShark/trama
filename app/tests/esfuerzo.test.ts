import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiarIdioma } from "../src/i18n/index.ts";
import { esfuerzoDe, nivelDe } from "../src/barra/esfuerzo.ts";
import { ficha } from "../src/barra/ficha.ts";
import type { Hilo } from "../src/datos/contrato.ts";

const h = (p: Partial<Hilo>) => ({ proyecto: "atlas", modelo: "claude-opus-5-5", effort: "high", rama: null, ...p }) as Hilo;

test("Claude: cada nivel cae en su lugar y max llena todo", () => {
  const esperado = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
  for (const [nivel, lleno] of Object.entries(esperado)) {
    for (const modelo of ["claude-opus-5-5", "claude-sonnet-5-5[1m]", "claude-haiku-5-5", "claude-fable-5-1"]) {
      const e = esfuerzoDe(modelo, nivel);
      assert.deepEqual([e?.nivel, e?.lleno, e?.niveles.length], [nivel, lleno, 5], `${modelo} ${nivel}`);
    }
  }
  const max = esfuerzoDe("claude-sonnet-5-5", "max")!;
  assert.equal(max.lleno, max.niveles.length);
});

test("Claude: mayúsculas y espacios no cambian el nivel", () => {
  assert.equal(esfuerzoDe("claude-opus-5-5", " Max ")?.lleno, 5);
});

test("Gemini/agy: el esfuerzo sale del id, aunque el campo venga vacío", () => {
  assert.equal(nivelDe("gemini-3.8-flash-high", ""), "high");
  assert.equal(nivelDe("gemini-4-argon-medium", null), "medium");
  assert.equal(nivelDe("agy:claude-opus-5-5-low", "-"), "low");
  for (const [modelo, nivel, lleno] of [
    ["gemini-3.8-flash-low", "low", 1],
    ["gemini-3.8-flash-medium", "medium", 2],
    ["gemini-3.8-flash-high", "high", 3],
    ["gemini-4-argon-high", "high", 3],
    ["gemini-4-argon-medium", "medium", 2],
    ["agy:claude-sonnet-5-5-high", "high", 3],
  ] as const) {
    const e = esfuerzoDe(modelo, null);
    assert.deepEqual([e?.nivel, e?.lleno, e?.niveles.length], [nivel, lleno, 3], modelo);
  }
  // El id manda sobre el campo.
  assert.equal(esfuerzoDe("gemini-3.8-flash-high", "low")?.nivel, "high");
  // Un Gemini que la tabla no conoce igual usa la escala de Gemini, no la de Claude.
  assert.equal(esfuerzoDe("gemini-9-nuevo-high", null)?.niveles.length, 3);
});

test("OpenCode: la variante pegada al id o el campo, dentro de la escala del modelo", () => {
  assert.equal(nivelDe("opencode:opencode/modelo-ejemplo-high", null), "high");
  assert.equal(nivelDe("opencode:opencode/modelo-ejemplo", "medium"), "medium");
  // Sin tabla de niveles para ese modelo no hay escala: no se dibuja.
  assert.equal(esfuerzoDe("opencode:opencode/modelo-ejemplo-high", "high"), null);
});

test("sin esfuerzo conocido o fuera de la escala no hay gráfico", () => {
  assert.equal(esfuerzoDe("claude-opus-5-5", ""), null);
  assert.equal(esfuerzoDe("claude-opus-5-5", "-"), null);
  assert.equal(esfuerzoDe("claude-opus-5-5", null), null);
  assert.equal(esfuerzoDe("claude-opus-5-5", "ultra"), null);
  assert.equal(esfuerzoDe("gemini-3.8-flash", "xhigh"), null);
  assert.equal(esfuerzoDe("gemini-3.8-flash", ""), null);
});

test("la ficha suma la línea del esfuerzo (en inglés y en español)", () => {
  cambiarIdioma("en");
  assert.match(ficha(h({ effort: "max" }), null), /Model: claude-opus-5-5 · max\nEffort: max \(5 of 5\)$/);
  assert.match(ficha(h({ modelo: "gemini-3.8-flash-high", effort: "" }), null), /Model: gemini-3.8-flash-high · high\nEffort: high \(3 of 3\)$/);
  assert.equal(ficha(h({ effort: "" }), null).includes("Effort"), false);
  cambiarIdioma("es");
  try {
    assert.match(ficha(h({ effort: "medium" }), null), /Modelo: claude-opus-5-5 · medium\nEsfuerzo: medium \(2 de 5\)$/);
  } finally {
    cambiarIdioma("en");
  }
});
