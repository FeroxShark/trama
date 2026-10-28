// Casos de paridad de las herramientas chicas: proyecto-ruta, trama-estado y workers (original en motor/bin vs. su port a TS en
// app/electron/cli). Mismo formato que casos.ts; cada caso dice `herramienta`. Todo es POSIX (los originales son bash/python):
// los fixtures usan scripts `#!/bin/sh` como programas falsos.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";

const reg = (c: Contexto) => path.join(c.home, ".config", "proyectos", "registry.json");
const registro = (c: Contexto, projects: unknown[]) => writeFileSync(reg(c), JSON.stringify({ projects }));
/** Crea (y devuelve) una carpeta bajo el espacio auxiliar del caso. */
const carpeta = (c: Contexto, ...rel: string[]) => {
  const d = path.join(c.aux, ...rel);
  mkdirSync(d, { recursive: true });
  return d;
};
const escribir = (ruta: string, texto: string, modo?: number) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
  if (modo) chmodSync(ruta, modo);
};
const programa = (ruta: string, cuerpo: string) => escribir(ruta, `#!/bin/sh\n${cuerpo}\n`, 0o755);
const ahora = () => Math.floor(Date.now() / 1000);
const VIEJO = 1704110400; // 2024-01-01T12:00:00Z

// ============================================================================ proyecto-ruta

const pr = (nombre: string, args: Caso["args"], rc: number, preparar?: Caso["preparar"], env?: Caso["env"]): Caso => ({ herramienta: "proyecto-ruta", nombre: `proyecto-ruta: ${nombre}`, args, rc, preparar, env });

const varios = (c: Contexto) => {
  registro(c, [
    { name: "demo", path: c.proyecto },
    { name: "proyecto-a", path: carpeta(c, "a") },
    { name: "proyecto-b", path: carpeta(c, "b") },
    { name: "Unico-Mayus", path: carpeta(c, "u") },
    { name: "cartera-usd", path: carpeta(c, "cartera") },
  ]);
};

const casosRuta: Caso[] = [
  pr("exacto", ["demo"], 0),
  pr("exacto sin distinguir mayúsculas", ["DEMO"], 0),
  pr("--listar ordenado y sin repetidos", ["--listar"], 0, (c) => registro(c, [{ name: "zeta", path: c.proyecto }, { name: "alfa", path: c.proyecto }, { name: "alfa", path: c.proyecto }, { name: "Beta", path: c.proyecto }])),
  pr("--listar con registry vacío", ["--listar"], 0, (c) => registro(c, [])),
  pr("sin argumentos", [], 2),
  pr("dos argumentos", ["a", "b"], 2),
  pr("nombre vacío", [""], 2),
  pr("no existe: lista los proyectos", ["fantasma"], 1, varios),
  pr("substring único", ["cartera"], 0, varios),
  pr("substring ambiguo", ["proyecto"], 1, varios),
  pr("substring sin distinguir mayúsculas", ["MAYUS"], 0, varios),
  pr("dos nombres para la misma carpeta no son ambiguos", ["mpv"], 0, (c) => registro(c, [{ name: "mpv-guard", path: c.proyecto }, { name: "mpv-guard / vram-guard", path: c.proyecto }])),
  pr("exacto gana al substring", ["proyecto-a"], 0, (c) => registro(c, [{ name: "proyecto-a", path: carpeta(c, "a") }, { name: "proyecto-a-vieja", path: carpeta(c, "viejo") }])),
  pr("registry inexistente", ["demo"], 1, undefined, (c) => ({ PROYECTOS_REGISTRY: path.join(c.aux, "no-hay.json") })),
  pr("--listar con registry inexistente", ["--listar"], 1, undefined, (c) => ({ PROYECTOS_REGISTRY: path.join(c.aux, "no-hay.json") })),
  pr("por titulo", ["Mi Titulo"], 0, (c) => registro(c, [{ name: "x", path: c.proyecto, titulo: "mi titulo" }])),
  pr("por alias (lista)", ["otro"], 0, (c) => registro(c, [{ name: "x", path: c.proyecto, alias: ["Otro", "tercero"] }])),
  pr("por aliases (texto)", ["tercero"], 0, (c) => registro(c, [{ name: "x", path: c.proyecto, aliases: "Tercero" }])),
  pr("alias que ya es el nombre de otro: gana el nombre", ["b"], 0, (c) => registro(c, [{ name: "a", path: carpeta(c, "a"), alias: ["b"] }, { name: "b", path: carpeta(c, "b") }])),
  pr("alias en dos carpetas distintas es ambiguo", ["comun"], 1, (c) => registro(c, [{ name: "uno", path: carpeta(c, "uno"), alias: "comun" }, { name: "dos", path: carpeta(c, "dos"), titulo: "Comun" }])),
  pr("alias repetido en la misma carpeta (con ~) no es ambiguo", ["comun"], 0, (c) => {
    const d = carpeta(c, "home-x");
    registro(c, [{ name: "uno", path: d, alias: "comun" }, { name: "dos", path: "~/" + path.relative(c.home, d), alias: "comun" }]);
  }),
  pr("ruta con ~", ["tilde"], 0, (c) => { carpeta(c, "..", "home", "dir-tilde"); registro(c, [{ name: "tilde", path: "~/dir-tilde" }]); }),
  pr("el registry apunta a un archivo: va a su carpeta", ["script"], 0, (c) => { const d = carpeta(c, "uno-solo"); writeFileSync(path.join(d, "run.sh"), "x"); registro(c, [{ name: "script", path: path.join(d, "run.sh") }]); }),
  pr("symlink: devuelve la ruta real", ["enlace"], 0, (c) => { symlinkSync(c.proyecto, path.join(c.aux, "enlace")); registro(c, [{ name: "enlace", path: path.join(c.aux, "enlace") }]); }),
  pr("la ruta no existe (falta sólo el último componente)", ["roto"], 1, (c) => registro(c, [{ name: "roto", path: path.join(c.aux, "no-esta") }])),
  pr("la ruta no existe (falta más de un componente)", ["roto"], 1, (c) => registro(c, [{ name: "roto", path: path.join(c.aux, "no", "esta", "tampoco") }])),
  pr("la ruta es un archivo suelto que no es carpeta", ["x"], 0, (c) => { writeFileSync(path.join(c.aux, "f.txt"), "x"); registro(c, [{ name: "x", path: path.join(c.aux, "f.txt") }]); }),
];

