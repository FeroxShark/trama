// Artificial Analysis (electron/artificial-analysis.ts): leer las formas de respuesta que puede tener la API, 401 / 429 con Retry-After,
// la caché de 24 h con reloj inyectado, el servidor falso por HTTP de verdad (header x-api-key, segunda ruta si la primera da 404) y que la
// key no aparezca en ningún mensaje ni en la caché. Sin red real: la API no se puede alcanzar desde los tests.
import { test, after } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VIGENCIA_AA_MS, bajarLista, estadoAA, leerCacheAA, modeloDe, parsearLista, refrescarAA, reintentarEn, rutaCacheAA, type EsperaAA, type FetchAA } from "../electron/artificial-analysis.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "aa-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const ruta = () => path.join(tmp, `c${n++}`, "aa-modelos.json");
const KEY = "aa-super-secreta-123";

const M = (name: string, extra: object = {}) => ({ name, slug: name.toLowerCase().replace(/\W+/g, "-"), model_creator: { name: "Anthropic" }, artificial_analysis_intelligence_index: 60, artificial_analysis_coding_index: 55, artificial_analysis_agentic_index: 50, ...extra });
const resp = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, json: async () => { if (body === "ROTO") throw new Error("json roto"); return body; } });

test("parsearLista: data, arreglo suelto, models; índices sueltos o dentro de evaluations", () => {
  assert.equal(parsearLista({ status: 200, data: [M("A"), M("B")] }).length, 2);
  assert.equal(parsearLista([M("A")]).length, 1);
  assert.equal(parsearLista({ models: [M("A")] }).length, 1);
  const anidado = parsearLista({ data: [{ name: "Claude Opus 5.5", slug: "claude-opus-5-5", creator: "Anthropic", evaluations: { artificial_analysis_intelligence_index: "70.5", artificial_analysis_coding_index: 66, artificial_analysis_agentic_index: null } }] });
  assert.deepEqual(anidado[0], { name: "Claude Opus 5.5", slug: "claude-opus-5-5", creator: "Anthropic", intelligence: 70.5, coding: 66, agentic: null });
  assert.deepEqual(parsearLista({ nada: 1 }), []);
  assert.deepEqual(parsearLista(null), []);
  assert.deepEqual(parsearLista("hola"), []);
});

test("modeloDe: descarta lo que no tiene nombre ni ningún índice; creador como texto o como objeto", () => {
  assert.equal(modeloDe({ name: "X" }), null);
  assert.equal(modeloDe({ artificial_analysis_coding_index: 3 }), null);
  assert.equal(modeloDe(5), null);
  assert.equal(modeloDe({ slug: "x-y", coding_index: 40 })?.name, "x-y");
  assert.equal(modeloDe({ name: "X", model_creator: { slug: "openai" }, intelligence_index: 1 })?.creator, "openai");
  assert.equal(modeloDe({ name: "X", creator: "Z", intelligence_index: 1 })?.creator, "Z");
  assert.equal(modeloDe({ name: "X", intelligence_index: NaN }), null);
});

test("reintentarEn: segundos, fecha HTTP, basura y tope de un día", () => {
  assert.equal(reintentarEn("120", 0), 120);
  assert.equal(reintentarEn(new Date(90_000).toUTCString(), 0), 90);
  assert.equal(reintentarEn("9999999", 0), 86400);
  assert.equal(reintentarEn("mañana", 0), undefined);
  assert.equal(reintentarEn(null, 0), undefined);
});

