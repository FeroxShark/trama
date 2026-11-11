// Sin caché de Artificial Analysis (sin API key) `reparto` usa la foto que viaja con el motor (motor/datos/aa-foto.json, la saca
// scripts/aa-foto.mjs): hay curva por esfuerzo, la tabla dice `aa_fecha` y `aa_foto`. Sin caché ni foto, valen los defaults de siempre.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = path.join(import.meta.dirname, "..", "..");
const REPARTO = path.join(RAIZ, "motor", "bin", "reparto");
const FOTO = path.join(RAIZ, "motor", "datos", "aa-foto.json");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-aa-foto-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const arch = (j: object) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
const AHORA = "2026-11-11T12:00:00Z";
const cupos = arch({ version: 1, leido: AHORA, suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: 0.2, vuelve: "2026-11-11T14:00:00Z" }] }] });
type Fila = { id: string; calidad: number; origen: string; aa_fecha: string | null; aa_foto?: boolean; calidad_por_effort: Record<string, number> };

/** `reparto --tabla` con un estado vacío (sin caché propia) y el entorno de la foto que se pida. */
function tabla(env: Record<string, string>) {
  const r = spawnSync(REPARTO, ["--tabla", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      REPARTO_CUPOS_FIJOS: cupos,
      REPARTO_AHORA: AHORA,
      REPARTO_AGY: "0",
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: "[]",
      REPARTO_STATE: path.join(tmp, "estado"),
      TRAMA_MODELOS: arch({ version: 1 }),
      REPARTO_AA_SUPLEMENTO: "0",
      ...env,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries((JSON.parse(r.stdout).modelos as Fila[]).map((m) => [m.id, m]));
}

const ENTRADA = (name: string, slug: string, intelligence: number) => ({ name, slug, creator: "Anthropic", intelligence });
const FOTO_FALSA = { fecha: "2026-11-10", modelos: [ENTRADA("Claude Sonnet 5.5 (Low)", "claude-sonnet-5-5-low", 20), ENTRADA("Claude Sonnet 5.5 (Medium)", "claude-sonnet-5-5-medium", 30), ENTRADA("Claude Sonnet 5.5 (High)", "claude-sonnet-5-5-high", 40)] };

test("sin caché y con foto: calidad_por_effort tiene un valor distinto por effort, con la fecha de la foto", () => {
  const s = tabla({ REPARTO_AA_FOTO: arch(FOTO_FALSA) })["claude-sonnet-5-5"]!;
  assert.deepEqual(s.calidad_por_effort, { low: 20, medium: 30, high: 40 });
  assert.equal(new Set(Object.values(s.calidad_por_effort)).size, 3);
  assert.deepEqual([s.origen, s.aa_fecha, s.aa_foto], ["artificial-analysis", "2026-11-10", true]);
});

test("la foto del repo (motor/datos/aa-foto.json) es válida, sin claves, y alcanza para tener curva sin caché", () => {
  assert.ok(existsSync(FOTO), "falta motor/datos/aa-foto.json (node app/scripts/aa-foto.mjs)");
  const texto = readFileSync(FOTO, "utf8");
  assert.doesNotMatch(texto, /api[_-]?key|secret|token|x-api/i);
  const j = JSON.parse(texto) as { fecha: string; modelos: object[] };
  assert.match(j.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(j.modelos.length > 0);
  const t = tabla({ REPARTO_AA_FOTO: "" }); // vacío = sin variable: la ruta por defecto, la del repo
  const conCurva = Object.values(t).filter((m) => m.origen === "artificial-analysis" && Object.keys(m.calidad_por_effort).length >= 2);
  assert.ok(conCurva.length > 0, "ningún modelo con curva por effort desde la foto");
  assert.ok(conCurva.every((m) => m.aa_foto === true && m.aa_fecha === j.fecha));
});

test("con caché propia manda la caché (sin marca de foto, con su fecha)", () => {
  const cache = arch({ version: 1, fetched: "2026-11-11T08:00:00.000Z", modelos: [ENTRADA("Claude Sonnet 5.5 (Low)", "claude-sonnet-5-5-low", 25), ENTRADA("Claude Sonnet 5.5 (High)", "claude-sonnet-5-5-high", 45)] });
  const s = tabla({ REPARTO_AA: cache, REPARTO_AA_FOTO: arch(FOTO_FALSA) })["claude-sonnet-5-5"]!;
  assert.deepEqual(s.calidad_por_effort, { low: 25, high: 45 });
  assert.deepEqual([s.aa_fecha, s.aa_foto], ["2026-11-11", undefined]);
});

test("sin caché ni foto: como antes (defaults, sin fecha ni curva por effort)", () => {
  for (const env of [{ REPARTO_AA_FOTO: "0" }, { REPARTO_AA_FOTO: path.join(tmp, "no-existe.json") }]) {
    const s = tabla(env)["claude-sonnet-5-5"]!;
    assert.equal(s.origen, "defecto");
    assert.equal(s.aa_fecha, null);
    assert.equal(s.aa_foto, undefined);
    assert.deepEqual(s.calidad_por_effort, {});
  }
});
