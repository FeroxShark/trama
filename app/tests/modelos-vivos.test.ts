// La tabla de modelos de los selectores (New lead, Seguir con…) sigue a la fuente viva sin reiniciar (src/datos/modelos-vivos.ts):
// un catálogo nuevo del `claude`, un proveedor que se habilita y una respuesta tardía del main se ven en `MODELOS`, un fallo no pisa
// lo bueno, y el modelo elegido que quedó viejo pasa al vigente.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("src")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(new RegExp("\\\\", "g"), "/").replace(new RegExp("^(?!\\.)"), "./"), ctx);
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
    if (!url.endsWith(".tsx")) return next(url, ctx);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", sourcefile: url });
    return { format: "module", source: code, shortCircuit: true };
  },
});

// Lo que el main contesta a `modelos:config`; cada test lo cambia.
let respuesta: () => Promise<unknown> = async () => null;
const noop = () => {};
Object.assign(globalThis, {
  window: globalThis,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  location: { search: "?fixtures=0", hash: "" },
  hilos: { modelos: { config: () => respuesta() } },
  document: { documentElement: { addEventListener: noop, removeEventListener: noop }, addEventListener: noop, removeEventListener: noop, getElementsByClassName: () => [], hidden: false, visibilityState: "visible" },
});

const { MODELOS, MODELO_DEFAULT, alCambiarModelos, modeloVigente } = await import("../src/hilo/opciones.tsx");
const { t } = await import("../src/i18n/index.ts");
const { arrancarModelosVivos, refrescarModelos } = await import("../src/datos/modelos-vivos.ts");

const ids = () => MODELOS.map((m) => m.id);
const claude = (extra: { id: string; nombre: string; principal: boolean; familia: string }[]) =>
  extra.map((m) => ({ ...m, efforts: ["low", "medium", "high"] }));
const CATALOGO_VIEJO = claude([
  { id: "claude-fable-5-1", nombre: "Fable 5.1", principal: true, familia: "fable" },
  { id: "claude-opus-5-5", nombre: "Opus 5.5", principal: true, familia: "opus" },
]);
// Catálogo de hoy: Fable 5.2 es el último y 5.1 pasó a «anteriores».
const CATALOGO_NUEVO = claude([
  { id: "claude-opus-5-5", nombre: "Opus 5.5", principal: true, familia: "opus" },
  { id: "claude-fable-5-2", nombre: "Fable 5.2", principal: true, familia: "fable" },
  { id: "claude-fable-5-1", nombre: "Fable 5.1", principal: false, familia: "fable" },
]);
const config = (extra: Record<string, unknown> = {}) => ({ version: 1, gemini: false, locales: [], llama: [], lider: null, ...extra });

test("el arranque con un catálogo viejo no tiene Fable 5.2, ni Gemini, ni DeepSeek", async () => {
  respuesta = async () => config({ claudeModelos: CATALOGO_VIEJO });
  await arrancarModelosVivos(200);
  assert.ok(ids().includes("claude-fable-5-1"));
  assert.ok(!ids().includes("claude-fable-5-2"));
  assert.ok(!ids().some((i) => i.startsWith("dsh:") || i.startsWith("gemini-") || i.startsWith("agy:")));
});

test("un catálogo nuevo aparece en el selector sin reiniciar y avisa a quien mira", async () => {
  let avisos = 0;
  const soltar = alCambiarModelos(() => avisos++);
  respuesta = async () => config({ claudeModelos: CATALOGO_NUEVO });
  await refrescarModelos();
  soltar();
  const fila = MODELOS.find((m) => m.id === "claude-fable-5-2");
  assert.ok(fila, "Fable 5.2 está");
  assert.equal(avisos, 1);
  // Fable 5.1 sigue, pero entre las generaciones anteriores.
  assert.equal(MODELOS.find((m) => m.id === "claude-fable-5-1")?.grupo, t("modelo.anteriores"));
});

test("una lectura que no cambia nada no avisa", async () => {
  let avisos = 0;
  const soltar = alCambiarModelos(() => avisos++);
  await refrescarModelos();
  soltar();
  assert.equal(avisos, 0);
});

test("un proveedor habilitado aparece: Gemini (agy), DeepSeek Harness y OpenCode", async () => {
  respuesta = async () =>
    config({
      claudeModelos: CATALOGO_NUEVO,
      gemini: true,
      agyModelos: [{ id: "gemini-4-argon-high", nombre: "Gemini 4 Argon" }],
      dsh: true,
      opencode: ["opencode/big-pickle"],
    });
  await refrescarModelos();
  assert.ok(ids().some((i) => i.startsWith("gemini-4-argon")), "Google");
  assert.ok(ids().some((i) => i.startsWith("dsh:")), "DeepSeek Harness");
  assert.ok(ids().includes("opencode:opencode/big-pickle"), "OpenCode");
});

test("un fallo del main (rechazo, null, basura) no pisa la tabla buena", async () => {
  const antes = ids();
  for (const r of [async () => Promise.reject(new Error("motor reconectando")), async () => null, async () => ({ version: 9 })]) {
    respuesta = r;
    await refrescarModelos();
    assert.deepEqual(ids(), antes);
  }
});

test("el modelo vigente: Fable 5.1 pasa a 5.2 cuando 5.1 quedó entre los anteriores; el vigente y los de otra empresa se quedan", () => {
  assert.equal(modeloVigente("claude-fable-5-1"), "claude-fable-5-2");
  assert.equal(modeloVigente("claude-fable-5-2"), "claude-fable-5-2");
  assert.equal(modeloVigente("claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(modeloVigente("gemini-4-argon"), "gemini-4-argon");
  // Uno que ya no existe en ninguna parte cae al default.
  assert.equal(modeloVigente("modelo-que-no-existe"), MODELO_DEFAULT);
});

test("la respuesta tardía del arranque se aplica cuando llega (no se pierde por el tope)", async () => {
  // La tabla sin nada: vuelve al estado del arranque con un catálogo sin Fable 5.2 ni Gemini.
  respuesta = async () => config({ claudeModelos: CATALOGO_VIEJO });
  await refrescarModelos();
  assert.ok(!ids().includes("claude-fable-5-2"));
  let llega!: (c: unknown) => void;
  respuesta = () => new Promise((ok) => (llega = ok));
  let avisos = 0;
  const soltar = alCambiarModelos(() => avisos++);
  const arranque = arrancarModelosVivos(20);
  await arranque; // pasó el tope: se pinta sin la config…
  assert.ok(!ids().includes("claude-fable-5-2"));
  llega(config({ claudeModelos: CATALOGO_NUEVO, dsh: true }));
  const { esperarHasta } = await import("./esperar.ts");
  await esperarHasta(() => ids().includes("claude-fable-5-2"));
  soltar();
  assert.ok(ids().some((i) => i.startsWith("dsh:")));
  assert.ok(avisos >= 1);
});
