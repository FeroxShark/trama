// Casos de paridad de los otros motores de pa (agy, codex, dsh, opencode, ollama): las funciones de motor/bin/pa corridas
// sueltas (motores-bash.sh) contra su port en app/electron/cli/pa/motores (motores-ts.ts). Cubre el .json de la salida de agy y
// codex, el latido, los candados de privacidad, la clasificación de modelos, las keys de dsh, el Ollama de siempre, el bloque de
// AGENTS.md y el argv/entorno de cada motor.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";

const escribir = (ruta: string, texto: string | Buffer) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
};
const aux = (c: Contexto, ...r: string[]) => path.join(c.aux, ...r);
const nd = (...xs: unknown[]) => xs.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n") + "\n";
const mo = (nombre: string, args: Caso["args"], o: Partial<Caso> = {}): Caso => ({ herramienta: "motores", nombre: `motores: ${nombre}`, args, rc: 0, ...o });

// ============================================================================ agy → .json

const agy = (nombre: string, stream: string, err: string, rc: string, modelo = "gemini-4-argon-high"): Caso =>
  mo(`agy_a_json: ${nombre}`, (c) => ["agy-a-json", aux(c, "s.jsonl"), aux(c, "e.txt"), modelo, rc], {
    preparar: (c) => {
      escribir(aux(c, "s.jsonl"), stream);
      escribir(aux(c, "e.txt"), err);
    },
  });

const casosAgy: Caso[] = [
  agy(
    "corrida buena con pasos, tokens y conversación",
    nd(
      { conversation_id: "c-1", event: "start" },
      { step_update: { state: "RUNNING", step_type: "agent_response" } },
      { step_update: { state: "DONE", step_type: "agent_response", usage: { input_tokens: 1200, cache_read_tokens: 200, output_tokens: 50, thinking_tokens: 30 } } },
      { step_update: { state: "DONE", step_type: "tool_call", usage: { input_tokens: 300, output_tokens: 5 } } },
      { step_update: { state: "DONE", step_type: "agent_response" } },
      { event: "result", result: { status: "SUCCESS", response: "RESULTADO: listo", duration_seconds: 12.3456, conversation_id: "c-2" } },
    ),
    "",
    "0",
  ),
  agy(
    "falla con el error de una herramienta y stderr",
    nd({ step_update: { state: "DONE", step_type: "tool_call", tool_info: { error: { message: "no anda" } } } }, { event: "result", result: { status: "ERROR" } }),
    "RESOURCE_EXHAUSTED: Individual quota reached\n\n",
    "1",
  ),
  agy("sin stderr: el error de la herramienta", nd({ step_update: { state: "DONE", tool_info: { error: { message: "ups" } } } }), "", "0"),
  agy("stream vacío", "", "", "1"),
  agy("tokens sólo en result.usage y basura en el medio", `no es json\n[1,2]\n\n${nd({ event: "result", result: { status: "SUCCESS", response: "ok", usage: { input_tokens: 9, cache_read_tokens: 4, output_tokens: 2 } } })}`, "", "0", "agy:claude-opus-5-5-high"),
  agy("rc distinto de cero con SUCCESS", nd({ event: "result", result: { status: "SUCCESS", response: "a medias" } }), "", "143"),
  agy("respuesta con acentos, comillas y DEL", nd({ event: "result", result: { status: "SUCCESS", response: 'dijo "ñandú"\t\u007f fin' } }), "", "0"),
];

// ============================================================================ codex → .json

const codex = (nombre: string, stream: string, err: string, rc: string, ultimo: string | null, seg = "7"): Caso =>
  mo(`codex_a_json: ${nombre}`, (c) => ["codex-a-json", aux(c, "s.jsonl"), aux(c, "e.txt"), "codex:gpt-6-sol-high", rc, aux(c, "ultimo"), seg], {
    preparar: (c) => {
      escribir(aux(c, "s.jsonl"), stream);
      escribir(aux(c, "e.txt"), err);
      if (ultimo !== null) escribir(aux(c, "ultimo"), ultimo);
    },
  });

const casosCodex: Caso[] = [
  codex(
    "corrida buena en dos turnos",
    nd(
      { type: "thread.started", thread_id: "th-1" },
      { type: "item.completed", item: { type: "command_execution", command: "ls" } },
      { type: "item.completed", item: { type: "agent_message", text: "primero" } },
      { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 40 } },
      { type: "item.completed", item: { type: "agent_message", text: "RESULTADO: hecho" } },
      { type: "turn.completed", usage: { input_tokens: 500, output_tokens: 10 } },
    ),
    "",
    "0",
    null,
  ),
  codex("el último mensaje del archivo gana (sin sus saltos finales)", nd({ type: "item.completed", item: { type: "agent_message", text: "del stream" } }), "", "0", "del archivo\n\n"),
  codex(
    "turn.failed y error: el último fallo va con el mensaje",
    nd({ type: "item.completed", item: { type: "agent_message", text: "algo" } }, { type: "turn.failed", error: { message: "límite" } }, { type: "error", message: "reconectando" }),
    "",
    "1",
    null,
  ),
  codex("fallo sin mensaje del modelo", nd({ type: "turn.failed", error: { message: "sin cupo" } }), "", "0", null),
  codex("sin nada: el stderr", "", "codex: no logueado\n", "1", null, "0"),
  codex("sin nada y sin stderr", "basura\n", "", "0", null),
];

