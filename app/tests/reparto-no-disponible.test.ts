// REPARTO_NO_DISPONIBLE en `reparto` (motor/bin/reparto): lo que `pa` sabe que ahora no sirve (plugin de agy sin cargar, un Claude con el límite
// a la vista) no es candidato; se pide el siguiente. Misma sintaxis que `excluir` (familia, id, prefijo*).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// La base es el índice de INTELIGENCIA de AA; la tabla suplementaria real se apaga.
process.env.REPARTO_AA_SUPLEMENTO = "0";
const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-nodisp-"));
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
    ["Claude Opus 5.5 (Reasoning)", 65], ["Claude Sonnet 5.5", 55], ["Claude Haiku 5.5", 39],
  ].map(([name, intelligence]) => ({ name, slug: String(name).toLowerCase().replace(/[^a-z0-9.]+/g, "-"), creator: "x", intelligence, coding: null, agentic: null })),
});

function elegir(tipo: string, noDisponible: string) {
  const r = spawnSync(REPARTO, ["--tipo", tipo, "--json"], {
    encoding: "utf8",
    env: { ...process.env, REPARTO_CUPOS_FIJOS: CUPOS, REPARTO_AHORA: AHORA, REPARTO_AA: AA, REPARTO_AGY: "0", REPARTO_STATE: path.join(tmp, "estado"),
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_OPENCODE_FIJO: "[]", TRAMA_MODELOS: arch({ version: 1 }), REPARTO_NO_DISPONIBLE: noDisponible },
  });
  // rc 1 = no queda candidato que sirva
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  return (r.status === 0 ? JSON.parse(r.stdout) : { modelo: "", effort: null, motivo: r.stderr }) as { modelo: string; effort: string | null; motivo: string };
}

test("sin REPARTO_NO_DISPONIBLE elige como siempre (un Claude)", () => {
  const r = elegir("codigo-multi", "");
  assert.ok(r.modelo.startsWith("claude-"));
});

test("saltea la familia y el id que pa dice que no sirven: pide el siguiente", () => {
  assert.match(elegir("codigo-multi", "opus, haiku").modelo, /sonnet/);
  assert.doesNotMatch(elegir("codigo-multi", "opus,sonnet").modelo, /opus|sonnet/);
  assert.match(elegir("codigo-multi", "claude-opus-5-5,haiku").modelo, /sonnet|opus/);
  assert.doesNotMatch(elegir("codigo-multi", "claude-opus-5-5,haiku").modelo, /opus-5-5$/);
});

test("el prefijo claude-* saca a todo Claude oficial (sin otro motor no queda candidato que sirva)", () => {
  const r = elegir("codigo-multi", "claude-*");
  assert.ok(!r.modelo || !r.modelo.startsWith("claude-"), r.modelo);
});
