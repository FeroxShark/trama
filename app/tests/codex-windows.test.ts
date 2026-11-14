// Codex (ChatGPT) en Windows: npm deja `codex.cmd` en el prefijo (`%APPDATA%\npm`), fuera del PATH de la app. Cuentas, el chequeo de pa y el
// reparto lo buscan con `hallarCodex`: los tres lo ven igual (antes el reparto usaba `enPath` y decía «sin datos» con la cuenta conectada).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { hallarCodex } from "../electron/binario.ts";

const home = "C:\\Users\\gonza";
const env = { APPDATA: "C:\\Users\\gonza\\AppData\\Roaming", PATH: "C:\\Windows\\System32" };

test("Windows: el codex.cmd del prefijo de npm se encuentra aunque no esté en el PATH", () => {
  const cmd = path.win32.join(env.APPDATA, "npm", "codex.cmd");
  assert.equal(hallarCodex(env, home, (f) => f === cmd, "win32"), cmd);
});

test("Windows: sin codex instalado, null", () => {
  assert.equal(hallarCodex(env, home, () => false, "win32"), null);
});

test("Linux: el del PATH", () => {
  assert.equal(hallarCodex({ PATH: "/opt/x/bin" }, "/home/ana", (f) => f === "/opt/x/bin/codex", "linux"), "/opt/x/bin/codex");
});
