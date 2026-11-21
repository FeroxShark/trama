// electron/pasos-stream.ts: los pasos de un worker de agy (y de opencode / codex) armados desde su `<id>.stream.jsonl`, con la forma
// real de lo que escribe agy (`step_update` con `duration_seconds`, la salida de `run_command` con "Command exited with code N",
// el bloqueo de un hook como ERROR, el texto en deltas). Lo mismo que muestra la vista de un worker de Claude.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ArmadorStream, categoriaDe, salidaDeComando } from "../electron/pasos-stream.ts";
import { crearPasos } from "../electron/pasos-worker.ts";
import type { CambioPasos } from "../electron/pasos.ts";
import { esperarHasta } from "./esperar.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-pasos-stream-"));
const CONV = "267e6656-58ce-4960-ab4c-c78419096b83";
const INICIO = Date.parse("2026-11-21T03:34:03Z");
const jl = (...ls: unknown[]) => ls.map((x) => JSON.stringify(x)).join("\n") + "\n";
const su = (step_index: number, state: string, step_type: string, extra: Record<string, unknown> = {}) => ({ event: "step_update", step_update: { conversation_id: CONV, step_index, state, step_type, ...extra } });
const USO = (i: number, o: number, c: number) => ({ usage: { input_tokens: i, output_tokens: o, thinking_tokens: 5, cache_read_tokens: c, total_tokens: i + o } });
const cmd = (i: number, CommandLine: string) => su(i, "ACTIVE", "tool", { tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine } } });
const cmdListo = (i: number, CommandLine: string, dur: number, output: string, state = "DONE") =>
  su(i, state, "tool", { tool_name: "run_command", duration_seconds: dur, tool_info: { name: "run_command", parameters: { CommandLine }, output } });
const bloqueado = (i: number) => [
  su(i, "ACTIVE", "tool", { tool_name: "read_file", tool_info: { name: "read_file", parameters: { Path: "/w/docs/visor.md" } } }),
  su(i, "ERROR", "tool", {
    tool_name: "read_file",
    duration_seconds: 1.2,
    tool_info: { name: "read_file", parameters: { Path: "/w/docs/visor.md" }, error: { type: "TOOL_ERROR", message: "tool call denied by pre-tool hook: BLOQUEADO: 'read_file' no está permitida en un worker de pa" } },
  }),
];

/** Un worker de agy como el real: pensar, comando (ok), lectura bloqueada, comando que falla, y la respuesta en deltas. */
const AGY = jl(
  { event: "init", conversation_id: CONV, init: { model: "gemini-4-neon-high", cwd: "/w", tools: ["run_command"], permission_mode: "always-proceed" } },
  su(0, "DONE", "user_input"),
  su(1, "DONE", "agent_response", { duration_seconds: 7.5, ...USO(18561, 530, 0) }),
  cmd(2, "ls -la visor/"),
  cmdListo(2, "ls -la visor/", 1.5, "Created At: 2026-11-21T00:34:13-03:00\nCompleted At: 2026-11-21T00:34:14-03:00\nCommand exited with code 0.\n\nCommand output:\nmotion/:\r\ntotal 40\r\nMotion.qml\r\n"),
  ...bloqueado(3),
  su(4, "DONE", "agent_response", { duration_seconds: 4, ...USO(2000, 100, 135873) }),
  cmd(5, "git commit -m x"),
  cmdListo(5, "git commit -m x", 0.5, "Command exited with code 1.\n\nCommand output:\nnothing to commit\r\n"),
  su(6, "ACTIVE", "agent_response", { text_delta: "Listo, " }),
  su(6, "ACTIVE", "agent_response", { text_delta: "terminé." }),
  su(6, "DONE", "agent_response", { text_delta: "\n", duration_seconds: 6, ...USO(2238, 60, 135873) }),
  { event: "result", result: { conversation_id: CONV, status: "SUCCESS", response: "Listo, terminé." } },
);
const ruta = path.join(tmp, "a.stream.jsonl");
writeFileSync(ruta, AGY);

