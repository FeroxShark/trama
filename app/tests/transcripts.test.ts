// electron/transcripts.ts: los números de un transcript inventado, leídos de a pedazos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Lector, Sesion, medianoche, totalDe, transcriptsDesde } from "../electron/transcripts.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-transcripts-"));
const HOY = Date.parse("2026-03-10T12:00:00Z");
const AYER = HOY - 86_400_000;
const hora = (ms: number) => new Date(ms).toISOString();

type U = [entrada: number, creado: number, leido: number, salida: number];
const uso = ([i, c, r, o]: U) => ({ input_tokens: i, cache_creation_input_tokens: c, cache_read_input_tokens: r, output_tokens: o });
const asistente = (id: string, modelo: string, u: U, ms = HOY, mas: object = {}) =>
  JSON.stringify({ type: "assistant", timestamp: hora(ms), message: { id, model: modelo, usage: uso(u), content: [{ type: "text", text: "texto inventado" }] }, ...mas }) + "\n";
const usuario = (texto: string) => JSON.stringify({ type: "user", timestamp: hora(HOY), message: { role: "user", content: texto } }) + "\n";
const compacto = () => JSON.stringify({ type: "system", subtype: "compact_boundary", timestamp: hora(HOY), compactMetadata: { trigger: "auto", preTokens: 900, postTokens: 90 } }) + "\n";

test("suma por modelo, sin contar dos veces el mismo mensaje", async () => {
  const ruta = path.join(tmp, "a.jsonl");
  writeFileSync(
    ruta,
    usuario("hola") +
      // Un mensaje en tres líneas (una por bloque): el mismo id y el mismo usage.
      asistente("m1", "claude-opus-5-5", [10, 100, 1000, 5]) +
      asistente("m1", "claude-opus-5-5", [10, 100, 1000, 5]) +
      asistente("m1", "claude-opus-5-5", [10, 100, 1000, 5]) +
      asistente("m2", "claude-opus-5-5", [20, 0, 1100, 7], HOY, { effort: "high" }) +
      asistente("m3", "claude-haiku-5-5", [1, 2, 3, 4]) +
      // Un sintético (un error de la API) no lo contestó nadie.
      asistente("m4", "<synthetic>", [0, 0, 0, 0]),
  );
  const l = new Lector(ruta, 0);
  assert.equal(await l.leer(), true);
  assert.deepEqual(l.lectura.total["claude-opus-5-5"], { entrada: 30, cacheCreado: 100, cacheLeido: 2100, salida: 12 });
  assert.deepEqual(l.lectura.total["claude-haiku-5-5"], { entrada: 1, cacheCreado: 2, cacheLeido: 3, salida: 4 });
  assert.equal(totalDe(l.lectura.total["claude-opus-5-5"]), 2242);
  assert.equal(Object.keys(l.lectura.total).length, 2);
  // El último que contestó manda en modelo y contexto.
  assert.equal(l.lectura.modelo, "claude-haiku-5-5");
  assert.deepEqual(l.lectura.uso, uso([1, 2, 3, 4]));
  assert.equal(l.lectura.effort, "high");
  // Sin nada nuevo no cambia ni se relee.
  assert.equal(await l.leer(), false);
});

test("lee sólo lo que creció, y espera la línea entera", async () => {
  const ruta = path.join(tmp, "b.jsonl");
  writeFileSync(ruta, asistente("m1", "claude-opus-5-5", [1, 1, 1, 1]));
  const l = new Lector(ruta, 0);
  await l.leer();
  const entera = asistente("m2", "claude-opus-5-5", [5, 0, 50, 2]);
  // A medio escribir: todavía no cuenta.
  appendFileSync(ruta, entera.slice(0, 40));
  assert.equal(await l.leer(), false);
  assert.equal(totalDe(l.lectura.total["claude-opus-5-5"]), 4);
  appendFileSync(ruta, entera.slice(40));
  assert.equal(await l.leer(), true);
  assert.equal(totalDe(l.lectura.total["claude-opus-5-5"]), 4 + 57);
  // El mismo id con otro usage (creció mientras llegaba): vale el último, no la suma.
  appendFileSync(ruta, asistente("m2", "claude-opus-5-5", [5, 0, 50, 9]));
  await l.leer();
  assert.equal(totalDe(l.lectura.total["claude-opus-5-5"]), 4 + 64);
  // Reescrito más corto: se empieza de nuevo.
  writeFileSync(ruta, asistente("m9", "claude-opus-5-5", [2, 0, 0, 1]));
  await l.leer();
  assert.equal(totalDe(l.lectura.total["claude-opus-5-5"]), 3);
});

test("compactaciones: tras compactar, el contexto no se sabe hasta que conteste", async () => {
  const ruta = path.join(tmp, "c.jsonl");
  writeFileSync(ruta, asistente("m1", "claude-opus-5-5", [1, 0, 900, 1]) + compacto());
  const l = new Lector(ruta, 0);
  await l.leer();
  assert.equal(l.lectura.compactaciones, 1);
  assert.equal(l.lectura.compactada, true);
  appendFileSync(ruta, asistente("m2", "claude-opus-5-5", [1, 90, 0, 1]) + compacto() + asistente("m3", "claude-opus-5-5", [1, 0, 95, 1]));
  await l.leer();
  assert.equal(l.lectura.compactaciones, 2);
  assert.equal(l.lectura.compactada, false);
  assert.deepEqual(l.lectura.uso, uso([1, 0, 95, 1]));
});

