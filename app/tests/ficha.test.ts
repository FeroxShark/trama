import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiarIdioma } from "../src/i18n/index.ts";
import { CORTO, familiaDe, ficha, lugarDe, modeloCorto } from "../src/barra/ficha.ts";
import type { Hilo } from "../src/datos/contrato.ts";

const h = (p: Partial<Hilo>) => ({ proyecto: "atlas", modelo: "claude-opus-5-5", effort: "high", rama: null, ...p }) as Hilo;

test("la familia sale del id del modelo", () => {
  assert.equal(familiaDe("claude-opus-5-5"), "opus");
  assert.equal(familiaDe("claude-sonnet-5-5[1m]"), "sonnet");
  assert.equal(familiaDe("claude-fable-5-1"), "fable");
  assert.equal(familiaDe("claude-haiku-5-5"), "haiku");
  assert.equal(familiaDe("modelo-local-ejemplo"), "otro");
  assert.equal(familiaDe(""), "otro");
  assert.equal(familiaDe(null), "otro");
});

test("el chip del modelo dice su nombre corto, nunca una letra suelta", () => {
  assert.equal(new Set(Object.values(CORTO)).size, Object.keys(CORTO).length);
  assert.equal(modeloCorto("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modeloCorto("claude-sonnet-5-5[1m]"), "Sonnet 5.5");
  assert.equal(modeloCorto("claude-fable-5-1"), "Fable 5.1");
  assert.equal(modeloCorto("claude-haiku-5-5"), "Haiku 5.5");
  assert.equal(modeloCorto("modelo-local-ejemplo"), "Modelo Local");
  assert.equal(modeloCorto("gemini-3.8-flash-low"), "Flash 3.8");
  assert.equal(modeloCorto("gemini-4-argon"), "Argon 4");
  assert.equal(modeloCorto("opencode:opencode/deepseek-v4.1-flash-free"), "Deepseek V4.1");
  assert.equal(modeloCorto("agy:claude-opus-5-5"), "Opus 5.5");
  assert.equal(modeloCorto(""), null);
  assert.equal(modeloCorto(null), null);
});

test("la ficha trae proyecto, máquina, rama y modelo completo (en inglés por default)", () => {
  assert.equal(
    ficha(h({ rama: "pa/atlas/20261003-100000-10001" }), "taller"),
    "Project: atlas\nMachine: local (taller)\nBranch: pa/atlas/20261003-100000-10001\nModel: claude-opus-5-5 · high",
  );
  assert.equal(ficha(h({ effort: "" }), null), "Project: atlas\nMachine: local\nBranch: no branch\nModel: claude-opus-5-5");
});

test("la ficha en español", () => {
  cambiarIdioma("es");
  try {
    assert.equal(
      ficha(h({ rama: "pa/atlas/20261003-100000-10001" }), "taller"),
      "Proyecto: atlas\nMáquina: local (taller)\nRama: pa/atlas/20261003-100000-10001\nModelo: claude-opus-5-5 · high",
    );
    assert.equal(ficha(h({ effort: "" }), null), "Proyecto: atlas\nMáquina: local\nRama: sin rama\nModelo: claude-opus-5-5");
  } finally {
    cambiarIdioma("en");
  }
});

test("por ahora todo corre en esta máquina", () => {
  assert.equal(lugarDe(h({})), "local");
});