test("agy: cada paso sale con su tipo, su estado y su salida", async () => {
  const a = new ArmadorStream(ruta, { inicio: INICIO });
  assert.equal(await a.leer(), true);
  const v = a.vista("x");
  assert.equal(v.hay, true);
  assert.deepEqual(
    v.pasos.map((p) => [p.tipo, p.estado]),
    [
      ["pensar", "ok"],
      ["correr", "ok"],
      ["leer", "fallo"],
      ["pensar", "ok"],
      ["correr", "fallo"],
      ["texto", "ok"],
    ],
  );
  const ls = v.pasos[1]!;
  assert.equal(ls.titulo, "ls -la visor/");
  assert.equal(ls.dur, 1500);
  assert.equal(ls.detalle.clase, "correr");
  if (ls.detalle.clase === "correr") {
    assert.equal(ls.detalle.codigo, 0);
    assert.equal(ls.detalle.salida?.t, "motion/:\ntotal 40\nMotion.qml\n", "sin el encabezado de agy ni los \\r");
  }
  const commit = v.pasos[4]!;
  assert.equal(commit.error, "nothing to commit");
  if (commit.detalle.clase === "correr") assert.equal(commit.detalle.codigo, 1);
  assert.match(v.pasos[2]!.error ?? "", /BLOQUEADO/);
});

test("agy: la hora de los pasos sale de sumar duraciones desde el arranque (agy no trae hora por línea)", async () => {
  const a = new ArmadorStream(ruta, { inicio: INICIO });
  await a.leer();
  const p = a.vista("x").pasos;
  // pensar: lleva la hora de cuando terminó (como en Claude); los demás, la de cuando empezaron.
  assert.equal(p[0]!.t, INICIO + 7500);
  assert.equal(p[1]!.t, INICIO + 7500);
  assert.equal(p[2]!.t, INICIO + 7500 + 1500);
  assert.equal(p[4]!.t, INICIO + 7500 + 1500 + 1200 + 4000);
  const e = a.encabezado();
  assert.equal(e.inicio, INICIO);
  assert.equal(e.fin, INICIO + 7500 + 1500 + 1200 + 4000 + 500 + 6000);
  assert.equal(e.dur, e.fin! - INICIO);
  for (let i = 1; i < p.length; i++) assert.ok(p[i]!.t! >= p[i - 1]!.t!, "las horas no retroceden");
});

test("agy: el mensaje final es el RESULTADO; tokens, turnos y carpeta al encabezado", async () => {
  const a = new ArmadorStream(ruta, { inicio: INICIO });
  await a.leer();
  const ult = a.vista("x").pasos.at(-1)!;
  assert.equal(ult.detalle.clase, "texto");
  if (ult.detalle.clase === "texto") {
    assert.equal(ult.detalle.final, true);
    assert.equal(ult.detalle.texto.t.trim(), "Listo, terminé.");
  }
  const e = a.encabezado();
  assert.equal(e.turnos, 3);
  assert.equal(e.tokens.entrada, 18561 + 2000 + 2238);
  assert.equal(e.tokens.cacheLeido, 135873 * 2);
  assert.equal(e.cwd, "/w");
  assert.ok(e.cache !== null && e.cache > 0.9);
});

test("agy en vivo: el paso que corre se ancla a la hora real del archivo, y un mensaje que sigue a herramientas no es el final", async () => {
  const f = path.join(tmp, "vivo.stream.jsonl");
  writeFileSync(f, jl({ event: "init", conversation_id: CONV, init: { model: "m" } }, ), "utf8");
  appendFileSync(f, jl(su(1, "DONE", "agent_response", { duration_seconds: 3, ...USO(1, 1, 0) }), cmd(2, "npm test")));
  const mtime = Date.now() - 1000;
  utimesSync(f, new Date(mtime), new Date(mtime));
  // Arrancó hace 10 minutos: la suma de duraciones (3 s) dejaría el reloj de la tarjeta corrido.
  const a = new ArmadorStream(f, { inicio: Date.now() - 600_000 });
  await a.leer();
  const corriendo = a.vista("x").pasos.find((p) => p.estado === "corriendo")!;
  assert.equal(corriendo.titulo, "npm test");
  assert.ok(Math.abs(corriendo.t! - mtime) < 2, "la hora del paso corriendo es la del archivo");
  // Llega el resultado: el paso se cierra y el reloj sigue desde ahí.
  appendFileSync(f, jl(cmdListo(2, "npm test", 12, "Command exited with code 0.\n\nCommand output:\nok\n")));
  const antes = a.v;
  await a.leer();
  assert.ok(a.v > antes);
  const p = a.vista("x").pasos.find((x) => x.titulo === "npm test")!;
  assert.equal(p.estado, "ok");
  assert.equal(p.dur, 12000);
  assert.ok(a.cambiosDesde(antes).includes(p), "el cambio trae el paso tocado");
});

