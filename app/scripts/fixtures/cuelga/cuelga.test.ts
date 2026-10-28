// Fixture de tests/runner-tope.test.ts: lo corre scripts/test.mjs con TRAMA_TEST_DIR (no es un test del proyecto).
// Se cuelga con un bucle que no cede (el tope de node --test no lo corta; sólo el runner) y deja dos hijos: uno en el
// grupo del archivo y otro desprendido (setsid, fuera del grupo). Escribe sus pids en TRAMA_TEST_PIDS.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { test } from "node:test";

test("se cuelga", () => {
  const dormir = "setInterval(() => {}, 1000)";
  const hijo = spawn(process.execPath, ["-e", dormir], { stdio: "inherit" });
  const nieto = spawn(process.execPath, ["-e", dormir], { detached: true, stdio: "ignore" });
  nieto.unref();
  writeFileSync(process.env.TRAMA_TEST_PIDS!, JSON.stringify([hijo.pid, nieto.pid]));
  for (;;) {
    /* no cede */
  }
});
