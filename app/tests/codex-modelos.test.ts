// Descubrimiento dinámico de modelos de Codex desde models_cache.json y respaldo sin caché ni codex instalado.
import { after, test } from "node:test";
import { testPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEX_RESPALDO,
  EFFORTS_CODEX_PA,
  aliasMasNuevosCodex,
  effortsCodexSoportados,
  esfuerzosDeSlugCodex,
  leerCatalogoCodex,
  leerCodexModelos,
  parsearCodexCache,
  resolverCodexPedido,
  rutaCodexCache,
  ventanaCodex,
} from "../electron/cli/codex-modelos.ts";
import { validarOtroMotor } from "../electron/cli/pa/motores/modelos.ts";
import { Traductor, partirCodex } from "../electron/codex-stream.ts";
import { resolver } from "../electron/cli/reparto.ts";

const APP = path.join(import.meta.dirname, "..");
const REPARTO_TS = path.join(APP, "electron", "cli", "reparto.ts");
const PA_TS = path.join(APP, "electron", "cli", "pa.ts");

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-codex-modelos-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const CACHE_FAKE = {
  fetched_at: "2026-11-21T10:00:00Z",
  models: [
    {
      slug: "gpt-6.2-sol",
      display_name: "GPT-6.2-Sol",
      visibility: "list",
      priority: 1,
      default_reasoning_level: "low",
      supported_reasoning_levels: [
        { effort: "low" },
        { effort: "medium" },
        { effort: "high" },
        { effort: "xhigh" },
        { effort: "max" },
        { effort: "ultra" },
      ],
      context_window: 500000,
    },
    {
      slug: "gpt-6.2-astra",
      display_name: "GPT-6.2-Astra",
      visibility: "list",
      priority: 2,
      supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
      context_window: 500000,
    },
    {
      slug: "gpt-6.1-terra",
      display_name: "GPT-6.1-Terra",
      visibility: "list",
      priority: 3,
      supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }, { effort: "max" }],
      context_window: 500000,
    },
    {
      slug: "gpt-6.1-sol",
      display_name: "GPT-6.1-Sol",
      visibility: "list",
      priority: 4,
      supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
      context_window: 400000,
    },
    { slug: "gpt-6-astra", display_name: "GPT-6-Astra", visibility: "list", priority: 5, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }], context_window: 400000 },
    { slug: "gpt-6-sol", display_name: "GPT-6-Sol", visibility: "list", priority: 6, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }], context_window: 400000 },
    { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list", priority: 7, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }], context_window: 400000 },
    { slug: "gpt-5.6-sol", display_name: "GPT-5.6-Sol", visibility: "list", priority: 8, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }], context_window: 400000 },
    { slug: "gpt-5.6-terra", display_name: "GPT-5.6-Terra", visibility: "list", priority: 9, supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }], context_window: 400000 },
    { slug: "gpt-5.6-luna", display_name: "GPT-5.6-Luna", visibility: "list", priority: 10, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }], context_window: 400000 },
    { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", priority: 99, supported_reasoning_levels: [{ effort: "high" }], context_window: 500000 },
    { slug: "codex-auto-review", display_name: "Codex Auto Review", visibility: "hide", priority: 99, supported_reasoning_levels: [{ effort: "medium" }], context_window: 200000 },
  ],
};

let seq = 0;
function mkCodexHome(contenido: string | null): string {
  const dir = path.join(tmp, `codex-${seq++}`);
  mkdirSync(dir, { recursive: true });
  if (contenido !== null) writeFileSync(path.join(dir, "models_cache.json"), contenido, "utf8");
  return dir;
}

const codexConCache = mkCodexHome(JSON.stringify(CACHE_FAKE));
const codexSinCache = mkCodexHome(null);
const codexRoto = mkCodexHome("{esto no es json");
const codexVacio = mkCodexHome("   \n");
const codexSoloOcultos = mkCodexHome(JSON.stringify({ models: [{ slug: "gpt-reserve", visibility: "hide" }] }));

const AHORA = "2026-11-21T12:00:00Z";
const aaVacio = path.join(tmp, "aa-vacio.json");
writeFileSync(aaVacio, JSON.stringify({ version: 1, modelos: [] }), "utf8");
const cuposArchivo = path.join(tmp, "cupos.json");
writeFileSync(
  cuposArchivo,
  JSON.stringify({
    version: 1,
    leido: AHORA,
    suscripciones: [
      {
        id: "claude",
        nombre: "Claude",
        proveedor: "claude",
        cuenta: "claude",
        ventanas: [
          { id: "5h", usado: 0.2, vuelve: "2026-11-21T14:00:00Z" },
          { id: "7d", usado: 0.3, vuelve: "2026-11-25T00:00:00Z" },
        ],
      },
      {
        id: "openai",
        nombre: "ChatGPT",
        proveedor: "openai",
        cuenta: "chatgpt",
        grupos: [
          {
            id: "codex",
            nombre: "Codex (ChatGPT)",
            ventanas: [
              { id: "5h", usado: 0.1, vuelve: "2026-11-21T14:00:00Z" },
              { id: "7d", usado: 0.2, vuelve: "2026-11-25T00:00:00Z" },
            ],
          },
        ],
      },
    ],
  }),
  "utf8",
);