// ============================================================================ latido

const latido = (nombre: string, motor: string, modelo: string, stream: string | Buffer | null): Caso =>
  mo(`latido: ${nombre}`, (c) => ["latido", motor, modelo, aux(c, "t.jsonl"), aux(c, "hb")], {
    preparar: (c) => {
      if (stream !== null) escribir(aux(c, "t.jsonl"), stream);
    },
  });

const largo = "comando con acentos áéíóú y ñ ".repeat(8);
const casosLatido: Caso[] = [
  latido("codex: el último comando", "codex", "codex:gpt-6-sol-high", nd({ type: "x" }, { item: { type: "command_execution", command: "npm test" } }, { type: "turn.completed" })),
  latido("codex: texto multilínea con tabs", "codex", "codex:gpt-6-sol-high", nd({ item: { type: "agent_message", text: "uno\ndos\tthree\r\n\n" } })),
  latido("codex: sólo el tipo", "codex", "codex:gpt-6-sol-high", nd({ item: { type: "reasoning" } }, { item: 5 })),
  latido("codex: cortado a 160 bytes", "codex", "codex:gpt-6-sol-high", nd({ item: { command: largo } })),
  latido("codex: sin transcript", "codex", "codex:gpt-6-sol-high", null),
  latido("dsh: tool_call con comando", "dsh", "dsh:ollama/qwen3", nd({ type: "tool_call", tool: "bash", input: { command: "cargo test" } }, { type: "usage" })),
  latido("dsh: tool_call con ruta y sin herramienta", "dsh", "dsh:deepseek/x", nd({ type: "tool_call", input: { file_path: "src/a.ts" } })),
  latido("opencode: tool_use con filePath", "dsh", "opencode:opencode/big-pickle", nd({ type: "tool_use", part: { tool: "read", state: { input: { filePath: "/x/y.ts" } } } })),
  latido("opencode: texto de la parte", "dsh", "opencode:opencode/big-pickle", nd({ type: "text", part: { text: "pienso que sí" } })),
  latido("dsh: pensando", "dsh", "dsh:ollama/qwen3", nd({ type: "text", text: "hola" }, { type: "reasoning" })),
  latido("dsh: herramienta con input numérico", "dsh", "dsh:ollama/qwen3", nd({ type: "tool_call", tool: 7, input: { pattern: 42 } })),
];

// ============================================================================ privacidad

const sec = (nombre: string, texto: string) => mo(`secreto en el pedido: ${nombre}`, ["secreto-en", texto]);
const casosPrivacidad: Caso[] = [
  sec("nada", "arreglá el test de login, el que falla en CI"),
  sec("clave sk-", "usá la key sk-abcd1234 para probar"),
  sec("token de GitHub", "ghp_abcdef123456"),
  sec("AWS", "AKIAABCDEFGHIJKL"),
  sec("clave privada", "pegué esto:\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc"),
  sec("mail", "avisale a ana.perez+trama@empresa.com.ar"),
  sec("teléfono internacional", "llamá al +54 11 4567 8901"),
  sec("teléfono local", "o al (011) 4567-8901 mañana"),
  sec("token largo", "el hash es a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8"),
  sec("sólo letras largas no es token", "abcdefghijklmnopqrstuvwxyzabcdefghijkl"),
  sec("número de versión no es teléfono", "subí a 1.2.3 y probá 2024"),
  sec("sk- pegado a una palabra no", "task-runner ask-me"),
  sec("multilínea: el mail en la segunda", "primera línea\nescribí a x@y.io"),
  mo(
    "secreto trackeado: .env.example no, config/.env sí",
    (c) => ["secreto-trackeado", c.proyecto],
    {
      preparar: (c) => {
        for (const f of [".env.example", "id_rsa.pub", "README.md", "config/.env"]) escribir(path.join(c.proyecto, f), "x\n");
        spawnSync("git", ["-C", c.proyecto, "add", "."]);
        spawnSync("git", ["-C", c.proyecto, "-c", "user.email=a@b", "-c", "user.name=x", "commit", "-qm", "f"]);
      },
    },
  ),
  mo("secreto trackeado: id_ sin punto", (c) => ["secreto-trackeado", c.proyecto], {
    preparar: (c) => {
      for (const f of ["a/id_deploy", "b/id_x.txt"]) escribir(path.join(c.proyecto, f), "x\n");
      spawnSync("git", ["-C", c.proyecto, "add", "."]);
      spawnSync("git", ["-C", c.proyecto, "-c", "user.email=a@b", "-c", "user.name=x", "commit", "-qm", "f"]);
    },
  }),
  mo("secreto trackeado: repo limpio", (c) => ["secreto-trackeado", c.proyecto]),
  mo("privacidad: el pedido manda", (c) => ["privacidad", c.proyecto, "mi clave es sk-1234567"]),
  mo("privacidad: el repo", (c) => ["privacidad", c.proyecto, "nada raro"], {
    preparar: (c) => {
      escribir(path.join(c.proyecto, "certs", "srv.pem"), "x\n");
      spawnSync("git", ["-C", c.proyecto, "add", "."]);
      spawnSync("git", ["-C", c.proyecto, "-c", "user.email=a@b", "-c", "user.name=x", "commit", "-qm", "f"]);
    },
  }),
];

