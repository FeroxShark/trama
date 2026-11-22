// ChatGPT/codex: el porcentaje sale de la medición más nueva por su timestamp, no del transcript modificado hace menos. Un rollout viejo que
// recibe una escritura sin medición no tapa a otro con una lectura posterior.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO_TS = path.join(import.meta.dirname, "..", "electron", "cli", "reparto.ts");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-codex-medicion-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const AHORA = "2026-11-22T12:00:00Z";
const T = (iso: string) => Math.round(Date.parse(iso) / 1000);

const medicion = (ts: string, p5: number, p7: number) =>
  JSON.stringify({ timestamp: ts, payload: { rate_limits: { primary: { used_percent: p5, window_minutes: 300, resets_at: T("2026-11-22T16:00:00Z") }, secondary: { used_percent: p7, window_minutes: 10080, resets_at: T("2026-11-25T00:00:00Z") } } } });

function rollout(home: string, nombre: string, lineas: string[], mtimeIso: string) {
  const dir = path.join(home, "sessions", "2026", "11", "22");
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `rollout-${nombre}.jsonl`);
  writeFileSync(f, lineas.join("\n") + "\n");
  utimesSync(f, T(mtimeIso), T(mtimeIso));
}

function leer(home: string) {
  const bin = path.join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 0\n");
  chmodSync(path.join(bin, "codex"), 0o755);
  writeFileSync(path.join(home, "auth.json"), "{}");
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PA_|REPARTO_|TRAMA_)/.test(k) && k !== "STATE"));
  const r = spawnSync(process.execPath, [REPARTO_TS, "--cupos", "--json"], {
    encoding: "utf8",
    env: {
      ...base,
      HOME: tmp,
      CODEX_HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      REPARTO_STATE: path.join(tmp, "estado"),
      REPARTO_AHORA: AHORA,
      REPARTO_AGY: "0",
      REPARTO_CLAUDE: "0",
      PA_STATE: path.join(tmp, "pa-estado"),
      REPARTO_CUENTAS_BIN: path.join(tmp, "no-hay-cuentas"),
      REPARTO_AVISAR: "0",
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: "[]",
      TRAMA_MODELOS: path.join(tmp, "no-hay.json"),
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout).suscripciones.find((x: { id: string }) => x.id === "openai");
  const w = (id: string) => s.grupos[0].ventanas.find((v: { id: string }) => v.id === id).usado;
  return { h5: w("5h"), d7: w("7d") };
}

test("gana la medición más nueva por timestamp aunque su archivo se haya tocado antes", () => {
  const home = path.join(tmp, "c1");
  // A: medición de las 11:00 (90 %); su archivo no se toca desde entonces.
  rollout(home, "a", [medicion("2026-11-22T11:00:00Z", 90, 80)], "2026-11-22T11:00:01Z");
  // B: medición vieja (08:00, 30 %), pero el archivo recibió escrituras sin medición a las 11:30.
  rollout(home, "b", [medicion("2026-11-22T08:00:00Z", 30, 20), JSON.stringify({ timestamp: "2026-11-22T11:30:00Z", payload: { type: "mensaje" } })], "2026-11-22T11:30:00Z");
  assert.deepEqual(leer(home), { h5: 0.9, d7: 0.8 });
});

test("por ventana: cada una sale de su medición más reciente", () => {
  const home = path.join(tmp, "c2");
  rollout(home, "a", [medicion("2026-11-22T10:00:00Z", 10, 70)], "2026-11-22T10:00:00Z");
  rollout(home, "b", [JSON.stringify({ timestamp: "2026-11-22T11:00:00Z", payload: { rate_limits: { primary: { used_percent: 55, window_minutes: 300, resets_at: T("2026-11-22T16:00:00Z") } } } })], "2026-11-22T11:00:00Z");
  assert.deepEqual(leer(home), { h5: 0.55, d7: 0.7 });
});
