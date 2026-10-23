// "Mandar a verificar y arreglar" (B25): el prompt del líder nuevo (src/datos/arreglar.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promptArreglar, type DatosArreglar } from "../src/datos/arreglar.ts";

const base: DatosArreglar = {
  id: "20261003-100700-99999",
  proyecto: "Atlas Web",
  ruta: "/tmp/atlas",
  rama: "pa/atlas/20261003-100700-99999",
  head_antes: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  head_despues: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  commits: ["abc1234 paginado por cursor", "def5678 tests del cursor"],
  tope: 30,
  motivo: "tests",
  tests: "npm test",
  cola: "not ok 3 - paginar\n# fail 1",
  rc: 1,
};

test("lleva el id, la rama, el rango de commits y la cola de los tests", () => {
  const p = promptArreglar(base);
  for (const x of [
    "- Integración: 20261003-100700-99999",
    "`pa --hilo 20261003-100700-99999 --json`",
    "- Rama: pa/atlas/20261003-100700-99999",
    "- Commits que entraron a main: aaaaaaaaaaaa..bbbbbbbbbbbb",
    "- Commits (2):",
    "  - abc1234 paginado por cursor",
    "Atlas Web (/tmp/atlas)",
    "los tests del proyecto dan rojo en main",
    "(rc 1):",
    "```\nnot ok 3 - paginar\n# fail 1\n```",
    "`npm test`",
  ])
    assert.ok(p.includes(x), x);
});

test("pide encontrar qué se rompió, arreglarlo con un worker de pa o revertir, y contarlo corto en español", () => {
  const p = promptArreglar(base);
  assert.ok(p.includes("git -C /tmp/atlas log -p aaaaaaaaaaaa..bbbbbbbbbbbb"));
  assert.ok(p.includes('`pa "Atlas Web" "<qué arreglar y por qué>"`'));
  assert.ok(p.includes('`pa "Atlas Web" --integrar <id> --tests`'));
  assert.ok(p.includes("`pa --revertir 20261003-100700-99999`"));
  assert.match(p, /peor que deshacerlo/);
  assert.match(p, /en español y corto/);
  assert.ok(p.indexOf("Encontrá qué se rompió") < p.indexOf("--revertir 2026"));
});

test("revertida o bien=no, sin cola ni heads ni tests: lo dice igual", () => {
  const p = promptArreglar({ ...base, motivo: "revertida", cola: null, rc: null, head_antes: null, head_despues: null, commits: null, tests: null, proyecto: "atlas" });
  assert.ok(p.includes("se integró y después se revirtió"));
  assert.ok(p.includes("(pa no los anotó; buscalos con git log)"));
  assert.ok(!p.includes("```"));
  assert.ok(p.includes("`pa atlas --integrar <id>`"));
  assert.ok(promptArreglar({ ...base, motivo: "bien_no" }).includes("bien=no"));
});

test("con muchos commits, sólo el tope", () => {
  const muchos = Array.from({ length: 35 }, (_, i) => `c${i} cosa`);
  const p = promptArreglar({ ...base, commits: muchos });
  assert.ok(p.includes("- Commits (más de 30):"));
  assert.ok(!p.includes("c30 cosa"));
});

test("sin ruta, git sin -C (nunca un comando roto)", () => {
  const p = promptArreglar({ ...base, ruta: null, proyecto: "atlas" });
  assert.ok(!p.includes("git -C"));
  assert.ok(p.includes("log -p ") && p.includes(" en la carpeta de atlas)"));
});
