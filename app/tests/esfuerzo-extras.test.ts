// Lo puro del esfuerzo con deslizador, Ultracode y Fast (electron/esfuerzo-extras.ts) y lo que se le dice a `claude` (lider-arma.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acumularRueda,
  ajustesExtras,
  argvFast,
  cabeceraEsfuerzo,
  colorNivel,
  esClaudeOficial,
  fraccion,
  indiceDe,
  indiceDesdeX,
  moverNivel,
  nivelBonito,
  nivelEn,
  nivelPorPasos,
  RAMPA,
  soportaFast,
  ultracodeEnVigor,
} from "../electron/esfuerzo-extras.ts";
import { argvLider, escribirGuardados, leerGuardados, lineaAjustes, lineaAjustesVigentes, parsearLinea, type Guardado } from "../electron/lider-arma.ts";

const CINCO = ["low", "medium", "high", "xhigh", "max"];
const SID = "36ac312b-6241-4230-b3b3-c3decacc39c0";

test("nivel ↔ posición: lugar en la lista del modelo, fracción del carril y el punto más cercano a un clic", () => {
  assert.equal(indiceDe(CINCO, "high"), 2);
  // Un nivel que el modelo no tiene (lista de otro modelo) cae al primero, nunca a -1.
  assert.equal(indiceDe(CINCO, "ultra"), 0);
  assert.equal(nivelEn(CINCO, 3), "xhigh");
  assert.equal(nivelEn(CINCO, 99), "max");
  assert.equal(nivelEn(CINCO, -4), "low");
  assert.equal(nivelEn([], 0), "");
  assert.equal(fraccion(5, 0), 0);
  assert.equal(fraccion(5, 2), 0.5);
  assert.equal(fraccion(5, 4), 1);
  // Con un solo nivel no hay carril que recorrer.
  assert.equal(fraccion(1, 0), 0);
  assert.equal(fraccion(0, 0), 0);
  // Un carril de 200 px con 5 niveles: un punto cada 50 px.
  assert.equal(indiceDesdeX(5, 0, 200), 0);
  assert.equal(indiceDesdeX(5, 74, 200), 1);
  assert.equal(indiceDesdeX(5, 76, 200), 2);
  assert.equal(indiceDesdeX(5, 200, 200), 4);
  // Fuera del carril se sujeta a los extremos.
  assert.equal(indiceDesdeX(5, -30, 200), 0);
  assert.equal(indiceDesdeX(5, 900, 200), 4);
  assert.equal(indiceDesdeX(1, 50, 200), 0);
  assert.equal(indiceDesdeX(5, 50, 0), 0);
});

test("teclado del deslizador: flechas, Inicio y Fin; en los extremos no hay cambio", () => {
  assert.equal(moverNivel(CINCO, "high", "ArrowRight"), "xhigh");
  assert.equal(moverNivel(CINCO, "high", "ArrowUp"), "xhigh");
  assert.equal(moverNivel(CINCO, "high", "ArrowLeft"), "medium");
  assert.equal(moverNivel(CINCO, "high", "ArrowDown"), "medium");
  assert.equal(moverNivel(CINCO, "high", "Home"), "low");
  assert.equal(moverNivel(CINCO, "high", "End"), "max");
  assert.equal(moverNivel(CINCO, "max", "ArrowRight"), null);
  assert.equal(moverNivel(CINCO, "low", "ArrowLeft"), null);
  assert.equal(moverNivel(CINCO, "low", "Home"), null);
  assert.equal(moverNivel(CINCO, "high", "Tab"), null);
  assert.equal(moverNivel(["max"], "max", "End"), null);
});

