// "Unificar todos" (Ajustes > Proyectos): qué plan se aplica directo y cuál se deja para revisar a mano (src/paneles/unificar-clase.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { clasePlan } from "../src/paneles/unificar-clase.ts";
import type { AccionMd } from "../electron/unificar-md.ts";

const plan = (acciones: AccionMd[], nada: "unificado" | "sin-contenido" | null = null) => ({ acciones, nada });

test("mecánico: un solo archivo con contenido, iguales, sólo el stub, ya dentro", () => {
  assert.equal(clasePlan(plan([{ archivo: "AGENTS.md", que: "crea", de: "CLAUDE.md" }, { archivo: "CLAUDE.md", que: "stub" }])), "mecanico");
  assert.equal(clasePlan(plan([{ archivo: "AGENTS.md", que: "crea", de: "GEMINI.md" }, { archivo: "GEMINI.md", que: "stub" }, { archivo: "CLAUDE.md", que: "crea-stub" }])), "mecanico");
  assert.equal(clasePlan(plan([{ archivo: "AGENTS.md", que: "crea", de: "iguales" }, { archivo: "CLAUDE.md", que: "stub" }, { archivo: "GEMINI.md", que: "stub" }])), "mecanico");
  assert.equal(clasePlan(plan([{ archivo: "CLAUDE.md", que: "crea-stub" }])), "mecanico");
  assert.equal(clasePlan(plan([{ archivo: "CLAUDE.md", que: "ya-dentro" }, { archivo: "CLAUDE.md", que: "stub" }])), "mecanico");
});

test("fusión: contenido distinto en más de un archivo nunca se aplica en masa", () => {
  assert.equal(clasePlan(plan([{ archivo: "AGENTS.md", que: "crea", de: "ambos" }, { archivo: "CLAUDE.md", que: "stub" }, { archivo: "GEMINI.md", que: "stub" }])), "fusion");
  assert.equal(clasePlan(plan([{ archivo: "AGENTS.md", que: "anexa", de: "CLAUDE.md" }, { archivo: "CLAUDE.md", que: "stub" }])), "fusion");
  assert.equal(clasePlan(plan([{ archivo: "GEMINI.md", que: "ya-dentro" }, { archivo: "AGENTS.md", que: "anexa", de: "CLAUDE.md" }])), "fusion");
});

test("nada: unificado, sin contenido o sin acciones", () => {
  assert.equal(clasePlan(plan([], "unificado")), "nada");
  assert.equal(clasePlan(plan([], "sin-contenido")), "nada");
  assert.equal(clasePlan(plan([])), "nada");
});
