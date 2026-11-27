// Helpers puros de edición de Presets de Skills (src/paneles/AjustesPresets.tsx): asignar preset por tipo, cambiar modo,
// parsear y validar lista de skills, restaurar de fábrica y detectar cambios sin guardar.
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
      const dir = path.dirname(fileURLToPath(ctx.parentURL));
      const base = path.join(dir, spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) {
        if (existsSync(f)) {
          return next(
            path.relative(dir, f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"),
            ctx,
          );
        }
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
    if (!url.endsWith(".tsx")) return next(url, ctx);
    const { code } = transformSync(readFileSync(fileURLToPath(url), "utf8"), {
      loader: "tsx",
      format: "esm",
      jsx: "automatic",
      sourcefile: url,
    });
    return { format: "module", source: code, shortCircuit: true };
  },
});

const noop = () => {};
Object.assign(globalThis, {
  window: globalThis,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  location: { search: "", hash: "" },
  document: {
    documentElement: { addEventListener: noop, removeEventListener: noop },
    addEventListener: noop,
    removeEventListener: noop,
    getElementsByClassName: () => [],
    hidden: false,
    visibilityState: "visible",
  },
});

const { presetsFabrica } = await import("../electron/presets-tipos.ts");
const {
  cambiarModoPreset,
  cambiarPresetTipo,
  cambiarSkillsPreset,
  parsearSkillsTexto,
  presetsDistintos,
  restaurarPresetsFabrica,
  TIPOS_WORKER_PRESETS,
} = await import("../src/paneles/AjustesPresets.tsx");

test("cambiarPresetTipo asigna un preset válido sin mutar el original e ignora inexistentes", () => {
  const base = presetsFabrica();
  const editado = cambiarPresetTipo(base, "debug", "minimo");
  assert.notEqual(editado, base);
  assert.equal(editado.por_tipo.debug, "minimo");
  assert.equal(base.por_tipo.debug, "codigo");
  // Mismo valor: devuelve la misma referencia.
  assert.equal(cambiarPresetTipo(editado, "debug", "minimo"), editado);
  // Preset inexistente: no rompe ni muta.
  assert.equal(cambiarPresetTipo(base, "debug", "no-existe"), base);
});

test("cambiarModoPreset actualiza el modo de un preset sin mutar y conserva sus skills", () => {
  const base = presetsFabrica();
  const skillsAntes = [...base.presets.codigo.skills];
  const editado = cambiarModoPreset(base, "codigo", "solo");
  assert.notEqual(editado, base);
  assert.equal(editado.presets.codigo.modo, "solo");
  assert.deepEqual(editado.presets.codigo.skills, skillsAntes);
  assert.equal(base.presets.codigo.modo, "apagar");
  // Mismo modo o preset ausente: sin cambios.
  assert.equal(cambiarModoPreset(editado, "codigo", "solo"), editado);
  assert.equal(cambiarModoPreset(base, "fantasma", "todo"), base);
});

test("parsearSkillsTexto separa por coma y salto de línea, deduplica y separa inválidas", () => {
  const res = parsearSkillsTexto("ui-ux-pro-max, taste-skill\ndiseno, ui-ux-pro-max\n  con espacio  \nfrontend-design:frontend-design\n\n");
  assert.deepEqual(res.validas, ["ui-ux-pro-max", "taste-skill", "diseno", "frontend-design:frontend-design"]);
  assert.deepEqual(res.invalidas, ["con espacio"]);

  const vacio = parsearSkillsTexto("  , \n  , ");
  assert.deepEqual(vacio, { validas: [], invalidas: [] });

  const ctrl = parsearSkillsTexto("ok-skill, mal\u0007skill, mal\u0007skill");
  assert.deepEqual(ctrl.validas, ["ok-skill"]);
  assert.deepEqual(ctrl.invalidas, ["mal\u0007skill"]);
});

test("cambiarSkillsPreset actualiza la lista deduplicada y filtrada sin mutar", () => {
  const base = presetsFabrica();
  const editado = cambiarSkillsPreset(base, "minimo", ["diseno", "diseno", "con espacio", "ui-ux-pro-max"]);
  assert.deepEqual(editado.presets.minimo.skills, ["diseno", "ui-ux-pro-max"]);
  assert.deepEqual(base.presets.minimo.skills, []);
  assert.equal(cambiarSkillsPreset(editado, "minimo", ["diseno", "ui-ux-pro-max"]), editado);
});

test("restaurarPresetsFabrica devuelve copia limpia igual a presetsFabrica", () => {
  const r1 = restaurarPresetsFabrica();
  const r2 = restaurarPresetsFabrica();
  assert.deepEqual(r1, presetsFabrica());
  assert.notEqual(r1, r2);
  r1.por_tipo.mecanico = "todo";
  assert.equal(restaurarPresetsFabrica().por_tipo.mecanico, "minimo");
});

test("presetsDistintos detecta cambios en por_tipo, modo y lista de skills", () => {
  const a = presetsFabrica();
  const b = presetsFabrica();
  assert.equal(presetsDistintos(a, b), false);

  assert.equal(presetsDistintos(a, cambiarPresetTipo(b, "frontend", "todo")), true);
  assert.equal(presetsDistintos(a, cambiarModoPreset(b, "todo", "apagar")), true);
  assert.equal(presetsDistintos(a, cambiarSkillsPreset(b, "minimo", ["diseno"])), true);

  // Volver al valor original deja sucio en false.
  const idaYVuelta = cambiarPresetTipo(cambiarPresetTipo(b, "frontend", "todo"), "frontend", "diseno");
  assert.equal(presetsDistintos(a, idaYVuelta), false);
});

test("TIPOS_WORKER_PRESETS cubre los 8 tipos esperados", () => {
  assert.deepEqual(TIPOS_WORKER_PRESETS, [
    "mecanico",
    "lectura",
    "codigo-acotado",
    "codigo-multi",
    "debug",
    "frontend",
    "diseno",
    "default",
  ]);
});
