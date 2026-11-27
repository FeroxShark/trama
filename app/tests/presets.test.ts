import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  apagadasPorPreset,
  archivoPresets,
  estadoPresets,
  guardarPresets,
  leerPresets,
  modoPresetValido,
  nombrePresetValido,
  normalizarPresets,
  presetHabilitaSkills,
  presetsFabrica,
  PRESETS_NOMBRES_FABRICA,
  resolverPreset,
  skillPresetValida,
} from "../electron/presets.ts";

const carpeta = () => mkdtempSync(path.join(os.tmpdir(), "presets-"));

const instaladas = [
  { clave: "ui-ux-pro-max", nombre: "ui-ux-pro-max" },
  { clave: "frontend-design:frontend-design", nombre: "frontend-design" },
  { clave: "docs-xlsx", nombre: "docs-xlsx" },
  { clave: "trama-orquestar", nombre: "trama-orquestar" },
];

test("defaults de fábrica: nombres, modos y mapeo por tipo", () => {
  const f = presetsFabrica();
  assert.deepEqual(Object.keys(f.presets).sort(), [...PRESETS_NOMBRES_FABRICA].sort());
  assert.deepEqual(f.presets.minimo, { modo: "solo", skills: [] });
  assert.equal(f.presets.codigo.modo, "apagar");
  assert.ok(f.presets.codigo.skills.includes("trama-orquestar"));
  assert.equal(f.presets.diseno.modo, "solo");
  assert.deepEqual(f.presets.orquestador.skills, ["trama-orquestar"]);
  assert.equal(f.presets.todo.modo, "todo");
  assert.equal(f.por_tipo.mecanico, "minimo");
  assert.equal(f.por_tipo.lectura, "minimo");
  assert.equal(f.por_tipo["codigo-multi"], "codigo");
  assert.equal(f.por_tipo.frontend, "diseno");
  // Cada llamada devuelve una copia: mutar una no toca la siguiente.
  f.presets.minimo.skills.push("x");
  assert.deepEqual(presetsFabrica().presets.minimo.skills, []);
});

test("resolverPreset: infiere por --tipo, por --leer y cae en default", () => {
  const cfg = presetsFabrica();
  assert.equal(resolverPreset(cfg, { tipo: "mecanico" })?.nombre, "minimo");
  assert.equal(resolverPreset(cfg, { tipo: "codigo-acotado" })?.nombre, "codigo");
  assert.equal(resolverPreset(cfg, { tipo: "frontend" })?.nombre, "diseno");
  assert.equal(resolverPreset(cfg, { leer: true })?.nombre, "minimo");
  assert.equal(resolverPreset(cfg, { tipo: "tipo-inventado" })?.nombre, "codigo");
  assert.equal(resolverPreset(cfg, {})?.nombre, "codigo");
  // Con tipo explícito, --leer no lo pisa.
  assert.equal(resolverPreset(cfg, { tipo: "debug", leer: true })?.nombre, "codigo");
});

test("resolverPreset: --preset explícito gana o devuelve null si no existe", () => {
  const cfg = presetsFabrica();
  const r = resolverPreset(cfg, { preset: "todo", tipo: "mecanico" });
  assert.equal(r?.nombre, "todo");
  assert.equal(r?.preset.modo, "todo");
  assert.equal(resolverPreset(cfg, { preset: "no-existe", tipo: "mecanico" }), null);
});

test("apagadasPorPreset en modo todo: sólo las globales", () => {
  const p = presetsFabrica().presets.todo;
  assert.deepEqual(apagadasPorPreset(instaladas, p, ["docs-xlsx"]), ["docs-xlsx"]);
  assert.deepEqual(apagadasPorPreset(instaladas, null, []), []);
});

test("apagadasPorPreset en modo apagar: agrega las del preset por clave o nombre", () => {
  const p = { modo: "apagar" as const, skills: ["ui-ux-pro-max", "frontend-design"] };
  const r = apagadasPorPreset(instaladas, p, ["docs-xlsx"]);
  assert.deepEqual(r.sort(), ["docs-xlsx", "frontend-design:frontend-design", "ui-ux-pro-max"]);
});

test("apagadasPorPreset en modo solo: apaga todo lo que no figura, y las globales siempre", () => {
  const p = { modo: "solo" as const, skills: ["ui-ux-pro-max"] };
  // La global es docs-xlsx, que el preset no lista: igual queda apagada.
  const r = apagadasPorPreset(instaladas, p, ["docs-xlsx"]);
  assert.deepEqual(r.sort(), ["docs-xlsx", "frontend-design:frontend-design", "trama-orquestar"]);
  // Una global apagada que el preset sí lista sigue apagada.
  const r2 = apagadasPorPreset(instaladas, { modo: "solo", skills: ["ui-ux-pro-max"] }, ["ui-ux-pro-max"]);
  assert.ok(r2.includes("ui-ux-pro-max"));
});

