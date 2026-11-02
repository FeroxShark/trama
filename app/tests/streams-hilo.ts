// Streams chicos de workers que no son de Claude, para `pa --hilo` (electron/cli/pa/hilo-stream.ts y el jq de motor/bin/pa):
// los usan tests/pa-hilo-stream.test.ts y los casos de paridad de tests/paridad/casos-globales.ts.
const jl = (...lineas: unknown[]) => lineas.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n";
const CONV = "c-1";
const paso = (step_index: number, state: string, step_type: string, extra: Record<string, unknown> = {}) => ({
  event: "step_update",
  step_update: { conversation_id: CONV, step_index, state, step_type, ...extra },
});
const herr = (i: number, parameters: unknown, output?: string) => [
  paso(i, "ACTIVE", "tool", { tool_name: "run_command", tool_info: { name: "run_command", parameters } }),
  ...(output === undefined ? [] : [paso(i, "DONE", "tool", { tool_name: "run_command", tool_info: { name: "run_command", parameters, output } })]),
];

/** agy: un paso sin texto (pensando), dos comandos (uno falla), una lectura y la respuesta en deltas. */
export const AGY = jl(
  { event: "init", conversation_id: CONV, init: { model: "gemini-3.8-flash-high", cwd: "/tmp/x" } },
  paso(0, "DONE", "user_input"),
  paso(1, "DONE", "agent_response", { usage: { input_tokens: 100, output_tokens: 10, thinking_tokens: 5, cache_read_tokens: 0, total_tokens: 110 } }),
  ...herr(2, { CommandLine: "ls | wc -l" }, "Command exited with code 0.\r\n\r\nCommand output:\r\n42\r\n"),
  paso(3, "DONE", "agent_response", { usage: { input_tokens: 20, output_tokens: 8, cache_read_tokens: 100 } }),
  ...herr(4, { CommandLine: "false" }, "Command exited with code 1.\n\nNo output from the command."),
  paso(5, "ACTIVE", "tool", { tool_name: "read_file", tool_info: { name: "read_file", parameters: { Path: "/a/b.ts" } } }),
  paso(5, "DONE", "tool", { tool_name: "read_file", tool_info: { name: "read_file", parameters: { Path: "/a/b.ts" }, output: "linea 1\nlinea 2\n" } }),
  paso(6, "ACTIVE", "agent_response", { text_delta: "  Hay " }),
  paso(6, "ACTIVE", "agent_response", { text_delta: "42 archivos.\n" }),
  paso(6, "DONE", "agent_response", { usage: { input_tokens: 30, output_tokens: 12, cache_read_tokens: 200 } }),
  { event: "result", result: { conversation_id: CONV, status: "SUCCESS", response: "Hay 42 archivos." } },
);

/** agy con el worker todavía corriendo: la herramienta sigue activa y la última línea quedó a medio escribir. */
export const AGY_VIVO =
  jl(
    { event: "init", conversation_id: CONV, init: { model: "gemini-3.8-flash-high" } },
    paso(1, "DONE", "agent_response", { usage: { input_tokens: 5, output_tokens: 1 } }),
    ...herr(2, { CommandLine: "npm test" }),
  ) + '{"event":"step_update","step_update":{"conversation_id":"c-1","step_index":3,"state":"ACTIVE","step_type":"agent_resp';

/** agy cortado por la cuenta: sin texto, el resultado es un error. */
export const AGY_ERROR = jl(
  { event: "init", conversation_id: CONV, init: { model: "gemini-4-argon-high" } },
  { event: "result", result: { conversation_id: CONV, status: "ERROR", response: "", error: "Individual quota reached. Resets in 4h55m." } },
);

/** codex (`--json`): un comando que anda, uno que falla, un cambio de archivos, una búsqueda y la respuesta; el uso incluye lo cacheado. */
export const CODEX = jl(
  { type: "thread.started", thread_id: "t-1" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item_0", type: "reasoning", text: "pienso" } },
  { type: "item.started", item: { id: "item_1", type: "command_execution", command: "ls", aggregated_output: "", status: "in_progress" } },
  { type: "item.completed", item: { id: "item_1", type: "command_execution", command: "ls", aggregated_output: "a\nb\n", exit_code: 0, status: "completed" } },
  { type: "item.started", item: { id: "item_2", type: "command_execution", command: "false", aggregated_output: "", status: "in_progress" } },
  { type: "item.completed", item: { id: "item_2", type: "command_execution", command: "false", aggregated_output: "", exit_code: 1, status: "failed" } },
  { type: "item.completed", item: { id: "item_3", type: "file_change", changes: [{ path: "/x/a.ts", kind: "update" }, { path: "/x/b.ts", kind: "add" }], status: "completed" } },
  { type: "item.completed", item: { id: "item_4", type: "web_search", query: "node test runner" } },
  { type: "item.completed", item: { id: "item_5", type: "agent_message", text: "Listo, cambié dos archivos." } },
  { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } },
);

