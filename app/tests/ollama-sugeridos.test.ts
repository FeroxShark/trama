// Los modelos sugeridos y si entran en la VRAM (src/paneles/ollama-sugeridos.ts): puro, sin red ni GPU.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cabe, SUGERIDOS, sinInstalar, tamanoCorto, vramGb } from "../src/paneles/ollama-sugeridos.ts";

const GB = 1024 ** 3;

test("cabe: 75 % entra, hasta el 100 % justo, más no entra, sin VRAM no se afirma nada", () => {
  const vram = 12 * 1024; // 12 GB
  assert.equal(cabe(vram, 2 * GB), "entra");
  assert.equal(cabe(vram, 9 * GB), "entra"); // justo el 75 %
  assert.equal(cabe(vram, 9.3 * GB), "justo");
  assert.equal(cabe(vram, 12 * GB), "justo");
  assert.equal(cabe(vram, 14 * GB), "no_entra");
  assert.equal(cabe(null, 2 * GB), "sin_dato");
  assert.equal(cabe(0, 2 * GB), "sin_dato");
});

test("los sugeridos van de menor a mayor y con nombres válidos para Ollama", () => {
  for (let i = 1; i < SUGERIDOS.length; i++) assert.ok(SUGERIDOS[i].bytes >= SUGERIDOS[i - 1].bytes);
  for (const s of SUGERIDOS) assert.match(s.modelo, /^[a-z0-9][\w.-]*(:[\w.-]+)?$/);
});

test("sinInstalar saca los que ya están", () => {
  const r = sinInstalar(["llama3.2:3b", "otro:1b"]);
  assert.ok(!r.some((s) => s.modelo === "llama3.2:3b"));
  assert.equal(r.length, SUGERIDOS.length - 1);
});

test("tamanoCorto y vramGb", () => {
  assert.equal(tamanoCorto(4.7 * GB), "4,7 GB");
  assert.equal(tamanoCorto(4.7 * GB, "."), "4.7 GB");
  assert.equal(tamanoCorto(14 * GB), "14 GB");
  assert.equal(tamanoCorto(640 * 1024 ** 2), "640 MB");
  assert.equal(vramGb(12282), 12);
});
