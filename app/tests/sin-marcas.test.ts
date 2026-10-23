import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Ninguna marca del autor en lo que se publica (el exportador público lo revisa igual). Un grep sin
// distinguir mayúsculas; este archivo se excluye a sí mismo. Cada marca lleva un corchete: el exportador
// también revisa este archivo, y su patrón no puede ser la marca escrita tal cual.
const MARCAS = "f[e]rox|f[e]roxshark|tail[c]68726|li[f]eos|[f]orgejo|gmail\\.com";
const RAIZ = fileURLToPath(new URL("../", import.meta.url));

test("ninguna marca del autor en src/, electron/, scripts/, tests/ ni vite.config.ts", () => {
  const r = spawnSync(
    "grep",
    ["-rniIE", "--exclude=sin-marcas.test.ts", MARCAS, "src", "electron", "scripts", "tests", "vite.config.ts"],
    { cwd: RAIZ, encoding: "utf8" },
  );
  // grep sale 1 cuando no encuentra nada y 2 si falló: eso no es "sin marcas", es un test roto.
  assert.notEqual(r.status, 2, r.stderr);
  assert.equal(r.stdout, "", `marcas encontradas:\n${r.stdout}`);
});