// ============================================================================ trama-estado

const te = (nombre: string, args: string[], preparar?: Caso["preparar"], env?: Caso["env"]): Caso => ({
  herramienta: "trama-estado",
  nombre: `trama-estado: ${nombre}`,
  args,
  rc: 0,
  preparar,
  // Nada de lo que haya en la máquina: ni agy/dsh/opencode reales, ni un motor u Ollama escuchando.
  env: (c) => ({
    TRAMA_CLAUDE: "trama-no-existe-claude",
    TRAMA_AGY: "trama-no-existe-agy",
    HILOS_DSH: path.join(c.aux, "no-hay-dsh"),
    HILOS_OPENCODE: path.join(c.aux, "no-hay-opencode"),
    TRAMA_PUERTO: "1",
    OLLAMA_HOST: "127.0.0.1:1",
    XDG_DATA_HOME: path.join(c.home, ".local", "share"),
    CLAUDE_CONFIG_DIR: path.join(c.home, ".claude"),
    ...(typeof env === "function" ? env(c) : env),
  }),
});

const claudeFalso = (c: Contexto, cuerpo: string) => { programa(path.join(c.aux, "bin", "claude"), cuerpo); return path.join(c.aux, "bin", "claude"); };
const programasFalsos = (c: Contexto) => {
  programa(path.join(c.aux, "bin", "dsh"), 'echo "dsh 9.9.9 extra"; echo segunda');
  programa(path.join(c.aux, "bin", "opencode"), 'if [ "$1" = auth ]; then printf "\\033[32m|  OpenCode Console  stored\\033[0m\\n"; else echo "opencode 1.2.3"; fi');
  programa(path.join(c.aux, "bin", "agy"), 'printf "gemini-3-pro\\tGemini 3 Pro\\nclaude-x\\n"');
};
const conFalsos = (c: Contexto) => ({
  HILOS_DSH: path.join(c.aux, "bin", "dsh"),
  HILOS_OPENCODE: path.join(c.aux, "bin", "opencode"),
  TRAMA_AGY: path.join(c.aux, "bin", "agy"),
});

