import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Windows no distingue mayúsculas: dos archivos versionados que sólo difieren en mayúscula o en
// extensión (src/hilo/Contexto.tsx y src/hilo/contexto.ts) hacen ambiguo un import sin extensión y
// la interfaz no compila allá. Este test falla si eso vuelve a pasar en src/ o electron/.
const raiz = path.resolve(import.meta.dirname, "..");

test("ningún archivo versionado de src/ o electron/ choca con otro ignorando mayúsculas y extensión", () => {
  const versionados = execFileSync("git", ["ls-files", "src", "electron"], { cwd: raiz, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const grupos = new Map<string, string[]>();
  for (const f of versionados) {
    const sinExt = f.replace(/\.[^./]+$/, "").toLowerCase();
    grupos.set(sinExt, [...(grupos.get(sinExt) ?? []), f]);
  }
  const choques = [...grupos.values()].filter((g) => g.length > 1);
  assert.deepEqual(choques, [], `archivos que chocan en Windows: ${choques.map((g) => g.join(" ~ ")).join(" | ")}`);
});
