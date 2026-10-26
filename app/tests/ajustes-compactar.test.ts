// Las opciones y el borrador de Ajustes > General > Compactación (src/paneles/ajustes-compactar.ts). Puro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const { conMiles, redDesde, redPara, SIN_TOPE, TOPE_DEFECTO, TOPES, topeDe, topesCon } = await import("../src/paneles/ajustes-compactar.ts");
const { RED_MAX, RED_MIN, validarRed } = await import("../electron/valida-ajustes.ts");

test("las opciones son 100k, 150k, 200k, 300k y sin tope, y todas las acepta el main", () => {
  assert.deepEqual([...TOPES], [100_000, 150_000, 200_000, 300_000, RED_MAX]);
  assert.equal(SIN_TOPE, RED_MAX);
  for (const n of TOPES) assert.equal(validarRed(String(n)).error, null, String(n));
  assert.ok(TOPES[0] >= RED_MIN);
});

test("sin nada guardado el selector muestra 200 000 y no hay nada que guardar", () => {
  assert.equal(topeDe(redDesde(null)), TOPE_DEFECTO);
  assert.deepEqual(redPara(null, redDesde(null)), { cambio: null, sucio: false });
});

test("elegir 200 000 sin nada guardado lo fija en el archivo", () => {
  assert.deepEqual(redPara(null, "200000"), { cambio: { red_seguridad: 200_000 }, sucio: true });
});

test("elegir otro tope manda ese número; volver al guardado deja de ser un cambio", () => {
  assert.deepEqual(redPara(200_000, "100000"), { cambio: { red_seguridad: 100_000 }, sucio: true });
  assert.deepEqual(redPara(200_000, "200000"), { cambio: null, sucio: false });
  assert.deepEqual(redPara(RED_MAX, String(RED_MAX)), { cambio: null, sucio: false });
});

test("un valor a mano que no es de la lista aparece, en su lugar, y no cuenta como cambio", () => {
  assert.deepEqual(topesCon(350_000), [100_000, 150_000, 200_000, 300_000, 350_000, RED_MAX]);
  assert.deepEqual(topesCon(200_000), [...TOPES]);
  assert.deepEqual(redPara(350_000, "350000"), { cambio: null, sucio: false });
  assert.deepEqual(topesCon(50_000)[0], 50_000, "uno fuera de rango se muestra igual (no se pierde)");
});

test("los miles van con espacio en español y con coma en inglés", () => {
  assert.equal(conMiles(200_000, "es"), "200\u00a0000");
  assert.equal(conMiles(1_000_000, "en"), "1,000,000");
  assert.equal(conMiles(950, "es"), "950");
});

test("el campo en miles de tokens: 250 → 250 000, rango 100–1000, y es el mismo valor que lee Ajustes", async () => {
  const { umbralDeK, kDe, PRESETS_K, RED_MIN_K, RED_MAX_K } = await import("../src/paneles/ajustes-compactar.ts");
  assert.deepEqual(umbralDeK("250"), { valor: 250_000, error: null });
  assert.deepEqual(umbralDeK(" 250 k"), { valor: 250_000, error: null });
  assert.deepEqual(umbralDeK(""), { valor: null, error: null });
  assert.equal(umbralDeK("99").error, "ajustes.errUmbralRango");
  assert.equal(umbralDeK("1001").error, "ajustes.errUmbralRango");
  assert.equal(umbralDeK("2x").error, "ajustes.errRedNumero");
  assert.equal(umbralDeK(String(RED_MAX_K)).valor, RED_MAX);
  assert.equal(RED_MIN_K * 1000, RED_MIN);
  for (const k of PRESETS_K) assert.equal(validarRed(String(k * 1000)).error, null);
  // Ida y vuelta Bienvenida → archivo → Ajustes: lo elegido es lo que se guarda y lo que se muestra.
  const elegido = umbralDeK("250").valor as number;
  const guardado = elegido;
  assert.equal(guardado, 250_000);
  assert.equal(topeDe(redDesde(guardado)), 250_000);
  assert.ok(topesCon(guardado).includes(250_000));
  assert.equal(kDe(guardado), "250");
});