const casosEstado: Caso[] = [
  te("--json sin nada instalado", ["--json"]),
  te("en palabras sin nada instalado", []),
  te("programas instalados y con sesión", ["--json"], programasFalsos, conFalsos),
  te("programas instalados, en palabras", [], programasFalsos, conFalsos),
  te("keys por entorno y por claves.env (sólo si están, nunca el valor)", ["--json"], (c) => escribir(path.join(c.aux, "claves.env"), "export DEEPSEEK_API_KEY='valor-falso'\r\nOPENCODE_API_KEY=\n"), (c) => ({ TRAMA_CLAVES: path.join(c.aux, "claves.env"), OPENCODE_API_KEY: "" })),
  te("key de opencode por entorno", ["--json"], undefined, { OPENCODE_API_KEY: "valor-falso" }),
  te("opencode con auth.json", ["--json"], (c) => {
    programa(path.join(c.aux, "bin", "opencode"), 'echo "opencode 0.9"');
    escribir(path.join(c.home, ".local", "share", "opencode", "auth.json"), '{"opencode":{"type":"api"}}');
  }, (c) => ({ HILOS_OPENCODE: path.join(c.aux, "bin", "opencode") })),
  te("opencode sin sesión", ["--json"], (c) => programa(path.join(c.aux, "bin", "opencode"), 'echo "opencode 0.9"'), (c) => ({ HILOS_OPENCODE: path.join(c.aux, "bin", "opencode") })),
  te("dsh que no anda (HILOS_DSH sin permiso)", ["--json"], (c) => escribir(path.join(c.aux, "bin", "dsh"), "x"), (c) => ({ HILOS_DSH: path.join(c.aux, "bin", "dsh") })),
  te("claude con sesión (auth status)", ["--json"], (c) => claudeFalso(c, 'echo \'{"loggedIn": true}\''), (c) => ({ TRAMA_CLAUDE: path.join(c.aux, "bin", "claude") })),
  te("claude sin sesión (auth status)", ["--json"], (c) => claudeFalso(c, 'echo \'{"loggedIn": false}\''), (c) => ({ TRAMA_CLAUDE: path.join(c.aux, "bin", "claude") })),
  te("claude viejo: sin JSON y con credenciales", ["--json"], (c) => { claudeFalso(c, "echo no se esta"); escribir(path.join(c.home, ".claude", ".credentials.json"), "{}"); }, (c) => ({ TRAMA_CLAUDE: path.join(c.aux, "bin", "claude") })),
  te("claude viejo: sin JSON y sin credenciales", ["--json"], (c) => claudeFalso(c, "echo no se esta"), (c) => ({ TRAMA_CLAUDE: path.join(c.aux, "bin", "claude") })),
  te("claude que falla: no hay fallback", ["--json"], (c) => { claudeFalso(c, "exit 3"); escribir(path.join(c.home, ".claude", ".credentials.json"), "{}"); }, (c) => ({ TRAMA_CLAUDE: path.join(c.aux, "bin", "claude") })),
  te("ollama por modelos.json (url con barra final)", ["--json"], (c) => escribir(path.join(c.aux, "modelos.json"), '{"locales":[{"nombre":"x"},{"url":"http://127.0.0.1:1/"}]}'), (c) => ({ TRAMA_MODELOS: path.join(c.aux, "modelos.json") })),
  te("ollama por OLLAMA_HOST con esquema", ["--json"], undefined, { OLLAMA_HOST: "http://127.0.0.1:1///" }),
  te("modelos.json roto", ["--json"], (c) => escribir(path.join(c.aux, "modelos.json"), "{no es json"), (c) => ({ TRAMA_MODELOS: path.join(c.aux, "modelos.json") })),
  te("motor: dueño vivo sin HTTP", ["--json"], (c) => escribir(path.join(c.home, ".local", "state", "hilos", "dueno"), JSON.stringify({ pid: process.pid }))),
  te("motor: dueño muerto", ["--json"], (c) => escribir(path.join(c.home, ".local", "state", "hilos", "dueno"), JSON.stringify({ pid: 2 ** 22 + 12345 }))),
  te("motor: dueño ilegible", ["--json"], (c) => escribir(path.join(c.home, ".local", "state", "hilos", "dueno"), "basura")),
  te("motor: HILOS_STATE y puerto propios", ["--json"], (c) => escribir(path.join(c.aux, "hilos", "dueno"), JSON.stringify({ pid: process.pid })), (c) => ({ HILOS_STATE: path.join(c.aux, "hilos"), TRAMA_PUERTO: "2" })),
  te("--json en cualquier posición", ["x", "--json"]),
];

