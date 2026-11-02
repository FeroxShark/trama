// `pa --hilo` de un worker que no es de Claude: su `<id>.stream.jsonl` convertido a los mensajes del transcript
// (electron/cli/pa/hilo-stream.ts; el bash tiene lo mismo en JQ_HILO_STREAM y lo compara tests/paridad).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mensajesDeStream } from "../electron/cli/pa/hilo-stream.ts";
import { hiloDePa } from "../src/datos/paHilo.ts";
import { AGY, AGY_ERROR, AGY_VIVO, CODEX, CODEX_VIVO, DSH, DSH_ERROR, OPENCODE, OPENCODE_ERROR } from "./streams-hilo.ts";

const INICIO = "1793507270";
const msgs = (s: string, modelo = "") => mensajesDeStream(s, "hacé tal cosa", INICIO, modelo) as any[];

test("agy: el pedido, los pasos con herramientas y la respuesta", () => {
  const m = msgs(AGY);
  assert.deepEqual(m.map((x) => x.rol), ["user", "assistant", "assistant"]);
  assert.equal(m[0].texto, "hacé tal cosa");
  assert.equal(m[0].ts, "2026-11-01T04:27:50Z"); // la hora de inicio de la corrida, no una inventada
  assert.deepEqual(m[1].herramientas, ["Bash", "Bash", "Read"]);
  assert.deepEqual(m[1].herramientas_det[0].entrada, { command: "ls | wc -l" }); // CommandLine → command
  assert.deepEqual(m[1].herramientas_det[2].entrada, { file_path: "/a/b.ts" }); // Path → file_path
  assert.equal(m[1].herramientas_det[0].resultado.error, false);
  assert.equal(m[1].herramientas_det[1].resultado.error, true); // "Command exited with code 1"
  assert.equal(m[1].herramientas_det[2].resultado.texto, "linea 1\nlinea 2");
  assert.equal(m[2].texto, "Hay 42 archivos."); // los deltas de un mismo paso, juntos y sin los blancos de los bordes
  assert.equal(m[1].ts, null); // agy no trae hora por línea
  assert.equal(m[2].modelo, "gemini-3.8-flash-high");
  assert.deepEqual(m[2].usage, { input_tokens: 30, output_tokens: 12, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 });
});

test("agy en vivo: la herramienta sin resultado y la última línea cortada no rompen nada", () => {
  const m = msgs(AGY_VIVO);
  assert.equal(m.length, 2);
  assert.equal(m[1].herramientas_det.length, 1);
  assert.equal(m[1].herramientas_det[0].resultado, undefined);
  assert.equal(m[1].texto, "");
});

test("un stream cortado en cualquier byte da lo que ya estaba completo", () => {
  const entero = msgs(AGY).length;
  for (const corte of [0, 1, 50, AGY.length >> 1, AGY.length - 3]) {
    const m = msgs(AGY.slice(0, corte));
    assert.ok(m.length <= entero && m[0].rol === "user", `corte ${corte}`);
  }
  assert.deepEqual(msgs(""), [msgs("")[0]]); // vacío: sólo el pedido
});

test("sin pedido en el .hilo no hay mensaje del usuario; sin modelo, modelo null", () => {
  const m = mensajesDeStream(CODEX, "", "", "") as any[];
  assert.equal(m[0].rol, "assistant");
  assert.equal(m[0].modelo, null);
  assert.equal((mensajesDeStream(AGY, "x", "no-es-numero", "") as any[])[0].ts, null);
});

test("agy cortado por la cuenta: el error queda a la vista", () => {
  const m = msgs(AGY_ERROR);
  assert.equal(m[1].texto, "✗ agy: Individual quota reached. Resets in 4h55m.");
});

test("codex: comandos con su resultado, cambios de archivos, búsqueda y respuesta", () => {
  const m = msgs(CODEX, "gpt-5.5");
  assert.deepEqual(m.map((x) => x.rol), ["user", "assistant", "assistant"]);
  assert.deepEqual(m[1].herramientas, ["Bash", "Bash", "Edit", "WebSearch"]);
  assert.equal(m[1].herramientas_det.length, 4); // item.started + item.completed del mismo comando: uno solo
  assert.deepEqual(m[1].herramientas_det[0].resultado, { texto: "a\nb", error: false });
  assert.equal(m[1].herramientas_det[1].resultado.error, true); // exit_code 1
  assert.equal(m[1].herramientas_det[2].entrada.file_path, "/x/a.ts, /x/b.ts");
  assert.equal(m[2].texto, "Listo, cambié dos archivos.");
  assert.equal(m[2].modelo, "gpt-5.5");
  assert.deepEqual(m[2].usage, { input_tokens: 60, output_tokens: 7, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 }); // lo cacheado aparte
});

test("codex en vuelo: el comando que empezó se ve sin resultado", () => {
  const m = msgs(CODEX_VIVO);
  assert.equal(m[1].herramientas_det[0].entrada.command, "npm test");
  assert.equal(m[1].herramientas_det[0].resultado, undefined);
});

test("opencode: un mensaje por paso, con la hora de la línea y sin el razonamiento", () => {
  const m = msgs(OPENCODE, "opencode:opencode/x-free");
  assert.deepEqual(m.map((x) => x.rol), ["user", "assistant", "assistant"]);
  assert.equal(m[1].texto, "Empiezo por mirar.");
  assert.equal(m[1].ts, "2026-11-01T04:27:56Z"); // timestamp (ms) de la línea
  assert.deepEqual(m[1].herramientas, ["Bash", "Read"]);
  assert.deepEqual(m[1].herramientas_det[1], { nombre: "Read", entrada: { file_path: "/x/no.ts" }, resultado: { texto: "no existe", error: true } });
  assert.equal(m[2].texto, "Listo.");
  assert.equal(m[2].modelo, "opencode:opencode/x-free");
  assert.equal(m[2].usage?.cache_creation_input_tokens, 10);
});

test("opencode cortado por el cupo: el error queda a la vista", () => {
  assert.equal(msgs(OPENCODE_ERROR)[1].texto, "✗ Free usage limit reached");
});

test("dsh: un mensaje por paso, sin razonamiento ni el final repetido", () => {
  const m = msgs(DSH, "dsh:opencode/x");
  assert.deepEqual(m.map((x) => x.rol), ["user", "assistant", "assistant"]);
  assert.equal(m[1].texto, "Miro el repo.");
  assert.deepEqual(m[1].herramientas, ["Bash", "Read"]);
  assert.deepEqual(m[1].herramientas_det[0], { nombre: "Bash", entrada: { command: "ls app" }, resultado: { texto: "a\nb", error: false } });
  assert.deepEqual(m[1].herramientas_det[1].resultado, { texto: "no existe", error: true });
  assert.equal(m[1].usage?.input_tokens, 1000);
  assert.equal(m[2].texto, "Listo.");
  assert.equal(m[2].usage?.output_tokens, 20);
});

test("dsh cortado: el error del turno queda a la vista", () => {
  assert.equal(msgs(DSH_ERROR)[1].texto, "✗ 429 sin cupo");
});

test("la vista entiende estos mensajes (hiloDePa)", () => {
  const r = hiloDePa({ mensajes: msgs(OPENCODE).map((x, i) => ({ i, ...x })) });
  assert.equal(r.mensajes[1].det?.[0].resultado?.texto, "a\nb");
  assert.equal(r.mensajes[2].texto, "Listo.");
});