test("una línea a medio escribir no rompe: se arma cuando se completa", async () => {
  const f = path.join(tmp, "corte.stream.jsonl");
  const l = jl(su(1, "DONE", "agent_response", { duration_seconds: 2, ...USO(1, 1, 0) }));
  writeFileSync(f, jl({ event: "init", conversation_id: CONV, init: { model: "m" } }) + l.slice(0, 30));
  const a = new ArmadorStream(f, { inicio: INICIO });
  await a.leer();
  assert.equal(a.vista("x").pasos.length, 0);
  appendFileSync(f, l.slice(30));
  await a.leer();
  assert.equal(a.vista("x").pasos.length, 1);
});

test("categoriaDe y salidaDeComando", () => {
  assert.equal(categoriaDe("run_command"), "correr");
  assert.equal(categoriaDe("view_file"), "leer");
  assert.equal(categoriaDe("grep_search"), "buscar");
  assert.equal(categoriaDe("replace_file_content"), "editar");
  assert.equal(categoriaDe("write_to_file"), "escribir");
  assert.equal(categoriaDe("manage_task"), "otro");
  assert.deepEqual(salidaDeComando("Command exited with code 2.\r\n\r\nCommand output:\r\nboom\r\n"), { codigo: 2, salida: "boom\n" });
  assert.deepEqual(salidaDeComando("sin formato"), { codigo: null, salida: "sin formato" });
});

test("opencode y codex: herramientas con su salida (opencode con hora real)", async () => {
  const f = path.join(tmp, "oc.stream.jsonl");
  const T = 1794485452690;
  writeFileSync(
    f,
    jl(
      { type: "tool_use", timestamp: T, part: { id: "p1", type: "tool", tool: "shell", state: { status: "completed", input: { command: "ls" }, output: "a\nb", time: { start: T - 500, end: T } } } },
      { type: "tool_use", timestamp: T + 1000, part: { id: "p2", type: "tool", tool: "read", state: { status: "error", input: { file_path: "/x" }, error: "nope", time: { start: T + 900, end: T + 1000 } } } },
      { type: "text", timestamp: T + 2000, part: { id: "p3", text: "hecho" } },
    ),
  );
  const a = new ArmadorStream(f, { inicio: T - 5000 });
  await a.leer();
  const p = a.vista("x").pasos;
  assert.deepEqual(p.map((x) => [x.tipo, x.estado]), [["correr", "ok"], ["leer", "fallo"], ["texto", "ok"]]);
  assert.equal(p[0]!.t, T - 500);
  assert.equal(p[0]!.dur, 500);
  const cx = path.join(tmp, "cx.stream.jsonl");
  writeFileSync(cx, jl({ type: "item.started", item: { id: "i1", type: "command_execution", command: "ls" } }, { type: "item.completed", item: { id: "i1", type: "command_execution", command: "ls", aggregated_output: "x\n", exit_code: 0 } }));
  const b = new ArmadorStream(cx, { inicio: T });
  await b.leer();
  assert.deepEqual(b.vista("x").pasos.map((x) => [x.tipo, x.estado, x.titulo]), [["correr", "ok", "ls"]]);
});

// --- El worker mirado por pasos-worker --------------------------------------------------------------------------------------

const paState = path.join(tmp, "pa");
const proyectos = path.join(tmp, "claude", "projects");
const ID = "20261121-003402-1523200";
mkdirSync(path.join(paState, "shell"), { recursive: true });
mkdirSync(proyectos, { recursive: true });
const rutaW = path.join(paState, "shell", `${ID}.stream.jsonl`);
writeFileSync(path.join(paState, "shell", `${ID}.hilo`), `modelo=gemini-4-neon-high\ninicio=${Math.floor(INICIO / 1000)}\n`);
writeFileSync(rutaW, AGY.split("\n").slice(0, 6).join("\n") + "\n");
const cambios: CambioPasos[] = [];
const p = crearPasos({ proyectos, paState, alCambiar: (c) => cambios.push(c), alStream: () => {}, espera: 20, esperaStream: 30 });
after(() => p.soltar("ventana"));

test("un worker de agy se mira con pasos (hay: true), igual que uno de Claude, y crece en lotes", async () => {
  const v = await p.mirar("ventana", ID);
  assert.equal(v.hay, true);
  assert.equal(v.encabezado.inicio, INICIO, "el arranque sale del .hilo");
  assert.deepEqual(v.pasos.map((x) => x.tipo), ["pensar", "correr", "leer"]);
  appendFileSync(rutaW, AGY.split("\n").slice(6, 10).join("\n") + "\n");
  await esperarHasta(() => cambios.length >= 1);
  const c = cambios.at(-1)!;
  assert.equal(c.id, ID);
  assert.ok(c.desde >= v.v);
  assert.ok(c.cambios.some((x) => x.tipo === "correr" && x.estado === "fallo"));
});