// ============================================================================ workers

const wk = (nombre: string, args: string[], rc: number, preparar?: Caso["preparar"], env?: Caso["env"]): Caso => ({ herramienta: "workers", nombre: `workers: ${nombre}`, args, rc, preparar, env });

type Run = { slug: string; pid?: number | string; inicio?: number; tarea?: string; modelo?: string; leer?: boolean; id?: string; jefe?: string; puesto?: string; rama?: string; cuenta?: string; transcript?: string; archivo?: string };
const running = (c: Contexto, r: Run) => {
  const lineas = [`proyecto=${r.slug}`, `pid=${r.pid ?? process.pid}`, `inicio=${r.inicio ?? VIEJO}`, `tarea=${r.tarea ?? "una tarea"}`, `modelo=${r.modelo ?? "claude-prueba"}`];
  if (r.leer) lineas.push("leer=1");
  if (r.id) lineas.push(`id=${r.id}`);
  if (r.jefe !== undefined) lineas.push(`jefe=${r.jefe}`);
  if (r.puesto) lineas.push(`puesto=${r.puesto}`);
  if (r.rama) lineas.push(`rama=${r.rama}`);
  if (r.cuenta) lineas.push(`cuenta=${r.cuenta}`);
  if (r.transcript) lineas.push(`transcript=${r.transcript}`);
  const f = path.join(c.estado, r.archivo ?? `${r.slug}.running`);
  escribir(f, lineas.join("\n") + "\n");
  return f;
};
const latido = (f: string, epoch: number, tool: string, desc: string, envuelo: boolean) => escribir(f.replace(/\.running$/, ".heartbeat"), `epoch=${epoch}\ntool=${tool}\ndesc=${desc}\nenvuelo=${envuelo ? 1 : 0}\n`);

const variosWorkers = (c: Contexto) => {
  const a = running(c, { slug: "demo", id: "20260101-000000-1", jefe: "jefe-1", puesto: "2", rama: "pa/demo-1", tarea: "x".repeat(90), cuenta: "claude" });
  latido(a, ahora() - 30, "Bash", "compilando un proyecto bastante grande con una descripcion de mas de sesenta caracteres de largo", true);
  const b = running(c, { slug: "otro", puesto: "aca" });
  latido(b, VIEJO, "Edit", "algo", false);
  const d = running(c, { slug: "demo", archivo: "demo.leer-abc.running", leer: true, id: "abc", tarea: "mirar" });
  latido(d, ahora() - 12, "Grep", "buscando cosas en todos lados", false);
  running(c, { slug: "sinlatido", id: "zz" });
  running(c, { slug: "muerto", pid: 2 ** 22 + 777 });
  running(c, { slug: "viejo-sin-pid-pa", pid: "" });
};

/** Un proceso que vive un rato (para `ver`, que sigue al transcript hasta que el worker muere). */
const dormilon = (): number => {
  const r = spawnSync("sh", ["-c", "sleep 2 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" });
  return Number(r.stdout.trim());
};