/** codex en vuelo: el comando empezó y todavía no terminó. */
export const CODEX_VIVO = jl(
  { type: "thread.started", thread_id: "t-1" },
  { type: "item.started", item: { id: "item_1", type: "command_execution", command: "npm test", aggregated_output: "", status: "in_progress" } },
);

const T0 = 1793507274000;
const oc = (type: string, dt: number, part: unknown) => ({ type, timestamp: T0 + dt, sessionID: "ses_1", part });
/** opencode: dos pasos (con herramientas, uno con error), un razonamiento que no se muestra y un texto final; trae `timestamp` por línea. */
export const OPENCODE = jl(
  oc("step_start", 0, { type: "step-start" }),
  oc("text", 2000, { type: "text", text: "Empiezo por mirar.\n\n" }),
  oc("tool_use", 2500, { type: "tool", tool: "shell", state: { status: "completed", input: { command: "ls app" }, output: "a\nb\n" } }),
  oc("tool_use", 2600, { type: "tool", tool: "read", state: { status: "error", input: { filePath: "/x/no.ts" }, error: "no existe" } }),
  oc("step_finish", 2700, { type: "step-finish", reason: "tool-calls", tokens: { input: 1000, output: 50, reasoning: 0, cache: { read: 500, write: 0 } } }),
  oc("step_start", 3000, { type: "step-start" }),
  oc("reasoning", 3500, { type: "reasoning", text: "no se ve" }),
  oc("text", 4000, { type: "text", text: "Listo.\n\n" }),
  oc("step_finish", 4100, { type: "step-finish", reason: "stop", tokens: { input: 800, output: 20, reasoning: 5, cache: { read: 900, write: 10 } } }),
);

/** opencode cortado por el cupo: el error es la última cosa que dijo. */
export const OPENCODE_ERROR = jl(
  oc("step_start", 0, { type: "step-start" }),
  { type: "error", timestamp: T0 + 1000, sessionID: "ses_1", error: { name: "APIError", data: { message: "Free usage limit reached" } } },
);

/** dsh (`dsh --json`): dos pasos (una herramienta que sale bien y otra que falla), un razonamiento que no se muestra y el texto final repetido en `final`. */
export const DSH = jl(
  { type: "session", sessionId: "s-1" },
  { type: "status", phase: "turn_start" },
  { type: "status", phase: "step_start" },
  { type: "thinking", text: "no se ve" },
  { type: "text", text: "Miro el repo.\n" },
  { type: "tool_call", callId: "c1", tool: "run_command", input: { CommandLine: "ls app" } },
  { type: "tool_result", callId: "c1", status: "completed", result: "a\nb\n" },
  { type: "tool_call", callId: "c2", tool: "read", input: { filePath: "/x/no.ts" } },
  { type: "tool_result", callId: "c2", status: "error", result: "no existe" },
  { type: "status", phase: "step_end", usage: { inputTokens: 1000, outputTokens: 50 } },
  { type: "status", phase: "step_start" },
  { type: "text", text: "Listo.\n" },
  { type: "status", phase: "step_end", usage: { inputTokens: 800, outputTokens: 20 } },
  { type: "status", phase: "turn_end", reason: { kind: "completed" } },
  { type: "final", text: "Listo.\n" },
);

/** dsh cortado: el turno terminó con error. */
export const DSH_ERROR = jl(
  { type: "status", phase: "step_start" },
  { type: "status", phase: "turn_end", reason: { kind: "error", error: { message: "429 sin cupo" } } },
);

/** El `.hilo` de una corrida de otro motor: el pedido (en una línea), la hora de inicio y el modelo. */
export const hiloDe = (tarea: string, modelo: string, inicio = 1793507270) => `tarea=${tarea}\nmodelo=${modelo}\ninicio=${inicio}\nlanzo=jefe\n`;
