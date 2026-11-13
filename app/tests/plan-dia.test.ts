// Prueba el módulo puro plan-dia.ts (leer, fijar, borrar, archivo ausente o roto, conservación de días ausentes),
// la equivalencia con `pa --plan ahorrar-hoy` (// reparto --plan) en una carpeta temporal, y que el canal exista
// en los dos lados (núcleo, preload, contrato y windows/src/canales.json).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-plan-dia-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const casaReal = os.homedir();
const bajoCasaReal = (d: string) => d === casaReal || d.startsWith(`${casaReal}/`);
process.env.PATH = (process.env.PATH ?? "").split(":").filter((d) => d && !bajoCasaReal(d)).join(":");
const casa = path.join(tmp, "casa");
mkdirSync(casa, { recursive: true });
process.env.HOME = casa;
for (const k of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "REPARTO_STATE"]) delete process.env[k];
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa-nucleo");
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_HISTORIAL = "0";

const { fijarPlanDia, leerPlanDia, MODOS_PLAN_DIA } = await import("../electron/plan-dia.ts");
const reparto = await import("../electron/cli/reparto.ts");
const nucleo = await import("../electron/nucleo.ts");

const AHORA = new Date(2026, 10, 13, 14, 0, 0);

test("archivo ausente o roto devuelve normal sin ausencias", () => {
  const ausente = path.join(tmp, "no-existe", "plan.json");
  assert.deepEqual(leerPlanDia({ now: AHORA, ruta: ausente }), { modo: "normal", ausente: [] });

  const roto = path.join(tmp, "roto.json");
  writeFileSync(roto, "{no es json");
  assert.deepEqual(leerPlanDia({ now: AHORA, ruta: roto }), { modo: "normal", ausente: [] });

  const raro = path.join(tmp, "raro.json");
  writeFileSync(raro, JSON.stringify({ version: 1, hoy: { fecha: "2026-11-13", modo: "turbo" }, ausente: ["mal", "2026-11-10"] }));
  assert.deepEqual(leerPlanDia({ now: AHORA, ruta: raro }), { modo: "normal", ausente: [] });
});

test("fijar ahorrar, gastar y normal (borrar) escribe y limpia plan.json", () => {
  const ruta = path.join(tmp, "basico", "plan.json");
  assert.deepEqual(MODOS_PLAN_DIA, ["ahorrar", "normal", "gastar"]);

  assert.deepEqual(fijarPlanDia("ahorrar", { now: AHORA, ruta }), { modo: "ahorrar", ausente: [] });
  assert.deepEqual(leerPlanDia({ now: AHORA, ruta }), { modo: "ahorrar", ausente: [] });
  assert.equal(JSON.parse(readFileSync(ruta, "utf8")).hoy.modo, "ahorrar");

  assert.deepEqual(fijarPlanDia("gastar", { now: AHORA, ruta }), { modo: "gastar", ausente: [] });
  assert.deepEqual(leerPlanDia({ now: AHORA, ruta }), { modo: "gastar", ausente: [] });

  assert.deepEqual(fijarPlanDia("normal", { now: AHORA, ruta }), { modo: "normal", ausente: [] });
  assert.equal(existsSync(ruta), false, "sin ausentes vigentes, normal borra plan.json");
  assert.deepEqual(leerPlanDia({ now: AHORA, ruta }), { modo: "normal", ausente: [] });
});

test("vence solo a medianoche y conserva días ausentes vigentes sin tocarlos", () => {
  const ruta = path.join(tmp, "ausente", "plan.json");
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(
    ruta,
    JSON.stringify({
      version: 1,
      actualizado: "2026-11-12T10:00:00Z",
      ausente: ["2026-11-12", "2026-11-15", "2026-11-16"],
      hoy: { fecha: "2026-11-12", modo: "gastar" },
    }),
  );

  assert.deepEqual(leerPlanDia({ now: AHORA, ruta }), { modo: "normal", ausente: ["2026-11-15", "2026-11-16"] });

  assert.deepEqual(fijarPlanDia("ahorrar", { now: AHORA, ruta }), { modo: "ahorrar", ausente: ["2026-11-15", "2026-11-16"] });
  const guardado = JSON.parse(readFileSync(ruta, "utf8"));
  assert.deepEqual(guardado.ausente, ["2026-11-15", "2026-11-16"]);
  assert.deepEqual(guardado.hoy, { fecha: "2026-11-13", modo: "ahorrar" });

  assert.deepEqual(fijarPlanDia("normal", { now: AHORA, ruta }), { modo: "normal", ausente: ["2026-11-15", "2026-11-16"] });
  assert.equal(existsSync(ruta), true, "con ausentes vigentes, normal borra sólo hoy y conserva plan.json");
  const trasNormal = JSON.parse(readFileSync(ruta, "utf8"));
  assert.deepEqual(trasNormal.ausente, ["2026-11-15", "2026-11-16"]);
  assert.equal("hoy" in trasNormal, false);
});

