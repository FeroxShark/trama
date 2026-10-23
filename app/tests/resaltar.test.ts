// El resaltado de los bloques de código (src/hilo/resaltar.ts): pegados, los pedazos
// dan el código tal cual; y de cada lenguaje, lo que ayuda a seguirlo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lenguaje, resaltar, type Clase } from "../src/hilo/resaltar.ts";

const de = (codigo: string, lang: string, c: Clase) =>
  resaltar(codigo, lang)
    .filter((x) => x.c === c)
    .map((x) => x.t);

const MUESTRAS: [string, string][] = [
  ["ts", '// nota\nexport function f(a: number): string {\n  return `x${a}` + "y"; /* fin */\n}\n'],
  ["bash", 'ATLAS=1 npm test -- --grep "a b" | head -n 5 # ya\nif [ -f x ]; then sudo rm "$HOME/x"; fi\n'],
  ["json", '{ "nombre": "atlas", "n": 12, "ok": true, "x": null }'],
  ["yaml", "# config\nnombre: atlas\npuertos:\n  - 8080\nactivo: true\n"],
  ["py", 'def f(a):\n    """doc"""\n    return a + 1  # suma\n'],
  ["css", ".a { color: #fff; max-width: 10rem; } /* x */"],
  ["diff", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-viejo\n+nuevo\n igual"],
  ["html", '<!-- x -->\n<a href="https://example.com" class=\'b\'>hola</a>'],
  ["sql", "SELECT a, count(*) FROM t WHERE b = 'x' -- fin"],
  ["rust", 'fn main() { let x = 1; println!("{}", x); }'],
  ["nada", "texto cualquiera { } // sin lenguaje"],
];

test("pegados en orden, los pedazos dan el código entero", () => {
  for (const [lang, codigo] of MUESTRAS) {
    const toks = resaltar(codigo, lang);
    assert.equal(toks.map((x) => x.t).join(""), codigo, lang);
    assert.ok(toks.every((x) => x.t.length > 0), `${lang}: un pedazo vacío`);
  }
  assert.deepEqual(resaltar("", "ts"), []);
});

test("lo que no se conoce, o es enorme, va tal cual", () => {
  assert.deepEqual(resaltar("a = 1 // x", "nada"), [{ c: "", t: "a = 1 // x" }]);
  assert.deepEqual(resaltar("a = 1", ""), [{ c: "", t: "a = 1" }]);
  const enorme = "const a = 1;\n".repeat(4000);
  assert.deepEqual(resaltar(enorme, "ts"), [{ c: "", t: enorme }]);
  assert.equal(lenguaje("TypeScript"), "js");
  assert.equal(lenguaje("zsh"), "sh");
  assert.equal(lenguaje("klingon"), null);
});

test("ts: comentarios, cadenas, palabras clave, números y lo que se llama", () => {
  const c = 'import { leer } from "./a"; // nota\nconst n = 42;\nexport async function f() { return leer(`x ${n}`); }';
  assert.deepEqual(de(c, "ts", "com"), ["// nota"]);
  assert.deepEqual(de(c, "ts", "str"), ['"./a"', "`x ${n}`"]);
  assert.deepEqual(de(c, "ts", "num"), ["42"]);
  assert.deepEqual(de(c, "ts", "fn"), ["f", "leer"]);
  for (const k of ["import", "from", "const", "export", "async", "function", "return"]) assert.ok(de(c, "ts", "kw").some((x) => x.split(" ").includes(k)), k);
  // Una palabra clave adentro de una cadena o de un comentario no lo es.
  assert.deepEqual(de('"return if" // const', "js", "kw"), []);
});

test("shell: el comando de cada renglón y de cada tubería, las variables y los comentarios", () => {
  const c = 'ATLAS=1 npm test -- --grep orden | head -n 5 # ya\nsudo systemctl restart "$UNIDAD" && echo ${HOME}/x\n$ git status';
  assert.deepEqual(de(c, "bash", "fn"), ["npm", "head", "sudo", "systemctl", "echo", "git"]);
  assert.deepEqual(de(c, "bash", "var"), ["${HOME}"]);
  assert.deepEqual(de(c, "bash", "com"), ["# ya"]);
  assert.deepEqual(de(c, "bash", "num"), []);
  // "#" pegado a una palabra no abre comentario (una URL con ancla, `$#`).
  assert.deepEqual(de("curl https://example.com/a#b", "sh", "com"), []);
  // Un renglón que sigue al de arriba con "\" no empieza con un comando.
  assert.deepEqual(de("docker run \\\n  imagen arg", "sh", "fn"), ["docker"]);
});

test("json y yaml: las claves no son cadenas ni texto", () => {
  const j = '{ "nombre": "atlas", "n": 12, "ok": true }';
  assert.deepEqual(de(j, "json", "fn"), ['"nombre"', '"n"', '"ok"']);
  assert.deepEqual(de(j, "json", "str"), ['"atlas"']);
  assert.deepEqual(de(j, "json", "num"), ["12"]);
  assert.deepEqual(de(j, "json", "kw"), ["true"]);
  const y = "# config\nnombre: atlas\nlista:\n  - puerto: 8080\nactivo: true";
  assert.deepEqual(de(y, "yaml", "fn"), ["nombre", "lista", "puerto", "activo"]);
  assert.deepEqual(de(y, "yaml", "com"), ["# config"]);
  assert.deepEqual(de('[unidad]\nnombre = "x"', "toml", "fn"), ["nombre"]);
});

test("diff: cada renglón según cómo empieza", () => {
  const t = resaltar("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-viejo\n+nuevo\n igual", "diff");
  assert.deepEqual(
    t.map((x) => x.c),
    ["com", "com", "meta", "menos", "mas", ""],
  );
});

test("html: etiquetas, valores de los atributos y comentarios", () => {
  const h = '<!-- x -->\n<a href="https://example.com">hola "che"</a>';
  assert.deepEqual(de(h, "html", "com"), ["<!-- x -->"]);
  assert.deepEqual(de(h, "html", "kw"), ["<a", ">", "</a", ">"]);
  assert.deepEqual(de(h, "html", "str"), ['"https://example.com"']);
});

test("sql: las palabras clave en cualquier caja", () => {
  assert.deepEqual(de("select a FROM t Where b = 'x'", "sql", "kw"), ["select", "FROM", "Where"]);
});
