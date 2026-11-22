// El límite semanal propio de un modelo de Claude (Fable: «hasta 50 % del límite semanal»): `reparto` lo lee de `por_modelo` de uso.json,
// no elige al modelo agotado aunque la semana general tenga lugar y `--cupos` lo muestra en una línea propia.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { familiaDeLimite, limiteDeModelo } from "../electron/cli/reparto.ts";

process.env.REPARTO_AA_SUPLEMENTO = "0";
const REPARTO_TS = path.join(import.meta.dirname, "..", "electron", "cli", "reparto.ts");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-limite-modelo-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const AHORA = "2026-11-22T12:00:00Z";
const T = (iso: string) => Math.round(Date.parse(iso) / 1000);
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
const vent = (usado: number, vuelve: string) => ({ id: "7d", usado, vuelve });
const claude = (modelos?: object[]) => ({
  version: 1,
  leido: AHORA,
  suscripciones: [
    { id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: 0.14, vuelve: "2026-11-22T16:00:00Z" }, vent(0.3, "2026-11-25T00:00:00Z")], ...(modelos ? { modelos } : {}) },
  ],
});
const FABLE = (usado: number, vuelve = "2026-11-22T14:59:59Z") => [{ id: "fable", nombre: "Fable", ventanas: [vent(usado, vuelve)] }];
const AA = arch({ version: 1, fetched: "2026-11-20T08:00:00Z", modelos: [] });

function env(extra: Record<string, string>): NodeJS.ProcessEnv {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PA_|REPARTO_|TRAMA_)/.test(k) && k !== "STATE"));
  return {
    ...base,
    HOME: tmp,
    HILOS_STATE: path.join(tmp, "hilos"),
    PA_STATE: path.join(tmp, "pa"),
    TRAMA_MODELOS: arch({ version: 1 }),
    REPARTO_STATE: path.join(tmp, "estado"),
    REPARTO_AHORA: AHORA,
    REPARTO_AA: AA,
    REPARTO_AGY: "0",
    REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
    REPARTO_OPENCODE_FIJO: "[]",
    ...extra,
  };
}
const correr = (args: string[], e: Record<string, string>) => spawnSync(process.execPath, [REPARTO_TS, ...args], { encoding: "utf8", env: env(e) });

test("la familia sale del nombre del límite, sin lista fija", () => {
  assert.equal(familiaDeLimite("Fable"), "fable");
  assert.equal(familiaDeLimite("Claude Opus 5"), "opus");
  assert.equal(familiaDeLimite("  "), "");
  assert.equal(familiaDeLimite(null), "");
});

test("limiteDeModelo: sólo un 100 % vigente corta, y sólo a los ids de esa familia", () => {
  const ahora = new Date(AHORA);
  assert.deepEqual(limiteDeModelo(FABLE(1), "claude-fable-5-2", ahora), ["Fable", "2026-11-22T14:59:59Z"]);
  assert.equal(limiteDeModelo(FABLE(1), "claude-opus-5-5", ahora), null);
  assert.equal(limiteDeModelo(FABLE(0.93), "claude-fable-5-2", ahora), null);
  assert.equal(limiteDeModelo(FABLE(1, "2026-11-22T11:00:00Z"), "claude-fable-5-2", ahora), null, "ya se reinició");
  assert.equal(limiteDeModelo(undefined, "claude-fable-5-2", ahora), null);
  assert.equal(limiteDeModelo([null, 3, { nombre: 4 }], "claude-fable-5-2", ahora), null);
  // Otro modelo que aparezca mañana entra solo.
  assert.ok(limiteDeModelo([{ nombre: "Opus", ventanas: [vent(1, "2026-11-23T00:00:00Z")] }], "claude-opus-5-5", ahora));
});

test("--tipo: con el límite de Fable agotado no se elige Fable aunque la semana general tenga lugar", () => {
  const libre = correr(["--tipo", "dificil", "--json"], { REPARTO_CUPOS_FIJOS: arch(claude(FABLE(0.2))) });
  assert.ok(libre.status === 0 || libre.status === 1, libre.stderr);
  const lleno = correr(["--tipo", "dificil", "--json", "--explicar"], { REPARTO_CUPOS_FIJOS: arch(claude(FABLE(1))) });
  assert.ok(lleno.status === 0 || lleno.status === 1, lleno.stderr);
  const eleg = (r: { stdout: string }) => (r.stdout.trim() ? (JSON.parse(r.stdout) as { modelo?: string }).modelo ?? "" : "");
  assert.doesNotMatch(eleg(lleno), /fable/);
  assert.match(lleno.stdout, /límite semanal de Fable agotado \(100 % usado\), vuelve en 3 h/);
  assert.doesNotMatch(libre.stdout, /límite semanal de Fable agotado/);
});

test("--cupos lee por_modelo de uso.json y muestra «Fable: 7d 7 % libre (vuelve en …)»; sin el campo no hay línea", () => {
  const dir = path.join(tmp, "pa");
  mkdirSync(dir, { recursive: true });
  const ts = T(AHORA) - 60;
  writeFileSync(
    path.join(dir, "uso.json"),
    JSON.stringify({
      version: 1,
      five_hour: { pct: 14, resets_at: T("2026-11-22T16:00:00Z"), ts },
      seven_day: { pct: 75, resets_at: T("2026-11-25T00:00:00Z"), ts },
      por_modelo: [{ modelo: "Fable", pct: 93, resets_at: T("2026-11-22T14:59:59Z"), ts }, null, { modelo: 4, pct: 1 }],
    }),
  );
  const e = { REPARTO_CLAUDE: "1", PATH: process.env.PATH ?? "" };
  const txt = correr(["--cupos"], e);
  assert.equal(txt.status, 0, txt.stderr);
  assert.match(txt.stdout, /^ {2}Fable: 7d 7 % libre \(vuelve en 3 h\)$/m);
  const j = JSON.parse(correr(["--cupos", "--json"], e).stdout) as { suscripciones: { id: string; modelos?: { id: string; nombre: string; ventanas: { id: string; usado: number }[] }[] }[] };
  const m = j.suscripciones.find((s) => s.id === "claude")?.modelos;
  assert.deepEqual(m?.map((x) => [x.id, x.nombre, x.ventanas[0]?.id, x.ventanas[0]?.usado]), [["fable", "Fable", "7d", 0.93]]);
  // Un uso.json viejo (sin por_modelo): ni línea ni campo.
  writeFileSync(path.join(dir, "uso.json"), JSON.stringify({ version: 1, five_hour: { pct: 14, resets_at: T("2026-11-22T16:00:00Z"), ts } }));
  assert.doesNotMatch(correr(["--cupos"], e).stdout, /Fable:/);
  assert.equal(JSON.parse(correr(["--cupos", "--json"], e).stdout).suscripciones.find((s: { id: string }) => s.id === "claude")?.modelos, undefined);
});
