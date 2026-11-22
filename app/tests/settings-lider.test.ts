// Un líder de Claude lleva UN solo `--settings` (hooks + apagado global): Claude Code usa sólo el último (electron/apagados.ts, settingsLider).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { guardarApagados, settingsLider } from "../electron/apagados.ts";
import { argvLider } from "../electron/lider-arma.ts";

const HOOKS = JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node cierre.mjs", timeout: 10 }] }] } });
const SID = "11111111-2222-3333-4444-555555555555";

const conDir = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "settings-lider-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("sin nada apagado: los hooks van tal cual (o nada)", () =>
  conDir((dir) => {
    assert.equal(settingsLider(HOOKS, dir), HOOKS);
    assert.equal(settingsLider(undefined, dir), undefined);
  }));

test("con algo apagado: un archivo con los hooks y el apagado juntos", () =>
  conDir((dir) => {
    guardarApagados({ version: 1, skills: ["gemini"], mcp: ["figma"], herramientas: ["NotebookEdit"], memoria: [] }, dir);
    const ruta = settingsLider(HOOKS, dir);
    assert.ok(ruta && path.dirname(ruta) === dir, `ruta: ${ruta}`);
    const s = JSON.parse(readFileSync(ruta!, "utf8"));
    assert.equal(s.hooks.UserPromptSubmit[0].hooks[0].command, "node cierre.mjs");
    assert.deepEqual(s.skillOverrides, { gemini: "off" });
    assert.deepEqual(s.permissions.deny, ["mcp__figma", "NotebookEdit"]);
    // Mismo contenido, mismo archivo; otros hooks (otro modelo, otro umbral), otro archivo: dos líderes no se pisan.
    assert.equal(settingsLider(HOOKS, dir), ruta);
    const otro = settingsLider(JSON.stringify({ hooks: {} }), dir);
    assert.notEqual(otro, ruta);
    assert.deepEqual(JSON.parse(readFileSync(otro!, "utf8")).skillOverrides, { gemini: "off" });
  }));

test("sin hooks (o ilegibles) queda al menos el apagado", () =>
  conDir((dir) => {
    guardarApagados({ version: 1, skills: ["gemini"], mcp: [], herramientas: [], memoria: [] }, dir);
    for (const h of [undefined, "{no es json"]) {
      const s = JSON.parse(readFileSync(settingsLider(h, dir)!, "utf8"));
      assert.deepEqual(s.skillOverrides, { gemini: "off" });
      assert.equal(s.hooks, undefined);
    }
  }));

test("argvLider: un solo --settings", () => {
  const a = argvLider({ modelo: "claude-opus-5-5", effort: "high", sid: SID, nombre: "trama-1", resume: false, cierreCupo: "/tmp/settings-lider-x.json" });
  assert.equal(a.filter((x) => x === "--settings").length, 1);
  assert.equal(a[a.indexOf("--settings") + 1], "/tmp/settings-lider-x.json");
});
