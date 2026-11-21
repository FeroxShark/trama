// Arreglos de la auditoría de reparto y cupos (2026-11-21): cada caso corre el `reparto` real (TS) con cupos, hora, modelos.json y estado fijos
// por entorno, sin red ni cuentas reales.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BIN = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-audit-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-11-21T12:00:00Z";
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
const carpeta = () => {
  const d = path.join(tmp, `d${n++}`);
  mkdirSync(d, { recursive: true });
  return d;
};
type Cand = { modelo: string; descartado_por: string | null; cupo_libre: number | null };
type Sal = { modelo: string | null; effort: string | null; todo_lleno: boolean; vuelve_antes: string | null; candidatos: Cand[]; avisos: string[] };

/** Todo apagado salvo lo que el caso pida por `env`. */
function correr(args: string[], env: Record<string, string>, mod: object = {}, suscripciones: object[] = []) {
  const estado = (env.REPARTO_STATE ??= carpeta());
  const r = spawnSync(BIN, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      TZ: "UTC", REPARTO_AHORA: AHORA, REPARTO_AA: "0", REPARTO_AA_FOTO: "0", REPARTO_AA_SUPLEMENTO: "0", REPARTO_CARGA_FIJA: "{}",
      TRAMA_GO_SIN_RED: "1", REPARTO_AVISAR: "0", REPARTO_AGY: "0", REPARTO_DSH: "0", REPARTO_CLAUDE: "0", REPARTO_CODEX: "0", REPARTO_OPENCODE: "0",
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_OPENCODE_FIJO: "[]",
      REPARTO_CUPOS_FIJOS: arch({ version: 1, leido: AHORA, suscripciones }), TRAMA_MODELOS: arch({ version: 1, ...mod }),
      PA_STATE: carpeta(), HILOS_STATE: carpeta(), CODEX_HOME: carpeta(), REPARTO_MEDICION: path.join(tmp, "med.tsv"),
      ...env, REPARTO_STATE: estado,
    },
  });
  return r;
}
const elegir = (tipo: string, env: Record<string, string>, mod: object = {}, susc: object[] = []) => {
  const r = correr(["--tipo", tipo, "--json"], env, mod, susc);
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  return JSON.parse(r.stdout) as Sal;
};

// A02 (REPARTO-CUPOS-1)
test("un gratis de OpenCode excluido en Ajustes no se revive aunque sea el único candidato", () => {
  const s = elegir("debug", { REPARTO_OPENCODE: "1", REPARTO_OPENCODE_FIJO: '["opencode/beam-free"]' }, { excluir: ["opencode:*"] });
  assert.equal(s.modelo, null, String(s.modelo));
});

test("un gratis de OpenCode con el grupo agotado no se revive por calidad baja", () => {
  const estado = carpeta();
  writeFileSync(path.join(estado, "agotado.json"), JSON.stringify({ "opencode-free": { hasta: "2026-11-22T12:00:00Z" } }));
  const s = elegir("debug", { REPARTO_OPENCODE: "1", REPARTO_OPENCODE_FIJO: '["opencode/beam-free"]', REPARTO_STATE: estado });
  assert.notEqual(s.modelo, "opencode:opencode/beam-free", String(s.modelo));
});

// A01 (REPARTO-CUPOS-4)
test("sin ningún proveedor disponible (Claude apagado y nada más) no ofrece un Claude inexistente", () => {
  const s = elegir("codigo-acotado", {});
  assert.equal(s.modelo, null, String(s.modelo));
});
