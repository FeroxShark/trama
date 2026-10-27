import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Windows no distingue mayúsculas: dos archivos versionados que sólo difieren en mayúscula o en
// extensión (src/hilo/Contexto.tsx y src/hilo/contexto.ts) hacen ambiguo un import sin extensión y
// la interfaz no compila allá. Este test falla si eso vuelve a pasar en app/src, app/electron, motor/ o windows/.
// (En motor/ y windows/ también pasa que `Foo` y `foo` no pueden convivir en un mismo checkout de Windows.)
const raiz = path.resolve(import.meta.dirname, "..", "..");
// En app/src y app/electron además se ignora la extensión (imports sin extensión); en motor/ y windows/ conviven a propósito
// archivos de igual nombre y distinta extensión (icon.png / icon.ico), así que ahí sólo cuenta la mayúscula.
const CARPETAS = ["app/src", "app/electron", "motor", "windows"];
const SIN_EXTENSION = /^app\/(src|electron)\//;

test("ningún archivo versionado de app/src, app/electron, motor/ o windows/ choca con otro ignorando mayúsculas (y la extensión en app/)", () => {
  const versionados = execFileSync("git", ["ls-files", "-z", "--", ...CARPETAS], { cwd: raiz, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  assert.ok(versionados.length > 0, "git ls-files no devolvió nada: ¿se corre fuera del repo?");
  const grupos = new Map<string, string[]>();
  for (const f of versionados) {
    const clave = (SIN_EXTENSION.test(f) ? f.replace(/\.[^./]+$/, "") : f).toLowerCase();
    grupos.set(clave, [...(grupos.get(clave) ?? []), f]);
  }
  const choques = [...grupos.values()].filter((g) => g.length > 1);
  assert.deepEqual(choques, [], `archivos que chocan en Windows: ${choques.map((g) => g.join(" ~ ")).join(" | ")}`);
});
