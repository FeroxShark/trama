// Esfuerzos dominados (src/paneles/efforts-dominados.ts): los números son los de Artificial Analysis (inteligencia @ costo por tarea).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FilaTabla } from "../electron/reparto-tabla.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { paresDe, dominados, aplicarSugerencias, ponerEffort, permitidosDe, costoDe } = await import("../src/paneles/efforts-dominados.ts");
const { borradorDe } = await import("../src/paneles/modelos-borrador.ts");

const fila = (id: string, familia: string, proveedor: string, q: FilaTabla["calidadPorEffort"], costo?: FilaTabla["costoPorEffort"]): FilaTabla => ({
  id, nombre: id, proveedor, familia, familiaExcluir: familia, cuenta: null, calidad: 100, effortUsado: null, calidadPorEffort: q, effortsEstimados: [], calidadEstimadaPorEffort: {}, ...(costo ? { costoPorEffort: costo } : {}),
  estimada: false, origen: "artificial-analysis", aaFecha: "2026-10-26", gratis: false, libre: 1, vuelve: null, ventanas: [], urgencia: 0, permitido: true, excluidoPor: null, agotado: false,
});
const b0 = () => borradorDe({ version: 1, ruta: "/x", existe: true, error: null, efectivo: null, config: { workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} } });

const SONNET = fila("claude-sonnet-5-5", "sonnet", "claude", { low: 35.9, high: 46.8 }, { low: 482.13, high: 1027.4 });
const HAIKU = fila("claude-haiku-5-5", "haiku", "claude", { max: 43.4 }, { max: 330.25 });
const DEEPSEEK = fila("deepseek:deepseek-v4.1-flash", "dsh", "deepseek", { max: 45.1 }, { max: 444.6 });

test("Sonnet low (35,9 @ 482 USD) lo domina Haiku max (43,4 @ 330 USD)", () => {
  const d = dominados(paresDe([SONNET, HAIKU], b0()));
  const x = d.find((z) => z.par.id === SONNET.id && z.par.effort === "low");
  assert.ok(x);
  assert.equal(x.por.id, HAIKU.id);
  assert.equal(x.por.effort, "max");
});

test("DeepSeek Flash max (45,1 @ 445 USD) casi iguala a Sonnet high (46,8 @ 1.027 USD) pero no lo domina: rinde menos", () => {
  const d = dominados(paresDe([SONNET, DEEPSEEK], b0()));
  assert.ok(!d.some((z) => z.par.id === SONNET.id && z.par.effort === "high"));
  // y Sonnet low (35,9 @ 482 USD) sí cae contra DeepSeek (más inteligente y más barato)
  assert.ok(d.some((z) => z.par.id === SONNET.id && z.par.effort === "low" && z.por.id === DEEPSEEK.id));
});

test("dos pares idénticos no se dominan; un modelo excluido no es alternativa", () => {
  const a = fila("a", "x", "claude", { high: 40 }, { high: 0.3 });
  const c = fila("c", "y", "google", { high: 40 }, { high: 0.3 });
  assert.deepEqual(dominados(paresDe([a, c], b0())), []);
  const b = { ...b0(), excluir: ["claude-haiku-5-5"] };
  assert.ok(!dominados(paresDe([SONNET, HAIKU], b)).some((z) => z.por.id === HAIKU.id));
});

test("sin costo de AA: COSTO de la familia × multiplicador del esfuerzo × escala del índice", () => {
  const f = fila("claude-sonnet-5-5", "sonnet", "claude", { low: 30, high: 40, max: 50 });
  assert.equal(costoDe(f, "low").costo, 0.35 * 0.5 * 2000);
  assert.equal(costoDe(f, "max").costo, 0.35 * 2.5 * 2000);
  assert.equal(costoDe(f, "high").fuente, "estimado");
  assert.equal(costoDe(SONNET, "low").fuente, "aa");
});

test("los gratis no entran a los pares", () => {
  assert.deepEqual(paresDe([{ ...HAIKU, gratis: true }], b0()), []);
});

test("aplicarSugerencias desmarca sólo los dominados y ponerEffort vuelve a la fábrica al completar", () => {
  const filas = [SONNET, HAIKU];
  const b = aplicarSugerencias(b0(), filas, dominados(paresDe(filas, b0())));
  assert.deepEqual(b.efforts_permitidos["sonnet"], ["high"]);
  assert.deepEqual(permitidosDe(SONNET, b), ["high"]);
  assert.deepEqual(ponerEffort(b, SONNET, "low", true).efforts_permitidos, {});
  assert.deepEqual(dominados(paresDe(filas, b)), []);
});

