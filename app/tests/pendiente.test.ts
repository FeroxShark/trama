// Modelo y esfuerzo elegidos con el líder trabajando (src/hilo/pendiente.ts): nunca se bloquean, no tocan el turno en curso
// y lo que difiere de lo que usa el turno se marca como pendiente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const { opcionesEnTurno, pendienteDe } = await import("../src/hilo/pendiente.ts");

const turno = { modelo: "claude-opus-5-5", effort: "high" };

test("sin turno en curso no hay nada pendiente (el próximo mensaje sale con lo elegido y ya)", () => {
  assert.deepEqual(pendienteDe({ ocupado: false, modelo: "claude-sonnet-5-5", effort: "low", turno }), { modelo: false, effort: false });
});

test("con un turno en curso: lo igual a lo del turno no se marca", () => {
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-opus-5-5", effort: "high", turno }), { modelo: false, effort: false });
});

test("con un turno en curso: otro esfuerzo se marca como pendiente, y el modelo no", () => {
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-opus-5-5", effort: "low", turno }), { modelo: false, effort: true });
});

test("con un turno en curso: otro modelo se marca como pendiente (su esfuerzo viaja con él, no se marca aparte)", () => {
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-sonnet-5-5", effort: "low", turno }), { modelo: true, effort: false });
});

test("sin datos del turno (líder todavía sin lista) no marca nada", () => {
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-sonnet-5-5", effort: "low", turno: null }), { modelo: false, effort: false });
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: "claude-sonnet-5-5", effort: "low", turno: { modelo: undefined, effort: "high" } }), { modelo: false, effort: false });
});

test("un modelo sin niveles de esfuerzo nunca marca esfuerzo", () => {
  const sin = { modelo: "opencode:opencode/big-pickle", effort: "high" };
  assert.deepEqual(pendienteDe({ ocupado: true, modelo: sin.modelo, effort: "low", turno: { modelo: sin.modelo, effort: "high" } }), { modelo: false, effort: false });
});

const ops = ["claude-opus-5-5", "claude-sonnet-5-5", "gemini-4-argon", "agy:claude-opus-5-5", "opencode:opencode/big-pickle"].map((id) => ({ id, desc: "d" }));

test("con un turno en curso, los modelos del mismo motor se eligen y los de otro motor se ven apagados con el porqué", () => {
  const r = opcionesEnTurno(ops, true, "claude-opus-5-5", "otro motor");
  assert.deepEqual(r.filter((o) => !o.deshabilitada).map((o) => o.id), ["claude-opus-5-5", "claude-sonnet-5-5"]);
  assert.ok(r.filter((o) => o.deshabilitada).every((o) => o.desc === "otro motor"));
});

test("sin turno en curso las opciones quedan como están (cambiar de motor sigue con su confirmación)", () => {
  assert.equal(opcionesEnTurno(ops, false, "claude-opus-5-5", "x"), ops);
});

test("la caja no bloquea los selectores por un turno en curso", () => {
  const lider = readFileSync(path.join(import.meta.dirname, "..", "src", "hilo", "Lider.tsx"), "utf8");
  assert.doesNotMatch(lider, /disabled=\{app && ocupado\}/, "ni el de modelo ni el de esfuerzo llevan disabled por el turno");
  assert.match(lider, /pendiente=\{pend\.effort/);
  assert.match(lider, /pendiente=\{pend\.modelo/);
});
