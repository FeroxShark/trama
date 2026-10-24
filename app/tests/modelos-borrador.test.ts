// El borrador de Ajustes > Modelos (src/paneles/modelos-borrador.ts): puro, sin React ni puente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EstadoModelos } from "../electron/modelos-config.ts";

// En src/ los imports no llevan extensión (los resuelve Vite): acá se los lleva al .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { agregarLocal, borradorDe, configDe, cupoDe, defaultsEn, efectivoBorrador, elegirEffortLider, elegirLider, elegirWorker, modelosPara, nombreGemini, quitarLocal, sucio, todoEn } = await import("../src/paneles/modelos-borrador.ts");

const estado = (config: Partial<EstadoModelos["config"]> = {}, existe = true): EstadoModelos => ({
  version: 1,
  ruta: "/x/modelos.json",
  existe,
  config: { workers: {}, locales: [], gemini: {}, claude: {}, ...config },
  error: null,
  efectivo: null,
});
const QWEN = { id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", url: "http://localhost:11434", modelo: "qwen3-coder:30b" };

test("sin cambios no está sucio; sin archivo tampoco", () => {
  assert.equal(sucio(estado({}, false), borradorDe(estado({}, false))), false);
  const e = estado({ lider: { modelo: "claude-opus-5-5", effort: "high" }, gemini: { cupo_max: 70 } });
  assert.equal(sucio(e, borradorDe(e)), false);
});

test("cambiar y volver a lo guardado deja de estar sucio", () => {
  const e = estado({ lider: { modelo: "claude-opus-5-5", effort: "high" } });
  const b = elegirEffortLider(borradorDe(e), "max");
  assert.equal(sucio(e, b), true);
  assert.equal(sucio(e, elegirEffortLider(b, "high")), false);
});

test("elegir modelo: Claude lleva esfuerzo (el que tenía si sirve), Gemini y locales no; vacío = como hoy", () => {
  let b = borradorDe(estado({ locales: [QWEN] }));
  b = elegirLider(b, "claude-sonnet-5-5");
  assert.deepEqual(b.lider, { modelo: "claude-sonnet-5-5", effort: "high" });
  b = elegirEffortLider(b, "low");
  b = elegirLider(b, "claude-haiku-5-5");
  assert.deepEqual(b.lider, { modelo: "claude-haiku-5-5", effort: "low" });
  b = elegirLider(b, "gemini-4-argon-high");
  assert.deepEqual(b.lider, { modelo: "gemini-4-argon-high" });
  b = elegirLider(b, QWEN.id);
  assert.deepEqual(b.lider, { modelo: QWEN.id });
  b = elegirLider(b, "");
  assert.equal(b.lider, undefined);
  assert.equal("lider" in configDe(b)!, false);
});

test("un solo modelo para todo: el líder y los ocho tipos, de una", () => {
  const b = todoEn(borradorDe(estado({ locales: [QWEN] })), "claude-sonnet-5-5");
  assert.equal(b.lider?.modelo, "claude-sonnet-5-5");
  assert.equal(Object.keys(b.workers).length, 8);
  assert.equal(b.workers["mecanico"]?.modelo, "claude-sonnet-5-5");
  const l = todoEn(borradorDe(estado({ locales: [QWEN] })), QWEN.id);
  assert.deepEqual(l.workers["debug"], { modelo: QWEN.id });
  assert.equal(configDe(l)!.workers["default"]!.modelo, QWEN.id);
});

test("usar los recomendados: cada tipo con su modelo por defecto, sin tocar el líder ni los locales; sin Claude, los de Gemini", () => {
  const base = borradorDe(estado({ lider: { modelo: "claude-opus-5-5", effort: "low" }, locales: [QWEN], workers: { debug: { modelo: QWEN.id } } }));
  const c = defaultsEn({ ...base, reparto: "auto" });
  assert.equal(c.reparto, undefined, "el reparto en automático se apaga: las filas ya dicen el modelo");
  assert.deepEqual(c.lider, base.lider);
  assert.deepEqual(c.locales, base.locales);
  assert.deepEqual(c.workers["lectura"], { modelo: "claude-haiku-5-5", effort: "xhigh" });
  assert.deepEqual(c.workers["codigo-multi"], { modelo: "claude-sonnet-5-5", effort: "high" });
  assert.deepEqual(c.workers["debug"], { modelo: "claude-opus-5-5", effort: "xhigh" });
  assert.ok(configDe(c), "lo que arma vale para guardar");
  const g = defaultsEn(base, true);
  assert.deepEqual(g.workers["mecanico"], { modelo: "gemini-3.8-flash-medium" });
  assert.deepEqual(g.workers["diseno"], { modelo: "gemini-4-argon-high" });
  assert.deepEqual(efectivoBorrador(borradorDe(estado()), "diseno", true), { modelo: "gemini-4-argon-high" });
  assert.ok(configDe(g));
});

test("agregar un local: no repite, normaliza la dirección y aparece en las opciones", () => {
  let b = borradorDe(estado());
  b = agregarLocal(b, "http://localhost:11434/", "qwen3-coder:30b");
  b = agregarLocal(b, "http://localhost:11434", "qwen3-coder:30b");
  assert.deepEqual(b.locales, [{ id: QWEN.id, nombre: "qwen3-coder:30b", url: "http://localhost:11434", modelo: "qwen3-coder:30b" }]);
  assert.equal(agregarLocal(b, "no es url", "x").locales.length, 1);
  assert.ok(modelosPara(b.locales).some((m) => m.id === QWEN.id && m.proveedor === "ollama"));
});

test("quitar un local deja en 'como hoy' lo que lo usaba", () => {
  let b = borradorDe(estado({ locales: [QWEN], lider: { modelo: QWEN.id }, workers: { mecanico: { modelo: QWEN.id }, debug: { modelo: "claude-opus-5-5", effort: "high" } } }));
  b = quitarLocal(b, QWEN.id);
  assert.equal(b.lider, undefined);
  assert.equal(b.workers["mecanico"], undefined);
  assert.equal(b.workers["debug"]?.modelo, "claude-opus-5-5");
  assert.equal(b.locales.length, 0);
  assert.ok(configDe(b));
});

test("el cupo: vacío, número entero de 1 a 100 o inválido (no se puede guardar)", () => {
  assert.equal(cupoDe(""), null);
  assert.equal(cupoDe(" 70 "), 70);
  for (const mal of ["0", "101", "7.5", "abc", "-3", "1000"]) assert.equal(cupoDe(mal), "mal");
  const e = estado();
  const b = { ...borradorDe(e), cupo: "500" };
  assert.equal(configDe(b), null);
  assert.equal(sucio(e, b), true);
  assert.deepEqual(configDe({ ...b, cupo: "70", sin_claude: "fallar" })!.gemini, { cupo_max: 70, sin_claude: "fallar" });
});

test("con qué corre cada tipo según el borrador", () => {
  const b = borradorDe(estado());
  assert.deepEqual(efectivoBorrador(b, "debug"), { modelo: "claude-opus-5-5", effort: "xhigh" });
  assert.deepEqual(efectivoBorrador(b, "codigo-multi"), { modelo: "claude-sonnet-5-5", effort: "high" });
  assert.deepEqual(efectivoBorrador(b, "mecanico"), { modelo: "claude-haiku-5-5", effort: "xhigh" });
  const c = elegirWorker(b, "default", "gemini-3.8-flash-low");
  assert.deepEqual(efectivoBorrador(c, "debug"), { modelo: "gemini-3.8-flash-low" });
});

test("las opciones traen un modelo del archivo que esta versión no lista, y los nombres de Gemini", () => {
  assert.ok(modelosPara([], ["claude-nuevo-9"]).some((m) => m.id === "claude-nuevo-9" && m.desc === "otro" && m.proveedor === "anthropic"));
  assert.equal(nombreGemini("gemini-4-argon-high"), "Gemini 4 Argon · high");
  assert.equal(nombreGemini("gemini-3.8-flash-low"), "Gemini 3.8 Flash · low");
});

test("agy (Claude y GPT por Google) y Automático (reparto) en workers", () => {
  const ops = modelosPara([]);
  assert.ok(ops.some((m) => m.id === "agy:claude-opus-5-5-high" && m.proveedor === "google" && m.nombre.includes("por Google")));
  assert.ok(ops.some((m) => m.id === "agy:claude-sonnet-5-5-medium" && m.proveedor === "google" && m.nombre.includes("por Google")));
  assert.ok(ops.some((m) => m.id === "agy:gpt-oss-120b-medium" && m.proveedor === "google" && m.nombre.includes("por Google")));
  assert.equal(nombreGemini("agy:claude-opus-5-5-high"), "Claude Opus 5.5 (por Google) · high");
  assert.equal(nombreGemini("agy:gpt-oss-120b-medium"), "GPT-OSS 120B (por Google) · medium");
  let b = borradorDe(estado());
  b = elegirWorker(b, "default", "auto");
  assert.equal(b.reparto, "auto");
  assert.equal(configDe(b)!.reparto, "auto");
  b = elegirWorker(b, "default", "");
  assert.equal(b.reparto, undefined);
  assert.equal("reparto" in configDe(b)!, false);
});

const { cruces, nombreModeloValido, porcentaje, TOPE_CLAUDE_DEFECTO, topeEfectivo } = await import("../src/paneles/modelos-borrador.ts");

test("topes de Claude: el borrador los lee, los escribe y deja de estar sucio al volver", () => {
  const e = estado({ claude: { tope_5h: 80, tope_7d: 60 } });
  const b = borradorDe(e);
  assert.equal(b.tope5, "80");
  assert.equal(b.tope7, "60");
  assert.deepEqual(configDe(b)!.claude, { tope_5h: 80, tope_7d: 60 });
  assert.equal(sucio(e, b), false);
  assert.equal(sucio(e, { ...b, tope7: "61" }), true);
  assert.equal(sucio(e, { ...b, tope7: "60" }), false);
  assert.deepEqual(configDe({ ...b, tope5: "" })!.claude, { tope_7d: 60 });
  for (const mal of ["0", "101", "7,5", "mucho", "-3"]) assert.equal(configDe({ ...b, tope5: mal }), null, mal);
});

test("topes de Claude: vacío vale el recomendado, y cruzar es llegar al tope", () => {
  const b = borradorDe(estado({}));
  assert.equal(topeEfectivo(b, "5h"), TOPE_CLAUDE_DEFECTO);
  assert.equal(TOPE_CLAUDE_DEFECTO, 85);
  const uso = { five_hour: { pct: 34 }, seven_day: { pct: 61 } };
  assert.deepEqual(cruces(b, uso), []);
  assert.deepEqual(cruces({ ...b, tope7: "60" }, uso), [{ ventana: "7d", pct: 61, tope: 60 }]);
  assert.deepEqual(cruces({ ...b, tope7: "61" }, uso), [{ ventana: "7d", pct: 61, tope: 61 }]);
  assert.deepEqual(cruces({ ...b, tope5: "30", tope7: "90" }, uso), [{ ventana: "5h", pct: 34, tope: 30 }]);
  // Sin dato no se afirma nada.
  assert.deepEqual(cruces({ ...b, tope5: "1" }, { five_hour: null, seven_day: null }), []);
  assert.deepEqual(cruces({ ...b, tope5: "1" }, null), []);
});

test("bajar un modelo: el nombre y el porcentaje", () => {
  for (const ok of ["llama3.2:3b", "qwen3-coder:30b", "hf.co/usuario/repo:Q4_K_M", " gemma3 "]) assert.equal(nombreModeloValido(ok), true, ok);
  for (const mal of ["", "  ", "-x", "a b", "a;rm", "mi modelo", ".x"]) assert.equal(nombreModeloValido(mal), false, mal);
  assert.equal(porcentaje({ completado: 50, total: 200 }), 25);
  assert.equal(porcentaje({ completado: 0, total: null }), null);
  assert.equal(porcentaje({ completado: null, total: 10 }), null);
  assert.equal(porcentaje({ completado: 999, total: 10 }), 100);
});