const CLAUDE_JSONL = [
  { type: "user", timestamp: "2024-01-01T12:00:01.000Z", message: { content: "hacé algo\ncon saltos\ty tabs   y espacios" } },
  { type: "assistant", timestamp: "2024-01-01T12:00:02.000Z", message: { content: [{ type: "thinking", thinking: "pienso mucho" }, { type: "text", text: "Voy a mirar" }, { type: "tool_use", name: "Bash", input: { command: "ls -la" } }] } },
  { type: "user", timestamp: "2024-01-01T12:00:04.000Z", message: { content: [{ type: "tool_result", content: "a.txt\nb.txt" }] } },
  { type: "assistant", timestamp: "2024-01-01T12:00:05.000Z", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/x/y.ts" } }, { type: "tool_use", name: "Task", input: { foo: 1, bar: [1, 2] } }, { type: "tool_use", name: "Agent", input: "texto" }, { type: "text", text: "é".repeat(450) }] } },
  { type: "user", timestamp: "2024-01-01T12:00:06.000Z", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "uno" }, { type: "image" }] }, { type: "image" }] } },
  { type: "system", subtype: "init" },
  { type: "assistant", message: { content: "sin timestamp y texto directo" } },
  { type: "user", timestamp: "2024-01-01T12:00:09Z", message: { content: [{ type: "tool_result", content: { raro: true } }] } },
];
const jsonl = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
const AGY = [
  { event: "init", init: { model: "gemini-prueba" } },
  { event: "step_update", step_update: { step_index: 1, step_type: "agent_response", text_delta: "Hola " } },
  { event: "step_update", step_update: { step_index: 1, step_type: "agent_response", text_delta: "mundo" } },
  { event: "step_update", step_update: { step_index: 2, step_type: "tool", state: "ACTIVE", tool_name: "run_command", tool_info: { parameters: { CommandLine: "ls -la" } } } },
  { event: "step_update", step_update: { step_index: 2, step_type: "tool", state: "DONE", tool_info: { name: "run_command", output: "a.txt" } } },
  { event: "step_update", step_update: { step_index: 3, step_type: "tool", state: "DONE", tool_info: { output: { k: 1 } } } },
  { event: "step_update", step_update: { step_index: 4, step_type: "agent_response", text_delta: "final" } },
  { event: "result", result: { status: "FAILED" } },
];
const CODEX = [
  { type: "thread.started" },
  { type: "item.started", item: { type: "command_execution", command: "ls" } },
  { type: "item.completed", item: { type: "command_execution", exit_code: 1, aggregated_output: "no\nhay" } },
  { type: "item.completed", item: { type: "agent_message", text: "listo" } },
  { type: "item.completed", item: { type: "file_change", changes: [{ path: "a.ts" }, { path: "b.ts" }] } },
  { type: "item.completed", item: { type: "mcp_tool_call", server: "s", tool: "t" } },
  { type: "item.completed", item: { type: "web_search", query: "algo" } },
  { type: "item.completed", item: { type: "reasoning", text: "pienso" } },
  { type: "turn.failed", error: { message: "se rompió" } },
];
const DSH = [
  { type: "session", sessionId: "abc" },
  { type: "text", text: "hola" },
  { type: "thinking", text: "pienso" },
  { type: "tool_call", tool: "bash", input: { command: "ls" } },
  { type: "tool_result", status: "error", result: { r: 1 } },
  { type: "status", phase: "turn_end", reason: { kind: "error", error: { message: "mal" } } },
  { type: "final", text: "hola" },
];
const OPENCODE = [
  { type: "step_start" },
  { type: "text", part: { text: "hola" } },
  { type: "tool_use", part: { tool: "bash", state: { status: "completed", input: { command: "ls" }, output: "a" } } },
  { type: "tool_use", part: { tool: "read", state: { status: "error", input: { filePath: "/x" }, error: "no" } } },
  { type: "error", error: { name: "Boom", data: { message: "falló" } } },
];

const verCon = (nombre: string, modelo: string, lineas: string, args: string[] = ["--todo"], inicio = VIEJO + 3): Caso => ({
  herramienta: "workers",
  nombre: `workers: ver ${nombre}`,
  args: ["ver", ...args],
  rc: 0,
  preparar: (c) => {
    const tr = path.join(c.aux, "transcript.jsonl");
    escribir(tr, lineas);
    running(c, { slug: "demo", pid: dormilon(), modelo, inicio, transcript: tr });
  },
  env: { WORKERS_PENSAR: "1" },
});

/** Dejar un transcript de Claude de `demo` (el que lee `ultimo`) con su fecha. */
const transcriptDemo = (c: Contexto, sid: string, texto: string, mtime: number) => {
  const f = path.join(c.home, ".claude", "projects", c.proyecto.replace(/[^A-Za-z0-9]/g, "-"), `${sid}.jsonl`);
  escribir(f, texto);
  utimesSync(f, mtime, mtime);
  return f;
};

