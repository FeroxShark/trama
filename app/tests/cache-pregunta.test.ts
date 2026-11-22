// Preguntar qué hacer con el primer mensaje cuando la caché venció (electron/cache-pregunta.ts) y recordar la elección (preferencias.ts). Puro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { decidirCacheConTranscript } from "../src/hilo/contexto-logica.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-cache-pref-"));
process.env.HILOS_STATE = tmp;
const { decidirCache, cacheVencida, abreOtra, UMBRAL_TOKENS, TOKENS_RESUMEN, TTL_DEFECTO_S } = await import("../electron/cache-pregunta.ts");
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

test("con caché vencida y tokens desconocidos se espera el transcript antes de decidir", async () => {
  const { tokens, ...entrada } = base;
  const pag = { total: 7, usage: { cache_read_input_tokens: tokens }, mensajes: [] };
  let llega!: (p: typeof pag) => void;
  const lectura = new Promise<typeof pag>((resolver) => { llega = resolver; });
  const v = decidirCacheConTranscript(entrada, null, { output_tokens: 10 }, false, () => lectura);
  assert.ok(v instanceof Promise);
  llega(pag);
  assert.deepEqual(await v, { total: pag.total, veredicto: decidirCache(base) });

  const noLeer = () => assert.fail("Ya se sabe si corresponde preguntar");
  const enVivo = decidirCacheConTranscript(entrada, null, pag.usage, false, noLeer);
  assert.deepEqual(enVivo, { total: 0, veredicto: decidirCache(base) });
  const vigente = { ...entrada, vence: AHORA / 1000 + 30 };
  assert.deepEqual(decidirCacheConTranscript(vigente, null, null, false, noLeer), {
    total: 0,
    veredicto: decidirCache({ ...vigente, tokens: 0 }),
  });
  await assert.rejects(
    async () => decidirCacheConTranscript(entrada, null, null, false, async () => { throw new Error("Faltó el transcript"); }),
    /Faltó el transcript/,
  );
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

test("lo recordado: seguir manda como siempre; resumen arranca solo únicamente donde no abre otra conversación (agy); vigente o chico, nada cambia", () => {
  const agy = { ...base, modelo: "agy:gemini-4-argon-high" };
  assert.equal(decidirCache({ ...base, pref: "seguir" }).accion, "enviar");
  assert.equal(decidirCache({ ...agy, pref: "seguir" }).accion, "enviar");
  assert.equal(decidirCache({ ...agy, pref: "resumen" }).accion, "resumen");
  assert.equal(decidirCache({ ...agy, pref: "resumen", actividad: AHORA / 1000 - 10 }).accion, "enviar");
  assert.equal(decidirCache({ ...base, pref: "resumen", actividad: AHORA / 1000 - 10 }).accion, "enviar");
  assert.equal(decidirCache({ ...base, pref: "resumen", tokens: 5_000 }).accion, "enviar");
});

test("Claude: «empezar con resumen» abre otra conversación, así que lo recordado nunca la abre solo: pregunta cada vez", () => {
  assert.equal(abreOtra("claude-opus-5-5"), true);
  assert.equal(abreOtra("agy:gemini-4-argon-high"), false);
  for (const modelo of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2"]) assert.equal(decidirCache({ ...base, modelo, pref: "resumen" }).accion, "preguntar", modelo);
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

test("sin TTL medido (ni vence ni ttl) el veredicto marca ttlSupuesto: el diálogo dice «probablemente venció»; con dato, no", async () => {
  const supuesto = decidirCache(base);
  assert.equal(supuesto.accion, "preguntar");
  assert.equal(supuesto.ttlSupuesto, true);
  // El TTL vino del transcript (cache_creation) o el vencimiento del statusline: es una medición.
  assert.equal(decidirCache({ ...base, ttl: 300 }).ttlSupuesto, undefined);
  assert.equal(decidirCache({ ...base, vence: AHORA / 1000 - 10 }).ttlSupuesto, undefined);
  // Gemini: agy no dice nada, siempre es suposición.
  assert.equal(decidirCache({ ...base, modelo: "gemini-4-argon-high" }).ttlSupuesto, true);
  const { es } = await import("../src/i18n/es.ts");
  const { en } = await import("../src/i18n/en.ts");
  assert.match((es as Record<string, string>)["cache.textoProbable"]!, /probablemente venció/);
  assert.match((en as Record<string, string>)["cache.textoProbable"]!, /probably expired/);
  assert.match((es as Record<string, string>)["cache.texto"]!, /venció:/);
});