// ============================================================================ modelos

const MODELOS = [
  "gemini-4-argon-high",
  "gemini-3.8-flash-low",
  "Gemini-4-Argon-Medium",
  "agy:claude-opus-5-5-high",
  "agy:claude-sonnet-5-5-low",
  "agy:gpt-oss-120b-medium",
  "codex:gpt-6-astra-low",
  "codex:gpt-6-luna-low",
  "codex:gpt-6-luna-medium",
  "codex:gpt-6-luna-high",
  "codex:gpt-6.1-sol-medium",
  "CODEX:gpt-6-sol-high",
  "dsh:ollama/qwen3-coder:30b",
  "dsh:opencode/big-pickle",
  "dsh:opencode/kimi-k2",
  "dsh:deepseek/deepseek-v4-flash",
  "DSH:Ollama/x",
  "opencode:opencode/glm-5.3-flash-free",
  "opencode:anthropic/claude-x",
  "opencode:suelto",
  "ollama:qwen3:30b",
  "claude-sonnet-5-5",
];
const casosModelos: Caso[] = [
  ...MODELOS.map((m) => mo(`clasificar ${m}`, ["clasificar", m])),
  ...MODELOS.map((m) => mo(`equivalente de ${m}`, ["equivalente", m])),
];

// ============================================================================ keys de dsh y el Ollama de siempre

const clave = (nombre: string, n: string, archivo: string | null, env: Record<string, string> = {}) =>
  mo(`clave: ${nombre}`, ["clave", n], {
    rc: 0,
    preparar: (c) => {
      if (archivo !== null) escribir(aux(c, "claves.env"), archivo);
    },
    env: (c) => ({ TRAMA_CLAVES: aux(c, "claves.env"), ...env }),
  });
const casosClaves: Caso[] = [
  clave("del entorno", "DEEPSEEK_API_KEY", null, { DEEPSEEK_API_KEY: "sk-del-entorno" }),
  clave("el entorno gana al archivo", "OPENCODE_API_KEY", "OPENCODE_API_KEY=del-archivo\n", { OPENCODE_API_KEY: "del-entorno" }),
  clave("del archivo con export y comillas", "OPENCODE_API_KEY", 'export OPENCODE_API_KEY = "oc-123"\n'),
  clave("comillas simples y CRLF", "DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY='ds-9'\r\n"),
  clave("la última gana", "DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY=uno\nDEEPSEEK_API_KEY=dos"),
  clave("valor con espacios no va", "DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY=a b\n"),
  clave("otra clave no se lee", "OTRA_KEY", "OTRA_KEY=x\n", { OTRA_KEY: "y" }),
  clave("sin archivo ni entorno", "DEEPSEEK_API_KEY", null),
  mo("local de: el Ollama de siempre", ["local-de", "ollama:qwen3-coder:30b"]),
  mo("local de: OLLAMA_HOST sin http", ["local-de", "ollama:x"], { env: { OLLAMA_HOST: "otra:11434" } }),
  mo("local de: barra al final de la url y del modelo", ["local-de", "ollama:raro/"], { env: { OLLAMA_HOST: "http://h:1/" } }),
];

// ============================================================================ AGENTS.md para los modelos que no son Claude

const bloque = (nombre: string, archivos: Record<string, string>, carpetas: string[], env: Record<string, string> = {}) =>
  mo(`AGENTS.md: ${nombre}`, (c) => ["bloque", ...carpetas.map((d) => aux(c, d))], {
    preparar: (c) => {
      for (const [f, t] of Object.entries(archivos)) escribir(aux(c, f), t);
    },
    env,
  });
