// Costo equivalente por modelo (src/paneles/precios.ts): el precio de cada id, la cuenta por millón y la validación de lo que
// el usuario edita. Import de src/ con la extensión .ts (node --test corre sin resolver de Vite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRECIOS_PUBLICOS, costoUsd, filasCosto, precioDe, precioDeGuardado, precioValido, tablaEfectiva } from "../src/paneles/precios.ts";

test("un id exacto trae su precio público; un id con fecha, el del prefijo más largo", () => {
  assert.deepEqual(precioDe("claude-opus-5-5", PRECIOS_PUBLICOS), { entrada: 4, salida: 20, cacheLeido: 0.2, cacheEscrito: 5 });
  // `claude-opus-5` es prefijo de `claude-opus-5-5`: gana el más largo.
  assert.equal(precioDe("claude-opus-5-5-20260401", PRECIOS_PUBLICOS)?.entrada, 4);
  assert.equal(precioDe("claude-opus-5-20260101", PRECIOS_PUBLICOS)?.entrada, 5);
});

test("un modelo que no está en la tabla no tiene precio (no se inventa)", () => {
  assert.equal(precioDe("gpt-6-astra", PRECIOS_PUBLICOS), null);
  // El prefijo tiene que cortar en `-`: `claude-opus-5-55` no es `claude-opus-5-5`.
  assert.equal(precioDe("claude-opus-5-55", PRECIOS_PUBLICOS), null);
});

test("el costo es tokens × precio por millón, las cuatro clases sumadas", () => {
  const p = { entrada: 4, salida: 20, cacheLeido: 0.2, cacheEscrito: 5 };
  // 1 M de cada clase = 4 + 20 + 0,2 + 5.
  assert.equal(costoUsd({ entrada: 1e6, salida: 1e6, cacheLeido: 1e6, cacheEscrito: 1e6 }, p), 29.2);
  assert.equal(costoUsd({ entrada: 0, salida: 0, cacheLeido: 0, cacheEscrito: 0 }, p), 0);
});

test("un precio gratis (0) no suma nada aunque haya tokens", () => {
  assert.equal(costoUsd({ entrada: 5e6, salida: 5e6, cacheLeido: 5e6, cacheEscrito: 5e6 }, { entrada: 0, salida: 0, cacheLeido: 0, cacheEscrito: 0 }), 0);
});

test("precioValido: finito, de 0 a 1000; el resto se rechaza", () => {
  assert.equal(precioValido(0), 0);
  assert.equal(precioValido(12.5), 12.5);
  assert.equal(precioValido(1000), 1000);
  assert.equal(precioValido(1001), null);
  assert.equal(precioValido(-1), null);
  assert.equal(precioValido(Number.NaN), null);
  assert.equal(precioValido(Infinity), null);
  assert.equal(precioValido("5"), null);
});

test("precioDeGuardado exige los cuatro números válidos", () => {
  assert.deepEqual(precioDeGuardado({ entrada: 1, salida: 2, cacheLeido: 0, cacheEscrito: 1.25 }), {
    entrada: 1,
    salida: 2,
    cacheLeido: 0,
    cacheEscrito: 1.25,
  });
  assert.equal(precioDeGuardado({ entrada: 1, salida: 2, cacheLeido: 0 }), null);
  assert.equal(precioDeGuardado({ entrada: 1, salida: 2, cacheLeido: 0, cacheEscrito: -3 }), null);
  assert.equal(precioDeGuardado(null), null);
});

test("tablaEfectiva: un cambio del usuario reemplaza la fila entera del modelo", () => {
  const t = tablaEfectiva({ "claude-haiku-5-5": { entrada: 0, salida: 0, cacheLeido: 0, cacheEscrito: 0 } });
  assert.equal(precioDe("claude-haiku-5-5", t)?.entrada, 0);
  assert.equal(precioDe("claude-opus-5-5", t)?.entrada, 4);
});

test("filasCosto: priced primero (de más a menos costo), sin precio al final, y el total sólo suma los priced", () => {
  const { filas, total } = filasCosto(
    {
      "claude-opus-5-5": { entrada: 1e6, salida: 0, cacheLeido: 0, cacheCreado: 0 },
      "claude-haiku-5-5": { entrada: 1e6, salida: 1e6, cacheLeido: 0, cacheCreado: 0 },
      "modelo-raro": { entrada: 9e6, salida: 0, cacheLeido: 0, cacheCreado: 0 },
      "claude-sonnet-5-5": { entrada: 0, salida: 0, cacheLeido: 0, cacheCreado: 0 },
    },
    PRECIOS_PUBLICOS,
  );
  assert.deepEqual(
    filas.map((f) => f.modelo),
    ["claude-opus-5-5", "claude-haiku-5-5", "modelo-raro"],
  );
  assert.equal(filas[2].costo, null);
  assert.equal(filas[2].tokens, 9e6);
  // Opus: 4 $ de entrada; Haiku: 0,10 + 0,50 $.
  assert.ok(Math.abs(total - 4.6) < 1e-9);
});

test("filasCosto: el caché escrito cobra pero no entra en los tokens", () => {
  const { filas } = filasCosto({ "claude-opus-5-5": { entrada: 0, salida: 0, cacheLeido: 0, cacheCreado: 1e6 } }, PRECIOS_PUBLICOS);
  assert.equal(filas[0].tokens, 0);
  assert.equal(filas[0].costo, 5);
});
