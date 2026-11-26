// El traductor del stream de codex: el medidor de contexto (PUENTES-2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { argsCodex, Traductor } from "../electron/codex-stream.ts";
import { parsearLinea } from "../electron/lider-arma.ts";

const msg = { type: "item.completed", item: { id: "i1", type: "agent_message", text: "Hola" } };
const fin = { type: "turn.completed", usage: { input_tokens: 15000, output_tokens: 200, reasoning_output_tokens: 50 } };

test("al terminar el turno el medidor se mueve: un message_start con lo que pesa el contexto", () => {
  const t = new Traductor({ sid: "s1", modelo: "gpt-5.4" });
  t.linea(msg);
  t.rollout = { contexto: 15000, cacheado: 0, salida: 200, ventana: null }; // lo que dice el rollout del último pedido (CTX-38)
  const out = t.linea(fin);
  const ms = out.filter((o) => o.type === "stream_event" && o.event.type === "message_start");
  assert.equal(ms.length, 1);
  assert.equal(ms[0]!.event.message.usage.input_tokens, 15000);
  assert.equal(out.at(-1)!.type, "result");
});

test("con el contexto del turno anterior, el mensaje ya sale con tokens (en vivo y en el transcript)", () => {
  const t = new Traductor({ sid: "s1", modelo: "gpt-5.4", contextoPrevio: 12000 });
  const out = t.linea(msg);
  assert.equal(out[0]!.event.message.usage.input_tokens, 12000);
  const asistente = out.find((o) => o.type === "assistant")!;
  assert.equal(asistente.message.usage.input_tokens, 12000);
});

test("sin contexto previo, el mensaje no inventa un usage en cero", () => {
  const t = new Traductor({ sid: "s1", modelo: "gpt-5.4" });
  const asistente = t.linea(msg).find((o) => o.type === "assistant")!;
  assert.equal(asistente.message.usage, undefined);
});

test("CTX-39: el anillo termina con el contexto del último pedido (traductor → parsearLinea), no en cero", () => {
  const t = new Traductor({ sid: "s1", modelo: "gpt-5.4" });
  const eventos = [...t.linea(msg)];
  t.rollout = { contexto: 120000, cacheado: 0, salida: 200, ventana: null };
  eventos.push(...t.linea(fin));
  const lecturas = eventos.flatMap((o) => parsearLinea(JSON.stringify(o))).filter((e) => e.tipo === "contexto" && e.usage);
  assert.equal(lecturas.at(-1)!.usage!.input_tokens, 120000);
  // Antes del `result` (el fin del turno): el anillo ya está en su valor final cuando el chat deja de estar ocupado.
  const iFin = eventos.findIndex((o) => o.type === "result");
  const iUltimo = eventos.findLastIndex((o) => o.type === "stream_event" && o.event.type === "message_start");
  assert.ok(iUltimo >= 0 && iUltimo < iFin);
});

/** Simula cómo clap parsea `codex exec`: `-i <FILE>...` en `exec` es voraz y se come posicionales hasta otra bandera o `--`. */
function parsearExecCodex(args: string[]) {
  assert.equal(args[0], "exec");
  const imagenes: string[] = [];
  const pos: string[] = [];
  let sub: "resume" | null = null;
  let finOpciones = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (finOpciones) {
      pos.push(a);
      continue;
    }
    if (a === "--") {
      finOpciones = true;
      continue;
    }
    if (a === "-i" || a === "--image") {
      if (sub === "resume") {
        imagenes.push(args[++i]!);
      } else {
        // En `codex exec`, `-i <FILE>...` traga todos los tokens que no empiecen con `-` (salvo `-` solo, que también traga si no hay `--`).
        while (i + 1 < args.length && (!args[i + 1]!.startsWith("-") || args[i + 1] === "-")) {
          if (args[i + 1] === "--") break;
          imagenes.push(args[++i]!);
        }
      }
      continue;
    }
    if (["-m", "-c", "--sandbox", "-C"].includes(a)) {
      i++;
      continue;
    }
    if (a.startsWith("--")) continue;
    if (!sub && a === "resume") {
      sub = "resume";
      continue;
    }
    pos.push(a);
  }
  return { sub, imagenes, pos };
}

test("argsCodex: con imágenes al iniciar y al retomar, -i nunca se traga resume, el UUID ni -", () => {
  const base = { modelo: "gpt-6.2-sol", effort: "high", sandbox: "danger-full-access", cwd: "/tmp/p" };
  const imgs = ["/tmp/img-1.png", "/tmp/img-2.png"];
  const uuid = "aaaaaaaa-0000-4000-8000-000000000001";

  const nuevoConImgs = parsearExecCodex(argsCodex({ ...base, imagenes: imgs, thread: null }, "linux"));
  assert.equal(nuevoConImgs.sub, null);
  assert.deepEqual(nuevoConImgs.imagenes, imgs);
  assert.deepEqual(nuevoConImgs.pos, ["-"]);

  const retomaConImgs = parsearExecCodex(argsCodex({ ...base, imagenes: imgs, thread: uuid }, "linux"));
  assert.equal(retomaConImgs.sub, "resume");
  assert.deepEqual(retomaConImgs.imagenes, imgs);
  assert.deepEqual(retomaConImgs.pos, [uuid, "-"]);

  const retomaSinImgs = parsearExecCodex(argsCodex({ ...base, imagenes: [], thread: uuid }, "linux"));
  assert.equal(retomaSinImgs.sub, "resume");
  assert.deepEqual(retomaSinImgs.imagenes, []);
  assert.deepEqual(retomaSinImgs.pos, [uuid, "-"]);

  const nuevoSinImgs = parsearExecCodex(argsCodex({ ...base, imagenes: [], thread: null }, "linux"));
  assert.equal(nuevoSinImgs.sub, null);
  assert.deepEqual(nuevoSinImgs.imagenes, []);
  assert.deepEqual(nuevoSinImgs.pos, ["-"]);
});
