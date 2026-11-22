// Ajustes > Modelos > «Memoria compartida»: el borrador anota sólo los motores apagados, y los textos existen en los dos idiomas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leerConfig } from "../electron/modelos-tipos.ts";

// En src/ los imports no llevan extensión (los resuelve Vite): acá se los lleva al .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { borradorDe, configDe } = await import("../src/paneles/modelos-borrador.ts");
const { MOTORES_MEMORIA, memoriaDe, ponerMemoria } = await import("../src/paneles/ajustes-memoria.ts");
const { es } = await import("../src/i18n/es.ts");
const { en } = await import("../src/i18n/en.ts");

const base = () => borradorDe({ version: 1, ruta: "/x", existe: true, config: leerConfig({ version: 1 }), error: null, efectivo: null } as never);

test("el borrador parte con todos los motores prendidos y apagar uno lo anota en la config", () => {
  let b = base();
  for (const m of MOTORES_MEMORIA) assert.equal(memoriaDe(b, m), true);
  assert.equal(configDe(b)?.memoria_compartida, undefined);
  b = ponerMemoria(b, "dsh", false);
  assert.equal(memoriaDe(b, "dsh"), false);
  assert.equal(memoriaDe(b, "gemini"), true);
  assert.deepEqual(configDe(b)?.memoria_compartida, { dsh: false });
  b = ponerMemoria(b, "dsh", true);
  assert.equal(configDe(b)?.memoria_compartida, undefined, "prendido vuelve a lo de fábrica y sale");
});

test("un modelos.json con un motor apagado llena el borrador", () => {
  const b = borradorDe({ version: 1, ruta: "/x", existe: true, config: leerConfig({ version: 1, memoria_compartida: { gemini: false } }), error: null, efectivo: null } as never);
  assert.equal(memoriaDe(b, "gemini"), false);
  assert.equal(memoriaDe(b, "codex"), true);
});

test("los textos de la sección están en español e inglés, con las mismas {variables}", () => {
  const claves = Object.keys(es).filter((k) => k.startsWith("ajustes.mdlMemoria"));
  assert.ok(claves.length >= 10, claves.join(","));
  for (const k of ["ajustes.mdlMemoria", ...claves]) {
    assert.ok((en as Record<string, string>)[k], k);
    assert.deepEqual(((es as Record<string, string>)[k].match(/\{\w+\}/g) ?? []).sort(), (((en as Record<string, string>)[k]).match(/\{\w+\}/g) ?? []).sort(), k);
  }
});