const homeAislado = path.join(tmp, "home-aislado");
const paStateAislado = path.join(tmp, "pa-state");
const repStateAislado = path.join(tmp, "rep-state");
const sinBinariosDir = path.join(tmp, "sin-bin");
const conCodexDir = path.join(tmp, "con-codex");
for (const d of [homeAislado, paStateAislado, repStateAislado, sinBinariosDir, conCodexDir]) mkdirSync(d, { recursive: true });
const fakeRepartoSh = path.join(tmp, "reparto-ts.sh");
writeFileSync(fakeRepartoSh, `#!/bin/sh\nexec "${process.execPath}" "${REPARTO_TS}" "$@"\n`, "utf8");
chmodSync(fakeRepartoSh, 0o755);
writeFileSync(path.join(conCodexDir, "codex"), "#!/bin/sh\necho codex 1.0\n", "utf8");
chmodSync(path.join(conCodexDir, "codex"), 0o755);
writeFileSync(path.join(codexConCache, "auth.json"), '{"tokens":{}}', "utf8");
writeFileSync(path.join(codexSinCache, "auth.json"), '{"tokens":{}}', "utf8");

function envAislado(codexHome: string): NodeJS.ProcessEnv {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PA_|REPARTO_|TRAMA_|CODEX_)/.test(k) && k !== "STATE"));
  return {
    ...base,
    HOME: homeAislado,
    XDG_CONFIG_HOME: path.join(homeAislado, ".config"),
    CODEX_HOME: codexHome,
    PA_STATE: paStateAislado,
    STATE: paStateAislado,
    HILOS_STATE: path.join(tmp, "hilos-state"),
    PA_PROJ: path.join(tmp, "pa-proj"),
    TRAMA_MODELOS: path.join(tmp, "no-modelos.json"),
    REPARTO_STATE: repStateAislado,
    REPARTO_CUPOS_FIJOS: cuposArchivo,
    REPARTO_AHORA: AHORA,
    REPARTO_AA: aaVacio,
    REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
    REPARTO_AGY: "0",
    PA_REPARTO: fakeRepartoSh,
    PATH: sinBinariosDir,
  };
}

