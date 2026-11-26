// «Contexto antes de compactar» también para el líder: mismas reglas que `pa` (por modelo o familia, null = nativo, PA_AUTOCOMPACT pisa),
// el `--autocompact` del argv del líder y el límite del panel de contexto.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  esPresetContextoOrq,
  topeAutocompact,
  topeDeEntorno,
  topeOrquestadorDePreset,
  topeWorkerDePreset,
} from "../electron/autocompact-tope.ts";
import { argvLider } from "../electron/lider-arma.ts";
import { conTope } from "../electron/contexto-desglose.ts";
import { leerConfig, unir, validarConfig } from "../electron/modelos-tipos.ts";
import {
  autocompactOrquestadorGuardado,
  avancesVivoGuardado,
  orquestacionGuardada,
  topeDeOrquestador,
} from "../electron/modelos-config.ts";
import { umbralDeLider } from "../src/hilo/contexto-logica.ts";

const conf = { defecto: null, por_modelo: { opus: 300000, sonnet: null, "claude-haiku-5-5": 150000 } };

test("el tope sale de la familia: opus 300 000, sonnet nativo, haiku por id; Haiku sin entrada 300 000", () => {
  assert.equal(topeAutocompact("claude-opus-5-5", conf), 300000);
  assert.equal(topeAutocompact("claude-sonnet-5-5", conf), null);
  assert.equal(topeAutocompact("claude-haiku-5-5", conf), 150000);
  assert.equal(topeAutocompact("claude-haiku-4-5", { defecto: null, por_modelo: {} }), 300000);
  assert.equal(topeAutocompact("claude-opus-5-5", null), null);
  assert.equal(topeAutocompact("claude-opus-5-5", { defecto: 200000, por_modelo: {} }), 200000);
});

test("PA_AUTOCOMPACT pisa todo; nativo lo apaga; lo inválido se ignora", () => {
  assert.equal(topeAutocompact("claude-opus-5-5", conf, topeDeEntorno("250000")), 250000);
  assert.equal(topeAutocompact("claude-opus-5-5", conf, topeDeEntorno("nativo")), null);
  assert.equal(topeDeEntorno("50"), null);
  assert.equal(topeAutocompact("claude-opus-5-5", conf, topeDeEntorno("basura")), 300000);
});

test("argvLider pasa --autocompact al arrancar y al reanudar; nativo, local y Ollama no", () => {
  const base = { modelo: "claude-opus-5-5", effort: "high", sid: "11111111-2222-3333-4444-555555555555", nombre: "trama-1" };
  for (const resume of [false, true]) {
    const a = argvLider({ ...base, resume, autocompact: 300000 });
    assert.equal(a[a.indexOf("--autocompact") + 1], "300000");
  }
  assert.equal(argvLider({ ...base, resume: false, autocompact: null }).includes("--autocompact"), false);
  assert.equal(argvLider({ ...base, resume: false }).includes("--autocompact"), false);
  assert.equal(argvLider({ ...base, resume: false, autocompact: 300000, ollama: { url: "http://x", modelo: "q" } }).includes("--autocompact"), false);
});

test("el panel muestra el tope como límite en vez de 1 M (nunca más que la ventana)", () => {
  const d = { fuente: "claude", ventana: 1000000, ventanaEstimada: true } as never;
  const r = conTope(d, 300000) as { ventana: number; ventanaEstimada: boolean; tope: number };
  assert.deepEqual([r.ventana, r.ventanaEstimada, r.tope], [300000, false, 300000]);
  assert.equal((conTope(d, null) as { ventana: number }).ventana, 1000000);
  assert.equal((conTope({ fuente: "claude", ventana: 200000, ventanaEstimada: false } as never, 500000) as { ventana: number }).ventana, 200000);
});

test("el anillo del líder usa el tope de su modelo (Claude y Gemini); sin tope, el autoCompactWindow o la ventana", () => {
  const tope = { conf, env: null };
  assert.equal(umbralDeLider("claude-opus-5-5", tope, 200000, 1000000), 300000);
  assert.equal(umbralDeLider("claude-sonnet-5-5", tope, 200000, 1000000), 200000);
  assert.equal(umbralDeLider("claude-sonnet-5-5", tope, null, 1000000), 1000000);
  assert.equal(umbralDeLider("gemini-4-argon", tope, null, 1000000), 1000000);
  const topeGem = { conf: { defecto: null, por_modelo: { gemini: 300000 } }, env: null };
  assert.equal(topeAutocompact("gemini-4-neon-xhigh", topeGem.conf), 300000);
  assert.equal(umbralDeLider("gemini-4-neon-xhigh", topeGem, null, 1000000), 300000);
});

