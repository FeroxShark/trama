// El catálogo de modelos de la cuenta de Claude (electron/claude-catalogo.ts): se lee del caché del `claude`, nunca se escribe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { modelosClaudeCuenta } from "../electron/claude-catalogo.ts";

const caso = (f: (home: string, dir: string) => void) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "trama-cat-"));
  try {
    const dir = path.join(home, ".claude", "cache", "model-catalog");
    mkdirSync(dir, { recursive: true });
    f(home, dir);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};
const catalogo = (models: unknown[]) => JSON.stringify({ version: 2, catalog: { surface: "cc", config: { id: "cc", models } } });

test("lee los modelos del catálogo más reciente, con sección y niveles", () => {
  caso((home, dir) => {
    writeFileSync(path.join(dir, "viejo-cc.json"), catalogo([{ id: "claude-opus-4-8", name: "Opus 4.8", section: "main" }]));
    utimesSync(path.join(dir, "viejo-cc.json"), 1000, 1000);
    writeFileSync(path.join(dir, "nuevo-cc.json"), catalogo([
      { id: "claude-fable-5-2", name: "Fable 5.2", section: "main", runtime: { effort_levels: ["low", "high"], family: "fable" } },
      { id: "claude-fable-5-1", name: "Fable 5.1", section: "overflow" },
      { id: "no-es-claude", name: "x", section: "main" },
    ]));
    writeFileSync(path.join(dir, "published-x.json"), "{}");
    assert.deepEqual(modelosClaudeCuenta({}, home), [
      { id: "claude-fable-5-2", nombre: "Fable 5.2", principal: true, efforts: ["low", "high"], familia: "fable" },
      { id: "claude-fable-5-1", nombre: "Fable 5.1", principal: false, efforts: [], familia: "" },
    ]);
  });
});

test("sin carpeta, con un archivo roto o vacío: null", () => {
  assert.equal(modelosClaudeCuenta({}, path.join(os.tmpdir(), "no-existe-trama-cat")), null);
  caso((home, dir) => {
    writeFileSync(path.join(dir, "a-cc.json"), "{roto");
    assert.equal(modelosClaudeCuenta({}, home), null);
    writeFileSync(path.join(dir, "a-cc.json"), catalogo([]));
    assert.equal(modelosClaudeCuenta({}, home), null);
  });
});

test("CLAUDE_CONFIG_DIR manda sobre ~/.claude", () => {
  caso((home) => {
    const otro = path.join(home, "otro");
    mkdirSync(path.join(otro, "cache", "model-catalog"), { recursive: true });
    writeFileSync(path.join(otro, "cache", "model-catalog", "z-cc.json"), catalogo([{ id: "claude-opus-5-5", name: "Opus 5.5", section: "main" }]));
    assert.equal(modelosClaudeCuenta({ CLAUDE_CONFIG_DIR: otro }, home)?.[0]?.id, "claude-opus-5-5");
  });
});
