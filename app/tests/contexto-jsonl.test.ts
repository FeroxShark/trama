// El lector incremental de transcripts (electron/contexto-jsonl.ts): un jsonl que crece se lee sólo desde donde iba, una línea a medias
// no se duplica cuando termina, un archivo reescrito más chico empieza de cero y los pedidos en paralelo no repiten líneas.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { leerTranscript } from "../electron/contexto-jsonl.ts";

// El main se importa con los .js de sus imports (como en dist-electron): se mapean a los .ts del checkout.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "trama-jsonl-"));

test("un jsonl que crece: cada pedido trae lo nuevo y el tamaño cambia", async () => {
  const f = path.join(tmp(), "s.jsonl");
  writeFileSync(f, '{"n":1}\n{"n":2}\n');
  const a = await leerTranscript(f);
  assert.deepEqual(a?.lineas, ['{"n":1}', '{"n":2}']);
  appendFileSync(f, '{"n":3}\n');
  const b = await leerTranscript(f);
  assert.deepEqual(b?.lineas, ['{"n":1}', '{"n":2}', '{"n":3}']);
  assert.ok(b && a && b.tam > a.tam);
  // Sin cambios: el mismo tamaño y la misma fecha (así el panel sabe que no hay nada que recalcular).
  const c = await leerTranscript(f);
  assert.equal(c?.tam, b?.tam);
  assert.equal(c?.mtime, b?.mtime);
});

test("una línea a medias no se duplica cuando termina de escribirse", async () => {
  const f = path.join(tmp(), "s.jsonl");
  writeFileSync(f, '{"n":1}\n{"n":2');
  assert.deepEqual((await leerTranscript(f))?.lineas, ['{"n":1}', '{"n":2']);
  appendFileSync(f, '}\n{"n":3}\n');
  assert.deepEqual((await leerTranscript(f))?.lineas, ['{"n":1}', '{"n":2}', '{"n":3}']);
});

test("un archivo reescrito más chico empieza de cero", async () => {
  const f = path.join(tmp(), "s.jsonl");
  writeFileSync(f, 'a\nb\nc\n');
  assert.deepEqual((await leerTranscript(f))?.lineas, ['a', 'b', 'c']);
  writeFileSync(f, 'x\n');
  assert.deepEqual((await leerTranscript(f))?.lineas, ['x']);
});

test("pedidos en paralelo sobre el mismo archivo no repiten líneas", async () => {
  const f = path.join(tmp(), "s.jsonl");
  writeFileSync(f, 'uno\n');
  appendFileSync(f, 'dos\ntres\n');
  const [a, b, c] = await Promise.all([leerTranscript(f), leerTranscript(f), leerTranscript(f)]);
  for (const r of [a, b, c]) assert.deepEqual(r?.lineas, ['uno', 'dos', 'tres']);
});

test("sin ruta o sin archivo: nada", async () => {
  assert.equal(await leerTranscript(null), null);
  assert.equal(await leerTranscript(path.join(tmp(), "no-esta.jsonl")), null);
});

// El panel de contexto de un worker, de punta a punta: el transcript crece y el desglose lo sigue; sin cambios no se recalcula; `fresco`
// salta lo guardado. Va con un HOME, un PA_STATE y un CLAUDE_CONFIG_DIR de mentira (el main los lee al cargarse).
test("el desglose de un worker sigue a su transcript que crece", async () => {
  const casa = tmp();
  process.env.HOME = casa;
  process.env.XDG_CONFIG_HOME = path.join(casa, "config");
  process.env.CLAUDE_CONFIG_DIR = path.join(casa, "claude");
  process.env.PA_STATE = path.join(casa, "pa");
  const { desgloseContexto } = await import("../electron/contexto-panel.ts");

  const sid = "7f1c2a40-0000-4000-8000-000000000001";
  const ID_W = "20261030-193341-1528793";
  mkdirSync(path.join(casa, "pa", "proyecto-inventado"), { recursive: true });
  writeFileSync(path.join(casa, "pa", "proyecto-inventado", `${ID_W}.sid`), sid);
  const dirT = path.join(casa, "claude", "projects", "proyecto-inventado");
  mkdirSync(dirT, { recursive: true });
  const f = path.join(dirT, `${sid}.jsonl`);
  const linea = (id: string, entrada: number) =>
    JSON.stringify({ type: "assistant", cwd: path.join(casa, "proyecto-inventado"), message: { id, model: "modelo-inventado", usage: { input_tokens: entrada, output_tokens: 5 } } }) + "\n";
  writeFileSync(f, linea("m1", 1000));

  const uno = await desgloseContexto({ worker: ID_W });
  assert.equal(uno.usado, 1000);
  // Sin cambios en el transcript: lo mismo, sin recalcular.
  assert.equal(await desgloseContexto({ worker: ID_W }), uno);

  appendFileSync(f, linea("m2", 5000));
  const dos = await desgloseContexto({ worker: ID_W });
  assert.equal(dos.usado, 5000);
  assert.notEqual(dos, uno);

  // El refresco manual recalcula aunque nada cambió.
  const fresco = await desgloseContexto({ worker: ID_W, fresco: true });
  assert.equal(fresco.usado, 5000);
  assert.notEqual(fresco, dos);

  // Dos pedidos a la vez comparten el mismo cálculo (no se pisan).
  appendFileSync(f, linea("m3", 7000));
  const [a, b] = await Promise.all([desgloseContexto({ worker: ID_W }), desgloseContexto({ worker: ID_W })]);
  assert.equal(a, b);
  assert.equal(a.usado, 7000);
});
