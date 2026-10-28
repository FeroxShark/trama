// Lo de otros-motores.ts que la paridad no ve: el entorno de un local, el `cuenta_env` y los shims .cmd de npm (Windows).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cuentaEnvDe, guionDeShim, programaDe } from "../electron/cli/pa/otros-motores.ts";
import { entornoClaude, type Lanzamiento } from "../electron/cli/pa/lanzar.ts";
import type { Llamada } from "../electron/cli/pa/motores/llamada.ts";

test("cuentaEnvDe: env -u A K=V", () => {
  assert.deepEqual(cuentaEnvDe(["env", "-u", "ANTHROPIC_API_KEY", "-u", "X", "CLAUDE_CONFIG_DIR=/c"]), { poner: { CLAUDE_CONFIG_DIR: "/c" }, quitar: ["ANTHROPIC_API_KEY", "X"] });
  assert.deepEqual(cuentaEnvDe([]), { poner: {}, quitar: [] });
});

test("un local: las ANTHROPIC_* van sólo en el proceso del claude y los modelos apuntan al local", () => {
  const l = { pa: { env: { PATH: "/bin", ANTHROPIC_API_KEY: "sk-real" } }, envClaude: {}, c: { local: { url: "http://h:11434", modelo: "qwen3" } } } as unknown as Lanzamiento;
  const e = entornoClaude(l);
  assert.equal(e.ANTHROPIC_BASE_URL, "http://h:11434");
  assert.equal(e.ANTHROPIC_AUTH_TOKEN, "ollama");
  assert.equal(e.ANTHROPIC_API_KEY, "");
  assert.equal(e.ANTHROPIC_DEFAULT_SONNET_MODEL, "qwen3");
  assert.equal(e.CLAUDE_CODE_SUBAGENT_MODEL, "qwen3");
  assert.equal(e.PA_WORKER, "1");
  const sinLocal = entornoClaude({ ...l, c: {} } as unknown as Lanzamiento);
  assert.equal(sinLocal.ANTHROPIC_BASE_URL, undefined);
});

test("guionDeShim: el .cmd de npm apunta al guion de node (sin shell: la tarea tiene saltos de línea)", () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "shim-"));
  mkdirSync(path.join(d, "node_modules", "@openai", "codex", "bin"), { recursive: true });
  const js = path.join(d, "node_modules", "@openai", "codex", "bin", "codex.js");
  writeFileSync(js, "");
  const cmd = path.join(d, "codex.cmd");
  writeFileSync(cmd, '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
  assert.equal(guionDeShim(cmd), js);
  assert.equal(guionDeShim(path.join(d, "codex")), null);
  const ll = { cmd: path.join(d, "codex"), args: ["exec", "x\ny"], env: { PATHEXT: ".cmd" } } as unknown as Llamada;
  assert.deepEqual(programaDe(ll, "win32"), { cmd: process.execPath, args: [js, "exec", "x\ny"] });
});

test("programaDe: node es este node", () => {
  const ll = { cmd: "node", args: ["correr.mjs", "--modelo", "m"], env: {} } as unknown as Llamada;
  assert.deepEqual(programaDe(ll, "linux"), { cmd: process.execPath, args: ["correr.mjs", "--modelo", "m"] });
});