test("rechaza modos inválidos sin tocar el archivo", () => {
  const ruta = path.join(tmp, "invalido", "plan.json");
  fijarPlanDia("gastar", { now: AHORA, ruta });
  const antes = readFileSync(ruta, "utf8");
  assert.throws(() => fijarPlanDia("rapido", { now: AHORA, ruta }), new RegExp("main\\.planDiaInvalido"));
  assert.throws(() => fijarPlanDia(null, { now: AHORA, ruta }), new RegExp("main\\.planDiaInvalido"));
  assert.equal(readFileSync(ruta, "utf8"), antes);
});

test("tocar Ahorrar por el núcleo deja el mismo estado que `pa --plan ahorrar-hoy` y vuelve marcado al releer", async () => {
  const dirPa = path.join(tmp, "equiv-pa");
  const dirUi = path.join(tmp, "equiv-ui");
  mkdirSync(dirPa, { recursive: true });
  mkdirSync(dirUi, { recursive: true });

  const prevPa = process.env.PA_STATE;
  const prevRep = process.env.REPARTO_STATE;
  const prevAhora = process.env.REPARTO_AHORA;
  const prevCupos = process.env.REPARTO_CUPOS_FIJOS;
  const cuposFijos = path.join(tmp, "cupos-fijos.json");
  writeFileSync(cuposFijos, JSON.stringify({ suscripciones: [] }));
  const ahoraIso = new Date().toISOString();

  try {
    process.env.PA_STATE = dirPa;
    process.env.REPARTO_STATE = path.join(dirPa, "reparto");
    process.env.REPARTO_AHORA = ahoraIso;
    process.env.REPARTO_CUPOS_FIJOS = cuposFijos;
    const rc = await reparto.main(["--plan", "ahorrar-hoy"]);
    assert.equal(rc, 0);

    process.env.PA_STATE = dirUi;
    process.env.REPARTO_STATE = path.join(dirUi, "reparto");
    nucleo.armarNucleo();
    const trasFijar = await nucleo.llamarLocal("planDia:fijar", ["ahorrar"], "prueba");
    assert.deepEqual(trasFijar, { modo: "ahorrar", ausente: [] });

    const jsonPa = JSON.parse(readFileSync(path.join(dirPa, "reparto", "plan.json"), "utf8"));
    const jsonUi = JSON.parse(readFileSync(path.join(dirUi, "reparto", "plan.json"), "utf8"));
    assert.equal(jsonUi.version, jsonPa.version);
    assert.deepEqual(jsonUi.ausente, jsonPa.ausente);
    assert.deepEqual(jsonUi.hoy, jsonPa.hoy);

    // Simula recargar la vista: `planDia:leer` devuelve el modo guardado.
    assert.deepEqual(await nucleo.llamarLocal("planDia:leer", [], "prueba"), { modo: "ahorrar", ausente: [] });

    // Por tailnet (celular): leer se puede, fijar se rechaza como SOLO_PC_TAILNET.
    assert.deepEqual(await nucleo.llamarRemoto("planDia:leer", [], "cel"), { modo: "ahorrar", ausente: [] });
    await assert.rejects(nucleo.llamarRemoto("planDia:fijar", ["gastar"], "cel"), new RegExp("main\\.soloPc"));
  } finally {
    if (prevPa === undefined) delete process.env.PA_STATE;
    else process.env.PA_STATE = prevPa;
    if (prevRep === undefined) delete process.env.REPARTO_STATE;
    else process.env.REPARTO_STATE = prevRep;
    if (prevAhora === undefined) delete process.env.REPARTO_AHORA;
    else process.env.REPARTO_AHORA = prevAhora;
    if (prevCupos === undefined) delete process.env.REPARTO_CUPOS_FIJOS;
    else process.env.REPARTO_CUPOS_FIJOS = prevCupos;
  }
});

test("los canales planDia:leer y planDia:fijar existen en los dos lados (núcleo, preload y carcasa de Windows)", () => {
  const raiz = path.join(import.meta.dirname, "..");
  const contrato = readFileSync(path.join(raiz, "electron", "canales", "contrato.ts"), "utf8");
  const preload = readFileSync(path.join(raiz, "electron", "preload.cts"), "utf8");
  const canalesWin = JSON.parse(readFileSync(path.join(path.dirname(raiz), "windows", "src", "canales.json"), "utf8")) as {
    canales: [string, string][];
  };
  for (const c of ["planDia:leer", "planDia:fijar"]) {
    assert.match(contrato, new RegExp(`\\["${c}", "invoke"\\]`), `falta en contrato.ts: ${c}`);
    assert.match(preload, new RegExp(`invocar\\("${c}"`), `falta en preload.cts: ${c}`);
    assert.ok(c in nucleo.RUTAS, `falta en RUTAS: ${c}`);
    assert.ok(canalesWin.canales.some(([nombre, tipo]) => nombre === c && tipo === "invoke"), `falta en windows/src/canales.json: ${c}`);
  }
  assert.ok(nucleo.SOLO_PC_TAILNET.has("planDia:fijar"));
});
