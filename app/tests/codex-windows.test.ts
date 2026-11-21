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

test("Windows: el codex.exe de la app de escritorio (la versión más nueva de ~\\.codex\\packages\\app-server-daemon\\releases)", () => {
  const rel = path.win32.join(home, ".codex", "packages", "app-server-daemon", "releases");
  const listar = (d: string) => (d === rel ? ["0.99.1-x86_64-pc-windows-msvc", "0.169.0-x86_64-pc-windows-msvc", "0.170.0-x86_64-unknown-linux-gnu"] : []);
  const nuevo = path.win32.join(rel, "0.169.0-x86_64-pc-windows-msvc", "bin", "codex.exe");
  const viejo = path.win32.join(rel, "0.99.1-x86_64-pc-windows-msvc", "bin", "codex.exe");
  assert.equal(hallarCodex(env, home, (f) => f === nuevo || f === viejo, "win32", listar), nuevo);
  assert.equal(hallarCodex(env, home, () => false, "win32", listar), null);
});

test("Windows: los argumentos de codex.cmd no llevan comillas dobles y paraLanzar no tira", async () => {
  const { argsCodex } = await import("../electron/codex-stream.ts");
  const { paraLanzar } = await import("../electron/binario.ts");
  const x = { modelo: "gpt-5.4", effort: "medium", sandbox: "workspace-write", cwd: "C:\\proj", imagenes: [], thread: null };
  const args = argsCodex(x, "win32");
  assert.ok(args.includes("model_reasoning_effort=medium"));
  assert.ok(args.includes("approval_policy=never"));
  assert.doesNotThrow(() => paraLanzar("C:\\Users\\gonza\\AppData\\Roaming\\npm\\codex.cmd", args, {}, "win32"));
  // Linux conserva las comillas TOML
  assert.ok(argsCodex(x, "linux").includes('model_reasoning_effort="medium"'));
});
