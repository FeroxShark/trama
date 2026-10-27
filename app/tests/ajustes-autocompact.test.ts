// «Contexto antes de compactar» (Ajustes > Modelos): el esquema de `autocompact` en modelos.json (modelos-tipos.ts) y el borrador
// (src/paneles/ajustes-autocompact.ts). Puro, sin React ni puente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EstadoModelos } from "../electron/modelos-config.ts";
import { leerConfig, unir, validarConfig } from "../electron/modelos-tipos.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { borradorDe, configDe, sucio } = await import("../src/paneles/modelos-borrador.ts");
const { esPredeterminado, ponerTope, topeDeK, topeEfectivo } = await import("../src/paneles/ajustes-autocompact.ts");

const estado = (j: Record<string, unknown> = {}): EstadoModelos => ({ version: 1, ruta: "/x/modelos.json", existe: true, error: null, efectivo: null, config: leerConfig(j) });

test("leerConfig: lee defecto y por_modelo (null = nativo); descarta lo que no vale", () => {
  const c = leerConfig({ autocompact: { defecto: null, por_modelo: { haiku: 300000, sonnet: null, opus: 50, "x y": 200000, fable: "mucho" } } });
  assert.deepEqual(c.autocompact, { defecto: null, por_modelo: { haiku: 300000, sonnet: null } });
  assert.equal(leerConfig({}).autocompact, undefined);
  assert.equal(leerConfig({ autocompact: { defecto: null, por_modelo: {} } }).autocompact, undefined);
});

test("validarConfig: acepta números en rango y null; rechaza fuera de rango, decimales y claves raras", () => {
  assert.deepEqual(validarConfig({ autocompact: { defecto: 200000, por_modelo: { haiku: 500000, opus: null } } }).autocompact, { defecto: 200000, por_modelo: { haiku: 500000, opus: null } });
  assert.throws(() => validarConfig({ autocompact: { por_modelo: { haiku: 99999 } } }));
  assert.throws(() => validarConfig({ autocompact: { por_modelo: { haiku: 1000001 } } }));
  assert.throws(() => validarConfig({ autocompact: { defecto: 150000.5 } }));
  assert.throws(() => validarConfig({ autocompact: { por_modelo: { haiku: "300k" } } }));
  assert.throws(() => validarConfig({ autocompact: { otro: 1 } }));
});

test("unir: escribe autocompact, conserva lo que la app no edita y saca la clave si no queda nada", () => {
  const c = validarConfig({ autocompact: { defecto: null, por_modelo: { haiku: null, opus: 200000 } } });
  const j = unir({ reparto: "auto", otra: 1 }, c);
  assert.deepEqual(j.autocompact, { defecto: null, por_modelo: { haiku: null, opus: 200000 } });
  assert.equal(j.otra, 1);
  assert.equal("autocompact" in unir(j, validarConfig({})), false);
});

test("topeEfectivo: sin entrada Haiku vale 300 000 y el resto nativo; el defecto numérico vale para todos; null explícito gana", () => {
  const b = borradorDe(estado());
  assert.equal(topeEfectivo(b, "haiku"), 300000);
  assert.equal(topeEfectivo(b, "sonnet"), null);
  assert.ok(esPredeterminado(b, "haiku"));
  const d = borradorDe(estado({ autocompact: { defecto: 200000, por_modelo: { opus: null } } }));
  assert.equal(topeEfectivo(d, "sonnet"), 200000);
  assert.equal(topeEfectivo(d, "haiku"), 200000);
  assert.equal(topeEfectivo(d, "opus"), null);
});

test("ponerTope: lo que coincide con lo predeterminado no se anota; nativo en Haiku se anota como null", () => {
  const b = borradorDe(estado());
  assert.deepEqual(ponerTope(b, "haiku", 300000).autocompact.por_modelo, {});
  assert.deepEqual(ponerTope(b, "sonnet", null).autocompact.por_modelo, {});
  assert.deepEqual(ponerTope(b, "haiku", null).autocompact.por_modelo, { haiku: null });
  assert.deepEqual(ponerTope(b, "opus", 500000).autocompact.por_modelo, { opus: 500000 });
  assert.deepEqual(ponerTope(ponerTope(b, "opus", 500000), "opus", null).autocompact.por_modelo, {});
});

test("el borrador: cambiar un tope ensucia, volver lo limpia; configDe lleva autocompact y sin entradas no", () => {
  const e = estado();
  const b = borradorDe(e);
  assert.equal(sucio(e, b), false);
  assert.equal(configDe(b)!.autocompact, undefined);
  const x = ponerTope(b, "haiku", null);
  assert.equal(sucio(e, x), true);
  assert.deepEqual(configDe(x)!.autocompact, { defecto: null, por_modelo: { haiku: null } });
  assert.equal(sucio(e, ponerTope(x, "haiku", 300000)), false);
});

test("topeDeK: miles de tokens, de 100 a 1000; vacío no es error; basura sí", () => {
  assert.deepEqual(topeDeK("250"), { valor: 250000, error: null });
  assert.deepEqual(topeDeK("250 k"), { valor: 250000, error: null });
  assert.deepEqual(topeDeK(""), { valor: null, error: null });
  assert.equal(topeDeK("99").error, "ajustes.errCompactarRango");
  assert.equal(topeDeK("1001").error, "ajustes.errCompactarRango");
  assert.equal(topeDeK("abc").error, "ajustes.errRedNumero");
});
