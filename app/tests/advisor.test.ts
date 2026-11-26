// Advisor de Claude Code: pares válidos, esquema en modelos.json, `--advisor` en el argv del líder y lo que lo apaga.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { asesorDe, asesoresPara, envDeSettings, familiaAdvisor, motivoAdvisor } from "../electron/advisor.ts";
import { leerConfig, unir, validarConfig } from "../electron/modelos-tipos.ts";
import { advisorOrquestadorGuardado, asesorDeLider, asesorDeOrquestador } from "../electron/modelos-config.ts";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-advisor-orq-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("advisor_orquestador: esquema en modelos.json y lectura independiente de advisor", () => {
  assert.deepEqual(
    leerConfig({ version: 1, advisor_orquestador: { opus: "fable", sonnet: "haiku", x: "opus" } }).advisor_orquestador,
    { opus: "fable" },
  );
  assert.deepEqual(validarConfig({ advisor_orquestador: { sonnet: "opus" } }).advisor_orquestador, { sonnet: "opus" });
  assert.throws(() => validarConfig({ advisor_orquestador: { opus: "sonnet" } }));
  assert.throws(() => validarConfig({ advisor_orquestador: "opus" }));

  const escrito = unir({ version: 1 }, validarConfig({ advisor: { sonnet: "opus" }, advisor_orquestador: { sonnet: "fable" } }));
  assert.deepEqual(escrito.advisor, { sonnet: "opus" });
  assert.deepEqual(escrito.advisor_orquestador, { sonnet: "fable" });
  assert.equal("advisor_orquestador" in unir(escrito, validarConfig({})), false);

  const prev = process.env.TRAMA_MODELOS;
  const ruta = path.join(tmp, "modelos.json");
  const home = path.join(tmp, "home");
  try {
    process.env.TRAMA_MODELOS = ruta;
    writeFileSync(ruta, JSON.stringify({ version: 1, advisor: { sonnet: "opus" } }));
    assert.equal(advisorOrquestadorGuardado(), null);
    assert.equal(asesorDeLider("claude-sonnet-5-5", {}, home), "opus");
    assert.equal(asesorDeOrquestador("claude-sonnet-5-5", {}, home), null);

    writeFileSync(ruta, JSON.stringify({ version: 1, advisor: { sonnet: "opus" }, advisor_orquestador: { sonnet: "fable" } }));
    assert.deepEqual(advisorOrquestadorGuardado(), { sonnet: "fable" });
    assert.equal(asesorDeLider("claude-sonnet-5-5", {}, home), "opus");
    assert.equal(asesorDeOrquestador("claude-sonnet-5-5", {}, home), "fable");
    assert.equal(asesorDeOrquestador("claude-sonnet-5-5", { DISABLE_TELEMETRY: "1" }, home), null);
  } finally {
    if (prev === undefined) delete process.env.TRAMA_MODELOS;
    else process.env.TRAMA_MODELOS = prev;
  }
});
