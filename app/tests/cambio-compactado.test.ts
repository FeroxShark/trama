// Máquina de estados y soporte de motores para «Compactar y cambiar» (src/hilo/cambio-compactado.ts)
// y extracción de `useCompactar` a src/hilo/compactar.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  debeEsperarInicio,
  destinoAplicar,
  ESPERA_COMPACTAR_S,
  evaluarProgreso,
  REPOSO,
  siguienteCambio,
  soportaCompactar,
  type EstadoCambioCompactado,
} from "../src/hilo/cambio-compactado.ts";
import { ponerConfig } from "../src/hilo/modelos.ts";
import { es } from "../src/i18n/es.ts";
import { en } from "../src/i18n/en.ts";

test("soportaCompactar: Claude oficial y Gemini (agy) sí; Codex, DeepSeek, OpenCode y locales no", () => {
  for (const m of ["claude-opus-5-5", "claude-sonnet-5-5[1m]", "claude-haiku-5-5", "claude-fable-5-1", "gemini-4-argon", "gemini-4-neon", "agy:claude-opus-5-5", "agy:gpt-oss-120b"]) {
    assert.equal(soportaCompactar(m), true, m);
  }
  for (const m of ["codex:gpt-6.1-sol", "dsh:deepseek/deepseek-v4-flash", "dsh:ollama/qwen3", "opencode:opencode/big-pickle", "ollama:qwen3-coder:30b", "", null, undefined]) {
    assert.equal(soportaCompactar(m), false, String(m));
  }
  ponerConfig({
    gemini: true,
    locales: [],
    llama: [{ id: "claude-imitado", nombre: "Local", empresa: "Local" }],
    lider: null,
  });
  try {
    assert.equal(soportaCompactar("claude-imitado"), false, "un modelo marcado local en la tabla nunca soporta /compact");
  } finally {
    ponerConfig(null);
  }
});

test("el destino (modelo y esfuerzo) sobrevive a ocupado y fin de caché, y se aplica al compactar", () => {
  const destino = { modelo: "claude-sonnet-5-5", effort: "low" };
  let estado: EstadoCambioCompactado = REPOSO;
  estado = siguienteCambio(estado, { tipo: "iniciar", destino });
  assert.equal(estado.fase, "compactando");
  assert.deepEqual(estado.destino, destino);
  assert.equal(destinoAplicar(estado), null);

  // `liderMandar` resolvió y el líder pasó a ocupado (en la vista `cambia` se apaga, pero este estado sigue vivo).
  estado = siguienteCambio(estado, { tipo: "enviado" });
  assert.equal(debeEsperarInicio(estado), true);
  assert.deepEqual(estado.destino, destino);

  // Llegó señal de inicio (hook PreCompact o stream status: compacting).
  const evInicio = evaluarProgreso(estado, {
    compactandoAhora: true,
    fines: 2,
    finesBase: 2,
    compactos: 0,
    compactosBase: 0,
    finEstado: null,
    errorTexto: null,
  });
  assert.deepEqual(evInicio, { tipo: "empezo" });
  estado = siguienteCambio(estado, evInicio!);
  assert.equal(debeEsperarInicio(estado), false);

  // Terminó el turno de /compact con hook y compact_boundary.
  const evFin = evaluarProgreso(estado, {
    compactandoAhora: false,
    fines: 3,
    finesBase: 2,
    compactos: 1,
    compactosBase: 0,
    finEstado: "listo",
    errorTexto: null,
  });
  assert.deepEqual(evFin, { tipo: "compacto" });
  estado = siguienteCambio(estado, evFin!);
  assert.equal(estado.fase, "hecho");
  assert.deepEqual(destinoAplicar(estado), destino);
});

test("en Gemini (sin hook, sólo stream) también detecta la compactación y aplica el destino", () => {
  const destino = { modelo: "gemini-4-neon", effort: "medium" };
  let estado = siguienteCambio(REPOSO, { tipo: "iniciar", destino });
  estado = siguienteCambio(estado, { tipo: "enviado" });
  const evInicio = evaluarProgreso(estado, {
    compactandoAhora: true,
    fines: 1,
    finesBase: 1,
    compactos: 0,
    compactosBase: 0,
    finEstado: null,
    errorTexto: null,
  });
  assert.deepEqual(evInicio, { tipo: "empezo" });
  estado = siguienteCambio(estado, evInicio!);

  const evFin = evaluarProgreso(estado, {
    compactandoAhora: false,
    fines: 2,
    finesBase: 1,
    compactos: 1,
    compactosBase: 0,
    finEstado: "listo",
    errorTexto: null,
  });
  assert.deepEqual(evFin, { tipo: "compacto" });
  estado = siguienteCambio(estado, evFin!);
  assert.deepEqual(destinoAplicar(estado), destino);
});

