// Un líder de Ollama: el mismo `claude` con el endpoint SÓLO en su proceso (contrato de modelos.json). Un `claude` de mentira
// anota su argv y las variables que le llegan; nada habla con un Ollama de verdad (la url apunta a un puerto sin nadie) ni usa la GPU.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-ollama-"));
const home = path.join(tmp, "home");
mkdirSync(home, { recursive: true });
const falso = path.join(tmp, "claude-anota.mjs");
const falsoReal = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
writeFileSync(
  falso,
  `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const e = process.env;
appendFileSync(${JSON.stringify(path.join(tmp, "claude.log"))}, JSON.stringify({ args: process.argv.slice(2), base: e.ANTHROPIC_BASE_URL ?? null, token: e.ANTHROPIC_AUTH_TOKEN ?? null, key: e.ANTHROPIC_API_KEY ?? null, model: e.ANTHROPIC_MODEL ?? null, local: e.CLAUDE_LOCAL ?? null }) + "\\n");
await import(${JSON.stringify(falsoReal)});
`,
);
chmodSync(falso, 0o755);
const config = path.join(tmp, "modelos.json");
writeFileSync(
  config,
  JSON.stringify({
    version: 1,
    locales: [{ id: "ollama:qwen3-coder:30b", nombre: "Qwen3 Coder 30B", url: "http://127.0.0.1:59999", modelo: "qwen3-coder:30b" }],
  }),
);
process.env.HOME = home;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = config;
process.env.HILOS_CLAUDE = falso;
process.env.TRAMA_FALSO_MS = "20";
// Lo que Ana pudiera tener en su entorno no debe llegar a ningún líder.
process.env.ANTHROPIC_BASE_URL = "http://no-debe-llegar.invalid";
process.env.ANTHROPIC_API_KEY = "sk-no-debe-llegar";

const lider = await import("../electron/lider.ts");
const arma = await import("../electron/lider-arma.ts");
const eventos: { sid: string; e: any }[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 15_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const fines = (sid: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === "fin").length;
const arranques = () => readFileSync(path.join(tmp, "claude.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("un líder de Ollama: --model con el nombre de Ollama, sin --effort, y el endpoint sólo en su proceso", { timeout: 30_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "ollama:qwen3-coder:30b", effort: "high", texto: "hola" });
  await hasta(() => fines(sid) === 1);
  const [a] = arranques();
  assert.equal(a.args[a.args.indexOf("--model") + 1], "qwen3-coder:30b");
  assert.ok(!a.args.includes("--effort"), "Ollama no tiene esfuerzo");
  assert.equal(a.base, "http://127.0.0.1:59999");
  assert.equal(a.token, "ollama");
  assert.equal(a.key, "", "ni la clave de nadie");
  assert.equal(a.model, "qwen3-coder:30b");
  assert.equal(a.local, "1", "pa se niega a lanzar workers con un endpoint de Ollama");
  // La barra lo ve con el id entero.
  const g = (await lider.lideresApp()).find((x) => x.sid === sid)!;
  assert.equal(g.modelo, "ollama:qwen3-coder:30b");
});

test("un líder de Claude no recibe nada de Ollama ni lo que haya en el entorno de trama", { timeout: 30_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola" });
  await hasta(() => fines(sid) === 1);
  const a = arranques().at(-1)!;
  assert.equal(a.args[a.args.indexOf("--model") + 1], "claude-opus-5-5");
  assert.equal(a.base, null);
  assert.equal(a.token, null);
  assert.equal(a.key, null);
  assert.equal(a.local, null);
});

test("un ollama:* que no está en modelos.json no se lanza: el error dice cuál y no queda un líder sin conversación", async () => {
  const antes = (await lider.lideresApp()).length;
  await assert.rejects(lider.nuevo({ modelo: "ollama:no-esta", effort: "high", texto: "hola" }), /ollama:no-esta/);
  assert.equal((await lider.lideresApp()).length, antes);
});

test("entornoOllama: sólo http(s), y no hereda ANTHROPIC_* de afuera", () => {
  assert.throws(() => arma.entornoOllama({}, home, { url: "file:///x", modelo: "m" }), /URL|url/i);
  const env = arma.entornoOllama({ ANTHROPIC_BASE_URL: "http://otro", ANTHROPIC_MODEL: "claude-x", PATH: "/usr/bin" }, home, { url: "http://h:1", modelo: "m1" });
  assert.equal(env.ANTHROPIC_BASE_URL, "http://h:1");
  assert.equal(env.ANTHROPIC_MODEL, "m1");
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, "m1");
  // El de un modelo cualquiera sigue sin nada de eso.
  const normal = arma.opcionesLider({ ANTHROPIC_BASE_URL: "http://otro", ANTHROPIC_API_KEY: "sk-x", PATH: "/usr/bin" }, home).env;
  assert.equal(normal.ANTHROPIC_BASE_URL, undefined);
  assert.equal(normal.ANTHROPIC_API_KEY, undefined);
});
