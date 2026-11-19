// Gemini 4 Neon en `reparto` (electron/cli/reparto.ts): va primero en lo que pesa, comparte el cupo de Gemini y cede cuando no tiene cupo o
// cuando el cupo de Claude se perdería. Cupos, hora y modelos fijos por entorno: no mira nada real.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { partirGemini } from "../electron/modelos-config.ts";
import { ubicacionDe } from "../src/hilo/cupo-modelos.ts";

const BIN = path.join(import.meta.dirname, "..", "..", "motor", "bin");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-neon-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
const en = (h: number) => new Date(Date.parse(AHORA) + h * 3600_000).toISOString().replace(".000", "");
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
const vent = (u5: number, u7: number, vuelve7 = 96) => [{ id: "5h", usado: u5, vuelve: en(3) }, { id: "7d", usado: u7, vuelve: en(vuelve7) }];
const cupos = ({ claude7 = 0.45, vuelve7 = 96, gemini = 0.1 }: { claude7?: number; vuelve7?: number; gemini?: number } = {}) =>
  arch({
    version: 1,
    leido: AHORA,
    suscripciones: [
      { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: vent(0.1, claude7, vuelve7) },
      {
        id: "google", nombre: "Google AI Pro",
        grupos: [
          { id: "gemini", nombre: "Gemini", ventanas: vent(gemini, gemini) },
          { id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: vent(0.1, 0.2) },
          { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [{ id: "7d", usado: 0.2, vuelve: en(96) }] },
        ],
      },
    ],
  });

function elegir(tipo: string, fijos: string, modelos: object = {}): { modelo: string; motivo: string; candidatos: { modelo: string; grupo: string }[] } {
  const r = spawnSync(path.join(BIN, "reparto"), ["--tipo", tipo, "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "UTC",
      REPARTO_CUPOS_FIJOS: fijos,
      REPARTO_AGY: "1",
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: "[]",
      REPARTO_STATE: path.join(tmp, `estado${n++}`),
      REPARTO_CARGA_FIJA: "{}",
      REPARTO_MEDICION: path.join(tmp, "sin-medicion.tsv"),
      TRAMA_MODELOS: arch({ version: 1, perfil: "ahorro", ...modelos }),
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

for (const tipo of ["frontend", "codigo-multi", "diseno", "debug"]) {
  test(`${tipo}: con cupo de Gemini gana Neon high`, () => {
    assert.equal(elegir(tipo, cupos()).modelo, "gemini-4-neon-high");
  });
}

test("Neon cobra del grupo de Gemini, igual que Hydrogen", () => {
  const neon = elegir("frontend", cupos()).candidatos.find((c) => c.modelo === "gemini-4-neon-high");
  assert.equal(neon?.grupo, "gemini");
  assert.deepEqual(ubicacionDe("gemini-4-neon-high"), { suscripcion: "google", grupo: "gemini" });
});

test("sin cupo de Gemini, o excluido, Neon no se elige", () => {
  assert.notEqual(elegir("frontend", cupos({ gemini: 1 })).modelo, "gemini-4-neon-high");
  assert.notEqual(elegir("frontend", cupos(), { excluir: ["neon"] }).modelo, "gemini-4-neon-high");
});

test("si el cupo semanal de Claude se perdería, Neon pierde la preferencia y decide el puntaje", () => {
  assert.match(elegir("codigo-multi", cupos()).motivo, /se prefiere la calidad de neon/);
  assert.doesNotMatch(elegir("codigo-multi", cupos({ claude7: 0.2, vuelve7: 24 })).motivo, /se prefiere la calidad de neon/);
});

test("Neon acepta xhigh en el nombre y en el esfuerzo", () => {
  assert.deepEqual(partirGemini("gemini-4-neon-xhigh"), { modelo: "gemini-4-neon", effort: "xhigh" });
  assert.deepEqual(partirGemini("gemini-4-neon", "xhigh"), { modelo: "gemini-4-neon", effort: "xhigh" });
});
