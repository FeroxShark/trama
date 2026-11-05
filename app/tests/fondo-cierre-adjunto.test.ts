// Un proceso de fondo que termina a mitad de un turno llega como adjunto `queued_command` con `commandMode: "task-notification"`,
// no como línea `user`. Tiene que cerrar su tarea en la pastilla sin ser un mensaje más de la conversación.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conversacionDe } from "../electron/lider-arma.ts";
import { tareasDeFondo } from "../src/hilo/fondo-logica.ts";

const TS = "2026-11-05T10:00:00.000Z";
const LANZADO = "Command running in background with ID: b1. Output is being written to: /tmp/x.output.";
const aviso = (id: string) => `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n<summary>listo</summary>\n</task-notification>`;
const linea = (o: unknown) => JSON.stringify(o);

const apertura = [
  linea({ type: "user", uuid: "u1", parentUuid: null, timestamp: TS, message: { role: "user", content: "Corre los tests" } }),
  linea({
    type: "assistant",
    uuid: "a1",
    parentUuid: "u1",
    timestamp: TS,
    message: {
      id: "m1",
      model: "claude-x",
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test", run_in_background: true, description: "Corre los tests" } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }),
  linea({ type: "user", uuid: "u2", parentUuid: "a1", timestamp: TS, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: LANZADO }] } }),
];

test("el aviso de fondo como adjunto cierra la tarea y no es un mensaje", () => {
  const adjunto = linea({ type: "attachment", uuid: "att1", parentUuid: "u2", timestamp: TS, attachment: { type: "queued_command", commandMode: "task-notification", prompt: aviso("b1") } });
  const pagina = conversacionDe("s1", null, [...apertura, adjunto].join("\n"));
  assert.equal(pagina.total, 2);
  assert.deepEqual(pagina.mensajes.map((m) => m.rol), ["user", "assistant"]);
  assert.deepEqual(tareasDeFondo(pagina.mensajes), []);
  assert.equal(pagina.mensajes[1].uuid, "u2");
});

test("sin el adjunto la tarea sigue abierta (el caso del bug)", () => {
  const pagina = conversacionDe("s1", null, apertura.join("\n"));
  assert.deepEqual(tareasDeFondo(pagina.mensajes).map((t) => t.id), ["b1"]);
});

test("el adjunto de fondo no corta la cadena: lo que sigue cuelga de la misma línea", () => {
  const adjunto = linea({ type: "attachment", uuid: "att1", parentUuid: "u2", timestamp: TS, attachment: { type: "queued_command", commandMode: "task-notification", prompt: aviso("b1") } });
  const seguir = linea({ type: "assistant", uuid: "a2", parentUuid: "u2", timestamp: TS, message: { id: "m2", model: "claude-x", role: "assistant", content: [{ type: "text", text: "Listo" }], usage: { input_tokens: 1, output_tokens: 1 } } });
  const pagina = conversacionDe("s1", null, [...apertura, adjunto, seguir].join("\n"));
  assert.deepEqual(pagina.mensajes.map((m) => m.texto), ["Corre los tests", "", "Listo"]);
  assert.equal(pagina.total, 3);
  assert.deepEqual(tareasDeFondo(pagina.mensajes), []);
});

test("un queued_command `prompt` sigue siendo un mensaje del usuario", () => {
  const mandado = linea({ type: "attachment", uuid: "att2", parentUuid: "u2", timestamp: TS, attachment: { type: "queued_command", commandMode: "prompt", prompt: "hola" } });
  const pagina = conversacionDe("s1", null, [...apertura, mandado].join("\n"));
  assert.equal(pagina.total, 3);
  assert.equal(pagina.mensajes[2].rol, "user");
  assert.equal(pagina.mensajes[2].texto, "hola");
  assert.equal(pagina.mensajes[2].uuid, "att2");
  assert.deepEqual(tareasDeFondo(pagina.mensajes).map((t) => t.id), ["b1"]);
});
