// Advisor de Claude Code: pares válidos, esquema en modelos.json, `--advisor` en el argv del líder y lo que lo apaga.
import { test } from "node:test";
import assert from "node:assert/strict";
import { asesorDe, asesoresPara, envDeSettings, familiaAdvisor, motivoAdvisor } from "../electron/advisor.ts";
import { leerConfig, unir, validarConfig } from "../electron/modelos-tipos.ts";
import { argvLider } from "../electron/lider-arma.ts";

const SID = "11111111-1111-4111-8111-111111111111";

test("el asesor es de una familia más fuerte", () => {
  assert.deepEqual(asesoresPara("sonnet"), ["opus", "fable"]);
  assert.deepEqual(asesoresPara("fable"), []);
  assert.equal(familiaAdvisor("claude-opus-5-5[1m]"), "opus");
  assert.equal(asesorDe("claude-sonnet-5-5", { sonnet: "fable" }), "fable");
  assert.equal(asesorDe("claude-opus-5-5", { opus: "sonnet" }), null);
  assert.equal(asesorDe("gemini-4-argon", { opus: "fable" }), null);
});

test("modelos.json: se lee, se valida y se escribe sin entradas vacías", () => {
  assert.deepEqual(leerConfig({ version: 1, advisor: { opus: "fable", sonnet: "haiku", x: "opus" } }).advisor, { opus: "fable" });
  assert.deepEqual(validarConfig({ advisor: { sonnet: "opus" } }).advisor, { sonnet: "opus" });
  assert.throws(() => validarConfig({ advisor: { opus: "sonnet" } }));
  assert.equal(unir({ version: 1, advisor: { opus: "fable" } }, validarConfig({})).advisor, undefined);
});

test("el líder arranca con --advisor sólo si hay asesor", () => {
  const base = { modelo: "claude-sonnet-5-5", effort: "high", sid: SID, nombre: "x" };
  const con = argvLider({ ...base, advisor: "opus" });
  assert.equal(con[con.indexOf("--advisor") + 1], "opus");
  assert.ok(!argvLider({ ...base }).includes("--advisor"));
  assert.ok(!argvLider({ ...base, advisor: "--raro" }).includes("--advisor"));
});

test("lo que apaga el advisor", () => {
  assert.equal(motivoAdvisor({}), null);
  assert.deepEqual(motivoAdvisor({ DISABLE_TELEMETRY: "1" }), { tipo: "variable", nombre: "DISABLE_TELEMETRY" });
  assert.deepEqual(motivoAdvisor({ ANTHROPIC_BASE_URL: "http://x.test" }), { tipo: "proveedor", nombre: "ANTHROPIC_BASE_URL" });
  assert.deepEqual(envDeSettings('{"env":{"A":"1","B":2}}'), { A: "1", B: "2" });
});
