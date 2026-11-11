// El mapeo «evento de electron-updater de la carcasa de Windows → props de `Avance`» (src/ui/avance-logica.ts `propsDeActualizador`).
import assert from "node:assert/strict";
import { test } from "node:test";
import { avance, propsDeActualizador } from "../src/ui/avance-logica.ts";
import { es } from "../src/i18n/es.ts";

const T0 = 1_700_000_000_000;
const tr = (k: string, v?: Record<string, string | number>) => (es as Record<string, string>)[k].replace(/\{(\w+)\}/g, (_, n) => String(v?.[n]));

test("descargando: porcentaje de 0 a 1 y el texto con la versión y el %", () => {
  const p = propsDeActualizador({ fase: "descargando", version: "0.2.1", progreso: 42 }, tr)!;
  assert.equal(p.porcentaje, 0.42);
  assert.equal(p.texto, "Descargando la v0.2.1… 42%");
  assert.equal(p.estado.fase, "instalando");
  // Lo que pinta Avance con eso: barra con porcentaje, sin tiempo ni «tarda de más» (la carcasa no sabe desde cuándo va).
  const a = avance({ paso: p.estado.paso, desde: p.estado.desde, ultimaLinea: p.estado.ultima, porcentaje: p.porcentaje, ahora: T0 });
  assert.equal(a.porcentaje, 0.42);
  assert.equal(a.tiempo, null);
  assert.equal(a.lento, false);
});

test("descargando: sin progreso es 0 %; fuera de rango se recorta", () => {
  assert.equal(propsDeActualizador({ fase: "descargando", version: "1" }, tr)!.porcentaje, 0);
  assert.equal(propsDeActualizador({ fase: "descargando", version: "1", progreso: 140 }, tr)!.porcentaje, 1);
  assert.equal(propsDeActualizador({ fase: "descargando", version: "1", progreso: -5 }, tr)!.porcentaje, 0);
});

test("instalando: sin porcentaje (la barra se mueve sola) y con su texto", () => {
  const p = propsDeActualizador({ fase: "instalando", version: "0.2.1" }, tr)!;
  assert.equal(p.porcentaje, undefined);
  assert.match(p.texto, /^Instalando la v0\.2\.1/);
  const a = avance({ paso: p.estado.paso, porcentaje: p.porcentaje, ahora: T0 });
  assert.equal(a.porcentaje, null);
});

test("las demás fases no usan Avance", () => {
  for (const fase of ["inactiva", "buscando", "al-dia", "lista", "error"]) assert.equal(propsDeActualizador({ fase, version: "1" }, tr), null);
  assert.equal(propsDeActualizador(null, tr), null);
});