test("rueda: hacia arriba sube, hacia abajo baja; un trackpad se acumula y no dispara un cambio por píxel", () => {
  assert.deepEqual(acumularRueda(0, -100), { pasos: 1, resto: -40 });
  assert.deepEqual(acumularRueda(0, 100), { pasos: -1, resto: 40 });
  assert.deepEqual(acumularRueda(0, -20), { pasos: 0, resto: -20 });
  // Lo que sobró se suma al pedacito siguiente.
  const a = acumularRueda(0, -40);
  const b = acumularRueda(a.resto, -40);
  assert.equal(a.pasos, 0);
  assert.equal(b.pasos, 1);
  assert.equal(b.resto, -20);
  assert.deepEqual(acumularRueda(0, -250), { pasos: 4, resto: -10 });
  assert.equal(nivelPorPasos(CINCO, "medium", 1), "high");
  assert.equal(nivelPorPasos(CINCO, "medium", -1), "low");
  assert.equal(nivelPorPasos(CINCO, "medium", 9), "max");
  assert.equal(nivelPorPasos(CINCO, "max", 1), null);
  assert.equal(nivelPorPasos(CINCO, "low", -1), null);
  assert.equal(nivelPorPasos(CINCO, "low", 0), null);
});

test("color por nivel: de frío a caliente con tokens que ya existen; el mismo nivel, el mismo color en todos los modelos", () => {
  assert.deepEqual(
    CINCO.map((n) => colorNivel(CINCO, n)),
    RAMPA.map((t) => `var(${t})`),
  );
  // Un modelo de tres niveles: «high» sigue siendo el de «high» (no se reparte la rampa de nuevo).
  assert.equal(colorNivel(["low", "medium", "high"], "high"), colorNivel(CINCO, "high"));
  assert.equal(colorNivel(["off", "low", "high"], "off"), "var(--inactivo)");
  // Un nivel que Claude no conoce (de otro motor) cae por su lugar en la lista.
  assert.equal(colorNivel(["a", "b", "c"], "a"), `var(${RAMPA[0]})`);
  assert.equal(colorNivel(["a", "b", "c"], "c"), `var(${RAMPA[4]})`);
  assert.equal(colorNivel(["solo"], "solo"), `var(${RAMPA[0]})`);
  // Sólo tokens de tokens.css: nada de colores sueltos.
  for (const t of RAMPA) assert.match(t, /^--[a-z-]+$/);
});

test("cabecera: «Modelo · Nivel», y Ultracode y Fast prendidos se dicen con palabras", () => {
  const palabras = { ultracode: "Ultracode", fast: "Fast" };
  assert.equal(nivelBonito("high"), "High");
  assert.equal(nivelBonito(""), "");
  assert.equal(cabeceraEsfuerzo({ modelo: "Opus 5.5", nivel: "high", palabras }), "Opus 5.5 · High");
  assert.equal(cabeceraEsfuerzo({ modelo: "Opus 5.5", nivel: "xhigh", fast: true, palabras }), "Opus 5.5 · Xhigh · Fast");
  assert.equal(cabeceraEsfuerzo({ modelo: "Opus 5.5", nivel: "max", ultracode: true, fast: true, palabras }), "Opus 5.5 · Max · Ultracode · Fast");
});

test("Ultracode y Fast: sólo modelos oficiales de Anthropic; Fast, sólo Opus y Fable", () => {
  assert.equal(esClaudeOficial("claude-opus-5-5"), true);
  assert.equal(esClaudeOficial("claude-haiku-5-5"), true);
  assert.equal(esClaudeOficial("ollama:qwen3"), false);
  assert.equal(esClaudeOficial("gemini-4-argon"), false);
  assert.equal(esClaudeOficial(null), false);
  assert.equal(soportaFast("claude-opus-5-5"), true);
  assert.equal(soportaFast("claude-fable-5-2"), true);
  assert.equal(soportaFast("claude-sonnet-5-5"), false);
  assert.equal(soportaFast("claude-haiku-5-5"), false);
  assert.equal(soportaFast("dsh:deepseek/x"), false);
});

