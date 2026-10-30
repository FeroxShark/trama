// El lector incremental de transcripts (electron/contexto-jsonl.ts): un jsonl que crece se lee sólo desde donde iba, una línea a medias
// no se duplica cuando termina, un archivo reescrito más chico empieza de cero y los pedidos en paralelo no repiten líneas.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { leerTranscript } from "../electron/contexto-jsonl.ts";

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