test("lector parsea models_cache.json real: filtra ocultos, ordena versiones, recorta efforts y arma aliases", () => {
  const modelos = parsearCodexCache(JSON.stringify(CACHE_FAKE));
  assert.ok(modelos);
  const slugs = modelos.map((m) => m.slug);
  assert.ok(slugs.includes("gpt-6.2-sol"));
  assert.ok(slugs.includes("gpt-6.1-terra"));
  assert.ok(!slugs.includes("gpt-reserve"));
  assert.ok(!slugs.includes("codex-auto-review"));

  const sol62 = modelos.find((m) => m.slug === "gpt-6.2-sol");
  assert.ok(sol62);
  assert.equal(sol62.id, "codex:gpt-6.2-sol");
  assert.equal(sol62.nombre, "GPT-6.2 Sol (Codex)");
  assert.equal(sol62.familia, "sol");
  assert.equal(sol62.version, "6.2");
  assert.equal(sol62.ventana, 500_000);
  assert.deepEqual(sol62.efforts, ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.deepEqual(effortsCodexSoportados(sol62), [...EFFORTS_CODEX_PA]);

  const terra61 = modelos.find((m) => m.slug === "gpt-6.1-terra");
  assert.ok(terra61);
  assert.deepEqual(effortsCodexSoportados(terra61), ["medium", "high"]);

  const aliases = aliasMasNuevosCodex(modelos);
  assert.equal(aliases.sol?.id, "codex:gpt-6.2-sol");
  assert.equal(aliases.astra?.id, "codex:gpt-6.2-astra");
  assert.equal(aliases.terra?.id, "codex:gpt-6.1-terra");
  assert.equal(aliases.luna?.id, "codex:gpt-6-luna");

  const sols = modelos.filter((m) => m.familia === "sol").map((m) => m.slug);
  assert.deepEqual(sols, ["gpt-6.2-sol", "gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol"]);
});

test("lector cae al respaldo sin tirar error si falta, está vacío, roto o sin visibles", () => {
  for (const dir of [codexSinCache, codexRoto, codexVacio, codexSoloOcultos]) {
    const cat = leerCatalogoCodex({ env: { CODEX_HOME: dir }, home: homeAislado });
    assert.equal(cat.fallback, true);
    assert.deepEqual(
      cat.modelos.map((m) => m.id),
      CODEX_RESPALDO.map((m) => m.id),
    );
    assert.deepEqual(leerCodexModelos({ env: { CODEX_HOME: dir }, home: homeAislado }), cat.modelos);
  }
  assert.equal(resolverCodexPedido("codex:gpt-6.2-sol-high", { env: { CODEX_HOME: codexConCache }, home: homeAislado })?.id, "codex:gpt-6.2-sol-high");
});

test("rutaCodexCache resuelve CODEX_HOME y USERPROFILE en Windows", () => {
  assert.equal(rutaCodexCache({}, "C:\\Users\\Ana", "win32"), "C:\\Users\\Ana\\.codex\\models_cache.json");
  assert.equal(
    rutaCodexCache({ CODEX_HOME: "D:\\Datos\\codex" }, "C:\\Users\\Ana", "win32"),
    "D:\\Datos\\codex\\models_cache.json",
  );
  assert.equal(rutaCodexCache({ CODEX_HOME: codexConCache }, homeAislado), path.join(codexConCache, "models_cache.json"));
});

test("pa acepta codex:gpt-6.2-sol-{low,medium,high}, rechaza ultra/xhigh y usa respaldo sin caché ni codex instalado", () => {
  const envOk = envAislado(codexConCache);
  for (const ef of ["low", "medium", "high"]) {
    assert.deepEqual(validarOtroMotor(`codex:gpt-6.2-sol-${ef}`, {}, envOk, homeAislado), {
      ok: true,
      modelo: `codex:gpt-6.2-sol-${ef}`,
      motor: "codex",
    });
  }
  assert.deepEqual(validarOtroMotor("codex:sol-high", {}, envOk, homeAislado), {
    ok: true,
    modelo: "codex:gpt-6.2-sol-high",
    motor: "codex",
  });
  for (const mal of ["codex:gpt-6.2-sol-ultra", "codex:gpt-6.2-sol-xhigh", "codex:gpt-6.2-sol-max", "codex:gpt-reserve-high"]) {
    const v = validarOtroMotor(mal, {}, envOk, homeAislado);
    assert.ok(v && !v.ok, `debería rechazar ${mal}`);
  }
  assert.deepEqual(esfuerzosDeSlugCodex("gpt-6.1-terra", { env: envOk, home: homeAislado }), ["medium", "high"]);

  const envFallback = envAislado(codexSinCache);
  assert.deepEqual(validarOtroMotor("codex:gpt-6.1-sol-high", {}, envFallback, homeAislado), {
    ok: true,
    modelo: "codex:gpt-6.1-sol-high",
    motor: "codex",
  });
  const fueraFallback = validarOtroMotor("codex:gpt-6.2-sol-high", {}, envFallback, homeAislado);
  assert.ok(fueraFallback && !fueraFallback.ok);
});

test("codex-stream usa context_window del catálogo y resuelve alias en partirCodex", () => {
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexConCache;
  try {
    assert.equal(ventanaCodex("codex:gpt-6.2-sol-high"), 500_000);
    assert.deepEqual(partirCodex("codex:sol-high"), { modelo: "gpt-6.2-sol", effort: "high" });
    const tr = new Traductor({ modelo: "codex:gpt-6.2-sol", sid: "s1" });
    const fin = tr.fin(null);
    const res = fin.find((x) => x.type === "result") as { modelUsage: Record<string, { contextWindow: number }> } | undefined;
    assert.equal(res?.modelUsage["codex:gpt-6.2-sol"]?.contextWindow, 500_000);
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
  }
});

test("reparto --tabla --json y --cupos --json listan codex:gpt-6.2-sol con caché, heredan calidad de sol y caen al respaldo sin caché", () => {
  const rTabla = spawnSync(process.execPath, [REPARTO_TS, "--tabla", "--json"], {
    encoding: "utf8",
    env: envAislado(codexConCache),
  });
  assert.equal(rTabla.status, 0, rTabla.stderr);
  const tabla = JSON.parse(rTabla.stdout) as { modelos: Array<{ id: string; familia: string; calidad: number; efforts_posibles?: string[]; origen?: string }> };
  const sol62 = tabla.modelos.find((f) => f.id === "codex:gpt-6.2-sol-high");
  const sol61 = tabla.modelos.find((f) => f.id === "codex:gpt-6.1-sol-high");
  assert.ok(sol62, `falta codex:gpt-6.2-sol-high en --tabla: ${tabla.modelos.map((m) => m.id).join(", ")}`);
  assert.ok(sol61, "falta codex:gpt-6.1-sol-high en --tabla");
  assert.equal(sol62.calidad, sol61.calidad, "gpt-6.2-sol sin AA propio debe heredar la calidad de sol");
  assert.ok(tabla.modelos.some((f) => f.id === "codex:gpt-6.1-terra-high"));
  assert.ok(!tabla.modelos.some((f) => f.id.includes("gpt-reserve")));
  assert.ok(!tabla.modelos.some((f) => f.id.includes("codex-auto-review")));

  const rFallback = spawnSync(process.execPath, [REPARTO_TS, "--tabla", "--json"], {
    encoding: "utf8",
    env: envAislado(codexSinCache),
  });
  assert.equal(rFallback.status, 0, rFallback.stderr);
  const tablaFb = JSON.parse(rFallback.stdout) as { modelos: Array<{ id: string }> };
  assert.ok(tablaFb.modelos.some((f) => f.id === "codex:gpt-6.1-sol-high"));
  assert.ok(!tablaFb.modelos.some((f) => f.id.startsWith("codex:gpt-6.2-sol")));

  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexConCache;
  try {
    const resSol = resolver("sol");
    assert.equal(resSol?.modelo, "gpt-6.2-sol");
    const resPref = resolver("codex:sol-high");
    assert.equal(resPref?.id, "codex:gpt-6.2-sol-high");
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
  }
});

testPosix("reparto --cupos --json usa el catálogo dinámico para modelos y recorta efforts", () => {
  const envCupos = (codexHome: string): NodeJS.ProcessEnv => {
    const base = envAislado(codexHome);
    delete base.REPARTO_CUPOS_FIJOS;
    return {
      ...base,
      REPARTO_CLAUDE: "0",
      REPARTO_AGY: "0",
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      PATH: conCodexDir,
    };
  };
  const rCupos = spawnSync(process.execPath, [REPARTO_TS, "--cupos", "--json"], {
    encoding: "utf8",
    env: envCupos(codexConCache),
  });
  assert.equal(rCupos.status, 0, rCupos.stderr);
  const cupos = JSON.parse(rCupos.stdout) as { suscripciones: Array<{ id: string; grupos?: Array<{ id: string; modelos: string[] }> }> };
  const openai = cupos.suscripciones.find((s) => s.id === "openai");
  const codexGrupo = openai?.grupos?.find((g) => g.id === "codex");
  assert.ok(codexGrupo, `falta grupo codex en --cupos: ${rCupos.stdout}`);
  assert.ok(codexGrupo.modelos.includes("codex:gpt-6.2-sol-high"));
  assert.ok(!codexGrupo.modelos.includes("codex:gpt-6.2-sol-ultra"));
  assert.ok(!codexGrupo.modelos.includes("codex:gpt-6.2-sol-xhigh"));
  assert.ok(!codexGrupo.modelos.includes("codex:gpt-6.1-terra-low"));

  const rCuposFb = spawnSync(process.execPath, [REPARTO_TS, "--cupos", "--json"], {
    encoding: "utf8",
    env: envCupos(codexSinCache),
  });
  assert.equal(rCuposFb.status, 0, rCuposFb.stderr);
  const fb = JSON.parse(rCuposFb.stdout) as { suscripciones: Array<{ id: string; grupos?: Array<{ id: string; modelos: string[] }> }> };
  const codexFb = fb.suscripciones.find((s) => s.id === "openai")?.grupos?.find((g) => g.id === "codex");
  assert.ok(codexFb?.modelos.includes("codex:gpt-6.1-sol-high"));
  assert.ok(!codexFb?.modelos.includes("codex:gpt-6.2-sol-high"));
});

testPosix("pa --modelos --json lista codex:gpt-6.2-sol con caché y usa respaldo sin caché ni codex instalado", () => {
  const conCache = spawnSync(process.execPath, [PA_TS, "--modelos", "--json"], {
    encoding: "utf8",
    env: envAislado(codexConCache),
  });
  assert.equal(conCache.status, 0, conCache.stderr);
  const j1 = JSON.parse(conCache.stdout) as { inteligencia: Record<string, { calidad: number; permitido: boolean }> };
  assert.ok("codex:gpt-6.2-sol-high" in j1.inteligencia, `inteligencia no trajo codex:gpt-6.2-sol-high: ${Object.keys(j1.inteligencia).join(", ")}`);
  assert.ok(!Object.keys(j1.inteligencia).some((k) => k.includes("gpt-reserve")));

  const sinCache = spawnSync(process.execPath, [PA_TS, "--modelos", "--json"], {
    encoding: "utf8",
    env: envAislado(codexSinCache),
  });
  assert.equal(sinCache.status, 0, sinCache.stderr);
  const j2 = JSON.parse(sinCache.stdout) as { inteligencia: Record<string, { calidad: number; permitido: boolean }> };
  assert.ok("codex:gpt-6.1-sol-high" in j2.inteligencia);
  assert.ok(!Object.keys(j2.inteligencia).some((k) => k.includes("gpt-6.2-sol")));
});