test("bajarLista: 401 = key mala, 429 = límite con Retry-After, 404 pasa a la otra ruta, sin red, JSON roto", async () => {
  const por = (f: (u: string) => ReturnType<typeof resp> | Promise<ReturnType<typeof resp>>): FetchAA => async (u) => f(u);
  assert.deepEqual(await bajarLista(KEY, { fetch: por(() => resp(401, {})) }), { ok: false, tipo: "clave" });
  assert.deepEqual(await bajarLista(KEY, { fetch: por(() => resp(403, {})) }), { ok: false, tipo: "clave" });
  assert.deepEqual(await bajarLista(KEY, { fetch: por(() => resp(429, {}, { "retry-after": "3600" })), ahora: () => 0 }), { ok: false, tipo: "limite", reintentarS: 3600 });
  assert.deepEqual(await bajarLista(KEY, { fetch: por(() => resp(429, {})) }), { ok: false, tipo: "limite", reintentarS: undefined });
  assert.deepEqual(await bajarLista("", { fetch: por(() => resp(200, {})) }), { ok: false, tipo: "sin-clave" });
  const vistas: string[] = [];
  const r = await bajarLista(KEY, { fetch: por((u) => (vistas.push(u), u.endsWith("/free") ? resp(404, {}) : resp(200, [M("A")]))) });
  assert.equal(r.ok, true);
  assert.deepEqual(vistas, ["https://artificialanalysis.ai/api/v2/language/models/free", "https://artificialanalysis.ai/api/v2/data/llms/models"]);
  // 200 sin modelos en la primera: prueba la segunda; si tampoco, forma rara
  assert.deepEqual(await bajarLista(KEY, { fetch: por(() => resp(200, { data: [] })) }), { ok: false, tipo: "forma" });
  assert.deepEqual(await bajarLista(KEY, { fetch: por(() => resp(404, {})) }), { ok: false, tipo: "forma", detalle: "404" });
  assert.equal((await bajarLista(KEY, { fetch: por(() => resp(500, {})) })).ok, false);
  const sinRed = await bajarLista(KEY, { fetch: async () => { throw new Error(`ECONNRESET con ${KEY}`); } });
  assert.equal(sinRed.ok, false);
  assert.equal((sinRed as { tipo: string }).tipo, "red");
  assert.ok(!JSON.stringify(sinRed).includes(KEY), "la key no sale en el motivo");
  assert.equal((await bajarLista(KEY, { fetch: por(() => resp(200, "ROTO")) })).ok, false);
});

test("refrescarAA: baja y guarda; con la caché de menos de 24 h no llama; pasadas las 24 h, sí; forzar ignora la vigencia", async () => {
  const r = ruta();
  let llamadas = 0;
  let ahora = Date.parse("2026-10-25T08:00:00Z");
  const deps = { ruta: r, ahora: () => ahora, espera: { hasta: 0 } as EsperaAA, fetch: (async () => (llamadas++, resp(200, { data: [M("Claude Opus 5.5"), M("Claude Haiku 5.5", { artificial_analysis_coding_index: 40 })] }))) as FetchAA };
  const a = await refrescarAA(KEY, deps);
  assert.deepEqual([a.ok, llamadas], [true, 1]);
  const c = await leerCacheAA(r);
  assert.equal(c?.fetched, "2026-10-25T08:00:00.000Z");
  assert.equal(c?.modelos.length, 2);
  assert.ok(!readFileSync(r, "utf8").includes(KEY), "la caché no lleva la key");
  ahora += VIGENCIA_AA_MS - 1000;
  const b = await refrescarAA(KEY, deps);
  assert.deepEqual([b.ok && b.vigente, llamadas], [true, 1], "de hace menos de 24 h: no llama");
  ahora += 2000;
  const d = await refrescarAA(KEY, deps);
  assert.deepEqual([d.ok && d.vigente, llamadas], [false, 2], "pasadas 24 h: baja de nuevo");
  await refrescarAA(KEY, { ...deps, forzar: true });
  assert.equal(llamadas, 3, "forzar ignora la vigencia");
  assert.deepEqual(await refrescarAA(undefined, deps), { ok: false, tipo: "sin-clave" });
  assert.equal(llamadas, 3);
  assert.deepEqual(await estadoAA(true, r), { version: 1, hayClave: true, fecha: ahora, modelos: 2 });
});

test("un fallo no pisa la caché de antes; 429 espera lo que pide Retry-After y los demás diez minutos; forzar salta la espera", async () => {
  const r = ruta();
  let ahora = Date.parse("2026-10-25T08:00:00Z");
  let modo: "ok" | "429" | "401" | "red" = "ok";
  let llamadas = 0;
  const espera: EsperaAA = { hasta: 0 };
  const fetch: FetchAA = async () => {
    llamadas++;
    if (modo === "429") return resp(429, {}, { "retry-after": "7200" });
    if (modo === "401") return resp(401, {});
    if (modo === "red") throw new Error("sin red");
    return resp(200, [M("A")]);
  };
  const deps = { ruta: r, ahora: () => ahora, espera, fetch };
  await refrescarAA(KEY, deps);
  ahora += VIGENCIA_AA_MS + 1;
  modo = "429";
  assert.deepEqual(await refrescarAA(KEY, deps), { ok: false, tipo: "limite", reintentarS: 7200 });
  assert.equal((await leerCacheAA(r))?.modelos.length, 1, "la caché vieja sigue");
  const antes = llamadas;
  ahora += 3600_000;
  const esperando = await refrescarAA(KEY, deps);
  assert.deepEqual([esperando.ok, llamadas], [false, antes], "dentro del Retry-After no vuelve a llamar");
  assert.equal((esperando as { reintentarS: number }).reintentarS, 3600);
  ahora += 3600_000 + 1;
  modo = "ok";
  assert.equal((await refrescarAA(KEY, deps)).ok, true);
  assert.equal(espera.hasta, 0);
  ahora += VIGENCIA_AA_MS + 1;
  modo = "401";
  assert.deepEqual(await refrescarAA(KEY, deps), { ok: false, tipo: "clave" });
  const n401 = llamadas;
  await refrescarAA(KEY, deps);
  assert.equal(llamadas, n401, "tras un fallo espera diez minutos");
  ahora += 11 * 60_000;
  modo = "red";
  assert.equal((await refrescarAA(KEY, deps)).ok, false);
  modo = "ok";
  assert.equal((await refrescarAA(KEY, { ...deps, forzar: true })).ok, true, "el botón salta la espera");
});

