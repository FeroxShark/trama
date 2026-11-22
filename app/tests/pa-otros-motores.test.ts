// Lo de otros-motores.ts que la paridad no ve: el entorno de un local, el `cuenta_env` y los shims .cmd de npm (Windows).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cuentaEnvDe, ejecutarOtro, guionDeShim, programaDe } from "../electron/cli/pa/otros-motores.ts";
import { armarLanzamiento, entornoClaude, type Corrida, type Lanzamiento } from "../electron/cli/pa/lanzar.ts";
import { prologo } from "../electron/cli/pa/entorno.ts";
import type { Llamada } from "../electron/cli/pa/motores/llamada.ts";
import { archivoMcpAgy } from "../electron/mcp-trama-registro.ts";
import { carpetaSkillsDe } from "../electron/cli/pa/skills-motores.ts";

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

test("guionDeShim: el .cmd de npm apunta al guion de node y conserva las comillas del flag", (t) => {
  const d = mkdtempSync(path.join(os.tmpdir(), "shim-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  mkdirSync(path.join(d, "node_modules", "@openai", "codex", "bin"), { recursive: true });
  const js = path.join(d, "node_modules", "@openai", "codex", "bin", "codex.js");
  writeFileSync(js, "");
  const cmd = path.join(d, "codex.cmd");
  writeFileSync(cmd, '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
  assert.equal(guionDeShim(cmd), js);
  assert.equal(guionDeShim(path.join(d, "codex")), null);
  const args = ["exec", "-c", 'approval_policy="never"', "-"];
  const ll = { cmd: path.join(d, "codex"), args, env: { PATHEXT: ".cmd" } } as unknown as Llamada;
  assert.deepEqual(programaDe(ll, "win32"), { cmd: process.execPath, args: [js, ...args], verbatim: false });
});

test("programaDe: node es este node", () => {
  const ll = { cmd: "node", args: ["correr.mjs", "--modelo", "m"], env: {} } as unknown as Llamada;
  assert.deepEqual(programaDe(ll, "linux"), { cmd: process.execPath, args: ["correr.mjs", "--modelo", "m"] });
});

test("programaDe: agy.cmd se resuelve con el entorno de la cuenta y va por cmd.exe", () => {
  const ll = { cmd: "agy", args: ["--input-format", "stream-json"], env: { HILOS_AGY: "C:\\Con espacios\\agy.cmd", USERPROFILE: "C:\\Prueba", ComSpec: "cmd.exe" } } as Llamada;
  assert.deepEqual(programaDe(ll, "win32"), {
    cmd: "cmd.exe", args: ["/d", "/s", "/c", '""C:\\Con espacios\\agy.cmd" --input-format stream-json"'], verbatim: true,
  });
});

test("ejecutarOtro entrega la tarea por stdin y sólo sincroniza MCP y skills cuando corresponden", async (t) => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "otros-motores-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const fake = path.join(raiz, "agy.mjs");
  writeFileSync(fake, `import { readFileSync } from "node:fs";
const [{ text }] = JSON.parse(readFileSync(0, "utf8")).message.content;
if (process.argv.join(" ").includes("tarea larga") || !text.endsWith("tarea larga".repeat(4000))) process.exit(1);
process.stdout.write(JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "listo" } }) + "\\n");`);
  const env = { HILOS_AGY: fake, HOME: raiz, USERPROFILE: raiz, PA_STATE: path.join(raiz, "estado"), CLAUDE_CONFIG_DIR: path.join(raiz, "claude") };
  const skill = path.join(env.CLAUDE_CONFIG_DIR, "skills", "prueba");
  mkdirSync(skill, { recursive: true });
  writeFileSync(path.join(skill, "SKILL.md"), "Reglas de prueba.\n");
  const pa = prologo([], env, { out: () => {}, err: () => {} });
  const c: Corrida = {
    proyecto: "demo", slug: "demo", ts: "1", ruta: raiz, rutaTrabajo: raiz, rama: "", base: "", origen: "", puesto: "",
    leer: true, usaWorktree: false, tengoLock: false, modelo: "gemini-4-neon-high", motor: "agy", esfuerzo: "", cuenta: "google",
    tarea: "tarea larga".repeat(4000), tareaJefe: "", lanzo: "jefe", sid: "sesion", resume: false, conMcp: false, maxTurns: "",
    maxBudget: "", autocompact: "", baseDelta: [], jefe: "", jefeId: "", async: false,
  };
  const mcp = archivoMcpAgy(raiz, pa.plat);
  const skillEnlazada = path.join(carpetaSkillsDe("agy", env, raiz, pa.plat), "prueba", "SKILL.md");
  const correr = async (corrida: Corrida) => {
    const l = armarLanzamiento(pa, corrida);
    mkdirSync(l.dir, { recursive: true });
    const rc = await ejecutarOtro(l, { alArrancar: () => {} });
    assert.equal(rc, 0, readFileSync(l.err, "utf8"));
    assert.equal(JSON.parse(readFileSync(l.out, "utf8")).result, "listo");
  };
  await correr(c);
  assert.equal(existsSync(mcp), false);
  assert.equal(existsSync(skillEnlazada), false);
  await correr({ ...c, ts: "2", tipo: "frontend" });
  assert.equal(existsSync(mcp), false);
  assert.equal(existsSync(skillEnlazada), true);
  await correr({ ...c, ts: "3", conMcp: true });
  assert.ok(JSON.parse(readFileSync(mcp, "utf8")).mcpServers.trama);
});

test("codex: el tope de --max-turns corta al worker que pasa de esos pasos; sin tope (0) lo deja correr (B088)", { skip: process.platform === "win32" }, async (t) => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "otros-motores-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const bin = path.join(raiz, "bin");
  mkdirSync(bin, { recursive: true });
  // un codex ficticio: emite 5 pasos y, si FAKE_SALIR=1, termina solo; si no, queda vivo hasta que lo corten
  writeFileSync(path.join(bin, "codex"), `#!/usr/bin/env node
for (let i = 0; i < 5; i++) process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "ls " + i } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hola" } }) + "\\n");
if (process.env.FAKE_SALIR === "1") process.exit(0);
setTimeout(() => process.exit(0), 15000); // espera-justificada: red del codex ficticio; si nadie lo corta, sale solo y el test falla en vez de colgarse
`, { mode: 0o755 });
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: raiz, USERPROFILE: raiz, PA_STATE: path.join(raiz, "estado"), PA_CODEX_PASOS_MS: "20" };
  const correr = async (ts: string, maxTurns: string, extra: Record<string, string> = {}) => {
    const pa = prologo([], { ...env, ...extra }, { out: () => {}, err: () => {} });
    const c: Corrida = {
      proyecto: "demo", slug: "demo", ts, ruta: raiz, rutaTrabajo: raiz, rama: "", base: "", origen: "", puesto: "",
      leer: true, usaWorktree: false, tengoLock: false, modelo: "codex:gpt-6-sol-high", motor: "codex", esfuerzo: "", cuenta: "chatgpt",
      tarea: "x", tareaJefe: "", lanzo: "jefe", sid: "sesion", resume: false, conMcp: false, maxTurns,
      maxBudget: "", autocompact: "", baseDelta: [], jefe: "", jefeId: "", async: false,
    };
    const l = armarLanzamiento(pa, c);
    mkdirSync(l.dir, { recursive: true });
    const rc = await ejecutarOtro(l, { alArrancar: () => {} });
    return { rc, json: JSON.parse(readFileSync(l.out, "utf8")) as { subtype: string; is_error: boolean }, err: readFileSync(l.err, "utf8") };
  };
  const cortada = await correr("1", "3");
  assert.notEqual(cortada.rc, 0);
  assert.equal(cortada.json.subtype, "error_max_turns");
  assert.match(cortada.err, /pasó el tope de 3 pasos/);
  const libre = await correr("2", "0", { FAKE_SALIR: "1" });
  assert.equal(libre.rc, 0);
  assert.equal(libre.json.subtype, "success");
  const holgada = await correr("3", "50", { FAKE_SALIR: "1" });
  assert.equal(holgada.json.subtype, "success", "dentro del tope no corta");
});