test("lo de antes de `desde` no entra en lo reciente", async () => {
  const ruta = path.join(tmp, "d.jsonl");
  writeFileSync(ruta, asistente("m1", "claude-opus-5-5", [1, 0, 0, 1], AYER) + asistente("m2", "claude-opus-5-5", [10, 0, 0, 10], HOY) + asistente("m3", "claude-opus-5-5", [100, 0, 0, 100], HOY + 1000));
  const l = new Lector(ruta, HOY);
  await l.leer();
  assert.equal(totalDe(l.lectura.total["claude-opus-5-5"]), 222);
  assert.equal(totalDe(l.lectura.reciente["claude-opus-5-5"]), 220);
});

test("lo que no se entiende se saltea", async () => {
  const ruta = path.join(tmp, "e.jsonl");
  writeFileSync(
    ruta,
    '{"type":"assistant","message":{"usage":\n' +
      "no es json\n" +
      JSON.stringify({ type: "assistant", message: { id: "x", model: "claude-opus-5-5", usage: "roto" } }) +
      "\n" +
      JSON.stringify({ type: "assistant", message: { id: "y", usage: uso([1, 1, 1, 1]) } }) +
      "\n" +
      JSON.stringify({ type: "user", message: { content: 'dice "usage" y "compact_boundary" en el texto' } }) +
      "\n",
  );
  const l = new Lector(ruta, 0);
  assert.equal(await l.leer(), false);
  assert.deepEqual(l.lectura, { total: {}, reciente: {}, modelo: null, effort: null, uso: null, compactaciones: 0, compactada: false });
  assert.equal(await new Lector(path.join(tmp, "no-existe.jsonl"), 0).leer(), false);
});

test("una sesión suma a sus subagentes, que no pesan en su contexto", async () => {
  const dir = path.join(tmp, "proyectos", "-tmp-uno");
  mkdirSync(path.join(dir, "s-1", "subagents"), { recursive: true });
  const ruta = path.join(dir, "s-1.jsonl");
  writeFileSync(ruta, asistente("m1", "claude-opus-5-5", [10, 0, 500, 10]));
  writeFileSync(path.join(dir, "s-1", "subagents", "agent-a.jsonl"), asistente("a1", "claude-haiku-5-5", [3, 0, 30, 3], HOY, { isSidechain: true }) + compacto());
  writeFileSync(path.join(dir, "s-1", "subagents", "agent-a.meta.json"), "{}");
  const s = new Sesion(ruta, 0);
  assert.equal(s.sid, "s-1");
  await s.leer();
  assert.equal(totalDe(s.total()["claude-opus-5-5"]), 520);
  assert.equal(totalDe(s.total()["claude-haiku-5-5"]), 36);
  assert.equal(s.principal.lectura.modelo, "claude-opus-5-5");
  assert.equal(s.principal.lectura.compactaciones, 0);
  // Un subagente nuevo aparece en la vuelta siguiente.
  writeFileSync(path.join(dir, "s-1", "subagents", "agent-b.jsonl"), asistente("b1", "claude-haiku-5-5", [1, 0, 0, 1]));
  assert.equal(await s.leer(), true);
  assert.equal(totalDe(s.reciente()["claude-haiku-5-5"]), 38);
});

test("los transcripts tocados desde un momento", async () => {
  const proyectos = path.join(tmp, "proyectos");
  const viejo = path.join(proyectos, "-tmp-uno", "s-viejo.jsonl");
  writeFileSync(viejo, "");
  utimesSync(viejo, AYER / 1000, AYER / 1000);
  mkdirSync(path.join(proyectos, "-tmp-dos"), { recursive: true });
  writeFileSync(path.join(proyectos, "-tmp-dos", "s-2.jsonl"), "");
  // El mismo transcript enlazado desde otra carpeta no es otra sesión.
  symlinkSync(path.join(proyectos, "-tmp-dos", "s-2.jsonl"), path.join(proyectos, "-tmp-uno", "s-2.jsonl"));
  const rutas = await transcriptsDesde(proyectos, Date.now() - 60_000);
  assert.deepEqual(rutas.map((r) => path.basename(r)).sort(), ["s-1.jsonl", "s-2.jsonl"]);
  assert.deepEqual(await transcriptsDesde(path.join(tmp, "nada"), 0), []);
});

test("la medianoche local", () => {
  const m = new Date(medianoche(HOY));
  assert.deepEqual([m.getHours(), m.getMinutes(), m.getSeconds(), m.getMilliseconds()], [0, 0, 0, 0]);
  assert.ok(HOY - m.getTime() < 86_400_000 && HOY >= m.getTime());
});
