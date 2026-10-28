// Plan y cupos > Avanzado > «Dónde pa deja de usar cada proveedor» (src/paneles/cupos-topes.ts): lo que se edita en el borrador y cómo queda
// en modelos.json (`reserva` de Claude, `topes_uso` de Google y ChatGPT, `agy_min_libre_5h` para código en Google). Puro, sin React.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EstadoModelos } from "../electron/modelos-config.ts";

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
const { cambiado, fabricaDe, poner, restaurar, topeDe } = await import("../src/paneles/cupos-topes.ts");
const { leerConfig, unir, validarConfig } = await import("../electron/modelos-tipos.ts");

const estadoDe = (archivo: Record<string, unknown> | null): EstadoModelos => ({ version: 1, ruta: "/x/modelos.json", existe: archivo !== null, config: leerConfig(archivo ?? {}), error: null, efectivo: null });
const borrador = (archivo: Record<string, unknown> | null = null) => borradorDe(estadoDe(archivo));
/** Lo que se escribiría sobre `archivo` con ese borrador. */
const escrito = (archivo: Record<string, unknown> | null, b: ReturnType<typeof borrador>) => unir(archivo, validarConfig(JSON.parse(JSON.stringify(configDe(b)))));

test("de fábrica todos están en 97 % (y el de código de Google en 70 %), sin nada cambiado ni escrito", () => {
  const b = borrador();
  for (const id of ["claude:5h", "claude:7d", "google", "google:claude-gpt", "openai"]) {
    assert.equal(topeDe(b, id), 97, id);
    assert.equal(fabricaDe(id), 97);
    assert.equal(cambiado(b, id), false);
  }
  assert.equal(topeDe(b, "google:codigo"), 70);
  assert.equal(fabricaDe("google:codigo"), 70);
  assert.deepEqual(escrito({ version: 1 }, b), { version: 1 });
});

test("Google: el tope de un grupo se guarda en topes_uso y volver a de fábrica saca la clave", () => {
  const b = poner(borrador(), "google:claude-gpt", 80);
  assert.equal(topeDe(b, "google:claude-gpt"), 80);
  assert.equal(topeDe(b, "google:gemini"), 97);
  assert.equal(cambiado(b, "google:claude-gpt"), true);
  const j = escrito({ version: 1 }, b);
  assert.deepEqual(j.topes_uso, { "google:claude-gpt": 80 });
  const otra = borrador(j);
  assert.equal(topeDe(otra, "google:claude-gpt"), 80);
  assert.equal(sucio(estadoDe(j), otra), false);
  const de_fabrica = restaurar(otra, "google:claude-gpt");
  assert.equal(cambiado(de_fabrica, "google:claude-gpt"), false);
  assert.equal(escrito(j, de_fabrica).topes_uso, undefined);
  // Ponerlo en 97 a mano es lo mismo que volver.
  assert.deepEqual(poner(b, "google:claude-gpt", 97).topes, {});
});

test("Google: un grupo hereda el tope del proveedor entero, y volver a de fábrica en el grupo lo dice explícito", () => {
  const b = borrador({ version: 1, topes_uso: { google: 85 } });
  assert.equal(topeDe(b, "google:gemini"), 85);
  assert.equal(topeDe(b, "google"), 85);
  const r = restaurar(b, "google:gemini");
  assert.equal(topeDe(r, "google:gemini"), 97);
  assert.deepEqual(r.topes, { google: 85, "google:gemini": 97 });
});

test("ChatGPT: va por topes_uso.openai", () => {
  const j = escrito({ version: 1 }, poner(borrador(), "openai", 90));
  assert.deepEqual(j.topes_uso, { openai: 90 });
});

test("Claude: un tope en 5 h o semana escribe `reserva` (la clave que ya lee reparto); todo en fábrica la apaga", () => {
  let b = poner(borrador(), "claude:5h", 80);
  assert.equal(topeDe(b, "claude:5h"), 80);
  assert.equal(topeDe(b, "claude:7d"), 97);
  const j = escrito({ version: 1 }, b);
  assert.deepEqual(j.reserva, { "5h": 0.2, "7d": 0.03 });
  b = borrador(j);
  assert.equal(topeDe(b, "claude:5h"), 80);
  assert.equal(cambiado(b, "claude:7d"), false);
  b = restaurar(restaurar(b, "claude:5h"), "claude:7d");
  assert.equal(b.guardar, false);
  assert.equal(escrito(j, b).reserva, null);
});

test("código en Google: se guarda como agy_min_libre_5h (lo que tiene que quedar libre) y 70 % no escribe nada", () => {
  const b = poner(borrador(), "google:codigo", 50);
  const j = escrito({ version: 1 }, b);
  assert.equal(j.agy_min_libre_5h, 0.5);
  assert.equal(topeDe(borrador(j), "google:codigo"), 50);
  assert.equal(escrito(j, poner(b, "google:codigo", 70)).agy_min_libre_5h, undefined);
  // Un valor a mano que no es un entero de % no se reescribe si no se toca.
  assert.equal(escrito({ version: 1, agy_min_libre_5h: 0.255 }, borrador({ version: 1, agy_min_libre_5h: 0.255 })).agy_min_libre_5h, 0.255);
});

test("topes_uso conserva lo que la app no entiende y no acepta claves ni valores inválidos", () => {
  const j = escrito({ version: 1, topes_uso: { futuro: "x" } }, poner(borrador(), "openai", 90));
  assert.deepEqual(j.topes_uso, { futuro: "x", openai: 90 });
  assert.throws(() => validarConfig({ topes_uso: { claude: 50 } }));
  assert.throws(() => validarConfig({ topes_uso: { google: 0 } }));
  assert.throws(() => validarConfig({ topes_uso: { google: 50.5 } }));
  assert.throws(() => validarConfig({ google_codigo_5h: 101 }));
});
