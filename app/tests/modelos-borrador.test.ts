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

const { agregarExcluido, agregarLocal, borradorDe, configDe, cupoDe, efectivoBorrador, elegirEffortLider, elegirLider, elegirWorker, esAutomatico, excluidoDe, EXCLUIR_MAX, modelosPara, nombreGemini, destrabarOn, ponerAutomatico, ponerDestrabar, ponerPermitirMax, quitarExcluido, quitarLocal, sucio, todoEn } = await import("../src/paneles/modelos-borrador.ts");

const estado = (config: Partial<EstadoModelos["config"]> = {}, existe = true): EstadoModelos => ({
  version: 1,
  ruta: "/x/modelos.json",
  existe,
  config: { workers: {}, locales: [], excluir: [], permitir_max: false, gemini: {}, claude: {}, destrabar: {}, ...config },
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

test("Automático: sin la clave vale automático, apagar escribe fijo y los modelos de la tabla se conservan", () => {
  const base = borradorDe(estado({ workers: { debug: { modelo: "claude-opus-5-5", effort: "high" } } }));
  assert.equal(esAutomatico(base), true);
  const fijo = ponerAutomatico(base, false);
  assert.equal(fijo.reparto, "fijo");
  assert.equal(esAutomatico(fijo), false);
  assert.deepEqual(configDe(fijo)!.reparto, "fijo");
  const otra = ponerAutomatico(fijo, true);
  assert.equal(otra.reparto, "auto");
  assert.deepEqual(otra.workers["debug"], { modelo: "claude-opus-5-5", effort: "high" });
  // Sin la clave y con "auto" dicen lo mismo: no es un cambio.
  assert.equal(sucio(estado({ workers: { debug: { modelo: "claude-opus-5-5", effort: "high" } } }), otra), false);
  assert.equal(sucio(estado({}), fijo), true);
  // Un solo modelo para todo es manual: apaga el automático.
  assert.equal(todoEn(base, "claude-opus-5-5").reparto, "fijo");
});

test("modelos que no se usan: normaliza, no repite, tiene tope y quitar los saca", () => {
  let b = borradorDe(estado());
  assert.deepEqual(b.excluir, []);
  b = agregarExcluido(b, " Fable ");
  b = agregarExcluido(b, "fable");
  b = agregarExcluido(b, "claude-opus-5-*");
  assert.deepEqual(b.excluir, ["fable", "claude-opus-5-*"]);
  assert.equal(agregarExcluido(b, "con espacio").excluir.length, 2);
  assert.equal(agregarExcluido(b, "").excluir.length, 2);
  assert.equal(excluidoDe("GPT-OSS"), "gpt-oss");
  assert.deepEqual(configDe(b)!.excluir, ["fable", "claude-opus-5-*"]);
  assert.equal(sucio(estado({}), b), true);
  assert.equal(sucio(estado({ excluir: ["fable", "claude-opus-5-*"] }), b), false);
  assert.deepEqual(quitarExcluido(b, "fable").excluir, ["claude-opus-5-*"]);
  let lleno = borradorDe(estado());
  for (let i = 0; i < EXCLUIR_MAX + 5; i++) lleno = agregarExcluido(lleno, `m${i}`);
  assert.equal(lleno.excluir.length, EXCLUIR_MAX);
});

test("permitir esfuerzo max: apagado de fábrica, se escribe y vuelve a no estar sucio", () => {
  const b = borradorDe(estado());
  assert.equal(b.permitir_max, false);
  const on = ponerPermitirMax(b, true);
  assert.equal(configDe(on)!.permitir_max, true);
  assert.equal(sucio(estado(), on), true);
  assert.equal(sucio(estado({ permitir_max: true }), on), false);
});

test("destrabar: prendido de fábrica sólo en Gemini 3.8 Flash; lo que coincide con la fábrica no se anota", () => {
  const b = borradorDe(estado());
  assert.equal(destrabarOn(b, "gemini-3.8-flash"), true);
  assert.equal(destrabarOn(b, "gemini-3.8-flash-low"), true, "el esfuerzo no cuenta");
  assert.equal(destrabarOn(b, "gemini-4-argon"), false);
  const off = ponerDestrabar(b, "gemini-3.8-flash", false);
  assert.deepEqual(configDe(off)!.destrabar, { "gemini-3.8-flash": false });
  assert.equal(destrabarOn(off, "gemini-3.8-flash-high"), false);
  assert.equal(sucio(estado(), off), true);
  assert.equal(sucio(estado({ destrabar: { "gemini-3.8-flash": false } }), off), false);
  assert.deepEqual(ponerDestrabar(off, "gemini-3.8-flash", true).destrabar, {}, "volver a la fábrica borra la clave");
  const on = ponerDestrabar(b, "gemini-4-argon", true);
  assert.deepEqual(configDe(on)!.destrabar, { "gemini-4-argon": true });
  assert.equal(destrabarOn(on, "gemini-4-argon-high"), true);
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

test("un porcentaje: vacío, número entero de 1 a 100 o inválido (un tope mal escrito no se puede guardar)", () => {
  assert.equal(cupoDe(""), null);
  assert.equal(cupoDe(" 70 "), 70);
  for (const mal of ["0", "101", "7.5", "abc", "-3", "1000"]) assert.equal(cupoDe(mal), "mal");
  const e = estado();
  const b = { ...borradorDe(e), guardar: true, tope5: "500" };
  assert.equal(configDe(b), null);
  assert.equal(sucio(e, b), true);
  const ok = configDe({ ...b, tope5: "70", sin_cupo: "fallar" })!;
  assert.deepEqual(ok.claude, { tope_5h: 70, tope_7d: 85 });
  assert.equal(ok.sin_cupo, "fallar");
});

test("gemini.cupo_max de un archivo viejo se lee pero el borrador ya no lo lleva ni lo escribe", () => {
  const e = estado({ gemini: { cupo_max: 70 } });
  const b = borradorDe(e);
  assert.equal("cupo" in b, false);
  assert.deepEqual(configDe(b)!.gemini, {});
  assert.equal(sucio(e, b), false);
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

test("agy (Claude y GPT por Google) y el \"auto\" viejo de un tipo", async () => {
  const ops = modelosPara([]);
  assert.ok(ops.some((m) => m.id === "agy:claude-opus-5-5-high" && m.proveedor === "google" && m.nombre.includes("por Google")));
  assert.ok(ops.some((m) => m.id === "agy:claude-sonnet-5-5-medium" && m.proveedor === "google" && m.nombre.includes("por Google")));
  assert.ok(ops.some((m) => m.id === "agy:gpt-oss-120b-medium" && m.proveedor === "google" && m.nombre.includes("por Google")));
  assert.equal(nombreGemini("agy:claude-opus-5-5-high"), "Claude Opus 5.5 (por Google) · high");
  assert.equal(nombreGemini("agy:gpt-oss-120b-medium"), "GPT-OSS 120B (por Google) · medium");
  // Un archivo viejo con un tipo en "auto" (lo escribía el selector de antes) se lee como el reparto automático.
  const viejo = borradorDe({ ...estado(), config: (await import("../electron/modelos-tipos.ts")).leerConfig({ workers: { default: { modelo: "auto" } } }) });
  assert.equal(viejo.reparto, "auto");
  assert.equal(viejo.workers["default"], undefined);
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
  assert.equal(b.guardar, true);
  // Con el interruptor prendido, un tope vacío vale el recomendado.
  assert.deepEqual(configDe({ ...b, tope5: "" })!.claude, { tope_5h: 85, tope_7d: 60 });
  for (const mal of ["0", "101", "7,5", "mucho", "-3"]) assert.equal(configDe({ ...b, tope5: mal }), null, mal);
  // Apagado: no hay reserva, y lo escrito en los campos no se valida.
  assert.deepEqual(configDe({ ...b, guardar: false, tope5: "mucho" })!.claude, {});
  assert.equal(sucio(e, { ...b, guardar: false }), true);
  assert.equal(borradorDe(estado({})).guardar, false);
});

test("topes de Claude: vacío vale el recomendado, y cruzar es llegar al tope", () => {
  const b = { ...borradorDe(estado({})), guardar: true };
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
  // Sin el interruptor no hay tope que cruzar.
  assert.deepEqual(cruces({ ...b, guardar: false, tope7: "60" }, uso), []);
});

test("bajar un modelo: el nombre y el porcentaje", () => {
  for (const ok of ["llama3.2:3b", "qwen3-coder:30b", "hf.co/usuario/repo:Q4_K_M", " gemma3 "]) assert.equal(nombreModeloValido(ok), true, ok);
  for (const mal of ["", "  ", "-x", "a b", "a;rm", "mi modelo", ".x"]) assert.equal(nombreModeloValido(mal), false, mal);
  assert.equal(porcentaje({ completado: 50, total: 200 }), 25);
  assert.equal(porcentaje({ completado: 0, total: null }), null);
  assert.equal(porcentaje({ completado: null, total: 10 }), null);
  assert.equal(porcentaje({ completado: 999, total: 10 }), 100);
});

const { avisosTope, GOOGLE_CODIGO, GOOGLE_LLENA } = await import("../src/paneles/cupos-aviso.ts");

test("el aviso de tope dice la ventana y cuándo vuelve; apagado o sin dato no dice nada", () => {
  const b = { ...borradorDe(estado({ claude: { tope_5h: 85, tope_7d: 60 } })) };
  const uso = { five_hour: { pct: 34, resets_at: 1000 }, seven_day: { pct: 92, resets_at: 2000 } };
  assert.deepEqual(avisosTope(b, uso as never), [{ quien: "claude", ventana: "7d", pct: 92, tope: 60, vuelve: 2000 }]);
  assert.deepEqual(avisosTope({ ...b, guardar: false }, uso as never), []);
  assert.deepEqual(avisosTope(b, null), []);
  assert.equal(GOOGLE_LLENA, 97);
  assert.equal(GOOGLE_CODIGO, 70);
});
