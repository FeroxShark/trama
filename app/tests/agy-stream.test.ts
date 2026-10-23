// El stream de agy traducido al de Claude (electron/agy-stream.ts), con un turno de verdad (fixtures/agy-real.jsonl:
// una herramienta run_command y una respuesta en pedazos) y con lo que ese turno no cubre (fallos, otras herramientas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { herramientaClaude, Traductor, VENTANA_GEMINI } from "../electron/agy-stream.ts";

const crudo = readFileSync(new URL("./fixtures/agy-real.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const traducir = (eventos: object[], modelo = "gemini-3.8-flash-low") => {
  const t = new Traductor({ sid: "sid-1", modelo });
  return { t, lineas: eventos.flatMap((e) => t.linea(e)) as any[] };
};

test("un turno de verdad: la herramienta como Bash con su resultado, el texto en deltas y un solo mensaje entero", () => {
  const { t, lineas } = traducir(crudo);
  assert.equal(t.conversacion, "57806b9d-e827-410e-8def-d13b5a549096");
  const uso = lineas.find((l) => l.type === "assistant" && l.message.content[0].type === "tool_use");
  assert.equal(uso.message.content[0].name, "Bash");
  assert.match(uso.message.content[0].input.command, /^bash -c/);
  const res = lineas.find((l) => l.type === "user");
  assert.equal(res.message.content[0].tool_use_id, uso.message.content[0].id);
  assert.match(res.message.content[0].content, /agy-tee\.sh|systemd/);
  assert.ok(!res.message.content[0].is_error);
  // Los deltas suman el mensaje entero, que sale una vez.
  const deltas = lineas.filter((l) => l.type === "stream_event" && l.event.type === "content_block_delta").map((l) => l.event.delta.text);
  const enteros = lineas.filter((l) => l.type === "assistant" && l.message.content[0].type === "text");
  assert.equal(enteros.length, 1);
  assert.equal(deltas.join("").trim(), enteros[0].message.content[0].text);
  assert.match(enteros[0].message.content[0].text, /pa <proyecto>/);
  // Todo lleva el id de sesión de la barra.
  assert.ok(lineas.every((l) => l.session_id === "sid-1"));
  // Un solo result, al final, con el contexto del último paso (no la suma) y la ventana de Gemini.
  const r = lineas.filter((l) => l.type === "result");
  assert.equal(r.length, 1);
  assert.equal(lineas.at(-1).type, "result");
  assert.equal(r[0].is_error, false);
  assert.equal(r[0].usage.input_tokens, 10092);
  assert.equal(r[0].usage.output_tokens, 535);
  assert.equal(r[0].modelUsage["gemini-3.8-flash-low"].contextWindow, VENTANA_GEMINI);
  assert.deepEqual(t.fin(null), [], "con result ya no hay nada que cerrar");
});

test("un run_command que sale con código ≠ 0 vuelve como error; el 0 no", () => {
  const paso = (estado: string, extra: object) => ({ event: "step_update", step_update: { conversation_id: "c", step_index: 2, step_type: "tool", tool_name: "run_command", state: estado, ...extra } });
  const info = (output?: string) => ({ tool_info: { name: "run_command", parameters: { CommandLine: "false" }, ...(output === undefined ? {} : { output }) } });
  const mal = traducir([paso("ACTIVE", info()), paso("DONE", info("Command exited with code 1.\n\nCommand output:\nnope\r\n"))]).lineas.find((l) => l.type === "user");
  assert.equal(mal.message.content[0].is_error, true);
  assert.equal(mal.message.content[0].content, "nope\n");
  const bien = traducir([paso("ACTIVE", info()), paso("DONE", info("Command exited with code 0.\n\nCommand output:\nok\n"))]).lineas.find((l) => l.type === "user");
  assert.equal(bien.message.content[0].is_error, undefined);
});

test("las herramientas de agy se ven como las de Claude con los campos que la vista lee", () => {
  assert.deepEqual(herramientaClaude("run_command", { CommandLine: "ls", Cwd: "/x" }), { name: "Bash", input: { command: "ls", cwd: "/x" } });
  assert.deepEqual(herramientaClaude("view_file", { AbsolutePath: "/a/b" }), { name: "Read", input: { file_path: "/a/b" } });
  assert.deepEqual(herramientaClaude("grep_search", { Query: "foo", SearchPath: "/src" }), { name: "Grep", input: { pattern: "foo", path: "/src" } });
  assert.equal(herramientaClaude("write_to_file", { TargetFile: "/a", CodeContent: "x" }).name, "Write");
  assert.equal(herramientaClaude("replace_file_content", { TargetFile: "/a" }).name, "Edit");
  assert.equal(herramientaClaude("read_url_content", { Url: "http://x" }).input.url, "http://x");
  // Lo desconocido pasa con su nombre y sus parámetros, sin tirar.
  assert.deepEqual(herramientaClaude("browser_click_element", { Id: 3 }), { name: "browser_click_element", input: { Id: 3 } });
  assert.deepEqual(herramientaClaude("run_command", null), { name: "Bash", input: {} });
});

test("un result que no es SUCCESS es un error con su motivo; sin result, fin() cierra el turno", () => {
  const { lineas } = traducir([{ event: "result", result: { status: "ERROR", response: "", usage: {} } }]);
  assert.equal(lineas[0].is_error, true);
  assert.match(lineas[0].result, /ERROR/);
  const t = new Traductor({ sid: "s", modelo: "gemini-3.8-flash-low" });
  t.linea({ event: "step_update", step_update: { conversation_id: "c", step_index: 1, step_type: "agent_response", state: "ACTIVE", text_delta: "hola" } });
  const f = t.fin("agy salió con 1");
  assert.equal(f.length, 1);
  assert.equal(f[0].is_error, true);
  assert.equal(f[0].result, "agy salió con 1");
  assert.deepEqual(t.fin(null), []);
});

test("basura en el stream no tira nada", () => {
  const t = new Traductor({ sid: "s", modelo: "m" });
  for (const x of [null, 3, "x", {}, { event: "otro" }, { event: "step_update" }, { event: "step_update", step_update: { step_type: "raro" } }]) assert.deepEqual(t.linea(x as any), []);
});
