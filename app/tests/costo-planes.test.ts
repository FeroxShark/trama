// Costo por suscripción (electron/costo-planes.ts y costo-planes-texto.ts): validar la respuesta de Priors, la caché de 6 h con reloj
// inyectado y el respaldo (caché vieja o nada), el mapeo de ids de Trama a los de Priors, el plan de Claude leído SÓLO de dos campos del
// credentials (los tokens no salen en ningún lado) y el costo de «No conviene» (AA × ratio; sin ratio o sin AA, lo de siempre).
// Sin red: fetch falso, y un servidor HTTP local para el camino del fetch de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { FilaTabla } from "../electron/reparto-tabla.ts";
import { datosPlanes, planClaudeDetectado, refrescarPlanes, rutaCachePlanes, rutaCredencialesClaude, vistaPlanes, VIGENCIA_PLANES_MS, type FetchPlanes } from "../electron/costo-planes.ts";
import { contextoPlanes, conPunto, idBase, idPriors, planCorto, planDeClaude, planEfectivo, planesDe, ratioDeFila, validarPriors, type DatosPriors } from "../electron/costo-planes-texto.ts";

// Lo de src/ se importa sin extensión (como en Vite).
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});
const { paresDe, dominados, costoDe } = await import("../src/paneles/efforts-dominados.ts");
const { borradorDe } = await import("../src/paneles/modelos-borrador.ts");

