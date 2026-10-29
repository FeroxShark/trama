// El ciclo de Shift+Tab y el aspecto de cada modo (src/hilo/modos.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASPECTO, esModo, MODO_DEFAULT, MODOS, siguienteModo } from "../src/hilo/modos.ts";
import { MODOS as MODOS_MAIN, MODO_DEFAULT as DEFAULT_MAIN } from "../electron/lider-arma.ts";

test("Shift+Tab: default → accept edits → plan → bypass → default, como Claude Code", () => {
  const vistos = [];
  let m = "default";
  for (let i = 0; i < 4; i++) vistos.push((m = siguienteModo(m)));
  assert.deepEqual(vistos, ["acceptEdits", "plan", "bypassPermissions", "default"]);
  // Uno que no conoce (auto, dontAsk, null) vuelve a default.
  assert.equal(siguienteModo("auto"), "default");
  assert.equal(siguienteModo(null), "default");
});

test("los modos del renderer y del main son los mismos; bypass por default", () => {
  assert.deepEqual([...MODOS], [...MODOS_MAIN]);
  assert.equal(MODO_DEFAULT, "bypassPermissions");
  assert.equal(DEFAULT_MAIN, MODO_DEFAULT);
  assert.ok(esModo("plan") && !esModo("auto") && !esModo(undefined));
  for (const m of MODOS) assert.ok(ASPECTO[m].icono && ASPECTO[m].color.startsWith("rgb("));
});
