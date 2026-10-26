// La bienvenida (src/paneles/Bienvenida.tsx): la lógica pura de sus pasos (`bienvenida-pasos.ts`), la marca de "ya vista" en
// preferencias.json (que una corrida de prueba nunca la abra sola) y que `excluir` / `permitir_max` viajen por modelos.json sin pisar nada.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    // Los imports de src/ van sin extensión.
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-bienvenida-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
for (const k of ["HILOS_BENCH", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG", "HILOS_PRUEBA", "HILOS_GUION", "HILOS_FIXTURES"]) delete process.env[k];
after(() => rmSync(tmp, { recursive: true, force: true }));

const pasos = await import("../src/paneles/bienvenida-pasos.ts");
const prefs = await import("../electron/preferencias.ts");
const tipos = await import("../electron/modelos-tipos.ts");

test("los pasos: el del celular sólo donde se puede editar", () => {
  assert.deepEqual(pasos.pasosVisibles(true), ["idioma", "proveedores", "automatico", "excluir", "max", "compactacion", "celular"]);
  assert.deepEqual(pasos.pasosVisibles(false), ["idioma", "proveedores", "automatico", "excluir", "max", "compactacion"]);
});

test("modelos que no se usan: Fable viene sugerido, lo de la persona se respeta y lo ajeno se conserva", () => {
  assert.deepEqual([...pasos.familiasMarcadas(undefined)], ["fable"]);
  assert.deepEqual([...pasos.familiasMarcadas([])], []);
  assert.deepEqual([...pasos.familiasMarcadas(["haiku", "agy:x"])], ["haiku"]);
  assert.deepEqual(pasos.excluirCon(["agy:x", "haiku"], new Set(["fable"] as const)), ["agy:x", "fable"]);
  assert.deepEqual(pasos.excluirCon(undefined, new Set()), []);
  assert.ok(pasos.mismasFamilias(new Set(["fable"] as const), new Set(["fable"] as const)));
  assert.ok(!pasos.mismasFamilias(new Set(["fable"] as const), new Set()));
});

test("compactación: 200 k de fábrica, vacío no vale y el rango es el de Ajustes", () => {
  assert.equal(pasos.textoCompactacion(null), "200000");
  assert.equal(pasos.textoCompactacion(150_000), "150000");
  assert.equal(pasos.compactacionDe("200000").valor, 200_000);
  assert.equal(pasos.compactacionDe("").error, "bv.compVacia");
  assert.ok(pasos.compactacionDe("5").error);
  assert.equal(pasos.compactacionDe("5").valor, null);
});

test("automático: prendido salvo que el archivo diga fijo", () => {
  assert.equal(pasos.automaticoPrendido(undefined), true);
  assert.equal(pasos.automaticoPrendido("auto"), true);
  assert.equal(pasos.automaticoPrendido("fijo"), false);
});

test("la marca de ya vista: pendiente hasta cerrarla, y se guarda en preferencias.json", async () => {
  assert.equal(await prefs.bienvenidaPendiente(), true);
  await prefs.guardarBienvenida(true);
  assert.equal(await prefs.bienvenidaPendiente(), false);
  const j = JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "preferencias.json"), "utf8"));
  assert.equal(j.bienvenida, true);
  assert.equal(j.version, 1);
  await prefs.guardarBienvenida(false);
  assert.equal(await prefs.bienvenidaPendiente(), true);
  await prefs.guardarBienvenida("sí");
  assert.equal(await prefs.bienvenidaPendiente(), true);
});

test("una corrida de prueba nunca abre la bienvenida sola", async () => {
  for (const k of ["HILOS_BENCH", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG", "HILOS_PRUEBA", "HILOS_GUION"]) {
    process.env[k] = "1";
    assert.equal(await prefs.bienvenidaPendiente(), false, k);
    delete process.env[k];
  }
  process.env.HILOS_FIXTURES = "1";
  assert.equal(await prefs.bienvenidaPendiente(), false);
  process.env.HILOS_FIXTURES = "0";
  assert.equal(await prefs.bienvenidaPendiente(), true);
  delete process.env.HILOS_FIXTURES;
});

test("excluir y permitir_max: se leen, se validan y se unen", () => {
  const c = tipos.leerConfig({ version: 1, excluir: ["fable", "agy:x"], permitir_max: true });
  assert.deepEqual(c.excluir, ["fable", "agy:x"]);
  assert.equal(c.permitir_max, true);
  assert.deepEqual(tipos.leerConfig({ version: 1 }).excluir, []);
  assert.equal(tipos.leerConfig({ version: 1 }).permitir_max, false);

  const v = tipos.validarConfig({ ...tipos.vacia(), excluir: ["fable"], permitir_max: false });
  assert.deepEqual(v.excluir, ["fable"]);
  assert.equal(v.permitir_max, false);

  const antes = { version: 1, excluir: ["fable"], permitir_max: true, rara: 1 };
  const nuevo = tipos.unir(antes, { ...tipos.vacia(), excluir: [], permitir_max: false });
  assert.equal("excluir" in nuevo, false);
  assert.equal("permitir_max" in nuevo, false);
  assert.equal(nuevo.rara, 1);
});
