// La cuenta del bloque «Salud» de Ajustes > Actualizaciones (src/paneles/salud-resumen.ts): sin eventos, «Todo bien»; con eventos, los
// cuatro renglones con su cifra y su palabra, en los dos idiomas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(pathToFileURL(ts).href, ctx);
    }
    return next(spec, ctx);
  },
});

const { resumirSalud, REINICIO_LENTO_MS } = await import("../src/paneles/salud-resumen.ts");
const { cambiarIdioma, t } = await import("../src/i18n/index.ts");

const textos = (e: unknown, idioma: "es" | "en" = "es") => {
  cambiarIdioma(idioma);
  return resumirSalud(e).renglones.map((r) => t(r.clave, r.vars as never));
};

test("sin eventos, o sólo con cosas que no cuentan, es una sola línea: Todo bien", () => {
  for (const e of [[], null, undefined, "x", [{ t: 1, tipo: "reinicio", ms: 3000 }, { t: 2, tipo: "reinicio", ms: REINICIO_LENTO_MS }, { t: 3, tipo: "lideres-cortados", n: 0 }, 7, null, { tipo: "otro" }]]) {
    assert.deepEqual(resumirSalud(e), { bien: true, cosas: 0, renglones: [] });
  }
});

test("con eventos, cuatro renglones con cifra y palabra", () => {
  const e = [
    { t: 1, tipo: "vuelta-version", version: "0.2.60" },
    { t: 2, tipo: "reinicio", ms: 18_000 },
    { t: 3, tipo: "reinicio", ms: 15_001 },
    { t: 4, tipo: "reinicio", ms: 4000 },
    { t: 5, tipo: "lideres-cortados", n: 2 },
    { t: 6, tipo: "lideres-cortados", n: 1 },
    { t: 7, tipo: "aviso-descartado", motivo: "x" },
    { t: 8, tipo: "aviso-descartado" },
    { t: 9, tipo: "aviso-descartado" },
    { t: 10, tipo: "aviso-descartado" },
    { t: 11, tipo: "aviso-descartado" },
  ];
  const r = resumirSalud(e);
  assert.equal(r.bien, false);
  assert.equal(r.cosas, 4);
  assert.deepEqual(r.renglones.map((x) => x.id), ["vueltas", "reinicios", "lideres", "avisos"]);
  assert.deepEqual(textos(e), ["1 vuelta de versión", "2 reinicios lentos · peor 18 s", "3 líderes cortados al salir", "5 avisos descartados"]);
  assert.deepEqual(textos(e, "en").length, 4);
});

test("lo que está bien dice «Sin …» y no cuenta como cosa para mirar", () => {
  const e = [{ t: 1, tipo: "vuelta-version" }, { t: 2, tipo: "vuelta-version" }, { t: 3, tipo: "reinicio", ms: 20_400 }];
  const r = resumirSalud(e);
  assert.equal(r.cosas, 2);
  assert.deepEqual(r.renglones.map((x) => x.ok), [false, false, true, true]);
  assert.deepEqual(textos(e), ["2 vueltas de versión", "1 reinicio lento · peor 20 s", "Sin líderes cortados al salir", "Sin avisos descartados"]);
});
