// Preguntar qué hacer con el primer mensaje cuando la caché venció (electron/cache-pregunta.ts) y recordar la elección (preferencias.ts). Puro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-cache-pref-"));
process.env.HILOS_STATE = tmp;
const { decidirCache, cacheVencida, UMBRAL_TOKENS, TOKENS_RESUMEN, TTL_DEFECTO_S } = await import("../electron/cache-pregunta.ts");
const { guardarCacheVencida, leerPreferencias } = await import("../electron/preferencias.ts");

const AHORA = 1_800_000_000_000;
const base = { modelo: "claude-opus-5-5", local: false, cruza: false, vence: null as number | null, ttl: null as number | null, actividad: AHORA / 1000 - 1800, tokens: 120_000, pref: "preguntar" as const, ahoraMs: AHORA };

test("caché vencida y contexto grande: pide elegir, con los tokens de cada camino", () => {
  const v = decidirCache(base);
  assert.equal(v.accion, "preguntar");
  assert.equal(v.tokensSeguir, 120_000);
  assert.equal(v.tokensResumen, TOKENS_RESUMEN);
  assert.equal(Object.hasOwn(v, "pctSeguir"), false);
});

test("caché vigente: no pregunta (con el vencimiento que dice el statusline, o con el TTL por defecto)", () => {
  assert.equal(decidirCache({ ...base, vence: AHORA / 1000 + 60 }).accion, "enviar");
  assert.equal(decidirCache({ ...base, actividad: AHORA / 1000 - 30 }).accion, "enviar");
  // Con el TTL de 1 h medido, a los 30 min sigue vigente.
  assert.equal(decidirCache({ ...base, ttl: 3600 }).accion, "enviar");
  assert.equal(decidirCache({ ...base, ttl: 3600, actividad: AHORA / 1000 - 4000 }).accion, "preguntar");
});

test("agy (gemini): usa el TTL por defecto del motor; sin vencimiento propio", () => {
  const g = { ...base, modelo: "agy:gemini-4-argon-high" };
  assert.equal(decidirCache(g).accion, "preguntar");
  assert.equal(decidirCache({ ...g, actividad: AHORA / 1000 - (TTL_DEFECTO_S.gemini - 20) }).accion, "enviar");
});

test("contexto chico, sin actividad, local, otros motores o cambio de motor: no pregunta", () => {
  assert.equal(decidirCache({ ...base, tokens: UMBRAL_TOKENS - 1 }).accion, "enviar");
  assert.equal(decidirCache({ ...base, tokens: UMBRAL_TOKENS }).accion, "preguntar");
  assert.equal(decidirCache({ ...base, actividad: 0 }).accion, "enviar");
  assert.equal(decidirCache({ ...base, local: true }).accion, "enviar");
  assert.equal(decidirCache({ ...base, cruza: true }).accion, "enviar");
  for (const modelo of ["ollama:qwen", "dsh:deepseek-v4", "opencode:x/y"]) assert.equal(decidirCache({ ...base, modelo }).accion, "enviar", modelo);
  assert.equal(cacheVencida({ ...base, modelo: "dsh:x" }), false);
});

test("lo recordado: seguir manda como siempre, resumen arranca con resumen sin preguntar; vigente o chico, nada cambia", () => {
  assert.equal(decidirCache({ ...base, pref: "seguir" }).accion, "enviar");
  assert.equal(decidirCache({ ...base, pref: "resumen" }).accion, "resumen");
  assert.equal(decidirCache({ ...base, pref: "resumen", actividad: AHORA / 1000 - 10 }).accion, "enviar");
  assert.equal(decidirCache({ ...base, pref: "resumen", tokens: 5_000 }).accion, "enviar");
});

test("recordar mi elección: se guarda en preferencias, se cambia y se borra con «preguntar»; lo raro se ignora", async () => {
  assert.equal((await leerPreferencias()).cacheVencida, undefined);
  await guardarCacheVencida("resumen");
  assert.equal((await leerPreferencias()).cacheVencida, "resumen");
  await guardarCacheVencida("otra-cosa");
  assert.equal((await leerPreferencias()).cacheVencida, "resumen");
  await guardarCacheVencida("seguir");
  assert.equal((await leerPreferencias()).cacheVencida, "seguir");
  await guardarCacheVencida("preguntar");
  assert.equal((await leerPreferencias()).cacheVencida, undefined);
  rmSync(tmp, { recursive: true, force: true });
});
