// `preferido_por_tipo` de `reparto` (electron/cli/reparto.ts, `elegir`): la banda de calidad [q0, q0 + MARGEN] se ancla en el preferido
// sólo si está entre los candidatos vivos. Un preferido sin cupo (agotado o enfriado) no deja afuera a los más baratos: pasaba que un
// gratis de OpenCode enfriado hacía ganar a Sonnet en vez de Haiku en lectura/mecanico con perfil ahorro. Sólo el TS (el python está
// congelado). Cupos, hora, modelos.json, AA y medición fijos por entorno: no mira nada real.
import { after, beforeEach } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BIN = path.join(import.meta.dirname, "..", "..", "motor", "bin");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-preferido-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
const CROUTON = "opencode:opencode/crouton-alpha-free";
const en = (h: number) => new Date(Date.parse(AHORA) + h * 3600_000).toISOString().replace(".000", "");
const CUPOS = path.join(tmp, "cupos.json");
writeFileSync(CUPOS, JSON.stringify({
  version: 1, leido: AHORA,
  suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: 0.1, vuelve: en(3) }, { id: "7d", usado: 0.3, vuelve: en(96) }] }],
}));
const MODELOS = path.join(tmp, "modelos.json");
writeFileSync(MODELOS, JSON.stringify({
  version: 1, perfil: "ahorro", calidad_unidades: "aa",
  calidad: { [CROUTON]: 41, haiku: 34.6, sonnet: 43 },
  preferido_por_tipo: { lectura: CROUTON, mecanico: CROUTON },
}));

let estado = "";
let n = 0;
beforeEach(() => void (estado = path.join(tmp, `estado${n++}`)));

function correr(args: string[]) {
  const r = spawnSync(path.join(BIN, "reparto"), args, {
    encoding: "utf8",
    env: {
      ...process.env, TZ: "UTC", TRAMA_REPARTO: "ts", REPARTO_AHORA: AHORA, REPARTO_CUPOS_FIJOS: CUPOS, TRAMA_MODELOS: MODELOS,
      REPARTO_AA: "0", REPARTO_AA_SUPLEMENTO: "0", REPARTO_AGY: "0", REPARTO_CODEX: "0", REPARTO_NVIDIA: "0",
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_OPENCODE_FIJO: '["opencode/crouton-alpha-free"]',
      REPARTO_STATE: estado, REPARTO_CARGA_FIJA: "{}", REPARTO_MEDICION: path.join(tmp, "no-hay.tsv"), REPARTO_CON_CHEQUEO: "",
    },
  });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return r.stdout;
}
const elegir = (t: string) => JSON.parse(correr(["--tipo", t, "--json"])) as { modelo: string; motivo: string };

test("preferido sin cupo + ahorro: lectura y mecanico eligen Haiku, sin banda anclada en el preferido", () => {
  correr(["--enfriar", CROUTON, "--horas", "24"]);
  for (const t of ["lectura", "mecanico"]) {
    const s = elegir(t);
    assert.equal(s.modelo, "claude-haiku-5-5", `${t}: ${s.motivo}`);
    assert.doesNotMatch(s.motivo, /se prefiere la calidad de/, t);
  }
});

test("preferido vivo: sigue ganando el preferido, como antes", () => {
  for (const t of ["lectura", "mecanico"]) assert.equal(elegir(t).modelo, CROUTON, t);
});
