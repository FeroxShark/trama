import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dirWinTests = path.join(raiz, "..", "windows", "tests");

test("windows/tests: actualización 0.1.1 -> 0.1.2, preservación SHA-256 de cuentas y sesiones, y limpieza", () => {
  const archivos = readdirSync(dirWinTests)
    .filter((f) => f.endsWith(".test.js"))
    .sort()
    .map((f) => path.join(dirWinTests, f));
  assert.ok(archivos.some((f) => f.endsWith("actualizar-wsl.test.js")));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const out = execFileSync(process.execPath, ["--test", "--test-reporter=spec", ...archivos], {
    cwd: path.join(raiz, "..", "windows"),
    env,
    encoding: "utf8",
  });
  assert.match(out, /actualizar 0\.1\.1 -> 0\.1\.2: recompila y reinicia el motor en WSL/);
  assert.match(out, /fail 0/);
});
