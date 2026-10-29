#!/usr/bin/env node
// agy, codex, opencode y dsh falsos para los casos de paridad de lanzar con otros motores (casos-motores-lanzar.ts). Se llama
// `node otro-falso.mjs <programa> args…` desde un shim con el nombre del programa. Anota en TRAMA_FALSO_LOG (como claude-falso.mjs)
// el argv, el cwd, el entorno que le interesa a pa y, de opencode y dsh, la tarea que reciben por stdin; y contesta según
// FALSO_MODO: "ok" (default, un RESULTADO completo), "cupo" (429 / límite de uso), "sin-login" (codex sin sesión), "sin-hooks" (agy sin plugin), "modelo-malo" (agy rechaza los Claude 5.5).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [prog, ...args] = process.argv.slice(2);
const modo = process.env.FALSO_MODO ?? "ok";
const BLOQUE = "RESULTADO: hice x.\nARCHIVOS: a.ts\nVERIFICACION: npm test\n  ok 3 tests\nDECISION: nada\nSIGUE: nada";
const val = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};
const nd = (...xs) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
const claves = ["PA_WORKER", "GIT_EDITOR", "GIT_SEQUENCE_EDITOR", "PA_AGY_HB", "PA_AGY_RAIZ", "PA_AGY_PPAL", "PA_AGY_RAMA", "PA_AGY_MAPA", "PA_AGY_MODO", "PA_AGY_REBASE", "PA_MAX_TURNS", "HILOS_OPENCODE", "HILOS_DSH", "XDG_DATA_HOME"];
const extra = claves.filter((k) => process.env[k] !== undefined).map((k) => `ENV ${k}=${process.env[k]}`);
extra.push(`ENV PATH0=${(process.env.PATH ?? "").split(path.delimiter)[0]}`);
extra.push(`ENV DEEPSEEK_API_KEY=${process.env.DEEPSEEK_API_KEY ? "puesta" : "no"}`);
// lo que consulta reparto (/quota, models) no es de pa: ni se anota ni cuenta para la paridad
const ajeno = args.includes("/quota") || args[0] === "models";
const log = (stdin = "") => {
  if (!process.env.TRAMA_FALSO_LOG || ajeno) return;
  const a = [prog, ...args, ...extra].map((x) => x.replace(/pa-dsh-[A-Za-z0-9]+/g, "pa-dsh-X"));
  if (stdin) a.push(`STDIN ${stdin}`);
  appendFileSync(process.env.TRAMA_FALSO_LOG, JSON.stringify({ prog, args: a, cwd: process.cwd() }) + "\n");
};
const leerStdin = () => {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

if (prog === "agy") {
  log();
  if (args.includes("/hooks")) {
    if (modo === "sin-hooks") process.stdout.write(JSON.stringify({ command: { data: { hooks: [] } } }));
    else process.stdout.write(JSON.stringify({ command: { data: { hooks: [{ name: "pa-worker", enabled: true, actions: [{ event: "PreToolUse" }] }] } } }));
    process.exit(0);
  }
  // "modelo-malo": el agy de esta cuenta no ofrece los Claude 5.5 (una cuenta de otra región/versión) y rechaza el modelo antes de arrancar
  const modeloPedido = val("--model") ?? "";
  if (modo === "modelo-malo" && /^claude-(sonnet|opus)-5-5-/.test(modeloPedido)) {
    process.stderr.write(`error: invalid model selection (--model "${modeloPedido}" --effort ""): model ${modeloPedido} is not recognized\nAvailable models: Gemini 3.8 Flash (High/Medium/Low), Claude Sonnet 4.6 (Thinking), Claude Opus 4.6 (Thinking), GPT-OSS 120B (Medium)\n`);
    process.exit(1);
  }
  if (modo === "cupo") {
    process.stderr.write("RESOURCE_EXHAUSTED: Individual quota reached\n");
    process.stdout.write(nd({ conversation_id: "c-1" }, { event: "result", result: { status: "ERROR", conversation_id: "c-1", duration_seconds: 1 } }));
    process.exit(1);
  }
  process.stdout.write(
    nd(
      { conversation_id: "c-1", event: "start" },
      { step_update: { state: "DONE", step_type: "agent_response", usage: { input_tokens: 1200, cache_read_tokens: 200, output_tokens: 50, thinking_tokens: 30 } } },
      { event: "result", result: { status: "SUCCESS", response: BLOQUE, duration_seconds: 2.5, conversation_id: "c-1" } },
    ),
  );
} else if (prog === "codex") {
  log();
  if (args[0] === "login") process.exit(modo === "sin-login" ? 1 : 0);
  const ultimo = val("--output-last-message");
  if (modo === "cupo") {
    process.stdout.write(nd({ type: "thread.started", thread_id: "th-1" }, { type: "turn.failed", error: { message: "You've hit your usage limit" } }));
    process.exit(1);
  }
  if (ultimo) writeFileSync(ultimo, BLOQUE);
  process.stdout.write(
    nd(
      { type: "thread.started", thread_id: "th-1" },
      { type: "item.completed", item: { type: "agent_message", text: BLOQUE } },
      { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 40 } },
    ),
  );
} else if (prog === "opencode") {
  if (args[0] === "run" && args.includes("--help")) {
    process.stdout.write("opencode run\n  --format\n  --variant\n  --thinking\n");
    process.exit(0);
  }
  log(leerStdin());
  if (modo === "cupo") {
    process.stdout.write(nd({ type: "error", error: { name: "APIError", data: { message: "FreeUsageLimitError", statusCode: 429 } } }));
    process.stderr.write("429 Too Many Requests\n");
    process.exit(1);
  }
  process.stdout.write(
    nd(
      { type: "step_start", sessionID: "s-1", part: {} },
      { type: "text", part: { text: BLOQUE } },
      { type: "step_finish", part: { reason: "stop", cost: 0, tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } } } },
    ),
  );
} else if (prog === "dsh") {
  log(leerStdin());
  process.stdout.write(
    nd(
      { type: "session", sessionId: "d-1" },
      { type: "status", phase: "step_end", usage: { inputTokens: 100, outputTokens: 20 } },
      { type: "status", phase: "turn_end", reason: { kind: "completed" } },
      { type: "final", text: BLOQUE },
    ),
  );
}
process.exit(0);
