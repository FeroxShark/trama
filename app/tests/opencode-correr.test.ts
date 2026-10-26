// El runner de workers de pa para opencode (motor/opencode/correr.mjs) contra un `opencode run --format json` de verdad y el servidor
// OpenAI falso (scripts/openai-falso.mjs) como proveedor `falso`: el NDJSON que copia al transcript, el .json final con la forma de
// codex_a_json, los códigos de salida y los errores de argumentos. Sin `opencode` lo que lo necesita se saltea. HOME y XDG en un tmp.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error: módulo .mjs sin tipos (el runner de pa no tiene TypeScript)
import { aResultado } from "../../motor/opencode/correr.mjs";
// @ts-expect-error: idem
import * as cfg from "../../motor/opencode/config.mjs";
import * as app from "../electron/opencode.ts";
import { arrancarFalso, entornoTmp } from "./dsh-ayuda.ts";
import { MODELO_FALSO, OPENCODE, SIN_OPENCODE, entornoOpencodeTmp } from "./opencode-ayuda.ts";

const CORRER = path.join(import.meta.dirname, "..", "..", "motor", "opencode", "correr.mjs");
const { tmp, home, trabajo } = entornoTmp("opencode-correr");
after(() => rmSync(tmp, { recursive: true, force: true }));

type Salida = { codigo: number | null; stderr: string; json: any; stream: string };
let n = 0;
/** Corre `correr.mjs` como lo hace pa: argumentos, `--` y la tarea; devuelve el exit, el stderr y los archivos que dejó. */
function correr(baseURL: string, args: string[], tarea: string | null, env: Record<string, string | undefined> = {}): Promise<Salida> {
  const stream = path.join(tmp, `stream-${++n}.ndjson`);
  const salida = path.join(tmp, `salida-${n}.json`);
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CORRER, "--cwd", trabajo, "--stream", stream, "--salida", salida, ...args, ...(tarea === null ? [] : ["--", tarea])], {
      env: { ...process.env, ...entornoOpencodeTmp(home, baseURL), HILOS_OPENCODE: OPENCODE ?? "/no/existe/opencode", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    p.stderr!.on("data", (t) => (stderr += t));
    p.on("close", (codigo) => ok({ codigo, stderr, json: existsSync(salida) ? JSON.parse(readFileSync(salida, "utf8")) : null, stream: existsSync(stream) ? readFileSync(stream, "utf8") : "" }));
  });
}

test("una corrida buena: NDJSON al stream y un .json con la forma de codex_a_json (result, is_error, num_turns, duración, tokens)", { skip: SIN_OPENCODE, timeout: 120_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  const r = await correr(falso.baseURL, ["--modelo", MODELO_FALSO], "RAZONA HERRAMIENTA hacelo");
  assert.equal(r.codigo, 0, r.stderr);
  const eventos = r.stream.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(eventos[0].type, "step_start");
  assert.ok(eventos.some((e) => e.type === "tool_use" && e.part.tool === "bash"));
  assert.ok(eventos.some((e) => e.type === "reasoning"), "con --thinking el razonamiento queda en el transcript");
  assert.equal(eventos.at(-1).type, "step_finish");
  const j = r.json;
  assert.equal(j.type, "result");
  assert.equal(j.motor, "opencode");
  assert.equal(j.subtype, "success");
  assert.equal(j.is_error, false);
  assert.equal(j.result, "listo: hola-desde-bash");
  assert.equal(j.num_turns, 2, "dos pasos del modelo: la herramienta y la respuesta");
  assert.ok(j.duration_ms > 0);
  assert.equal(j.total_cost_usd, undefined, "un modelo que no es gratis (falso/…) no inventa costo");
  assert.match(j.opencode_session_id, /^ses_/);
  assert.deepEqual(j.modelUsage[MODELO_FALSO], { inputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 9 });
});

test("la tarea larga y con comillas llega entera (por stdin); --tarea-archivo y `-- -` también", { skip: SIN_OPENCODE, timeout: 120_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  const tarea = `dijo "hola" y 'chau' $(no) \`tampoco\` ${"x".repeat(20_000)}`;
  const r = await correr(falso.baseURL, ["--modelo", MODELO_FALSO], tarea);
  assert.equal(r.codigo, 0, r.stderr);
  assert.ok(r.json.result.includes(tarea.slice(0, 200)), "el eco trae la tarea");
  const f = path.join(tmp, "tarea.txt");
  writeFileSync(f, "desde un archivo");
  const r2 = await correr(falso.baseURL, ["--modelo", MODELO_FALSO, "--tarea-archivo", f], null);
  assert.match(r2.json.result, /desde un archivo/);
});

