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
import { leerConfig, validarConfig } from "../electron/modelos-tipos.ts";
import { validarOtroMotor } from "../electron/cli/pa/motores/modelos.ts";

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
  assert.doesNotMatch(ex, /fable/i, "Fable ni aparece entre los candidatos del reparto");
});

const REPARTO_TS = path.join(RAIZ, "app", "electron", "cli", "reparto.ts");

function tablaTs(opts: { mod?: object; agyFijo?: string; conGoogle?: boolean } = {}) {
  const cupos = path.join(tmp, `cupos-${Math.random().toString(36).slice(2)}.json`);
  const suscripciones: object[] = [
    {
      id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude",
      ventanas: opts.conGoogle
        ? [{ id: "5h", usado: 0.99, vuelve: "2026-11-11T14:00:00Z" }, { id: "7d", usado: 0.99, vuelve: "2026-11-15T00:00:00Z" }]
        : [{ id: "5h", usado: 0.2, vuelve: "2026-11-11T14:00:00Z" }],
    },
  ];
  if (opts.conGoogle) {
    suscripciones.push({
      id: "google", nombre: "Google AI Pro", proveedor: "google", cuenta: "google",
      grupos: [
        { id: "gemini", nombre: "Gemini", ventanas: [{ id: "5h", usado: 0.1, vuelve: "2026-11-11T14:00:00Z" }, { id: "7d", usado: 0.1, vuelve: "2026-11-15T00:00:00Z" }] },
        { id: "gemini-4-argon", nombre: "Gemini 4 Argon", ventanas: [{ id: "7d", usado: 0.2, vuelve: "2026-11-15T00:00:00Z" }] },
      ],
    });
  }
  writeFileSync(cupos, JSON.stringify({ version: 1, leido: "2026-11-11T12:00:00Z", suscripciones }));
  const mod = path.join(tmp, `modelos-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(mod, JSON.stringify({ version: 1, ...(opts.mod ?? {}) }));
  const base: Record<string, string | undefined> = { ...process.env };
  for (const k of ["REPARTO_AA", "REPARTO_AA_FOTO", "REPARTO_AA_SUPLEMENTO", "REPARTO_OK_DUENO", "REPARTO_NO_DISPONIBLE"]) delete base[k];
  return (args: string[]) =>
    spawnSync(process.execPath, [REPARTO_TS, ...args], {
      encoding: "utf8",
      env: {
        ...base,
        REPARTO_CUPOS_FIJOS: cupos,
        REPARTO_AHORA: "2026-11-11T12:00:00Z",
        REPARTO_AGY: opts.agyFijo ? "1" : "0",
        ...(opts.agyFijo ? { REPARTO_AGY_MODELOS_FIJO: opts.agyFijo } : {}),
        REPARTO_DSH_FIJO: "{\"ollama\":[],\"opencode\":false,\"deepseek\":false}",
        REPARTO_OPENCODE_FIJO: "[\"opencode/glm-5.3-flash-free\",\"opencode/big-pickle\"]",
        REPARTO_STATE: path.join(tmp, "estado-ts"),
        TRAMA_MODELOS: mod,
      },
    });
}

test("Gemini 3.8 Flash no está en la tabla y el reparto no lo elige en ningún tipo (ni si agy models lo devuelve)", () => {
  const agyFijo = ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.8-flash-low", "gemini-4-hydrogen-high"].join(String.fromCharCode(10));
  const r = tablaTs({ conGoogle: true, agyFijo });
  const tab = JSON.parse(r(["--tabla", "--json"]).stdout) as { modelos: { id: string; familia: string }[] };
  assert.equal(tab.modelos.some((m) => m.id.includes("3.8-flash") || m.familia === "flash"), false, "Flash no puede aparecer en --tabla");
  assert.ok(tab.modelos.some((m) => m.id.startsWith("gemini-4-hydrogen")), "Hydrogen tiene que estar en --tabla");
  const res = r(["--resumen", "--json"]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.includes("3.8-flash"), false, "--resumen no puede nombrar 3.8-flash");
  for (const tipo of ["lectura", "mecanico", "codigo-acotado", "frontend", "diseno", "codigo-multi", "debug", "final"]) {
    const x = r(["--tipo", tipo, "--json", "--explicar"]);
    assert.equal(x.status, 0, `${tipo}: ${x.stderr}`);
    const j = JSON.parse(x.stdout) as { modelo: string; candidatos: { modelo: string }[] };
    assert.equal(j.modelo.includes("3.8-flash"), false, `${tipo}: nunca elige Flash`);
    assert.equal(j.candidatos.some((c) => c.modelo.includes("3.8-flash")), false, `${tipo}: Flash ni entra como candidato aunque agy models lo liste`);
  }
});

test("un modelos.json viejo que nombra Flash no rompe nada y -m gemini-3.8-flash-high se rechaza igual que un desconocido", () => {
  const viejo = {
    version: 1,
    excluir: ["gemini-3.8-flash", "flash"],
    destrabar: { "gemini-3.8-flash": false },
    minimo_por_tipo: { lectura: "gemini-3.8-flash", debug: "gemini-3.8-flash-high" },
    workers: { mecanico: { modelo: "gemini-3.8-flash-medium" } },
  };
  const cfg = validarConfig({ excluir: viejo.excluir, destrabar: viejo.destrabar });
  assert.deepEqual(cfg.destrabar["gemini-3.8-flash"], false);
  const lc = leerConfig(viejo);
  assert.ok(Array.isArray(lc.excluir));
  const r = tablaTs({ mod: viejo });
  const tab = JSON.parse(r(["--tabla", "--json"]).stdout) as { modelos: { id: string; permitido: boolean }[] };
  const glm = tab.modelos.find((m) => m.id === "opencode:opencode/glm-5.3-flash-free");
  assert.ok(glm?.permitido, "excluir [\"flash\"] no excluye modelos ajenos como glm-5.3-flash-free");
  for (const tipo of ["lectura", "debug"]) {
    const x = r(["--tipo", tipo, "--json"]);
    assert.equal(x.status, 0, `${tipo}: ${x.stderr}`);
    const j = JSON.parse(x.stdout) as { modelo: string };
    assert.equal(j.modelo.includes("3.8-flash"), false);
  }
  const rFlash = validarOtroMotor("gemini-3.8-flash-high");
  const rDesc = validarOtroMotor("gemini-no-existe-high");
  assert.ok(rFlash && !rFlash.ok && rDesc && !rDesc.ok);
  assert.equal(rFlash.error.replace("gemini-3.8-flash-high", "<M>"), rDesc.error.replace("gemini-no-existe-high", "<M>"));
});