test("arranque: Fast va en el argv (--fast-mode on) sólo con un modelo que lo sirva; Ultracode nunca (va por apply_flag_settings tras el arranque)", () => {
  assert.deepEqual(argvFast("claude-opus-5-5", true), ["--fast-mode", "on"]);
  assert.deepEqual(argvFast("claude-sonnet-5-5", true), []);
  assert.deepEqual(argvFast("claude-opus-5-5", false), []);
  assert.deepEqual(argvFast("claude-opus-5-5", undefined), []);
  const con = argvLider({ modelo: "claude-opus-5-5", effort: "high", sid: SID, nombre: "trama-0a1b", resume: false, fast: true });
  assert.ok(con.join(" ").includes("--fast-mode on"));
  assert.ok(!con.includes("--settings"));
  const sin = argvLider({ modelo: "claude-opus-5-5", effort: "high", sid: SID, nombre: "trama-0a1b", resume: false });
  assert.ok(!sin.includes("--fast-mode"));
  // Un local o uno de Ollama nunca lleva Fast.
  const ollama = argvLider({ modelo: "claude-opus-5-5", effort: "high", sid: SID, nombre: "trama-0a1b", resume: false, fast: true, ollama: { url: "http://127.0.0.1:11434", modelo: "qwen3" } });
  assert.ok(!ollama.includes("--fast-mode"));
  // Retomado: lo mismo, junto a --resume.
  const retomado = argvLider({ modelo: "claude-fable-5-2", effort: "max", sid: SID, nombre: "trama-0a1b", resume: true, fast: true });
  assert.ok(retomado.join(" ").includes("--fast-mode on --resume"));
});

test("líneas de control: apply_flag_settings con ultracode y fastMode, y get_settings para ver si quedó en vigor", () => {
  assert.deepEqual(ajustesExtras({ ultracode: true }), { ultracode: true });
  assert.deepEqual(ajustesExtras({ fast: false }), { fastMode: false });
  assert.deepEqual(ajustesExtras({ ultracode: false, fast: true }), { ultracode: false, fastMode: true });
  assert.deepEqual(ajustesExtras({}), {});
  assert.deepEqual(JSON.parse(lineaAjustes("c1", { ultracode: true })), {
    type: "control_request",
    request_id: "c1",
    request: { subtype: "apply_flag_settings", settings: { ultracode: true } },
  });
  assert.deepEqual(JSON.parse(lineaAjustes("c2", { fast: true })).request.settings, { fastMode: true });
  assert.deepEqual(JSON.parse(lineaAjustesVigentes("c3")), { type: "control_request", request_id: "c3", request: { subtype: "get_settings" } });
});

test("get_settings: se lee si Ultracode quedó en vigor (applied.ultracode); sin el dato (versión vieja) no se afirma nada", () => {
  assert.equal(ultracodeEnVigor({ applied: { ultracode: true, ultracodeRequested: true } }), true);
  assert.equal(ultracodeEnVigor({ applied: { ultracode: false, ultracodeRequested: true, ultracodeAvailable: false } }), false);
  assert.equal(ultracodeEnVigor({ applied: {} }), null);
  assert.equal(ultracodeEnVigor({}), null);
  assert.equal(ultracodeEnVigor(null), null);
  const resp = (applied: unknown) => JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "c3", response: { applied } } });
  assert.deepEqual(parsearLinea(resp({ ultracode: true })), [{ tipo: "control", id: "c3", ok: true, ultracode: true }]);
  assert.deepEqual(parsearLinea(resp({ ultracode: false })), [{ tipo: "control", id: "c3", ok: true, ultracode: false }]);
  // Un success sin `applied` (apply_flag_settings) no trae el dato.
  assert.deepEqual(parsearLinea(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: "c1" } })), [{ tipo: "control", id: "c1", ok: true }]);
});

test("lideres.json: Ultracode y Fast se guardan y se leen; los de antes (sin esos campos) siguen valiendo", () => {
  const g: Guardado = { sid: SID, nombre: "trama-0a1b", modelo: "claude-opus-5-5", effort: "high", creado: 10, ultimo: 20, cache_ttl_s: 3600, modo: "plan" };
  const con: Guardado = { ...g, ultracode: true, fast: true };
  assert.deepEqual(leerGuardados(escribirGuardados([con])), [con]);
  assert.deepEqual(leerGuardados(escribirGuardados([g])), [g]);
  // Sólo `true` cuenta: un valor raro se descarta (apagado).
  assert.deepEqual(leerGuardados(JSON.stringify({ version: 1, lideres: [{ ...g, ultracode: "si", fast: 1 }] })), [g]);
});