const tmp = mkdtempSync(path.join(os.tmpdir(), "planes-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const ruta = () => path.join(tmp, `c${n++}`, "costo-planes.json");

/** Una respuesta con la forma de `GET /api/plan-prices` (recortada). */
const API = {
  date: "2026-11-19",
  generatedAt: "2026-11-19T05:04:33.799Z",
  labs: [
    { id: "anthropic", name: "Anthropic", plans: [{ plan: "Claude Pro", feeUsd: 20 }, { plan: "Claude Max 5x", feeUsd: 100 }, { plan: "Claude Ultra", feeUsd: 200 }] },
    { id: "google", name: "Google", plans: [{ plan: "Google AI Pro", feeUsd: 20 }, { plan: "Google AI Ultra 20x", feeUsd: 250 }] },
    { id: "openai", name: "OpenAI", plans: [{ plan: "ChatGPT Plus", feeUsd: 20 }] },
  ],
  models: [
    { id: "claude-opus-5.5", name: "Claude Opus 5.5", lab: "anthropic", aa: ["claude-opus-5-5"], plan: "Claude Max 5x", feeUsd: 100, ratio: 0.013018, confidence: "medium", plans: { "Claude Pro": { ratio: 0.015671, confidence: "medium" }, "Claude Max 5x": { ratio: 0.013018, confidence: "medium" } } },
    { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5", lab: "anthropic", aa: ["claude-sonnet-5-5"], plan: "Claude Max 5x", ratio: 0.013018, confidence: "low", plans: { "Claude Max 5x": { ratio: 0.013018, confidence: "low" } } },
    { id: "gemini-4-neon", name: "Gemini 4 Neon", lab: "google", aa: ["gemini-4-neon"], plan: "Google AI Pro (assumed same as Flash)", feeUsd: 20, ratio: 0.048133, confidence: "medium" },
    { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", lab: "openai", aa: ["gpt-6-1-sol"], plan: "ChatGPT Plus", ratio: 0.066968, confidence: "estimated from token usage" },
    { id: "sin-ratio", name: "X", lab: "openai", aa: [], plan: "ChatGPT Plus", ratio: "mucho" },
  ],
};
const DATOS = validarPriors(API) as DatosPriors;

const resp = (status: number, body: unknown) => ({ status, json: async () => { if (body === "ROTO") throw new Error("json roto"); return body; } });
const fetchDe = (r: ReturnType<typeof resp> | Error) => {
  const llamados: { url: string; headers: Record<string, string> }[] = [];
  const f: FetchPlanes = async (url, init) => {
    llamados.push({ url, headers: init.headers });
    if (r instanceof Error) throw r;
    return r;
  };
  return { f, llamados };
};

test("validarPriors: se queda con lo que usa, limpia la aclaración del plan de referencia y descarta lo raro", () => {
  assert.ok(DATOS);
  assert.equal(DATOS.fecha, "2026-11-19T05:04:33.799Z");
  assert.deepEqual(DATOS.labs.map((l) => l.id), ["anthropic", "google", "openai"]);
  assert.deepEqual(planesDe(DATOS, "google"), ["Google AI Pro", "Google AI Ultra 20x"]);
  assert.deepEqual(planesDe(DATOS, "deepseek"), []);
  // «Google AI Pro (assumed same as Flash)» → «Google AI Pro», confianza «assumed».
  assert.deepEqual(DATOS.modelos.find((m) => m.id === "gemini-4-neon")?.planes, { "Google AI Pro": { ratio: 0.048133, confianza: "assumed" } });
  assert.equal(DATOS.modelos.find((m) => m.id === "gpt-6.1-sol")?.planes["ChatGPT Plus"]?.confianza, "estimated");
  // Un ratio que no es número no entra (y el modelo sin ningún ratio, tampoco).
  assert.equal(DATOS.modelos.some((m) => m.id === "sin-ratio"), false);
  assert.equal(validarPriors(null), null);
  assert.equal(validarPriors({ labs: [], models: [] }), null);
  assert.equal(validarPriors({ labs: API.labs }), null);
  assert.equal(validarPriors("hola"), null);
});

test("mapeo de ids: Trama → Priors por id, versión con punto o slug de AA; sin match, null", () => {
  assert.equal(conPunto("claude-opus-5-5"), "claude-opus-5.5");
  assert.equal(idBase("agy:gemini-4-neon-high"), "gemini-4-neon");
  assert.equal(idPriors(DATOS, "claude-opus-5-5"), "claude-opus-5.5");
  assert.equal(idPriors(DATOS, "gemini-4-neon"), "gemini-4-neon");
  assert.equal(idPriors(DATOS, "agy:gemini-4-neon"), "gemini-4-neon");
  assert.equal(idPriors(DATOS, "codex:gpt-6-1-sol"), "gpt-6.1-sol");
  assert.equal(idPriors(DATOS, "deepseek:deepseek-v4.1-flash"), null);
  assert.equal(idPriors(DATOS, ""), null);
  assert.equal(planCorto("Claude Max 5x"), "Max 5x");
  assert.equal(planCorto("Google AI Pro"), "AI Pro");
});

test("caché: la primera vez baja con User-Agent genérico y guarda; dentro de 6 h no vuelve a pedir; vencida, vuelve a bajar", async () => {
  const r = ruta();
  let ahora = 1_000_000;
  const { f, llamados } = fetchDe(resp(200, API));
  const a = await refrescarPlanes({ fetch: f, ruta: r, ahora: () => ahora, baseUrl: "http://falso.test/" });
  assert.equal(a.nuevo, true);
  assert.deepEqual(a.datos, DATOS);
  assert.equal(llamados.length, 1);
  assert.equal(llamados[0]!.url, "http://falso.test/api/plan-prices");
  // Sin ningún dato de la persona: sólo estos dos encabezados.
  assert.deepEqual(llamados[0]!.headers, { "User-Agent": "Trama", Accept: "application/json" });
  assert.ok(existsSync(r));
  ahora += VIGENCIA_PLANES_MS - 1;
  const b = await refrescarPlanes({ fetch: f, ruta: r, ahora: () => ahora });
  assert.equal(b.nuevo, false);
  assert.deepEqual(b.datos, DATOS);
  assert.equal(llamados.length, 1);
  ahora += 2;
  assert.equal((await refrescarPlanes({ fetch: f, ruta: r, ahora: () => ahora })).nuevo, true);
  assert.equal(llamados.length, 2);
});

test("respaldo: si Priors falla (red, 500, JSON roto o forma rara) queda la caché vieja; sin caché, null; nunca tira", async () => {
  const r = ruta();
  await datosPlanes({ fetch: fetchDe(resp(200, API)).f, ruta: r, ahora: () => 0 });
  const tarde = () => VIGENCIA_PLANES_MS * 10;
  for (const malo of [new Error("sin red"), resp(500, {}), resp(200, "ROTO"), resp(200, { labs: "x" })]) {
    const x = await refrescarPlanes({ fetch: fetchDe(malo).f, ruta: r, ahora: tarde });
    assert.equal(x.nuevo, false);
    assert.deepEqual(x.datos, DATOS);
    assert.equal(await datosPlanes({ fetch: fetchDe(malo).f, ruta: ruta(), ahora: tarde }), null);
  }
  // Una caché tocada a mano con basura se ignora.
  const rota = ruta();
  mkdirSync(path.dirname(rota), { recursive: true });
  writeFileSync(rota, JSON.stringify({ version: 1, bajado: 0, datos: { labs: 3 } }));
  assert.equal(await datosPlanes({ fetch: fetchDe(new Error("x")).f, ruta: rota, ahora: () => 1 }), null);
});

test("sin red (pruebas y capturas): sólo la caché, aunque esté vencida; no pide nada", async () => {
  const r = ruta();
  await datosPlanes({ fetch: fetchDe(resp(200, API)).f, ruta: r, ahora: () => 0 });
  const { f, llamados } = fetchDe(resp(200, API));
  assert.deepEqual(await datosPlanes({ fetch: f, ruta: r, ahora: () => VIGENCIA_PLANES_MS * 3, sinRed: true }), DATOS);
  assert.equal(await datosPlanes({ fetch: f, ruta: ruta(), sinRed: true }), null);
  assert.equal(llamados.length, 0);
});

test("el fetch de verdad contra un servidor local: pide /api/plan-prices con User-Agent Trama", async () => {
  const vistos: { url?: string; ua?: string }[] = [];
  const srv = http.createServer((req, res) => {
    vistos.push({ url: req.url, ua: req.headers["user-agent"] });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(API));
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    assert.deepEqual(await datosPlanes({ ruta: ruta(), baseUrl: base }), DATOS);
    assert.deepEqual(vistos, [{ url: "/api/plan-prices", ua: "Trama" }]);
  } finally {
    srv.close();
  }
});

test("rutaCachePlanes en el estado de trama; credentials de Claude en el home de Linux y de Windows", () => {
  assert.equal(path.basename(rutaCachePlanes()), "costo-planes.json");
  assert.equal(rutaCredencialesClaude({ HOME: "/home/x" }, "linux"), "/home/x/.claude/.credentials.json");
  assert.equal(rutaCredencialesClaude({ USERPROFILE: "C:\\Users\\x" }, "win32"), "C:\\Users\\x\\.claude\\.credentials.json");
});

test("planDeClaude: pro, max 5x, max 20x (Ultra); lo demás sin plan", () => {
  assert.equal(planDeClaude("pro", null), "Claude Pro");
  assert.equal(planDeClaude("max", "default_claude_max_5x"), "Claude Max 5x");
  assert.equal(planDeClaude("max", "default_claude_max_20x"), "Claude Ultra");
  assert.equal(planDeClaude("max", "otro"), null);
  assert.equal(planDeClaude("team", "default_claude_max_5x"), null);
  assert.equal(planDeClaude(undefined, undefined), null);
  assert.equal(planDeClaude(5, {}), null);
});

test("plan de Claude del credentials: sólo dos campos; los tokens no salen ni en la vista, ni en la caché, ni en la consola", async () => {
  const SECRETOS = ["sk-ant-oat01-ACCESO-SECRETO", "sk-ant-ort01-REFRESCO-SECRETO", "org-SECRETA"];
  const cred = path.join(tmp, "cred", ".credentials.json");
  mkdirSync(path.dirname(cred), { recursive: true });
  writeFileSync(cred, JSON.stringify({ claudeAiOauth: { accessToken: SECRETOS[0], refreshToken: SECRETOS[1], expiresAt: 9e12, scopes: ["user:inference"], subscriptionType: "max", rateLimitTier: "default_claude_max_5x" }, organizationUuid: SECRETOS[2] }));
  const dichos: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => void dichos.push(a.map(String).join(" "));
  const r = ruta();
  const pedidos: string[] = [];
  const f: FetchPlanes = async (url, init) => {
    pedidos.push(url + JSON.stringify(init.headers));
    return resp(200, API);
  };
  try {
    assert.equal(await planClaudeDetectado(cred), "Claude Max 5x");
    const v = await vistaPlanes({ credenciales: cred, agy: false, fetch: f, ruta: r, ahora: () => 0 });
    assert.equal(v.claude, "Claude Max 5x");
    const todo = [JSON.stringify(v), readFileSync(r, "utf8"), ...pedidos, ...dichos].join("\n");
    for (const s of SECRETOS) assert.ok(!todo.includes(s), `se filtró ${s}`);
    assert.ok(!todo.includes("accessToken") && !todo.includes("refreshToken"));
  } finally {
    Object.assign(console, orig);
  }
  // Archivo ausente, roto o sin claudeAiOauth: sin plan (se usa la estimación).
  assert.equal(await planClaudeDetectado(path.join(tmp, "no-existe.json")), null);
  const roto = path.join(tmp, "cred", "roto.json");
  writeFileSync(roto, "{no es json");
  assert.equal(await planClaudeDetectado(roto), null);
  writeFileSync(roto, JSON.stringify({ otra: { subscriptionType: "pro" } }));
  assert.equal(await planClaudeDetectado(roto), null);
});

test("plan efectivo: lo elegido gana; si no, Claude detectado y Google AI Pro con agy; el resto sin plan", () => {
  const vista = { claude: "Claude Max 5x", agy: true };
  assert.equal(planEfectivo("claude", {}, vista), "Claude Max 5x");
  assert.equal(planEfectivo("claude", { claude: "Claude Pro" }, vista), "Claude Pro");
  assert.equal(planEfectivo("google", {}, vista), "Google AI Pro");
  assert.equal(planEfectivo("google", {}, { claude: null, agy: false }), null);
  assert.equal(planEfectivo("google", { google: "Google AI Ultra 20x" }, { claude: null, agy: false }), "Google AI Ultra 20x");
  assert.equal(planEfectivo("openai", {}, vista), null);
  assert.deepEqual(contextoPlanes({ datos: DATOS, ...vista }, { openai: "ChatGPT Plus" }).planes, { claude: "Claude Max 5x", google: "Google AI Pro", openai: "ChatGPT Plus" });
});

// ── Costo en «No conviene» (src/paneles/efforts-dominados.ts) ──
const fila = (id: string, familia: string, proveedor: string, q: FilaTabla["calidadPorEffort"], costo?: FilaTabla["costoPorEffort"]): FilaTabla => ({
  id, nombre: id, proveedor, familia, familiaExcluir: familia, cuenta: null, calidad: 100, effortUsado: null, calidadPorEffort: q, effortsEstimados: [], calidadEstimadaPorEffort: {}, ...(costo ? { costoPorEffort: costo } : {}),
  estimada: false, origen: "artificial-analysis", aaFecha: "2026-10-26", gratis: false, libre: 1, vuelve: null, ventanas: [], urgencia: 0, permitido: true, excluidoPor: null, agotado: false,
});
const b0 = () => borradorDe({ version: 1, ruta: "/x", existe: true, error: null, efectivo: null, config: { workers: {}, locales: [], excluir: [], calidad: {}, permitir_max: false, gemini: {}, claude: {}, destrabar: {} } });
const SONNET = fila("claude-sonnet-5-5", "sonnet", "claude", { low: 35.9, high: 46.8 }, { low: 482.13, high: 1027.4 });
const DEEPSEEK = fila("deepseek:deepseek-v4.1-flash", "dsh", "deepseek", { max: 45.1 }, { max: 444.6 });
const CTX = contextoPlanes({ datos: DATOS, claude: "Claude Max 5x", agy: false }, {});

test("costo con ratio: costo de AA × ratio del plan, con el plan anotado", () => {
  const c = costoDe(SONNET, "high", CTX);
  assert.equal(c.costo, 1027.4 * 0.013018);
  assert.equal(c.fuente, "aa");
  assert.equal(c.plan, "Claude Max 5x");
  assert.deepEqual(ratioDeFila(CTX, SONNET), { ratio: 0.013018, confianza: "low", plan: "Claude Max 5x" });
});

test("costo sin ratio: sin datos, sin plan, modelo fuera de Priors o de otro lab, queda el de API; sin costo de AA, la estimación de siempre", () => {
  const api = costoDe(SONNET, "high");
  assert.deepEqual(api, { costo: 1027.4, fuente: "aa" });
  assert.deepEqual(costoDe(SONNET, "high", null), api);
  assert.deepEqual(costoDe(SONNET, "high", { datos: null, planes: { claude: "Claude Max 5x" } }), api);
  assert.deepEqual(costoDe(SONNET, "high", { datos: DATOS, planes: {} }), api);
  // Un plan que el modelo no tiene en Priors.
  assert.deepEqual(costoDe(SONNET, "high", { datos: DATOS, planes: { claude: "Claude Team Premium" } }), api);
  assert.deepEqual(costoDe(DEEPSEEK, "max", CTX), { costo: 444.6, fuente: "aa" });
  // Un Claude que llega por Google (proveedor google) no toma el ratio de Anthropic.
  assert.equal(ratioDeFila(CTX, { id: "claude-sonnet-5-5", proveedor: "google" }), null);
  // Sin costo de AA: la estimación por familia, sin multiplicar y marcada «estimado».
  const sinAA = fila("claude-sonnet-5-5", "sonnet", "claude", { low: 30 });
  assert.deepEqual(costoDe(sinAA, "low", CTX), costoDe(sinAA, "low"));
  assert.equal(costoDe(sinAA, "low", CTX).fuente, "estimado");
  assert.equal(costoDe(sinAA, "low", CTX).plan, undefined);
});

test("paresDe usa el costo con plan: con Max 5x, Sonnet low deja de estar dominado por DeepSeek Flash", () => {
  const sin = dominados(paresDe([SONNET, DEEPSEEK], b0()));
  assert.ok(sin.some((z) => z.par.id === SONNET.id && z.par.effort === "low" && z.por.id === DEEPSEEK.id));
  const pares = paresDe([SONNET, DEEPSEEK], b0(), CTX);
  const low = pares.find((p) => p.id === SONNET.id && p.effort === "low");
  assert.equal(low?.costo, 482.13 * 0.013018);
  assert.equal(low?.plan, "Claude Max 5x");
  assert.equal(pares.find((p) => p.id === DEEPSEEK.id)?.plan, undefined);
  assert.ok(!dominados(pares).some((z) => z.par.id === SONNET.id && z.por.id === DEEPSEEK.id));
});