test("presetHabilitaSkills", () => {
  // solo sin skills: no carga ninguna.
  assert.equal(presetHabilitaSkills(instaladas, { modo: "solo", skills: [] }, []), false);
  // solo que deja al menos una cargada.
  assert.equal(presetHabilitaSkills(instaladas, { modo: "solo", skills: ["ui-ux-pro-max"] }, []), true);
  // solo donde todas las que quedan están apagadas por el global.
  assert.equal(presetHabilitaSkills(instaladas, { modo: "solo", skills: ["ui-ux-pro-max"] }, ["ui-ux-pro-max", "frontend-design:frontend-design", "docs-xlsx", "trama-orquestar"]), false);
  // apagar que apaga todas las instaladas.
  const todas = instaladas.map((s) => s.clave);
  assert.equal(presetHabilitaSkills(instaladas, { modo: "apagar", skills: todas }, []), false);
  // todo siempre habilita (si hay algo instalado y nada global lo apaga).
  assert.equal(presetHabilitaSkills(instaladas, { modo: "todo", skills: [] }, []), true);
});

test("validadores de nombre, modo y skill", () => {
  assert.equal(nombrePresetValido("codigo-2"), true);
  assert.equal(nombrePresetValido("con espacio"), false);
  assert.equal(nombrePresetValido(""), false);
  assert.equal(nombrePresetValido(42), false);
  assert.equal(modoPresetValido("apagar"), true);
  assert.equal(modoPresetValido("nunca"), false);
  assert.equal(skillPresetValida("plugin:skill"), true);
  assert.equal(skillPresetValida("con espacio"), false);
  assert.equal(skillPresetValida("ctrl\u0001"), false);
  assert.equal(skillPresetValida(null), false);
});

test("normalizarPresets descarta basura sin romper y conserva los defaults", () => {
  const cfg = normalizarPresets({
    presets: {
      "mio": { modo: "solo", skills: ["a", "a", 7, "con espacio", "b"] },
      "mal modo": { modo: "raro", skills: ["x"] },
      "sin-modo": { skills: ["x"] },
      "codigo": "no es objeto",
      "": { modo: "todo", skills: [] },
      "lista-rota": { modo: "apagar", skills: "no-es-lista" },
    },
    por_tipo: {
      "frontend": "mio",
      "debug": "no-existe",
      "bad tipo": "mio",
      "final": 3,
      "mecanico": "todo",
    },
  });
  assert.deepEqual(cfg.presets.mio, { modo: "solo", skills: ["a", "b"] });
  assert.equal("mal modo" in cfg.presets, false);
  assert.equal("sin-modo" in cfg.presets, false);
  assert.equal("" in cfg.presets, false);
  assert.deepEqual(cfg.presets["lista-rota"], { modo: "apagar", skills: [] });
  // Un preset de fábrica inválido vuelve a su valor de fábrica.
  assert.equal(cfg.presets.codigo.modo, "apagar");
  assert.equal(cfg.por_tipo.frontend, "mio");
  assert.equal(cfg.por_tipo.debug, "codigo");
  assert.equal(cfg.por_tipo["bad tipo"], undefined);
  assert.equal(cfg.por_tipo.final, "codigo");
  assert.equal(cfg.por_tipo.mecanico, "todo");
});

test("normalizarPresets con basura total devuelve los defaults", () => {
  for (const x of [null, undefined, 5, "texto", [], { presets: 1, por_tipo: [] }]) {
    assert.deepEqual(normalizarPresets(x), presetsFabrica());
  }
});

test("leer sin archivo o con JSON roto devuelve los defaults", () => {
  const dir = carpeta();
  assert.deepEqual(leerPresets(dir), presetsFabrica());
  assert.equal((estadoPresets(dir)).existe, false);
  writeFileSync(archivoPresets(dir), "{ roto");
  assert.deepEqual(leerPresets(dir), presetsFabrica());
});

test("guardarPresets escribe atómico, normaliza y se vuelve a leer igual", () => {
  const dir = carpeta();
  const estado = guardarPresets({ presets: { mio: { modo: "apagar", skills: ["ui-ux-pro-max", "ui-ux-pro-max"] } }, por_tipo: { debug: "mio" } }, dir);
  assert.equal(estado.existe, true);
  assert.equal(estado.ruta, archivoPresets(dir));
  assert.deepEqual(estado.config.presets.mio, { modo: "apagar", skills: ["ui-ux-pro-max"] });
  assert.equal(estado.config.por_tipo.debug, "mio");
  // Sin restos del temporal.
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  // Lo escrito es JSON válido y se relee igual.
  const enDisco = JSON.parse(readFileSync(archivoPresets(dir), "utf8"));
  assert.deepEqual(enDisco, estado.config);
  assert.deepEqual(leerPresets(dir), estado.config);
  assert.equal(estadoPresets(dir).existe, true);
});

test("guardarPresets rechaza lo que no es objeto", () => {
  const dir = carpeta();
  assert.throws(() => guardarPresets(null, dir));
  assert.throws(() => guardarPresets([1, 2], dir));
  assert.throws(() => guardarPresets("texto", dir));
  assert.equal(estadoPresets(dir).existe, false);
});