const casosWorkers: Caso[] = [
  wk("--help", ["--help"], 0),
  wk("-h", ["-h"], 0),
  wk("ayuda", ["ayuda"], 0),
  wk("subcomando desconocido", ["zzz"], 2),
  wk("lista vacía", [], 0),
  wk("lista (ls)", ["ls"], 0, variosWorkers),
  wk("lista con workers vivos, huérfanos y latidos de todos los tipos", [], 0, variosWorkers),
  wk("lista con un latido que piensa", ["lista"], 0, (c) => { const f = running(c, { slug: "demo", puesto: "1" }); latido(f, ahora() - 5, "Edit", "archivo.ts", false); }),
  wk("--json vacío", ["--json"], 0),
  wk("--json con workers", ["--json"], 0, variosWorkers),
  wk("lista: subagentes recientes", [], 0, (c) => {
    escribir(path.join(c.home, ".claude", "projects", "-x", "s1", "subagents", "agent-1.jsonl"), jsonl([{ type: "user" }, { type: "assistant", message: { content: [{ type: "text", text: "pensando\nen voz alta" }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] } }]));
    escribir(path.join(c.home, ".claude", "projects", "-x", "s1", "subagents", "agent-2.jsonl"), jsonl([{ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { description: "arreglo", command: "x" } }] } }]));
    const viejo = path.join(c.home, ".claude", "projects", "-x", "s1", "subagents", "agent-viejo.jsonl");
    escribir(viejo, "{}\n");
    utimesSync(viejo, VIEJO, VIEJO);
  }),
  wk("lista: ramas sin integrar", [], 0, (c) => {
    const git = (...a: string[]) => spawnSync("git", ["-C", c.proyecto, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
    git("checkout", "-q", "-b", "pa/demo-1");
    git("commit", "-q", "--allow-empty", "-m", "trabajo");
    git("checkout", "-q", "main");
    git("branch", "pa/demo-2");
    for (const [n, rama, origen] of [["a", "pa/demo-1", ""], ["b", "pa/demo-2", ""], ["c", "pa/no-existe", ""], ["d", "pa/demo-1", "seguir"]] as const) {
      escribir(path.join(c.estado, "demo", `${n}.corrida`), `rama=${rama}\nruta_trabajo=${c.proyecto}\norigen=${origen}\n`);
    }
  }),
  wk("ver: sin workers", ["ver"], 1),
  wk("ver: proyecto sin worker", ["ver", "demo"], 1),
  wk("ver: varios workers sin decir cuál", ["ver"], 1, variosWorkers),
  wk("ver: dos writers en el mismo proyecto", ["ver", "demo"], 1, (c) => { running(c, { slug: "demo", id: "a1", puesto: "1" }); running(c, { slug: "demo", archivo: "demo.2.running", id: "a2", puesto: "2" }); }),
  wk("ver: .running sin transcript", ["ver"], 1, (c) => running(c, { slug: "demo" })),
  { ...wk("ver: el transcript no aparece", ["ver"], 1, (c) => running(c, { slug: "demo", transcript: path.join(c.aux, "no-aparece.jsonl") })), env: {} },
  verCon("claude (--todo)", "claude-prueba", jsonl(CLAUDE_JSONL)),
  verCon("claude desde el inicio de la corrida", "claude-prueba", jsonl(CLAUDE_JSONL), []),
  verCon("claude con una línea rota (jq corta ahí)", "claude-prueba", jsonl(CLAUDE_JSONL.slice(0, 2)) + "{roto\n" + jsonl(CLAUDE_JSONL.slice(2))),
  verCon("claude con un tipo inesperado (jq corta ahí)", "claude-prueba", jsonl(CLAUDE_JSONL.slice(0, 2)) + jsonl([{ type: "assistant", message: { content: [{ type: "text", text: 5 }] } }]) + jsonl(CLAUDE_JSONL.slice(2))),
  verCon("agy", "agy:prueba", jsonl(AGY) + "no es json\n"),
  verCon("codex", "codex:prueba", jsonl(CODEX)),
  verCon("dsh", "dsh:prueba", jsonl(DSH)),
  verCon("opencode", "opencode:prueba", jsonl(OPENCODE)),
  verCon("formato por la primera línea (codex sin modelo conocido)", "otro", jsonl(CODEX)),
  verCon("formato por la primera línea (agy)", "otro", jsonl(AGY)),
  verCon("formato por la primera línea (dsh)", "otro", jsonl(DSH)),
  verCon("formato por la primera línea (opencode)", "otro", jsonl(OPENCODE)),
  wk("ultimo: sin proyecto", ["ultimo"], 2),
  wk("ultimo: proyecto que no existe", ["ultimo", "fantasma"], 1),
  wk("ultimo: sin transcripts", ["ultimo", "demo"], 1),
  wk("ultimo: por el .session de pa", ["ultimo", "demo"], 0, (c) => {
    transcriptDemo(c, "sid-viejo", jsonl(CLAUDE_JSONL.slice(0, 1)), VIEJO);
    transcriptDemo(c, "sid-pa", jsonl(CLAUDE_JSONL), VIEJO + 100);
    transcriptDemo(c, "sid-otro", jsonl(CLAUDE_JSONL.slice(0, 2)), VIEJO + 200);
    escribir(path.join(c.estado, "demo.session"), "sid-pa\n");
  }),
  wk("ultimo: sin .session, el jsonl más nuevo", ["ultimo", "demo"], 0, (c) => {
    transcriptDemo(c, "sid-viejo", jsonl(CLAUDE_JSONL.slice(0, 1)), VIEJO);
    transcriptDemo(c, "sid-nuevo", jsonl(CLAUDE_JSONL.slice(0, 3)), VIEJO + 200);
  }),
  wk("ultimo: gana el stream de un worker de otro motor", ["ultimo", "demo"], 0, (c) => {
    transcriptDemo(c, "sid-viejo", jsonl(CLAUDE_JSONL.slice(0, 1)), VIEJO);
    const s = path.join(c.estado, "demo", "20260101-000000-1.stream.jsonl");
    escribir(s, jsonl(AGY));
    utimesSync(s, VIEJO + 500, VIEJO + 500);
  }),
  wk("ultimo: la corrida sin VERIFICACION se avisa", ["ultimo", "demo"], 0, (c) => {
    transcriptDemo(c, "sid-viejo", jsonl(CLAUDE_JSONL.slice(0, 2)), VIEJO);
    const h1 = path.join(c.estado, "demo", "20260101-000000-1.hilo");
    const h2 = path.join(c.estado, "demo", "20260101-000000-2.hilo");
    escribir(h1, "verificado=1\n");
    escribir(h2, "verificado=0\n");
    escribir(path.join(c.estado, "demo", "20260101-000000-3.hilo"), "leer=1\nverificado=0\n");
    utimesSync(h1, VIEJO + 1, VIEJO + 1);
    utimesSync(h2, VIEJO + 2, VIEJO + 2);
    utimesSync(path.join(c.estado, "demo", "20260101-000000-3.hilo"), VIEJO + 3, VIEJO + 3);
  }),
  { ...wk("ultimo: con WORKERS_PENSAR", ["ultimo", "demo"], 0, (c) => transcriptDemo(c, "s", jsonl(CLAUDE_JSONL), VIEJO)), env: { WORKERS_PENSAR: "1" } },
  { ...wk("ultimo: el nombre del proyecto con espacios se sanea en el slug", ["ultimo", "con espacio"], 0, (c) => {
    const d = carpeta(c, "Con Espacio");
    registro(c, [{ name: "con espacio", path: d }]);
    escribir(path.join(c.home, ".claude", "projects", d.replace(/[^A-Za-z0-9]/g, "-"), "a.jsonl"), jsonl(CLAUDE_JSONL.slice(0, 2)));
    escribir(path.join(c.estado, "con-espacio.session"), "a\n");
  }) },
];

// ============================================================================ carcasa nativa de Windows

// La carcasa nativa (windows/src/pasos-nativo.js) le pregunta a `trama-estado --json` con el entorno que arma para el motor
// (nativo.js, entornoMotor): las variables de Windows y las del motor no cambian lo que contesta.
const casosCarcasaNativa: Caso[] = [
  te("--json con el entorno de la carcasa nativa de Windows", ["--json"], undefined, (c) => ({
    LOCALAPPDATA: path.join(c.aux, "Local"),
    APPDATA: path.join(c.aux, "Roaming"),
    USERPROFILE: c.home,
    USERNAME: "ana",
    TRAMA_APP: path.join(c.aux, "Local", "trama", "app"),
    HILOS_MOTOR: "1",
    TRAMA_UNIDAD: "1",
    TRAMA_LOCAL: "1",
  })),
];

export const casosHerramientas: Caso[] = [...casosRuta, ...casosEstado, ...casosWorkers, ...casosCarcasaNativa];
