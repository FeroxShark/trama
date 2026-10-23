import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// El registry de mentira, antes de importar (registro.ts lee la ruta al cargar).
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-registro-"));
for (const d of ["atlas", "brote", "cauce"]) mkdirSync(path.join(tmp, d));
writeFileSync(
  path.join(tmp, "registry.json"),
  JSON.stringify({
    projects: [
      { name: "Atlas Web", path: path.join(tmp, "atlas"), tests: "npm test", titulo: " Atlas " },
      { name: "brote", path: path.join(tmp, "brote"), tests: null, titulo: "" },
      { name: "cauce", path: path.join(tmp, "cauce"), tests: "  " },
      // Un alias de la misma carpeta que pierde por nombre pero trae los tests.
      { name: "Cauce de agua", path: path.join(tmp, "cauce"), tests: "cargo test", titulo: "Cauce" },
      // Un área: vive en home, no es una carpeta de la barra.
      { name: "sistema", path: "~" },
    ],
  }),
);
process.env.PROYECTOS_REGISTRY = path.join(tmp, "registry.json");
const { registro, slugsPorNombre } = await import("../electron/registro.ts");

test("registro: `tests` sólo si es texto no vacío; vale para la carpeta aunque lo traiga un alias", async () => {
  const por = new Map((await registro()).map((p) => [p.slug, p]));
  assert.equal(por.get("atlas")?.tests, "npm test");
  assert.equal(por.get("brote")?.tests, null);
  assert.equal(por.get("cauce")?.nombre, "cauce");
  assert.equal(por.get("cauce")?.tests, "cargo test");
});

test("registro: `titulo` opcional (texto no vacío), también desde un alias; `nombre` no cambia", async () => {
  const por = new Map((await registro()).map((p) => [p.slug, p]));
  assert.equal(por.get("atlas")?.titulo, "Atlas");
  assert.equal(por.get("atlas")?.nombre, "Atlas Web");
  assert.equal(por.get("brote")?.titulo, null);
  assert.equal(por.get("cauce")?.titulo, "Cauce");
  assert.equal(por.get("cauce")?.nombre, "cauce");
});

test("slugsPorNombre: cada nombre del registry con el slug de su carpeta, los alias también; lo de home no", async () => {
  assert.deepEqual(await slugsPorNombre(), { "Atlas Web": "atlas", brote: "brote", cauce: "cauce", "Cauce de agua": "cauce" });
});