test("topeAutocompact reconoce familias de codex, gemini y agy:* (sin confundir agy:claude-* con opus)", () => {
  const todos = { defecto: null, por_modelo: { codex: 250000, gemini: 350000, opus: 450000 } };
  assert.equal(topeAutocompact("codex:gpt-6.2-sol-high", todos), 250000);
  assert.equal(topeAutocompact("gpt-6.2-sol", todos), 250000);
  assert.equal(topeAutocompact("agy:claude-opus-5-5-high", todos), 350000);
  assert.equal(topeAutocompact("gemini-4-neon-xhigh", todos), 350000);
  assert.equal(topeAutocompact("claude-opus-5-5", todos), 450000);
  // Id exacto gana sobre la familia.
  const exacto = { defecto: null, por_modelo: { codex: 250000, "codex:gpt-6.2-sol-high": 400000 } };
  assert.equal(topeAutocompact("codex:gpt-6.2-sol-high", exacto), 400000);
});

test("presets de contexto del orquestador y de workers por tipo", () => {
  assert.equal(esPresetContextoOrq("equilibrado"), true);
  assert.equal(esPresetContextoOrq("otro"), false);
  assert.equal(topeOrquestadorDePreset("ahorro"), 200_000);
  assert.equal(topeOrquestadorDePreset("equilibrado"), 300_000);
  assert.equal(topeOrquestadorDePreset("profundo"), 500_000);
  assert.equal(topeOrquestadorDePreset("manual"), null);

  assert.equal(topeWorkerDePreset("manual", "debug"), null);
  assert.equal(topeWorkerDePreset("ahorro", "mecanico"), 150_000);
  assert.equal(topeWorkerDePreset("ahorro", "lectura"), 150_000);
  assert.equal(topeWorkerDePreset("ahorro", "codigo-multi"), 200_000);
  assert.equal(topeWorkerDePreset("equilibrado", "mecanico"), 200_000);
  assert.equal(topeWorkerDePreset("equilibrado", "codigo-acotado"), 300_000);
  assert.equal(topeWorkerDePreset("equilibrado", "codigo-multi"), 400_000);
  assert.equal(topeWorkerDePreset("equilibrado", "diseño"), 400_000);
  assert.equal(topeWorkerDePreset("equilibrado", "diseno"), 400_000);
  assert.equal(topeWorkerDePreset("equilibrado", "debug"), 400_000);
  assert.equal(topeWorkerDePreset("profundo", "lectura"), 300_000);
  assert.equal(topeWorkerDePreset("profundo", "frontend"), 500_000);
  assert.equal(topeWorkerDePreset("profundo", null), 500_000);
});