const { usadoDe, masCercano, calidadEnEffort, cifra, effortsMostrados, esEstimado } = await import("../src/paneles/modelos-workers.ts");

const OPUS = fila("claude-opus-5-5", "opus", "claude", { high: 55, max: 58 }, { high: 1.4, max: 3.1 });

test("Opus max (58) no lo domina nadie de los de arriba: rinde más que todos (y cuesta más)", () => {
  const d = dominados(paresDe([SONNET, HAIKU, DEEPSEEK, OPUS], b0()));
  assert.ok(!d.some((z) => z.par.id === OPUS.id && z.par.effort === "max"));
  // Opus high (55 @ 1,4) tampoco: sólo Opus max rinde más y cuesta más
  assert.ok(!d.some((z) => z.par.id === OPUS.id && z.par.effort === "high"));
});

test("un esfuerzo apagado no es alternativa: sin Haiku max, Sonnet low ya no está dominado por él", () => {
  const b = ponerEffort(b0(), HAIKU, "max", false);
  assert.ok(!dominados(paresDe([SONNET, HAIKU], b)).some((z) => z.par.id === SONNET.id));
});

test("el número grande: el esfuerzo que reparto usaría (high), nunca el máximo; con high apagado, el siguiente más alto, si no el de abajo", () => {
  const f = fila("claude-sonnet-5-5", "sonnet", "claude", { low: 35.9, medium: 41, high: 46.8, max: 52 });
  assert.deepEqual(usadoDe(f, b0()), { efecto: "high", valor: 46.8, estimado: false });
  assert.deepEqual(usadoDe(f, ponerEffort(b0(), f, "high", false)), { efecto: "max", valor: 52, estimado: false }, "primero el siguiente más alto");
  assert.deepEqual(usadoDe(f, ponerEffort(ponerEffort(b0(), f, "high", false), f, "max", false)), { efecto: "medium", valor: 41, estimado: false }, "si no hay más alto, el más alto de los de abajo");
  const nada = ["low", "medium", "high", "max"].reduce((b, e) => ponerEffort(b, f, e as "low", false), b0());
  assert.deepEqual(usadoDe(f, nada), { efecto: null, valor: null, estimado: false }, "lista vacía: el modelo no se usa");
  const sinDesglose = fila("x", "dsh", "opencode", {});
  assert.deepEqual(usadoDe({ ...sinDesglose, calidad: 43 }, b0()), { efecto: null, valor: 43, estimado: false });
});

test("calidadEnEffort interpola entre vecinos como reparto, y cifra muestra un decimal sin ceros", () => {
  assert.equal(calidadEnEffort({ low: 30, max: 50 }, "high", 50), 40, "high está en el medio de low (0) y max (4): posición 2");
  assert.equal(calidadEnEffort({ max: 50 }, "low", 50), 50);
  assert.equal(masCercano("high", ["low", "xhigh"]), "xhigh");
  assert.equal(masCercano("high", []), null);
  assert.equal(cifra(43), "43");
  assert.equal(cifra(47.86), "47.9");
});

// Opus 5.5 real: AA sólo midió max (57,6); el resto es estimado y así se rotula (texto "estimado", no sólo color).
const OPUS_AA = { ...fila("claude-opus-5-5", "opus", "claude", { max: 57.6 }), effortsEstimados: ["low", "medium", "high", "xhigh"] as FilaTabla["effortsEstimados"], calidadEstimadaPorEffort: { low: 39.2, medium: 44.7, high: 50.2, xhigh: 54.7 } };

test("esfuerzos estimados: se muestran (con su rótulo) pero no se comparan; el número grande dice si es estimado", () => {
  assert.deepEqual(effortsMostrados(OPUS_AA), ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(esEstimado(OPUS_AA, "high"), true);
  assert.equal(esEstimado(OPUS_AA, "max"), false, "max está medido");
  assert.deepEqual(usadoDe(OPUS_AA, b0()), { efecto: "high", valor: 50.2, estimado: true });
  assert.deepEqual(paresDe([OPUS_AA], b0()).map((p) => p.effort), ["max"], "sólo lo medido entra a los pares dominados");
  assert.deepEqual(effortsMostrados(fila("x", "dsh", "opencode", {})), [], "sin desglose no hay chips");
  assert.deepEqual(permitidosDe(OPUS_AA, ponerEffort(b0(), OPUS_AA, "low", false)), ["medium", "high", "xhigh", "max"], "un estimado se apaga como cualquiera");
});
