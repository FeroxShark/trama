// electron/consumo.ts: el resumen de hoy por modelo (líderes y workers) y las filas pedidas, contra
// transcripts y `.sid` inventados en un tmp. También que se entere solo cuando un transcript crece.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearConsumo, pedidoDe, type Consumo } from "../electron/consumo.ts";
import { totalDe } from "../electron/transcripts.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-consumo-"));
const proyectos = path.join(tmp, "claude", "projects");
const paState = path.join(tmp, "pa");
const AHORA = Date.now();
const AYER = AHORA - 86_400_000;

type U = [number, number, number, number];
const linea = (id: string, modelo: string, [i, c, r, o]: U, ms = AHORA) =>
  JSON.stringify({
    type: "assistant",
    timestamp: new Date(ms).toISOString(),
    message: { id, model: modelo, usage: { input_tokens: i, cache_creation_input_tokens: c, cache_read_input_tokens: r, output_tokens: o } },
  }) + "\n";
function transcript(carpeta: string, sid: string, texto: string) {
  mkdirSync(path.join(proyectos, carpeta), { recursive: true });
  writeFileSync(path.join(proyectos, carpeta, `${sid}.jsonl`), texto);
}
function worker(proyecto: string, id: string, sid: string) {
  mkdirSync(path.join(paState, proyecto), { recursive: true });
  writeFileSync(path.join(paState, proyecto, `${id}.sid`), sid);
}

// Dos líderes y tres workers (dos de un líder, uno suelto); el tercero todavía sin transcript.
transcript("-tmp-uno", "lider-a", linea("a0", "claude-opus-5-5", [1, 1, 1, 1], AYER) + linea("a1", "claude-opus-5-5", [10, 200, 3000, 40]));
transcript("-tmp-dos", "lider-b", linea("b1", "claude-fable-5-1", [5, 0, 100, 5]));
transcript("-tmp-wt-1", "sid-w1", linea("w1", "claude-sonnet-5-5", [2, 20, 200, 2]) + linea("w2", "claude-sonnet-5-5", [3, 0, 222, 3]));
transcript("-tmp-wt-2", "sid-w2", linea("x1", "claude-opus-5-5", [1, 0, 50, 1]));
worker("atlas", "20260310-100000-111", "sid-w1");
worker("atlas", "20260310-100100-222", "sid-w2");
worker("faro", "20260310-100200-333", "sid-w3");
// Lo que no es de `pa` no es un worker; un `.sid` con forma rara se ignora.
mkdirSync(path.join(paState, "statusline"), { recursive: true });
writeFileSync(path.join(paState, "atlas", "20260310-100300-444.sid"), "../../etc/passwd");

const avisos: Consumo[] = [];
const consumo = crearConsumo({ proyectos, paState, alCambiar: (c) => avisos.push(c) });
after(() => consumo.soltar());

const PEDIDO = { lideres: ["lider-a", "lider-b"], workers: ["20260310-100000-111", "20260310-100100-222", "20260310-100200-333"] };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}

test("el pedido se valida: los ids arman rutas", () => {
  assert.deepEqual(pedidoDe({ lideres: ["ok-1", "../x", 3, "ok-1"], workers: ["20260310-100000-111", "x"] }), { lideres: ["ok-1"], workers: ["20260310-100000-111"] });
  assert.deepEqual(pedidoDe(null), { lideres: [], workers: [] });
});

test("el resumen de hoy por modelo, líderes y workers aparte, y cada fila", async () => {
  const c = await consumo.mirar(PEDIDO);
  // Líderes: lo de ayer no cuenta en el resumen.
  assert.deepEqual(c.lideres, {
    "claude-opus-5-5": { entrada: 10, cacheCreado: 200, cacheLeido: 3000, salida: 40 },
    "claude-fable-5-1": { entrada: 5, cacheCreado: 0, cacheLeido: 100, salida: 5 },
  });
  assert.deepEqual(c.workers, {
    "claude-sonnet-5-5": { entrada: 5, cacheCreado: 20, cacheLeido: 422, salida: 5 },
    "claude-opus-5-5": { entrada: 1, cacheCreado: 0, cacheLeido: 50, salida: 1 },
  });
  // La fila sí cuenta la sesión entera.
  const a = c.filas["lider-a"]!;
  assert.equal(totalDe(a.total["claude-opus-5-5"]), 3254);
  assert.equal(a.modelo, "claude-opus-5-5");
  assert.deepEqual(a.uso, { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 40 });
  const w1 = c.filas["20260310-100000-111"]!;
  assert.equal(w1.modelo, "claude-sonnet-5-5");
  assert.deepEqual(w1.uso, { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 222, output_tokens: 3 });
  assert.equal(totalDe(w1.total["claude-sonnet-5-5"]), 452);
  // Sin transcript: no hay dato, no un cero.
  assert.equal(c.filas["20260310-100200-333"], null);
  assert.equal(consumo.mirando(), true);
});

test("se entera solo cuando un transcript crece", async () => {
  avisos.length = 0;
  appendFileSync(path.join(proyectos, "-tmp-wt-2", "sid-w2.jsonl"), linea("x2", "claude-opus-5-5", [4, 0, 60, 6]));
  await hasta(() => avisos.length > 0);
  const c = avisos.at(-1)!;
  // Cada respuesta dice su orden: el panel se queda con la más nueva, llegue por donde llegue.
  assert.ok(c.n > 1 && avisos.every((x, i) => i === 0 || x.n > avisos[i - 1].n));
  assert.deepEqual(c.workers["claude-opus-5-5"], { entrada: 5, cacheCreado: 0, cacheLeido: 110, salida: 7 });
  assert.deepEqual(c.filas["20260310-100100-222"]!.uso, { input_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 60, output_tokens: 6 });
});

test("el transcript que faltaba aparece al buscarlo de nuevo", async () => {
  avisos.length = 0;
  transcript("-tmp-wt-3", "sid-w3", linea("y1", "claude-haiku-5-5", [1, 2, 3, 4]));
  consumo.faltantes();
  await hasta(() => avisos.length > 0);
  assert.equal(avisos.at(-1)!.filas["20260310-100200-333"]!.modelo, "claude-haiku-5-5");
  // Y un subagente suyo suma en la sesión.
  avisos.length = 0;
  mkdirSync(path.join(proyectos, "-tmp-wt-3", "sid-w3", "subagents"), { recursive: true });
  writeFileSync(path.join(proyectos, "-tmp-wt-3", "sid-w3", "subagents", "agent-1.jsonl"), linea("z1", "claude-haiku-5-5", [10, 0, 0, 10]));
  await hasta(() => avisos.length > 0);
  assert.equal(totalDe(avisos.at(-1)!.workers["claude-haiku-5-5"]), 30);
});

test("soltar: nadie mira, nada llega", async () => {
  consumo.soltar();
  avisos.length = 0;
  appendFileSync(path.join(proyectos, "-tmp-uno", "lider-a.jsonl"), linea("a2", "claude-opus-5-5", [1, 0, 0, 1]));
  consumo.repasar();
  consumo.faltantes();
  await espera(400);
  assert.equal(avisos.length, 0);
  assert.equal(consumo.mirando(), false);
  // Al volver a mirar está al día.
  const c = await consumo.mirar(PEDIDO);
  assert.equal(totalDe(c.lideres["claude-opus-5-5"]), 3252);
});