test("modelos.json: leerConfig, validarConfig y unir de autocompact_orquestador, avances_vivo y orquestacion", () => {
  // autocompact_orquestador
  assert.deepEqual(
    leerConfig({ autocompact_orquestador: { defecto: null, por_modelo: { codex: 250000, gemini: 300000 } } }).autocompact_orquestador,
    { defecto: null, por_modelo: { codex: 250000, gemini: 300000 } },
  );
  assert.deepEqual(leerConfig({ autocompact_orquestador: {} }).autocompact_orquestador, { defecto: null, por_modelo: {} });
  assert.deepEqual(
    validarConfig({ autocompact_orquestador: { defecto: 300000, por_modelo: { codex: null } } }).autocompact_orquestador,
    { defecto: 300000, por_modelo: { codex: null } },
  );
  assert.throws(() => validarConfig({ autocompact_orquestador: { defecto: 50000 } }));
  const conOrqTope = unir({ version: 1 }, validarConfig({ autocompact_orquestador: { defecto: 200000, por_modelo: {} } }));
  assert.deepEqual(conOrqTope.autocompact_orquestador, { defecto: 200000, por_modelo: {} });
  assert.equal("autocompact_orquestador" in unir(conOrqTope, validarConfig({})), false);

  // avances_vivo (default true: sólo false se escribe; true borra la clave)
  assert.equal(leerConfig({ avances_vivo: false }).avances_vivo, false);
  assert.equal(leerConfig({ avances_vivo: "no" }).avances_vivo, undefined);
  assert.throws(() => validarConfig({ avances_vivo: "no" }));
  const sinAvances = unir({ version: 1 }, validarConfig({ avances_vivo: false }));
  assert.equal(sinAvances.avances_vivo, false);
  assert.equal("avances_vivo" in unir(sinAvances, validarConfig({ avances_vivo: true })), false);

  // orquestacion
  const leida = leerConfig({
    orquestacion: { activo: true, modelo: { modelo: "claude-opus-5-5", effort: "high" }, revision_previa: false, preset_contexto: "profundo" },
  }).orquestacion;
  assert.deepEqual(leida, { activo: true, modelo: { modelo: "claude-opus-5-5", effort: "high" }, revision_previa: false, preset_contexto: "profundo" });
  assert.deepEqual(leerConfig({ orquestacion: { activo: "si", preset_contexto: "raro" } }).orquestacion, { activo: false });

  assert.throws(() => validarConfig({ orquestacion: "si" }));
  assert.throws(() => validarConfig({ orquestacion: { activo: "si" } }));
  assert.throws(() => validarConfig({ orquestacion: { activo: true, revision_previa: "no" } }));
  assert.throws(() => validarConfig({ orquestacion: { activo: true, preset_contexto: "ultra" } }));
  assert.throws(() => validarConfig({ orquestacion: { activo: true, modelo: { modelo: "gpt-9" } } }));
  assert.throws(() => validarConfig({ orquestacion: { activo: true, raro: 1 } }));

  // unir: sólo escribe lo no-default; inactivo sin config no-default borra la clave
  const oActiva = unir(
    { version: 1 },
    validarConfig({
      orquestacion: { activo: true, modelo: { modelo: "codex:gpt-6.2-sol-high" }, revision_previa: true, preset_contexto: "equilibrado" },
    }),
  );
  assert.deepEqual(oActiva.orquestacion, { activo: true, modelo: { modelo: "codex:gpt-6.2-sol-high" } });
  const oFull = unir(
    { version: 1 },
    validarConfig({
      orquestacion: { activo: false, revision_previa: false, preset_contexto: "ahorro" },
    }),
  );
  assert.deepEqual(oFull.orquestacion, { activo: false, revision_previa: false, preset_contexto: "ahorro" });
  assert.equal(
    "orquestacion" in unir(oActiva, validarConfig({ orquestacion: { activo: false, revision_previa: true, preset_contexto: "equilibrado" } })),
    false,
  );
  assert.equal("orquestacion" in unir(oActiva, validarConfig({})), false);
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-orq-tope-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("modelos-config: getters de orquestador, avances_vivo y topeDeOrquestador", () => {
  const prev = process.env.TRAMA_MODELOS;
  const ruta = path.join(tmp, "modelos.json");
  try {
    process.env.TRAMA_MODELOS = path.join(tmp, "inexistente.json");
    assert.equal(autocompactOrquestadorGuardado(), null);
    assert.equal(avancesVivoGuardado(), true);
    assert.deepEqual(orquestacionGuardada(), { activo: false, revision_previa: true, preset_contexto: "equilibrado" });
    assert.equal(topeDeOrquestador("claude-opus-5-5", {}), 300_000);

    process.env.TRAMA_MODELOS = ruta;
    writeFileSync(ruta, JSON.stringify({ version: 1, avances_vivo: false, orquestacion: { activo: true, preset_contexto: "profundo" } }));
    assert.equal(avancesVivoGuardado(), false);
    assert.deepEqual(orquestacionGuardada(), { activo: true, revision_previa: true, preset_contexto: "profundo" });
    assert.equal(topeDeOrquestador("claude-opus-5-5", {}), 500_000);
    assert.equal(topeDeOrquestador("claude-opus-5-5", { PA_AUTOCOMPACT: "250000" }), 250_000);
    assert.equal(topeDeOrquestador("claude-opus-5-5", { PA_AUTOCOMPACT: "nativo" }), null);

    // Con preset manual, cae al autocompact general si no hay autocompact_orquestador.
    writeFileSync(
      ruta,
      JSON.stringify({ version: 1, autocompact: { defecto: null, por_modelo: { codex: 220000 } }, orquestacion: { activo: true, preset_contexto: "manual" } }),
    );
    assert.equal(topeDeOrquestador("codex:gpt-6.2-sol-high", {}), 220_000);

    // autocompact_orquestador pisa al preset.
    writeFileSync(
      ruta,
      JSON.stringify({
        version: 1,
        autocompact_orquestador: { defecto: null, por_modelo: { opus: 420000 } },
        orquestacion: { activo: true, preset_contexto: "ahorro" },
      }),
    );
    assert.deepEqual(autocompactOrquestadorGuardado(), { defecto: null, por_modelo: { opus: 420000 } });
    assert.equal(topeDeOrquestador("claude-opus-5-5", {}), 420_000);
  } finally {
    if (prev === undefined) delete process.env.TRAMA_MODELOS;
    else process.env.TRAMA_MODELOS = prev;
  }
});
