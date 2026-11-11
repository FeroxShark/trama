// Ningún modelo nuevo queda sin fila de Artificial Analysis (AA) sin que nadie se entere: cada familia de `FAMILIAS` (reparto) y cada
// modelo principal del catálogo de la cuenta de Claude tiene fila en AA (caché, foto del repo) o en el suplemento. Si no, falla con su nombre.
// Fable 5.2 entra a la tabla del reparto pero no se elige solo: sin --ok-dueno `pa` lo frena (política) y `reparto --tipo` lo descarta.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { familiasSinFilaAA } from "../electron/cli/reparto.ts";
import { calidadDeAA } from "../electron/reparto-claude.ts";
import { modelosClaudeCuenta } from "../electron/claude-catalogo.ts";

const RAIZ = path.join(import.meta.dirname, "..", "..");
const DATOS = path.join(RAIZ, "motor", "datos");
const FIX = path.join(import.meta.dirname, "fixtures");
const REPARTO = path.join(RAIZ, "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-fam-aa-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Corre `f` con esas variables de entorno puestas (y las restaura). */
function conEntorno<T>(env: Record<string, string | undefined>, f: () => T): T {
  const antes = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    return f();
  } finally {
    for (const [k, v] of Object.entries(antes)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

/** Sin caché propia (estado vacío): vale la foto del repo + el suplemento, como en una máquina sin API key. */
const SIN_CACHE = { REPARTO_AA: undefined, REPARTO_AA_FOTO: undefined, REPARTO_AA_SUPLEMENTO: undefined, REPARTO_STATE: path.join(tmp, "estado"), PA_STATE: path.join(tmp, "estado") };

test("cada familia de FAMILIAS tiene fila en AA o en el suplemento", () => {
  const sin = conEntorno(SIN_CACHE, familiasSinFilaAA);
  assert.deepEqual(sin, [], `sin fila de Artificial Analysis (ni en la foto ni en aa-suplemento.json): ${sin.join(", ")}`);
});

test("el control falla con una familia sin fila: la caché vieja (14 modelos) y sin suplemento no trae Fable 5.2", () => {
  const sin = conEntorno({ ...SIN_CACHE, REPARTO_AA: path.join(FIX, "aa-real-2026-10-27.json"), REPARTO_AA_FOTO: "0", REPARTO_AA_SUPLEMENTO: "0" }, familiasSinFilaAA);
  assert.ok(sin.includes("claude-fable-5-2"), `debería nombrar a claude-fable-5-2; dijo: ${sin.join(", ")}`);
});

test("cada modelo principal del catálogo de la cuenta tiene fila de AA (foto + suplemento)", () => {
  const home = mkdtempSync(path.join(tmp, "home-"));
  const dir = path.join(home, ".claude", "cache", "model-catalog");
  rmSync(dir, { recursive: true, force: true });
  const lista = JSON.parse(readFileSync(path.join(FIX, "claude-catalogo-cuenta.json"), "utf8"));
  // el lector busca `<config>/cache/model-catalog/*-cc.json`
  const arch = path.join(dir, "cuenta-cc.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(arch, JSON.stringify(lista));
  const cat = modelosClaudeCuenta({}, home);
  assert.ok(cat?.some((m) => m.id === "claude-fable-5-2" && m.principal), "el fixture debería traer Fable 5.2 como principal");
  const foto = JSON.parse(readFileSync(path.join(DATOS, "aa-foto.json"), "utf8")) as { fecha: string; modelos: { slug: string; intelligence?: number }[] };
  const supl = JSON.parse(readFileSync(path.join(DATOS, "aa-suplemento.json"), "utf8")) as { modelos: { slug: string; intelligence?: number }[] };
  const aa = { fetched: foto.fecha, modelos: [...foto.modelos, ...supl.modelos].map((m) => ({ slug: m.slug, intelligence: m.intelligence ?? null })) };
  const sin = (cat ?? []).filter((m) => m.principal && Object.keys(calidadDeAA(aa, m.id).por).length === 0).map((m) => m.id);
  assert.deepEqual(sin, [], `modelos del catálogo sin fila de AA (ni foto ni suplemento): ${sin.join(", ")}`);
});

/** Un `reparto --tabla --json` sin caché propia (foto del repo) y con Claude con cupo. */
function tabla() {
  const cupos = path.join(tmp, "cupos.json");
  writeFileSync(cupos, JSON.stringify({ version: 1, leido: "2026-11-11T12:00:00Z", suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: 0.2, vuelve: "2026-11-11T14:00:00Z" }] }] }));
  const mod = path.join(tmp, "modelos.json");
  writeFileSync(mod, JSON.stringify({ version: 1 }));
  const base: Record<string, string | undefined> = { ...process.env };
  for (const k of ["REPARTO_AA", "REPARTO_AA_FOTO", "REPARTO_AA_SUPLEMENTO", "REPARTO_OK_DUENO"]) delete base[k];
  return (args: string[]) =>
    spawnSync(REPARTO, args, {
      encoding: "utf8",
      env: { ...base, REPARTO_CUPOS_FIJOS: cupos, REPARTO_AHORA: "2026-11-11T12:00:00Z", REPARTO_AGY: "0", REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_OPENCODE_FIJO: "[]", REPARTO_STATE: path.join(tmp, "estado2"), TRAMA_MODELOS: mod },
    });
}

test("Fable 5.2 está en la tabla con su fila de AA y el reparto no lo elige solo (en ningún tipo)", () => {
  const r = tabla();
  const t = JSON.parse(r(["--tabla", "--json"]).stdout) as { modelos: { id: string; origen: string }[] };
  const f = t.modelos.find((m) => m.id === "claude-fable-5-2");
  assert.ok(f, "Fable 5.2 tiene que estar en --tabla");
  assert.equal(f.origen, "artificial-analysis");
  for (const tipo of ["lectura", "mecanico", "frontend", "diseno", "codigo-multi", "debug"]) {
    const x = r(["--tipo", tipo, "--json"]);
    const j = JSON.parse(x.stdout) as { modelo?: string };
    assert.notEqual(j.modelo, "claude-fable-5-2", `${tipo}: Fable no se elige solo`);
  }
  const ex = r(["--tipo", "frontend", "--json", "--explicar"]).stdout;
  assert.match(ex, /Fable no se elige solo/);
});
