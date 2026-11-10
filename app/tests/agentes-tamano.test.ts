import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// El AGENTS.md lo carga cada worker: si crece, los prompts se van de largo y las reglas de área se pierden.
// Las reglas enteras viven en docs/reglas/; este test mira que el mapa de ese archivo no se rompa.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOPE = 8192; // bytes
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

test("el AGENTS.md se mantiene corto: las reglas de área están en docs/reglas/", () => {
  const bytes = statSync(path.join(RAIZ, "AGENTS.md")).size;
  assert.ok(bytes <= TOPE, `AGENTS.md pesa ${bytes} bytes (tope ${TOPE}): mové la regla a docs/reglas/`);
});

test("cada docs/reglas/ que nombra el AGENTS.md existe, y ningún archivo de reglas quedó afuera", () => {
  const agents = leer("AGENTS.md");
  const nombrados = [...agents.matchAll(/docs\/reglas\/[a-z-]+\.md/g)].map((m) => m[0]);
  assert.ok(nombrados.length > 0, "el AGENTS.md tiene que decir dónde están las reglas");
  const unicos = [...new Set(nombrados)];
  for (const r of unicos) {
    assert.ok(statSync(path.join(RAIZ, r)).isFile(), `el AGENTS.md nombra ${r} y no está`);
  }
  const enDisco = readdirSync(path.join(RAIZ, "docs", "reglas")).filter((f) => f.endsWith(".md")).map((f) => `docs/reglas/${f}`);
  for (const r of enDisco) assert.ok(unicos.includes(r), `${r} existe pero el AGENTS.md no lo manda leer`);
});