test("servidor falso por HTTP: manda x-api-key, la primera ruta 404 pasa a la segunda, 401 sin key, 429 con Retry-After", async () => {
  const pedidos: { url: string; key: string | undefined }[] = [];
  let modo: "ok" | "limite" = "ok";
  const srv = http.createServer((req, res) => {
    pedidos.push({ url: req.url!, key: req.headers["x-api-key"] as string | undefined });
    if (req.headers["x-api-key"] !== KEY) return res.writeHead(401).end("{}");
    if (modo === "limite") return res.writeHead(429, { "Retry-After": "90" }).end("{}");
    if (req.url === "/api/v2/language/models/free") return res.writeHead(404).end("{}");
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [M("Claude Opus 5.5"), M("GLM-5.3 Flash")] }));
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const baseUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    const r = ruta();
    const bien = await refrescarAA(KEY, { baseUrl, ruta: r, espera: { hasta: 0 } });
    assert.deepEqual(bien.ok && bien.modelos, 2);
    assert.deepEqual(pedidos.map((p) => p.url), ["/api/v2/language/models/free", "/api/v2/data/llms/models"]);
    assert.ok(pedidos.every((p) => p.key === KEY));
    assert.deepEqual(await refrescarAA("otra", { baseUrl, ruta: ruta(), forzar: true, espera: { hasta: 0 } }), { ok: false, tipo: "clave" });
    modo = "limite";
    assert.deepEqual(await refrescarAA(KEY, { baseUrl, ruta: ruta(), forzar: true, espera: { hasta: 0 } }), { ok: false, tipo: "limite", reintentarS: 90 });
  } finally {
    srv.close();
  }
});

test("rutaCacheAA: REPARTO_AA manda ('0' la apaga), si no el estado de reparto como el motor; sin archivo o roto no hay caché", { skip: soloPosix("compara rutas POSIX (/e/aa-modelos.json)") }, async () => {
  assert.equal(rutaCacheAA({ REPARTO_AA: "/x/y.json" }), "/x/y.json");
  assert.equal(rutaCacheAA({ REPARTO_AA: "0" }), null);
  assert.equal(rutaCacheAA({ REPARTO_STATE: "/e" }), "/e/aa-modelos.json");
  assert.equal(rutaCacheAA({ PA_STATE: "/p", HOME: "/h" }), "/p/reparto/aa-modelos.json");
  assert.equal(rutaCacheAA({ HOME: "/h" }), "/h/.local/state/pa/reparto/aa-modelos.json");
  assert.equal(await leerCacheAA(path.join(tmp, "no-existe.json")), null);
  assert.equal(await leerCacheAA(null), null);
  assert.deepEqual(await estadoAA(false, path.join(tmp, "no-existe.json")), { version: 1, hayClave: false, fecha: null, modelos: 0 });
  assert.equal(existsSync(path.join(tmp, "no-existe.json")), false);
});

test("modeloDe guarda costo, tokens y tiempo por tarea cuando AA los trae (sueltos o en objetos) y no inventa los que faltan", () => {
  const a = modeloDe({ name: "X (high)", slug: "x-high", coding_index: 40, agentic_index: 38, evaluations: { artificial_analysis_intelligence_index: 46.8 }, cost_per_task: 0.884, tokens_per_task: 120000, time_per_task: 95 })!;
  assert.deepEqual([a.intelligence, a.coding, a.agentic, a.cost, a.tokens, a.time], [46.8, 40, 38, 0.884, 120000, 95]);
  const b = modeloDe({ name: "Y", coding_index: 30, intelligence_index_cost: { total_cost: 12.5 }, intelligence_index_token_counts: { input_tokens: 100, output_tokens: 50 } })!;
  assert.deepEqual([b.cost, b.tokens, b.time], [12.5, 150, undefined]);
  const c = modeloDe({ name: "Z", coding_index: 30 })!;
  assert.equal("cost" in c || "tokens" in c || "time" in c, false);
});