test("--max-pasos corta la corrida: subtype error_max_turns", { skip: SIN_OPENCODE, timeout: 120_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  const r = await correr(falso.baseURL, ["--modelo", MODELO_FALSO, "--max-pasos", "1"], "HERRAMIENTA");
  assert.equal(r.json.subtype, "error_max_turns");
  assert.equal(r.json.is_error, true);
  assert.notEqual(r.codigo, 0);
});

test("escribir fuera del worktree se rechaza (run auto-rechaza los permisos); dentro anda", { skip: SIN_OPENCODE, timeout: 120_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  const fuera = path.join(tmp, "fuera-run.txt");
  await correr(falso.baseURL, ["--modelo", MODELO_FALSO], `OC_ESCRIBE ${fuera}`);
  assert.ok(!existsSync(fuera));
  await correr(falso.baseURL, ["--modelo", MODELO_FALSO], "OC_ESCRIBE dentro-run.txt");
  assert.ok(existsSync(path.join(trabajo, "dentro-run.txt")));
});

test("argumentos: modelo mal armado, sin tarea, sin opencode", async () => {
  const sin = await correr("http://127.0.0.1:1/v1", ["--modelo", "dsh:ollama/x"], "hola");
  assert.equal(sin.codigo, 2);
  assert.equal(sin.json.is_error, true);
  const vacia = await correr("http://127.0.0.1:1/v1", ["--modelo", MODELO_FALSO], null);
  assert.equal(vacia.codigo, 2);
  const noHay = await correr("http://127.0.0.1:1/v1", ["--modelo", MODELO_FALSO], "hola", { HILOS_OPENCODE: "/no/existe/opencode" });
  assert.equal(noHay.codigo, 127);
  assert.equal(noHay.json.is_error, true);
});

test("aResultado: un 429 de OpenCode dice qué hacer; un error cualquiera trae su motivo; el costo de un gratis es 0", () => {
  const cuota = [
    { type: "step_start", sessionID: "ses_1", part: {} },
    { type: "error", sessionID: "ses_1", error: { name: "APIError", data: { message: "Too Many Requests: Free usage limit reached", statusCode: 429 } } },
  ];
  const r = aResultado({ eventos: cuota, modelo: "opencode:opencode/beam-free", rc: 1, stderr: "", segundos: 1, gratis: true });
  assert.equal(r.is_error, true);
  assert.match(r.result, /\/connect/);
  assert.equal(r.total_cost_usd, 0);
  const otro = aResultado({ eventos: [{ type: "error", error: { name: "APIError", data: { message: "boom", statusCode: 500 } } }], modelo: "x", rc: 1, stderr: "", segundos: 1, gratis: false });
  assert.match(otro.result, /500: boom/);
  const bien = aResultado({ eventos: [{ type: "text", sessionID: "s", part: { text: "hecho" } }, { type: "step_finish", part: { reason: "stop", cost: 0.25, tokens: { input: 1, output: 2, reasoning: 1, cache: { read: 3, write: 4 } } } }], modelo: "m", rc: 0, stderr: "", segundos: 2, gratis: false });
  assert.equal(bien.is_error, false);
  assert.equal(bien.total_cost_usd, 0.25);
  assert.deepEqual(bien.modelUsage.m, { inputTokens: 1, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, outputTokens: 3 });
});

test("config.mjs (pa) y opencode.ts (app) dicen lo mismo", () => {
  for (const id of ["opencode:opencode/beam-free", "opencode:openrouter/qwen/qwen3:free", "opencode:", "opencode:x", "dsh:opencode/big-pickle", "opencode:a b/c"]) assert.deepEqual(cfg.parsearModelo(id), app.parsearModelo(id), id);
  for (const id of ["opencode/beam-free", "opencode:opencode/big-pickle", "opencode/gpt-5", "anthropic/claude"]) assert.equal(cfg.esGratis(id), app.esGratis(id), id);
  for (const t of ["429 FreeUsageLimitError", "boom", "HTTP 429", "rate limited"]) assert.equal(cfg.esErrorCuota(t), app.esErrorCuota(t), t);
  assert.equal(cfg.mensajeCuotaOpencode("m"), app.mensajeCuotaOpencode("m"));
  assert.equal(cfg.resolverOpencode({ HILOS_OPENCODE: "/a" }), app.resolverOpencode({ HILOS_OPENCODE: "/a" }));
});