const casosBloque: Caso[] = [
  bloque("AGENTS.md con un import", { "w/AGENTS.md": "# Proyecto\n@doc/reglas.md\nfin\n", "w/doc/reglas.md": "regla 1\r\nregla 2\n\n" }, ["w"]),
  bloque("el import dentro de un bloque de código no se resuelve", { "w/AGENTS.md": "```\n@doc/reglas.md\n```\n@doc/reglas.md\n", "w/doc/reglas.md": "R\n" }, ["w"]),
  bloque("imports que salen de la carpeta o son absolutos quedan como texto", { "w/AGENTS.md": "@../fuera.md\n@/etc/hostname\n@~/x.md\n@no-existe.md\n", "fuera.md": "secreto\n" }, ["w"]),
  bloque("AGENTS.md stub sin destino cae al CLAUDE.md", { "w/AGENTS.md": "<!-- stub -->\n@AGENTS.md\n", "w/CLAUDE.md": "las reglas\n" }, ["w"]),
  bloque("el worktree primero, después el tree principal", { "p/AGENTS.md": "del principal\n", "w/CLAUDE.md": "del worktree\n" }, ["w", "p"]),
  bloque("vacío: nada", { "w/AGENTS.md": "  \n\n" }, ["w"]),
  bloque("truncado con aviso (PA_AGENTS_MAX)", { "w/AGENTS.md": `${"ñandú y acentos ".repeat(10)}\nfin\n` }, ["w"], { PA_AGENTS_MAX: "40" }),
  bloque("PA_AGENTS_MAX inválido usa el de siempre", { "w/AGENTS.md": "corto\n" }, ["w"], { PA_AGENTS_MAX: "abc" }),
];

// ============================================================================ argv y entorno de cada motor

type Armar = { motor: string; modelo: string; leer?: boolean; actualizar?: boolean; maxTurns?: string; ocEffort?: string; mapa?: boolean; claudeMd?: boolean; env?: Record<string, string> };
const armar = (nombre: string, o: Armar): Caso =>
  mo(
    `armado: ${nombre}`,
    (c) => [
      "armar",
      o.motor,
      o.modelo,
      c.proyecto,
      c.proyecto,
      "pa/demo/20261028-000000-1",
      aux(c, "estado-demo"),
      "20261028-000000-1",
      aux(c, "demo.heartbeat"),
      aux(c, "mapa", "demo.md"),
      o.leer ? "1" : "0",
      o.actualizar ? "1" : "",
      o.maxTurns ?? "",
      o.ocEffort ?? "",
    ],
    {
      preparar: (c) => {
        escribir(path.join(c.proyecto, "AGENTS.md"), "Reglas del proyecto.\n");
        if (o.mapa) escribir(aux(c, "mapa", "demo.md"), "mapa\n");
        if (o.claudeMd !== false) escribir(path.join(c.home, ".claude", "CLAUDE.md"), "Reglas del dueño.\n\n");
      },
      env: { P_CONTRATO: "CONTRATO\nde prueba", P_PROMPT: "hacé algo\ncon dos líneas", ...(o.env ?? {}) },
    },
  );
const casosArmar: Caso[] = [
  armar("agy", { motor: "agy", modelo: "gemini-4-argon-high" }),
  armar("agy: claude por agy, --leer y --actualizar, timeout propio", { motor: "agy", modelo: "agy:claude-opus-5-5-high", leer: true, actualizar: true, env: { PA_AGY_TIMEOUT: "60" } }),
  armar("agy sin CLAUDE.md del dueño", { motor: "agy", modelo: "gemini-3.8-flash-low", claudeMd: false }),
  armar("codex con el .git común, CARGO_TARGET_DIR y el mapa", { motor: "codex", modelo: "codex:gpt-6-sol-high", mapa: true, env: { CARGO_TARGET_DIR: "/tmp/target-x" } }),
  armar("codex --leer (read-only, sin --add-dir)", { motor: "codex", modelo: "codex:gpt-6.1-sol-low", leer: true, mapa: true }),
  armar("dsh deepseek: sin el CLAUDE.md del dueño", { motor: "dsh", modelo: "dsh:deepseek/deepseek-v4-flash" }),
  armar("dsh ollama: CLAUDE.md, --url y --max-pasos", { motor: "dsh", modelo: "dsh:ollama/qwen3-coder:30b", maxTurns: "12", env: { OLLAMA_HOST: "http://gpu:11434/" } }),
  armar("opencode con effort", { motor: "dsh", modelo: "opencode:opencode/big-pickle", ocEffort: "high" }),
  armar("dsh con effort (no viaja)", { motor: "dsh", modelo: "dsh:opencode/kimi", ocEffort: "high" }),
];

export const casosMotores: Caso[] = [...casosAgy, ...casosCodex, ...casosLatido, ...casosPrivacidad, ...casosModelos, ...casosClaves, ...casosBloque, ...casosArmar];