test("error al mandar o durante la compactación: guarda el motivo y no cambia el modelo", () => {
  const destino = { modelo: "claude-haiku-5-5", effort: "medium" };
  let estado = siguienteCambio(REPOSO, { tipo: "iniciar", destino });
  estado = siguienteCambio(estado, { tipo: "fallo", motivo: "rate limit" });
  assert.equal(estado.fase, "error");
  assert.equal(estado.motivo, "rate limit");
  assert.equal(destinoAplicar(estado), null);

  // Error en medio del turno después de haber empezado.
  let enTurno = siguienteCambio(REPOSO, { tipo: "iniciar", destino });
  enTurno = siguienteCambio(enTurno, { tipo: "enviado" });
  enTurno = siguienteCambio(enTurno, { tipo: "empezo" });
  const evErr = evaluarProgreso(enTurno, {
    compactandoAhora: false,
    fines: 2,
    finesBase: 1,
    compactos: 0,
    compactosBase: 0,
    finEstado: "error",
    errorTexto: "API overloaded",
  });
  assert.deepEqual(evErr, { tipo: "fallo", motivo: "API overloaded" });
  enTurno = siguienteCambio(enTurno, evErr!);
  assert.equal(enTurno.fase, "error");
  assert.equal(destinoAplicar(enTurno), null);

  // Si terminó sin compactar (p. ej. conversación vacía o parado a mano), falla y no cambia.
  const sinCompactar = siguienteCambio(siguienteCambio(REPOSO, { tipo: "iniciar", destino }), { tipo: "enviado" });
  const evNada = evaluarProgreso(sinCompactar, {
    compactandoAhora: false,
    fines: 2,
    finesBase: 1,
    compactos: 0,
    compactosBase: 0,
    finEstado: "listo",
    errorTexto: null,
  });
  assert.deepEqual(evNada, { tipo: "fallo", motivo: "" });
});

test("tiempo límite (mock.timers): vence si no empieza a compactar; si ya empezó, no vence", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const destino = { modelo: "claude-sonnet-5-5", effort: "high" };

  let estado = siguienteCambio(REPOSO, { tipo: "iniciar", destino });
  // Mientras `enviando` es true, todavía no corre la espera y un `vencio` se ignora.
  assert.equal(debeEsperarInicio(estado), false);
  assert.equal(siguienteCambio(estado, { tipo: "vencio" }).fase, "compactando");

  estado = siguienteCambio(estado, { tipo: "enviado" });
  assert.equal(debeEsperarInicio(estado), true);

  let disparo = false;
  const id = setTimeout(() => {
    disparo = true;
    estado = siguienteCambio(estado, { tipo: "vencio" });
  }, ESPERA_COMPACTAR_S * 1000);

  t.mock.timers.tick(ESPERA_COMPACTAR_S * 1000 - 1);
  assert.equal(disparo, false);
  assert.equal(estado.fase, "compactando");

  t.mock.timers.tick(1);
  clearTimeout(id);
  assert.equal(disparo, true);
  assert.equal(estado.fase, "vencido");
  assert.equal(destinoAplicar(estado), null);

  // Si ya empezó a compactar antes del límite, un `vencio` tardío tampoco corta ni cambia el destino.
  let empezado = siguienteCambio(siguienteCambio(REPOSO, { tipo: "iniciar", destino }), { tipo: "enviado" });
  empezado = siguienteCambio(empezado, { tipo: "empezo" });
  assert.equal(debeEsperarInicio(empezado), false);
  assert.equal(siguienteCambio(empezado, { tipo: "vencio" }).fase, "compactando");
});

test("la caja del líder queda de sólo lectura mientras espera el envío tras compactar", () => {
  const lider = readFileSync(path.join(import.meta.dirname, "..", "src", "hilo", "Lider.tsx"), "utf8");
  assert.match(lider, /const compactoCacheActivo = !!compactoCache && !compactoCache\.restaurado/);
  assert.match(lider, /const cajaSoloLectura = enviando \|\| compactoCacheActivo/);
  assert.match(lider, /<textarea\b[^>]*readOnly=\{cajaSoloLectura\}/);
  assert.match(lider, /if \(leerBorrador\(clave\)\.texto === pend\.crudo\) enviar\(pend\.crudo/);
  const salir = lider.slice(lider.indexOf("const salir ="), lider.indexOf("fuente.liderMandar(l.id, empezar"));
  assert.match(salir, /if \(leerBorrador\(clave\)\.texto === crudo\) \{\s+setTexto\(""\)/);
});

test("useCompactar vive en compactar.ts y las claves i18n nuevas existen en es y en", () => {
  const ctx = readFileSync(path.join(import.meta.dirname, "..", "src", "paneles", "PanelContexto.tsx"), "utf8");
  const lider = readFileSync(path.join(import.meta.dirname, "..", "src", "hilo", "Lider.tsx"), "utf8");
  assert.match(ctx, /from "\.\.\/hilo\/compactar"/);
  assert.doesNotMatch(ctx, /function useCompactar/);
  assert.match(lider, /from "\.\/cambio-compactado"/);
  assert.match(lider, /soportaCompactar/);
  for (const k of ["aviso.volver", "aviso.compactarYCambiar", "aviso.compactandoCambio", "aviso.compactadoCambio", "aviso.compactarVencido", "aviso.compactarDetenido"] as const) {
    assert.ok(k in es && es[k].trim(), `es:${k}`);
    assert.ok(k in en && en[k].trim(), `en:${k}`);
  }
});
