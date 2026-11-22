// CTX-9: la Claude «de siempre» cuenta como con sesión también si se entra por una variable de entorno (token de auth, Bedrock, Vertex,
// Foundry) o por un `apiKeyHelper`/`env` del `settings.json` de Claude Code; antes reparto la sacaba sin avisar. Con CLAUDE_CONFIG_DIR de prueba.
import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeConSesion } from "../electron/cli/reparto.ts";
import { hayEntradaAlternativaClaude } from "../electron/credenciales-claude.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "claude-sesion-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
/** Una carpeta de configuración de prueba con los archivos pedidos (objeto = JSON). */
const carpeta = (archivos: Record<string, unknown> = {}) => {
  const d = path.join(tmp, `c${n++}`);
  mkdirSync(d, { recursive: true });
  for (const [nombre, v] of Object.entries(archivos)) writeFileSync(path.join(d, nombre), typeof v === "string" ? v : JSON.stringify(v));
  return d;
};

const VARIABLES = ["REPARTO_CUPOS_FIJOS", "REPARTO_CLAUDE", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "AWS_BEARER_TOKEN_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "ANTHROPIC_FOUNDRY_API_KEY"];
const guardado: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const v of VARIABLES) {
    guardado[v] = process.env[v];
    delete process.env[v];
  }
});
afterEach(() => {
  for (const v of VARIABLES) {
    if (guardado[v] === undefined) delete process.env[v];
    else process.env[v] = guardado[v];
  }
});

test("sin nada, la Claude de siempre no tiene sesión", () => {
  process.env.CLAUDE_CONFIG_DIR = carpeta();
  assert.equal(claudeConSesion(), false);
});

test("un .credentials.json con claudeAiOauth cuenta", () => {
  process.env.CLAUDE_CONFIG_DIR = carpeta({ ".credentials.json": { claudeAiOauth: { accessToken: "falso" } } });
  assert.equal(claudeConSesion(), true);
});

for (const [v, valor] of [
  ["ANTHROPIC_API_KEY", "x"],
  ["ANTHROPIC_AUTH_TOKEN", "x"],
  ["CLAUDE_CODE_OAUTH_TOKEN", "x"],
  ["CLAUDE_CODE_USE_BEDROCK", "1"],
  ["AWS_BEARER_TOKEN_BEDROCK", "x"],
  ["CLAUDE_CODE_USE_VERTEX", "1"],
  ["CLAUDE_CODE_USE_FOUNDRY", "1"],
  ["ANTHROPIC_FOUNDRY_API_KEY", "x"],
] as const) {
  test(`la variable ${v} del entorno cuenta como sesión`, () => {
    process.env.CLAUDE_CONFIG_DIR = carpeta();
    process.env[v] = valor;
    assert.equal(claudeConSesion(), true);
  });
}

test("una variable CLAUDE_CODE_USE_* en 0 o false no cuenta", () => {
  process.env.CLAUDE_CONFIG_DIR = carpeta();
  process.env.CLAUDE_CODE_USE_BEDROCK = "0";
  process.env.CLAUDE_CODE_USE_VERTEX = "false";
  assert.equal(claudeConSesion(), false);
});

test("un apiKeyHelper del settings.json cuenta", () => {
  process.env.CLAUDE_CONFIG_DIR = carpeta({ "settings.json": { apiKeyHelper: "~/bin/dame-clave" } });
  assert.equal(claudeConSesion(), true);
});

test("un env del settings.json con una variable de entrada cuenta; con otras cosas, no", () => {
  process.env.CLAUDE_CONFIG_DIR = carpeta({ "settings.json": { env: { CLAUDE_CODE_USE_VERTEX: "1", PATH: "/x" } } });
  assert.equal(claudeConSesion(), true);
  process.env.CLAUDE_CONFIG_DIR = carpeta({ "settings.json": { env: { PATH: "/x", EDITOR: "vim" } } });
  assert.equal(claudeConSesion(), false);
});

test("un settings.json roto o sin esas claves no cuenta ni tira", () => {
  assert.equal(hayEntradaAlternativaClaude({}, carpeta({ "settings.json": "{ no es json" })), false);
  assert.equal(hayEntradaAlternativaClaude({}, carpeta({ "settings.json": { apiKeyHelper: "", theme: "dark" } })), false);
  assert.equal(hayEntradaAlternativaClaude({}, path.join(tmp, "no-existe")), false);
});
