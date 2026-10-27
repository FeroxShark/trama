// `efforts_permitidos` de modelos.json en `reparto` (motor/bin/reparto): si el effort del tipo no está permitido va el más cercano
// (primero el siguiente más alto, si no el más alto de los de abajo) con su calidad; lista vacía = modelo excluido; el motivo nombra el effort.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-efp-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const AHORA = "2026-10-26T12:00:00Z";
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
const CUPOS = arch({ version: 1, leido: AHORA, suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: 0.2, vuelve: "2026-10-26T14:00:00Z" }, { id: "7d", usado: 0.3, vuelve: "2026-10-27T00:00:00Z" }] }] });
const AA = arch({
  version: 1,
  fetched: "2026-10-25T08:00:00Z",
  modelos: [
    ["Claude Opus 5.5 (Reasoning)", 66, 64], ["Claude Sonnet 5.5", 56, 54], ["Claude Haiku 5.5", 40, 38],
  ].map(([name, coding, agentic]) => ({ name, slug: String(name).toLowerCase().replace(/[^a-z0-9.]+/g, "-"), creator: "x", intelligence: 50, coding, agentic })),
});

function elegir(tipo: string, mod: object) {
  const r = spawnSync(REPARTO, ["--tipo", tipo, "--json"], {
    encoding: "utf8",
    env: { ...process.env, REPARTO_CUPOS_FIJOS: CUPOS, REPARTO_AHORA: AHORA, REPARTO_AA: AA, REPARTO_AGY: "0", REPARTO_STATE: path.join(tmp, "estado"),
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_OPENCODE_FIJO: "[]", TRAMA_MODELOS: arch({ version: 1, ...mod }) },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as { modelo: string; effort: string | null; motivo: string };
}

test("sin efforts_permitidos: el effort del tipo (codigo-multi = high)", () => {
  const r = elegir("codigo-multi", { excluir: ["opus", "haiku"] });
  assert.match(r.modelo, /sonnet/);
  assert.equal(r.effort, "high");
});

test("high no permitido: va xhigh (el siguiente más alto) y el motivo lo dice", () => {
  const r = elegir("codigo-multi", { excluir: ["opus", "haiku"], efforts_permitidos: { sonnet: ["low", "xhigh"] } });
  assert.equal(r.effort, "xhigh");
  assert.match(r.motivo, /xhigh/);
});

test("sin ninguno más alto permitido: el más alto de los de abajo", () => {
  const r = elegir("codigo-multi", { excluir: ["opus", "haiku"], efforts_permitidos: { sonnet: ["low", "medium"] } });
  assert.equal(r.effort, "medium");
  assert.match(r.motivo, /medium/);
});

test("lista vacía: el modelo queda excluido y gana otro", () => {
  const r = elegir("lectura", { excluir: ["opus"], efforts_permitidos: { sonnet: [] } });
  assert.match(r.modelo, /haiku|opencode|claude/);
  assert.doesNotMatch(r.modelo, /sonnet/);
});

test("la clave puede ser el id exacto", () => {
  const r = elegir("codigo-multi", { excluir: ["opus", "haiku"], efforts_permitidos: { "claude-sonnet-5-5": ["max"] } });
  assert.equal(r.effort, "max");
});

test("efforts_permitidos inválido: se ignora (defaults)", () => {
  const r = elegir("codigo-multi", { excluir: ["opus", "haiku"], efforts_permitidos: { sonnet: ["ultra"] } });
  assert.equal(r.effort, "high");
});

// --- nunca se ordena por el esfuerzo máximo: el puntaje que cuenta es el del esfuerzo que corre ------------------------------------
const AA_EF = arch({
  version: 1,
  fetched: "2026-10-25T08:00:00Z",
  modelos: [
    ["Claude Sonnet 5.5 (Low Effort)", 40], ["Claude Sonnet 5.5 (Medium Effort)", 46], ["Claude Sonnet 5.5 (High Effort)", 50], ["Claude Sonnet 5.5 (Max Effort)", 62],
    ["Claude Opus 5.5 (High Effort)", 56], ["Claude Opus 5.5 (Max Effort)", 70], ["Claude Haiku 5.5 (High Effort)", 38], ["Claude Haiku 5.5 (Max Effort)", 44],
  ].map(([name, v]) => ({ name, slug: String(name).toLowerCase().replace(/[^a-z0-9.]+/g, "-"), creator: "x", intelligence: 50, coding: v, agentic: v })),
});
type Cand = { modelo: string; effort: string | null; calidad: number; calidad_mejor: number; descartado_por: string | null };
function corrida(args: string[], mod: object) {
  const r = spawnSync(REPARTO, args, {
    encoding: "utf8",
    env: { ...process.env, REPARTO_CUPOS_FIJOS: CUPOS, REPARTO_AHORA: AHORA, REPARTO_AA: AA_EF, REPARTO_AGY: "0", REPARTO_STATE: path.join(tmp, "estado"),
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_OPENCODE_FIJO: "[]", TRAMA_MODELOS: arch({ version: 1, ...mod }) },
  });
  assert.ok(r.status === 0 || r.status === 1, r.stderr); // 1: ningún modelo sirve (igual trae los candidatos)
  return JSON.parse(r.stdout);
}
const cand = (r: { candidatos: Cand[] }, id: string) => r.candidatos.find((c) => c.modelo === id)!;

test("--tipo: el puntaje de Sonnet es el de high (50), no el del max (62) ni el 'mejor'; el mínimo 'sonnet' se mide al mismo esfuerzo", () => {
  const r = corrida(["--tipo", "codigo-multi", "--json"], { excluir: ["opus", "haiku"] });
  const c = cand(r, "claude-sonnet-5-5");
  assert.equal(c.effort, "high");
  assert.equal(c.calidad, 50);
  assert.equal(c.calidad_mejor, 62, "el mejor sólo informa");
  const ca = corrida(["--tipo", "codigo-acotado", "--json"], { excluir: ["opus", "haiku"] });
  assert.equal(cand(ca, "claude-sonnet-5-5").calidad, 46, "codigo-acotado va en medium");
  assert.equal(cand(ca, "claude-sonnet-5-5").descartado_por, null, "medium contra el mínimo de Sonnet en medium");
});

test("efforts_permitidos cambia el puntaje al del esfuerzo que se usa: sólo low → 40, y ya no llega al mínimo de Sonnet", () => {
  const r = corrida(["--tipo", "codigo-acotado", "--json"], { excluir: ["opus", "haiku"], efforts_permitidos: { sonnet: ["low"] } });
  const c = cand(r, "claude-sonnet-5-5");
  assert.equal(c.effort, "low");
  assert.equal(c.calidad, 40);
  assert.match(c.descartado_por ?? "", /calidad 40 menor que la 46/);
});

test("--tabla: calidad es la del esfuerzo que se usaría (high), con effort_usado; sólo [low, max] permitidos → el siguiente más alto (max)", () => {
  const filas = (mod: object) => Object.fromEntries((corrida(["--tabla", "--json"], mod).modelos as { id: string; calidad: number; effort_usado: string | null; calidad_por_effort: Record<string, number> }[]).map((m) => [m.id, m]));
  const t = filas({});
  assert.deepEqual([t["claude-sonnet-5-5"].calidad, t["claude-sonnet-5-5"].effort_usado], [50, "high"]);
  assert.deepEqual(t["claude-sonnet-5-5"].calidad_por_effort, { low: 40, medium: 46, high: 50, max: 62 });
  const u = filas({ efforts_permitidos: { sonnet: ["low", "max"] } });
  assert.deepEqual([u["claude-sonnet-5-5"].calidad, u["claude-sonnet-5-5"].effort_usado], [62, "max"]);
});
