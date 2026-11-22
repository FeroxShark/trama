#!/usr/bin/env node
// Un `codex exec --json … [resume <id>] -` falso (HILOS_CODEX=scripts/codex-falso.mjs) para probar los líderes de ChatGPT sin
// gastar nada. Habla como el de verdad (thread.started, turn.started, item.started / item.completed, turn.completed); el turno
// llega por stdin y lo que trae después de "Mensaje de <dueño>:" (o todo) lo contesta "eco: <texto> (turno N)". Gatillos:
//   "herramienta"  antes corre un command_execution (`echo hola`)
//   "pienso"       antes un ítem de razonamiento
//   "despacio"     tarda TRAMA_FALSO_MS_LENTO (default 1500) ms antes y después de la herramienta (para interrumpir)
//   "morite"       escribe en stderr y sale con 1 a mitad del turno
// Una conversación existe en $HILOS_STATE/codex-falso/<id>: `resume <id>` que no existe sale con 1 y un error por stderr, sin
// ningún evento (como el de verdad); con la que existe, sigue y cuenta los turnos.
//   TRAMA_FALSO_FALLA=<texto>   al retomar un hilo sale con 1 y ese texto por stderr, sin eventos (un fallo que no es «no existe»).
//   TRAMA_FALSO_ROLLOUT=1       como el de verdad, anexa a `$CODEX_HOME|~/.codex/sessions/AAAA/MM/DD/rollout-…-<id>.jsonl` un `token_count`
//                               por pedido (3 por turno): el último pesa 100000 + 1000 × turno en una ventana de 475000, y el `turn.completed`
//                               trae el ACUMULADO de los tres (el dato que NO es contexto).
//   `codex login status`: «Logged in using ChatGPT» (TRAMA_FALSO_CODEX_LOGIN=0: «Not logged in», sale con 1).
//   TRAMA_FALSO_LOG=<archivo>   una línea JSON por arranque ({ args, cwd, claves del entorno, prompt }).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
if (args.includes("--version")) {
  console.log("codex-cli 0.0.0-falso");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") {
  if (process.env.TRAMA_FALSO_CODEX_LOGIN === "0") {
    console.error("Not logged in");
    process.exit(1);
  }
  console.error("Logged in using ChatGPT");
  process.exit(0);
}
if (args[0] !== "exec") {
  console.error(`codex falso: no sé hacer ${args.join(" ")}`);
  process.exit(2);
}
const valor = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};
const iResume = args.indexOf("resume");
const pedida = iResume >= 0 ? args[iResume + 1] : null;
let prompt = "";
if (args.at(-1) === "-") for await (const t of process.stdin) prompt += t;
else prompt = args.at(-1) ?? "";

if (process.env.TRAMA_FALSO_LOG)
  appendFileSync(
    process.env.TRAMA_FALSO_LOG,
    JSON.stringify({ codex: true, args, cwd: process.cwd(), env: Object.keys(process.env).filter((k) => /^(ANTHROPIC|CLAUDE|PA_|OLLAMA|OPENAI|CODEX_API)/.test(k)), path: process.env.PATH, prompt }) + "\n",
  );

const dir = path.join(process.env.HILOS_STATE ?? "/tmp", "codex-falso");
mkdirSync(dir, { recursive: true });
if (pedida && process.env.TRAMA_FALSO_FALLA) {
  // Un fallo que no es «no existe el hilo» (red, login, cuota): sale con 1 y lo dice por stderr, sin ningún evento.
  process.stderr.write(`${process.env.TRAMA_FALSO_FALLA}\n`);
  process.exit(1);
}
if (pedida && !existsSync(path.join(dir, pedida))) {
  process.stderr.write(`Error: thread/resume failed: no rollout found for thread id ${pedida}\n`);
  process.exit(1);
}
let id = pedida;
let turno = 1;
if (id) turno = Number(readFileSync(path.join(dir, id), "utf8")) + 1;
else id = randomUUID();
writeFileSync(path.join(dir, id), String(turno));

const salir = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const texto = (prompt.split(/Mensaje de [^\n]+:\n/).pop() ?? prompt).trim();
const lento = /despacio/i.test(texto);
const ms = lento ? Number(process.env.TRAMA_FALSO_MS_LENTO ?? 1500) : Number(process.env.TRAMA_FALSO_MS ?? 20);
let n = 0;

salir({ type: "thread.started", thread_id: id });
salir({ type: "turn.started" });
await dormir(ms);
if (/morite/i.test(texto)) {
  process.stderr.write("codex falso: me muero\n");
  process.exit(1);
}
if (/pienso/i.test(texto)) salir({ type: "item.completed", item: { id: `item_${n++}`, type: "reasoning", text: "**Pienso** antes de contestar." } });
if (/herramienta/i.test(texto)) {
  const item = { id: `item_${n++}`, type: "command_execution", command: "bash -lc 'echo hola'", aggregated_output: "", exit_code: null, status: "in_progress" };
  salir({ type: "item.started", item });
  await dormir(ms);
  salir({ type: "item.completed", item: { ...item, aggregated_output: "hola\n", exit_code: 0, status: "completed" } });
  await dormir(ms);
}
const dicho = [`eco: ${texto}`, `(turno ${turno})`, `[${valor("-m")} ${valor("--sandbox")}]`].join(" ");
salir({ type: "item.completed", item: { id: `item_${n++}`, type: "agent_message", text: dicho } });
if (process.env.TRAMA_FALSO_ROLLOUT === "1") {
  const raiz = process.env.CODEX_HOME || path.join(process.env.HOME ?? "", ".codex");
  const carpeta = path.join(raiz, "sessions", "2026", "11", "22");
  mkdirSync(carpeta, { recursive: true });
  const archivo = path.join(carpeta, `rollout-2026-11-22T10-00-00-${id}.jsonl`);
  const pedidos = [0, 1, 2].map((k) => 100_000 + turno * 1000 - (2 - k) * 5000);
  for (const entrada of pedidos) {
    const info = { total_token_usage: { input_tokens: 0 }, last_token_usage: { input_tokens: entrada, cached_input_tokens: entrada - 500, output_tokens: 30, reasoning_output_tokens: 5 }, model_context_window: 475000 };
    appendFileSync(archivo, JSON.stringify({ timestamp: "2026-11-22T10:00:00Z", type: "event_msg", payload: { type: "token_count", info } }) + "\n");
  }
  salir({ type: "turn.completed", usage: { input_tokens: pedidos.reduce((a, b) => a + b, 0), cached_input_tokens: 1000, output_tokens: 90 } });
} else {
  salir({ type: "turn.completed", usage: { input_tokens: 9000 + turno, cached_input_tokens: 4000, output_tokens: 30 } });
}
