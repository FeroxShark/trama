// Los resultados de herramientas de un worker, pegados a la página de `pa --hilo`
// con lo que dice su transcript (electron/hilo-resultados.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { conResultados } from "../electron/hilo-resultados.ts";
import { avanzarConv, convNueva } from "../electron/lider-arma.ts";
import { hiloDePa } from "../src/datos/paHilo.ts";

const l = (o: unknown) => JSON.stringify(o) + "\n";
const T1 = "2026-10-14T10:00:00.000Z";
const TRANSCRIPT =
  l({ type: "user", timestamp: "2026-10-14T09:59:00.000Z", message: { content: "corré los tests" } }) +
  l({ type: "assistant", timestamp: T1, message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } }) +
  l({ type: "assistant", timestamp: "2026-10-14T10:00:01.000Z", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "/x/a.ts" } }] } }) +
  l({ type: "user", timestamp: "2026-10-14T10:00:05.000Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok\n5 pass" }, { type: "tool_result", tool_use_id: "t2", content: "boom", is_error: true }] } });

const pagina = () => ({
  version: 1,
  id: "w1",
  transcript: "/tmp/t.jsonl",
  mensajes: [
    { i: 0, rol: "user", texto: "corré los tests", herramientas: [], ts: "2026-10-14T09:59:00.000Z", modelo: null },
    {
      i: 1,
      rol: "assistant",
      texto: "",
      herramientas: ["Bash", "Read"],
      ts: T1,
      modelo: "claude-opus-5-5",
      herramientas_det: [
        { nombre: "Bash", entrada: { command: "npm test" } },
        { nombre: "Read", entrada: { file_path: "/x/a.ts" } },
      ],
    },
  ],
});

test("hilo-resultados: cada llamada recibe su id y el final de su resultado, también el que falló", () => {
  const est = convNueva();
  avanzarConv(est, TRANSCRIPT);
  const m = hiloDePa(conResultados(pagina(), est)).mensajes[1];
  assert.deepEqual(m.det?.[0].resultado, { texto: "ok\n5 pass", error: false });
  assert.deepEqual(m.det?.[1].resultado, { texto: "boom", error: true });
  assert.equal(m.det?.[0].id, "t1");
});

test("hilo-resultados: sin el resultado todavía (o sin pareja en el transcript) la página queda como vino", () => {
  const est = convNueva();
  avanzarConv(est, TRANSCRIPT.split("\n").slice(0, 3).join("\n") + "\n");
  const m = hiloDePa(conResultados(pagina(), est)).mensajes[1];
  assert.equal(m.det?.[0].resultado, undefined);
  assert.equal(m.det?.[0].id, "t1");
  const otra = pagina();
  otra.mensajes[1].ts = "2026-10-14T11:00:00.000Z";
  assert.deepEqual(conResultados(otra, est), otra);
});
