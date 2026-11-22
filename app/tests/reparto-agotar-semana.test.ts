// `reparto --agotar` de un grupo de Google: la marca dura hasta que vuelve la ventana que de verdad bloquea (la semana, si está llena), no
// hasta la de 5 h libre; y mientras rige la marca `--cupos` no pisa con esa hora el reinicio semanal medido.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.REPARTO_AA_SUPLEMENTO = "0";
const REPARTO_TS = path.join(import.meta.dirname, "..", "electron", "cli", "reparto.ts");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-agotar-semana-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const AHORA = "2026-11-22T12:00:00Z";
const H5 = "2026-11-22T15:00:00Z";
const H7 = "2026-11-25T00:00:00Z";
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
const google = (u5: number, u7: number) => ({
  version: 1,
  leido: AHORA,
  suscripciones: [
    { id: "google", nombre: "Google AI Pro", grupos: [{ id: "gemini", nombre: "Gemini", modelos: ["gemini-4-neon-high"], ventanas: [{ id: "5h", usado: u5, vuelve: H5 }, { id: "7d", usado: u7, vuelve: H7 }] }] },
  ],
});
function correr(args: string[], cupos: object, estado: string) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PA_|REPARTO_|TRAMA_)/.test(k) && k !== "STATE"));
  const env = { ...base, HOME: tmp, PA_STATE: path.join(tmp, "pa"), TRAMA_MODELOS: arch({ version: 1 }), REPARTO_STATE: estado, REPARTO_AHORA: AHORA, REPARTO_AGY: "0", REPARTO_CUPOS_FIJOS: arch(cupos) };
  return spawnSync(process.execPath, [REPARTO_TS, ...args], { encoding: "utf8", env });
}
const hastaDe = (r: { stdout: string; stderr: string }) => /agotado hasta (\S+)/.exec(r.stdout)?.[1] ?? r.stderr;

test("semana llena y 5 h libre: la marca dura hasta el reinicio semanal", () => {
  const e = mkdtempSync(path.join(tmp, "e-"));
  assert.equal(hastaDe(correr(["--agotar", "gemini-4-neon"], google(0.1, 1), e)), H7);
});

test("semana llena y 5 h llena: dura hasta la más tardía", () => {
  const e = mkdtempSync(path.join(tmp, "e-"));
  assert.equal(hastaDe(correr(["--agotar", "gemini-4-neon"], google(1, 1), e)), H7);
});

test("sólo la de 5 h llena: dura hasta ese reinicio", () => {
  const e = mkdtempSync(path.join(tmp, "e-"));
  assert.equal(hastaDe(correr(["--agotar", "gemini-4-neon"], google(1, 0.2), e)), H5);
});

test("con la marca vigente, --cupos conserva el reinicio semanal medido", () => {
  const e = mkdtempSync(path.join(tmp, "e-"));
  const cupos = google(0.1, 0.5);
  assert.equal(correr(["--agotar", "gemini-4-neon", "--hasta", "2026-11-22T14:00:00Z"], cupos, e).status, 0);
  const j = JSON.parse(correr(["--cupos", "--json"], cupos, e).stdout);
  const g = j.suscripciones[0].grupos[0];
  assert.deepEqual(g.ventanas.map((w: { id: string; usado: number; vuelve: string }) => [w.id, w.usado, w.vuelve]), [["5h", 1, H5], ["7d", 1, H7]]);
});
