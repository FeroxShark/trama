// Adivinación de lenguaje en bloques de código sin etiqueta (src/hilo/resaltar.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { adivinarLenguaje, resaltar, type Clase } from "../src/hilo/resaltar.ts";

const clases = (codigo: string, lang = ""): Clase[] =>
  resaltar(codigo, lang)
    .filter((x) => x.c !== "")
    .map((x) => x.c);

test("adivinarLenguaje: JSON (objeto o arreglo válido) → json", () => {
  assert.equal(adivinarLenguaje('{"nombre": "trama", "activo": true, "n": 3}'), "json");
  assert.equal(adivinarLenguaje('  [\n  { "id": 1 },\n  { "id": 2 }\n]  '), "json");
  // Lo que empieza con { o [ pero no es JSON válido no se adivina como json.
  assert.equal(adivinarLenguaje("{ a: 1 }"), null);
  assert.equal(adivinarLenguaje("[seccion]\nclave = valor"), null);
  assert.ok(clases('{"a": 1, "ok": true}').includes("fn"));
  assert.ok(clases('{"a": 1, "ok": true}').includes("kw"));
});

test("adivinarLenguaje: bash con sudo, otros comandos conocidos, pipe o && → bash", () => {
  assert.equal(adivinarLenguaje("sudo systemctl restart trama"), "bash");
  assert.equal(adivinarLenguaje("$ npm test -- --grep orden"), "bash");
  assert.equal(adivinarLenguaje("  cd app\n  git status"), "bash");
  assert.equal(adivinarLenguaje("npx tsc --noEmit"), "bash");
  assert.equal(adivinarLenguaje("pa trama --estado"), "bash");
  assert.equal(adivinarLenguaje("ls -la\ngrep -rn foo src\ncat package.json"), "bash");
  assert.equal(adivinarLenguaje("pacman -Qi electron\nparu -S foo\ncurl -s https://example.com"), "bash");
  assert.equal(adivinarLenguaje("echo hola | head -n 1"), "bash");
  assert.equal(adivinarLenguaje("mkdir build && cd build"), "bash");
  assert.ok(clases("sudo pacman -Syu").includes("fn"));
  // Una tabla markdown o un "||" no son tuberías de bash.
  assert.equal(adivinarLenguaje("| col1 | col2 |\n| 1 | 2 |"), null);
  assert.equal(adivinarLenguaje("a || b"), null);
});

test("adivinarLenguaje: diff con +, -, @@ o cabeceras → diff", () => {
  assert.equal(adivinarLenguaje("--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-viejo\n+nuevo"), "diff");
  assert.equal(adivinarLenguaje("@@ -10,2 +10,3 @@\n igual\n+agregado"), "diff");
  assert.equal(adivinarLenguaje("-const a = 1;\n+const a = 2;"), "diff");
  // Un diff de un script de bash sigue siendo diff, no bash.
  assert.equal(adivinarLenguaje("--- a/run.sh\n+++ b/run.sh\n@@ -1 +1 @@\n-npm test\n+sudo make\n git status"), "diff");
  assert.deepEqual(
    resaltar("-viejo\n+nuevo", "").map((x) => x.c),
    ["menos", "mas"],
  );
  // Una lista con guiones suelta no es diff.
  assert.equal(adivinarLenguaje("- primer punto\n- segundo punto"), null);
});

test("adivinarLenguaje: texto común o vacío → null, y no pisa un lenguaje explícito", () => {
  assert.equal(adivinarLenguaje(""), null);
  assert.equal(adivinarLenguaje("   \n  "), null);
  assert.equal(adivinarLenguaje("Hola mundo, esto es texto común."), null);
  assert.equal(adivinarLenguaje("para tener en cuenta:\n$HOME/archivo"), null);
  assert.deepEqual(resaltar("Texto común sin lenguaje", ""), [{ c: "", t: "Texto común sin lenguaje" }]);
  assert.deepEqual(resaltar('{"a": 1}', "nada"), [{ c: "", t: '{"a": 1}' }]);
});
