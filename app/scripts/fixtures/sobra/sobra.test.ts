// Fixture de tests/runner-tope.test.ts: termina bien pero deja un proceso desprendido vivo. El runner lo cuenta como
// falla y lo mata. Lo corre scripts/test.mjs con TRAMA_TEST_DIR (no es un test del proyecto).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";

test("termina, pero deja un proceso vivo", () => {
  const nieto = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  nieto.unref();
  writeFileSync(process.env.TRAMA_TEST_PIDS!, JSON.stringify([nieto.pid]));
});
