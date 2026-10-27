// El runner de workers de pa para opencode (motor/opencode/correr.mjs) contra un `opencode run --format json` de verdad y el servidor
// OpenAI falso (scripts/openai-falso.mjs) como proveedor `falso`: el NDJSON que copia al transcript, el .json final con la forma de
// codex_a_json, los códigos de salida y los errores de argumentos. Sin `opencode` lo que lo necesita se saltea. HOME y XDG en un tmp.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
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
  // opencode 2.x llama `shell` a la de shell que antes era `bash`
  assert.ok(eventos.some((e) => e.type === "tool_use" && ["bash", "shell"].includes(e.part.tool)));
  assert.ok(eventos.some((e) => e.type === "reasoning"), "con --thinking el razonamiento queda en el transcript");
  // opencode 1.x cierra cada paso con step_finish; 2.x no cierra el último (queda el texto como último evento)
  assert.ok(["step_finish", "text"].includes(eventos.at(-1).type));
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
  // Con step_finish final (1.x): 30 y 9 de los dos pasos. Si no (2.x): la suma de los step_finish que hay.
  const fins = eventos.filter((e) => e.type === "step_finish");
  const suma = (f: (t: any) => number) => fins.reduce((n, e) => n + f(e.part.tokens), 0);
  const sumados = { inputTokens: suma((t) => t.input), cacheReadInputTokens: suma((t) => t.cache.read), cacheCreationInputTokens: suma((t) => t.cache.write), outputTokens: suma((t) => t.output + (t.reasoning ?? 0)) };
  const esperado = eventos.at(-1).type === "step_finish" ? { inputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 9 } : sumados;
  assert.deepEqual(j.modelUsage[MODELO_FALSO], esperado);
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

test("aResultado: opencode 2.x no cierra el último paso: un paso abierto con texto es un turno bueno; sin texto, error", () => {
  const dijo = [
    { type: "step_start", sessionID: "ses_2", part: {} },
    { type: "text", sessionID: "ses_2", part: { text: "hola" } },
  ];
  const bien = aResultado({ eventos: dijo, modelo: "m", rc: 0, stderr: "", segundos: 1, gratis: false });
  assert.equal(bien.is_error, false);
  assert.equal(bien.subtype, "success");
  assert.equal(bien.result, "hola");
  assert.equal(bien.num_turns, 1);
  const mudo = aResultado({ eventos: [{ type: "step_start", sessionID: "ses_2", part: {} }], modelo: "m", rc: 0, stderr: "", segundos: 1, gratis: false });
  assert.equal(mudo.is_error, true);
  assert.match(mudo.result, /no devolvió respuesta/);
  // Con una herramienta antes: su paso cierra con tool-calls (tokens contados) y el de la respuesta queda abierto (dos pasos).
  const herramienta = [
    { type: "step_start", sessionID: "ses_2", part: {} },
    { type: "tool_use", sessionID: "ses_2", part: { tool: "bash" } },
    { type: "step_finish", sessionID: "ses_2", part: { reason: "tool-calls", cost: 0, tokens: { input: 7, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } },
    { type: "step_start", sessionID: "ses_2", part: {} },
  ];
  const sinTexto = aResultado({ eventos: herramienta, modelo: "m", rc: 0, stderr: "", segundos: 1, gratis: false });
  assert.equal(sinTexto.is_error, true);
  assert.match(sinTexto.result, /sin cerrar el turno \(razón: tool-calls\)/);
  const r = aResultado({ eventos: [...herramienta, { type: "text", sessionID: "ses_2", part: { text: "listo" } }], modelo: "m", rc: 0, stderr: "", segundos: 1, gratis: false });
  assert.equal(r.is_error, false);
  assert.equal(r.result, "listo");
  assert.equal(r.num_turns, 2);
  assert.deepEqual(r.modelUsage.m, { inputTokens: 7, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 1 });
});

test("config.mjs (pa) y opencode.ts (app) dicen lo mismo", () => {
  for (const id of ["opencode:opencode/beam-free", "opencode:openrouter/qwen/qwen3:free", "opencode:", "opencode:x", "dsh:opencode/big-pickle", "opencode:a b/c"]) assert.deepEqual(cfg.parsearModelo(id), app.parsearModelo(id), id);
  for (const id of ["opencode/beam-free", "opencode:opencode/big-pickle", "opencode/gpt-5", "anthropic/claude"]) assert.equal(cfg.esGratis(id), app.esGratis(id), id);
  for (const t of ["429 FreeUsageLimitError", "boom", "HTTP 429", "rate limited"]) assert.equal(cfg.esErrorCuota(t), app.esErrorCuota(t), t);
  assert.equal(cfg.mensajeCuotaOpencode("m"), app.mensajeCuotaOpencode("m"));
  assert.equal(cfg.resolverOpencode({ HILOS_OPENCODE: "/a" }), app.resolverOpencode({ HILOS_OPENCODE: "/a" }));
});

test("--effort llega a opencode como `--variant` (y vacío o raro no se pasa)", { timeout: 60_000 }, async () => {
  // Un «opencode» de mentira que vuelca sus argumentos: sólo interesa qué recibe.
  const falso = path.join(tmp, "oc-args.sh");
  const log = path.join(tmp, "oc-args.log");
  writeFileSync(falso, `#!/bin/sh\nif [ "$2" = "--help" ]; then echo "  --variant  x"; echo "  --thinking  y"; exit 0; fi\necho "$@" >> ${log}\ncat >/dev/null\n`, { mode: 0o755 });
  for (const ef of ["high", "", "--x y"]) {
    await correr("http://127.0.0.1:1", ["--modelo", MODELO_FALSO, ...(ef ? ["--effort", ef] : [])], "hola", { HILOS_OPENCODE: falso });
  }
  const l = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(l.length, 3);
  assert.match(l[0]!, /-m falso\/fake-model --variant high$/);
  assert.doesNotMatch(l[1]!, /--variant/);
  assert.doesNotMatch(l[2]!, /--variant/);
});

test("opencode 2.x: sólo se pasan los flags que su `run --help` nombra (sin --dir, --thinking ni --variant si no están)", { timeout: 60_000 }, async () => {
  // Como opencode 2.1: rechaza un flag que no conoce («Unrecognized flag: --dir») y su ayuda no trae --dir/--thinking/--variant.
  const falso = path.join(tmp, "oc-2x.sh");
  const log = path.join(tmp, "oc-2x.log");
  writeFileSync(falso, `#!/bin/sh\nif [ "$2" = "--help" ]; then echo "  --format  f"; echo "  -m, --model  m"; exit 0; fi\nfor a in "$@"; do case "$a" in --dir|--thinking|--variant) echo "Unrecognized flag: $a" >&2; exit 1;; esac; done\necho "$@" >> ${log}\ncat >/dev/null\n`, { mode: 0o755 });
  await correr("http://127.0.0.1:1", ["--modelo", MODELO_FALSO, "--effort", "high"], "hola", { HILOS_OPENCODE: falso });
  const l = readFileSync(log, "utf8").trim();
  assert.equal(l, "run --format json -m falso/fake-model");
});
