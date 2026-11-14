// «Contexto antes de compactar» separado para líderes (`autocompact_lider` en modelos.json): el líder lee el suyo y, sin la clave, el de
// los workers; `pa` (workers) sigue leyendo sólo `autocompact`. Más el borrador de Ajustes > Modelos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Modelos } from "../electron/cli/pa/modelos.ts";
import { topeDeLider, type EstadoModelos } from "../electron/modelos-config.ts";
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
const { ponerTope, separarLideres, topeEfectivo } = await import("../src/paneles/ajustes-autocompact.ts");

const estado = (j: Record<string, unknown> = {}): EstadoModelos => ({ version: 1, ruta: "/x/modelos.json", existe: true, error: null, efectivo: null, config: leerConfig(j) });
const silencio = { err: () => {}, out: () => {} } as never;

function archivo(j: Record<string, unknown>): string {
  const f = path.join(mkdtempSync(path.join(os.tmpdir(), "acl-")), "modelos.json");
  writeFileSync(f, JSON.stringify({ version: 1, ...j }));
  return f;
}

test("líder y worker con topes distintos: el líder lee autocompact_lider, pa sigue con autocompact", () => {
  const f = archivo({ autocompact: { defecto: null, por_modelo: { opus: 200000 } }, autocompact_lider: { defecto: null, por_modelo: { opus: 500000 } } });
  const env = { TRAMA_MODELOS: f } as NodeJS.ProcessEnv;
  const antes = process.env.TRAMA_MODELOS;
  process.env.TRAMA_MODELOS = f;
  try {
    assert.equal(topeDeLider("claude-opus-5-5", env), 500000);
    assert.equal(topeDeLider("claude-haiku-5-5", env), 300000);
  } finally {
    if (antes === undefined) delete process.env.TRAMA_MODELOS;
    else process.env.TRAMA_MODELOS = antes;
  }
  assert.equal(new Modelos(env, silencio).autocompactDe("claude-opus-5-5", null), "200000");
});

test("archivo viejo sin autocompact_lider: el líder usa el tope de los workers", () => {
  const f = archivo({ autocompact: { defecto: null, por_modelo: { opus: 200000 } } });
  const antes = process.env.TRAMA_MODELOS;
  process.env.TRAMA_MODELOS = f;
  try {
    assert.equal(topeDeLider("claude-opus-5-5", {}), 200000);
  } finally {
    if (antes === undefined) delete process.env.TRAMA_MODELOS;
    else process.env.TRAMA_MODELOS = antes;
  }
});

test("autocompact_lider vacía se conserva (lo de fábrica para líderes) y se valida como autocompact", () => {
  assert.deepEqual(leerConfig({ autocompact_lider: { defecto: null, por_modelo: {} } }).autocompact_lider, { defecto: null, por_modelo: {} });
  assert.equal(leerConfig({}).autocompact_lider, undefined);
  assert.deepEqual(validarConfig({ autocompact_lider: { por_modelo: { sonnet: 400000 } } }).autocompact_lider, { defecto: null, por_modelo: { sonnet: 400000 } });
  assert.throws(() => validarConfig({ autocompact_lider: { por_modelo: { haiku: 99999 } } }));
  const sin = unir({ version: 1, autocompact_lider: { defecto: null, por_modelo: {} } }, leerConfig({}));
  assert.equal(sin.autocompact_lider, undefined);
});

test("borrador: sin clave los líderes siguen a los workers; separarlos copia el de los workers y ensucia; volver a igual lo limpia", () => {
  const e = estado({ autocompact: { defecto: null, por_modelo: { opus: 200000 } } });
  const b = borradorDe(e);
  assert.equal(b.autocompactLider, null);
  assert.equal(topeEfectivo(b, "opus", "lideres"), 200000);
  const s = separarLideres(b, true);
  assert.deepEqual(s.autocompactLider, { defecto: null, por_modelo: { opus: 200000 } });
  assert.equal(sucio(e, s), true);
  assert.equal(sucio(e, separarLideres(s, false)), false);
  const conL = estado({ autocompact_lider: { defecto: null, por_modelo: { opus: 500000 } } });
  assert.equal(sucio(conL, borradorDe(conL)), false);
});

test("ponerTope de líderes no toca el de los workers y configDe escribe autocompact_lider", () => {
  const b = borradorDe(estado());
  const x = ponerTope(b, "opus", 500000, "lideres");
  assert.deepEqual(x.autocompact.por_modelo, {});
  assert.equal(topeEfectivo(x, "opus", "workers"), null);
  assert.equal(topeEfectivo(x, "opus", "lideres"), 500000);
  assert.deepEqual(configDe(x)!.autocompact_lider, { defecto: null, por_modelo: { opus: 500000 } });
  assert.equal(configDe(x)!.autocompact, undefined);
});
