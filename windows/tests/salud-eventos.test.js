"use strict";
// salud-eventos.js: la carcasa anota la vuelta de versión en el mismo archivo y formato que lee `salud:eventos` (app/electron/salud-eventos.ts).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { anotar, archivoSalud, MAX_EVENTOS } = require("../src/salud-eventos");

const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), "trama-salud-"));

test("anota una línea JSON {t, tipo, ...datos} y crea la carpeta que falte", () => {
  const f = path.join(carpeta(), "no", "hay", "salud-eventos.jsonl");
  anotar(f, { tipo: "vuelta-version", version: "0.2.0", motivo: "no-arranco" }, { t: 5 });
  assert.deepEqual(fs.readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l)), [{ t: 5, tipo: "vuelta-version", version: "0.2.0", motivo: "no-arranco" }]);
});

test("deja sólo las últimas MAX_EVENTOS y no se pega con una línea cortada", () => {
  const f = path.join(carpeta(), "s.jsonl");
  fs.writeFileSync(f, `${'{"t":1,"tipo":"x"}\n'.repeat(MAX_EVENTOS)}{"t":2,"ti`);
  anotar(f, { tipo: "vuelta-version" }, { t: 9 });
  const l = fs.readFileSync(f, "utf8").trim().split("\n");
  assert.equal(l.length, MAX_EVENTOS);
  assert.equal(JSON.parse(l.at(-1)).t, 9);
});

test("nunca tira: una carpeta imposible se ignora", () => {
  const f = path.join(carpeta(), "archivo");
  fs.writeFileSync(f, "x");
  assert.doesNotThrow(() => anotar(path.join(f, "dentro", "s.jsonl"), { tipo: "vuelta-version" }));
});

test("la ruta es la del estado del motor, junto a `dueno`", () => {
  const r = { dueno: "C:\\Users\\a\\AppData\\Local\\trama\\estado\\hilos\\dueno" };
  assert.equal(archivoSalud(r), "C:\\Users\\a\\AppData\\Local\\trama\\estado\\hilos\\salud-eventos.jsonl");
});
