// Un hook de React (`useX(...)`) nunca va del lado derecho de `||`, `&&`, `??` ni de un `?`: se saltea en algunos renders, el orden de
// los hooks cambia y la ventana se cae («Cannot read properties of undefined (reading 'length')»; pasó con useDebate en PedidoPermiso).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const RAIZ = path.join(import.meta.dirname, "..", "src");

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    return e.isDirectory() ? archivos(f) : /\.tsx?$/.test(e.name) ? [f] : [];
  });
}

test("ningún hook se llama de forma condicional con ||, &&, ?? o ?", () => {
  const malos: string[] = [];
  for (const f of archivos(RAIZ)) {
    readFileSync(f, "utf8").split("\n").forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      if (/(\|\||&&|\?\?|\?)\s*(?:[!(]\s*)*(?:\w+\(\s*)*(?<!\w)use[A-Z]\w*\(/.test(l.replace(/\?\./g, ".")) && !/^\s*import /.test(l)) malos.push(`${path.relative(RAIZ, f)}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(malos, []);
});
