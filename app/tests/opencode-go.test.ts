// OpenCode Go (plan pago de OpenCode, APAGADO por defecto): la tabla de topes (motor/opencode/go-topes.json, un solo archivo de datos), qué
// modelos se ofrecen según el plan, el plan guardado en modelos.json, el cupo POR MODELO (un 429 de un modelo de Go no toca a los demás ni a
// `opencode-free`), el modelo chico gratis cuando no hay Go (el 402 de GPT-6 Luna) y el rótulo «Plan Go» del selector. Sin opencode ni red.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cargarTablaGo, guardarPlanOpencode, normalizarSlug, ofertasGo, parsearTablaGo, planOpencode, vistaPlanGo } from "../electron/opencode-go.ts";
import { conModeloChico, esModeloGo, MODELO_CHICO_GRATIS } from "../electron/opencode.ts";
import { elegibles } from "../electron/opencode-ajustes.ts";
import { GRUPO_OPENCODE_GRATIS, grupoModeloGo, marcarModeloGoAgotado, marcarOpencodeAgotado, modelosGoAgotados, opencodeAgotadoHasta } from "../electron/opencode-agotado.ts";
import * as motor from "../../motor/opencode/config.mjs";
import { aResultado } from "../../motor/opencode/correr.mjs";
import { esAvisoSinCupoOpencode, goAgotadosDe, goAgotadosHasta, marcarAgotadas } from "../src/hilo/agotados.ts";
import { esGoOpencode, ponerConfig, TABLA } from "../src/hilo/modelos.ts";
import { vistaModelos } from "../electron/modelos-config.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "oc-go-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const carpeta = () => {
  const d = path.join(tmp, `c${n++}`);
  mkdirSync(d, { recursive: true });
  return d;
};
const REAL = path.join(import.meta.dirname, "..", "..", "motor", "opencode", "go-topes.json");

test("la tabla real: 11 modelos con los topes de Go y Go Plus, fecha y URL de origen", () => {
  const t = parsearTablaGo(readFileSync(REAL, "utf8"))!;
  assert.ok(t, "go-topes.json se entiende");
  assert.equal(t.fuente, "https://opencode.ai/go");
  assert.match(t.fecha, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(t.modelos.length, 11);
  const por = Object.fromEntries(t.modelos.map((m) => [m.slug, m]));
  assert.deepEqual(por["kimi-k3.1-pro"]!.topes, { go: { pedidos5h: 147, usdMes: 15 }, "go-plus": { pedidos5h: 588, usdMes: 60 } });
  assert.deepEqual(por["deepseek-v4.1-flash"]!.topes, { go: { pedidos5h: 34670, usdMes: 80 }, "go-plus": { pedidos5h: 69330, usdMes: 160 } });
  assert.deepEqual(por["mimo-v2.6-flash"]!.topes["go-plus"], { pedidos5h: 60200, usdMes: 120 });
  assert.equal(por["gpt-6-luna"]!.nombre, "GPT 6 Luna");
  assert.equal(t.precios.go, 10);
  assert.equal(t.precios["go-plus"], 40);
  assert.equal(t.origen, "respaldo");
});

test("parsearTablaGo: lo que no es el contrato no es una tabla", () => {
  for (const mal of ["", "{", "[]", JSON.stringify({ version: 2, modelos: [{ id: "x" }] }), JSON.stringify({ version: 1, modelos: [] }), JSON.stringify({ version: 1, modelos: [{ id: "con espacio" }] })]) assert.equal(parsearTablaGo(mal), null, mal);
  const t = parsearTablaGo(JSON.stringify({ version: 1, modelos: [{ id: "a-b", go: { pedidos_5h: 3 } }] }))!;
  assert.equal(t.modelos[0]!.topes.go, null, "topes incompletos: sin topes, no a medias");
});

test("cargarTablaGo: HILOS_OPENCODE_GO manda; sin nada que sirva, null", () => {
  const d = carpeta();
  const f = path.join(d, "t.json");
  writeFileSync(f, JSON.stringify({ version: 1, fuente: "https://x.test", fecha: "2030-01-01", modelos: [{ id: "solo-uno", nombre: "Solo uno", go: { pedidos_5h: 1, usd_mes: 2 }, "go-plus": { pedidos_5h: 3, usd_mes: 4 } }] }));
  assert.deepEqual(cargarTablaGo({ HILOS_OPENCODE_GO: f }, d)!.modelos.map((m) => m.slug), ["solo-uno"]);
  writeFileSync(f, "roto");
  // Cae a la tabla del repo (junto a esta app).
  assert.equal(cargarTablaGo({ HILOS_OPENCODE_GO: f }, d)!.modelos.length, 11);
});

test("ofertasGo: sin plan Go no se ofrece nada; con plan, los de la tabla (o los que opencode listó, con su id)", () => {
  const t = cargarTablaGo({ HILOS_STATE: carpeta() })!;
  assert.deepEqual(ofertasGo("gratis", t), []);
  assert.deepEqual(ofertasGo("go", null), [], "sin tabla no se inventa");
  const todos = ofertasGo("go", t);
  assert.equal(todos.length, 11);
  assert.ok(todos.every((o) => o.id.startsWith("opencode-go/") && o.topes !== null));
  assert.deepEqual(todos.find((o) => o.id === "opencode-go/kimi-k3.1-pro")!.topes, { pedidos5h: 147, usdMes: 15 });
  assert.deepEqual(ofertasGo("go-plus", t).find((o) => o.id === "opencode-go/kimi-k3.1-pro")!.topes, { pedidos5h: 588, usdMes: 60 });
  // opencode ya listó modelos de Go: sólo esos, con el id que listó (slug distinto, mismo modelo).
  const listados = ["opencode/big-pickle", "opencode-go/DeepSeek-V4.1-Flash", "opencode-go/otro-que-no-esta-en-la-tabla"];
  assert.deepEqual(ofertasGo("go", t, listados).map((o) => o.id), ["opencode-go/DeepSeek-V4.1-Flash"]);
  assert.equal(normalizarSlug("opencode:opencode-go/Kimi_K3.1-Pro"), normalizarSlug("kimi-k3.1-pro"));
});

test("elegibles: sin plan Go todo como antes; con plan, los de Go van después de los gratis y reemplazan a los opencode-go sueltos", () => {
  const t = cargarTablaGo({ HILOS_STATE: carpeta() })!;
  const todos = ["opencode/gpt-5", "opencode/big-pickle", "opencode/beam-free", "opencode-go/glm-5.3-flash", "anthropic/claude-x"];
  const antes = elegibles(todos, ["opencode-go"]);
  assert.deepEqual(antes, ["opencode/big-pickle", "opencode/beam-free", "opencode/gpt-5", "opencode-go/glm-5.3-flash"], "gratis: igual que siempre");
  assert.deepEqual(elegibles(todos, ["opencode-go"], "gratis", t), antes);
  const con = elegibles(todos, [], "go", t);
  assert.deepEqual(con.slice(0, 2), ["opencode/big-pickle", "opencode/beam-free"]);
  assert.deepEqual(con.slice(2), ["opencode-go/glm-5.3-flash", "opencode/gpt-5"], "sólo los de la tabla que opencode lista; el resto de Zen al final");
  const sinListado = elegibles(["opencode/big-pickle"], [], "go-plus", t);
  assert.equal(sinListado.length, 12, "sin modelos de Go listados: los 11 de la tabla");
});

test("el plan: gratis por defecto; guardarPlanOpencode escribe en modelos.json sin perder nada y gratis saca la clave", async () => {
  const d = carpeta();
  const env = { TRAMA_MODELOS: path.join(d, "modelos.json") };
  assert.equal(planOpencode(env, d), "gratis");
  // Sin archivo y elegir gratis: no se crea nada.
  assert.equal(await guardarPlanOpencode("gratis", env, d), "gratis");
  assert.throws(() => readFileSync(env.TRAMA_MODELOS), /ENOENT/);
  // Un plan crea el archivo mínimo.
  assert.equal(await guardarPlanOpencode("go", env, d), "go");
  assert.deepEqual(JSON.parse(readFileSync(env.TRAMA_MODELOS, "utf8")), { version: 1, opencode_plan: "go" });
  assert.equal(planOpencode(env, d), "go");
  // Con otras claves: quedan como estaban.
  writeFileSync(env.TRAMA_MODELOS, JSON.stringify({ version: 1, excluir: ["fable"], calidad: { opus: 99 }, desconocida: { a: 1 } }));
  await guardarPlanOpencode("go-plus", env, d);
  assert.deepEqual(JSON.parse(readFileSync(env.TRAMA_MODELOS, "utf8")), { version: 1, excluir: ["fable"], calidad: { opus: 99 }, desconocida: { a: 1 }, opencode_plan: "go-plus" });
  assert.equal(planOpencode(env, d), "go-plus");
  await guardarPlanOpencode("gratis", env, d);
  assert.deepEqual(JSON.parse(readFileSync(env.TRAMA_MODELOS, "utf8")), { version: 1, excluir: ["fable"], calidad: { opus: 99 }, desconocida: { a: 1 } });
  // Un plan que no existe, o un archivo roto / de otra versión: rechaza sin escribir.
  await assert.rejects(guardarPlanOpencode("platino", env, d), /opencodePlan/);
  writeFileSync(env.TRAMA_MODELOS, "{roto");
  await assert.rejects(guardarPlanOpencode("go", env, d));
  assert.equal(readFileSync(env.TRAMA_MODELOS, "utf8"), "{roto");
  writeFileSync(env.TRAMA_MODELOS, JSON.stringify({ version: 1, opencode_plan: "oro" }));
  assert.equal(planOpencode(env, d), "gratis", "un valor desconocido es gratis");
});

test("vistaPlanGo: topes del plan elegido; el uso real no está disponible (OpenCode no lo expone)", () => {
  const d = carpeta();
  const env = { TRAMA_MODELOS: path.join(d, "m.json") };
  writeFileSync(env.TRAMA_MODELOS, JSON.stringify({ version: 1, opencode_plan: "go-plus" }));
  const v = vistaPlanGo(env, d);
  assert.equal(v.plan, "go-plus");
  assert.equal(v.fuente, "https://opencode.ai/go");
  assert.equal(v.usoDisponible, false);
  assert.deepEqual(v.modelos.find((m) => m.id === "opencode-go/minimax-m3")!, { id: "opencode-go/minimax-m3", nombre: "MiniMax M3", pedidos5h: 9600, usdMes: 180 });
  assert.equal(v.precio, 40);
  writeFileSync(env.TRAMA_MODELOS, JSON.stringify({ version: 1 }));
  const g = vistaPlanGo(env, d);
  assert.equal(g.plan, "gratis");
  assert.equal(g.modelos.find((m) => m.id === "opencode-go/minimax-m3")!.pedidos5h, 3200, "sin plan se ve lo de Go");
  assert.equal(g.precio, 10);
});

test("cupo por modelo: un 429 de un modelo de Go marca SÓLO a ese modelo (5 h); opencode-free no se toca, y al revés", () => {
  const dir = carpeta();
  const env = { REPARTO_STATE: dir } as NodeJS.ProcessEnv;
  const ahora = Date.parse("2026-10-27T10:00:00Z");
  assert.ok(esModeloGo("opencode:opencode-go/deepseek-v4.1-flash") && esModeloGo("opencode-go/x") && !esModeloGo("opencode:opencode/big-pickle") && !esModeloGo("dsh:opencode-go/x"));
  assert.equal(marcarModeloGoAgotado("opencode:opencode/big-pickle", undefined, env, ahora), null, "un gratis no es de Go");
  const hasta = marcarModeloGoAgotado("opencode:opencode-go/DeepSeek-V4.1-Flash", undefined, env, ahora)!;
  assert.equal(hasta, ahora + 5 * 3600_000);
  const f = JSON.parse(readFileSync(path.join(dir, "agotado.json"), "utf8"));
  assert.deepEqual(Object.keys(f), ["opencode:opencode-go/deepseek-v4.1-flash"], "el grupo es el modelo, no opencode-free");
  assert.equal(f["opencode:opencode-go/deepseek-v4.1-flash"].hasta, "2026-10-27T15:00:00Z");
  assert.equal(opencodeAgotadoHasta(env, ahora + 1000), null, "los gratis siguen libres");
  assert.deepEqual(modelosGoAgotados(env, ahora + 1000), { "opencode:opencode-go/deepseek-v4.1-flash": hasta });
  assert.deepEqual(modelosGoAgotados(env, hasta + 1), {}, "vencido");
  // Los gratis agotados no marcan a los de Go.
  marcarOpencodeAgotado(undefined, env, ahora);
  const g = JSON.parse(readFileSync(path.join(dir, "agotado.json"), "utf8"));
  assert.deepEqual(Object.keys(g).sort(), [GRUPO_OPENCODE_GRATIS, "opencode:opencode-go/deepseek-v4.1-flash"].sort());
  assert.deepEqual(Object.keys(modelosGoAgotados(env, ahora + 1000)), ["opencode:opencode-go/deepseek-v4.1-flash"]);
  assert.equal(grupoModeloGo("opencode-go/Kimi-K3.1-Pro"), "opencode:opencode-go/kimi-k3.1-pro");
});

test("el selector: sólo el modelo de Go agotado lleva el rótulo; los gratis agotados no arrastran a los de Go", () => {
  const ops = [
    { id: "opencode:opencode/big-pickle", nombre: "BP", desc: "", grupo: "OpenCode" },
    { id: "opencode:opencode-go/deepseek-v4.1-flash", nombre: "DS", desc: "", grupo: "OpenCode" },
    { id: "opencode:opencode-go/kimi-k3.1-pro", nombre: "Kimi", desc: "", grupo: "OpenCode" },
  ];
  const uso: any = { version: 1, suscripciones: [{ id: "opencode", nombre: "OpenCode", ts: 0, grupos: [{ id: "opencode:opencode-go/deepseek-v4.1-flash", nombre: "x", ventanas: [], agotado: 5000 }] }] };
  assert.deepEqual([...goAgotadosHasta(uso, 1000)], [["opencode:opencode-go/deepseek-v4.1-flash", 5000]]);
  assert.equal(goAgotadosDe(uso, 6000).size, 0);
  const r = marcarAgotadas(ops, null, 1000, goAgotadosDe(uso, 1000));
  assert.deepEqual(r.map((o) => !!(o as any).agotada), [false, true, false]);
  const ambos = marcarAgotadas(ops, 9000, 1000, goAgotadosDe(uso, 1000));
  assert.deepEqual(ambos.map((o) => !!(o as any).agotada), [true, true, false]);
  assert.equal(marcarAgotadas(ops, null, 1000), ops, "nada que marcar: la misma lista");
  assert.ok(esAvisoSinCupoOpencode("\u0001i18n:main.opencodeGoSinCupo\u0001{}\u0001"));
});

test("el selector de modelos: con el plan Go los de Go dicen «Plan Go» (con texto); sin plan, como siempre", () => {
  try {
    const modelos = ["opencode/big-pickle", "opencode-go/deepseek-v4.1-flash", "opencode/gpt-5"];
    ponerConfig({ gemini: false, opencode: modelos, locales: [], llama: [], lider: null });
    const sin = TABLA.filter((m) => m.empresa === "opencode");
    assert.deepEqual(sin.map((m) => m.nombre), ["Big Pickle · Gratis", "DeepSeek V4.1 Flash · opencode-go", "GPT 5 · Zen"]);
    assert.ok(sin.every((m) => !m.go));
    ponerConfig({ gemini: false, opencode: modelos, opencodePlan: "go", locales: [], llama: [], lider: null });
    const con = TABLA.filter((m) => m.empresa === "opencode");
    assert.deepEqual(con.map((m) => m.nombre), ["Big Pickle · Gratis", "DeepSeek V4.1 Flash · Plan Go", "GPT 5 · Zen"]);
    assert.deepEqual(con.map((m) => !!m.go), [false, true, false]);
    assert.equal(con[1]!.desc, "modelo.opencodeGo");
    assert.ok(!con[1]!.gratis, "no es «Gratis»");
    assert.ok(esGoOpencode("opencode:opencode-go/x") && !esGoOpencode("opencode:opencode/x"));
  } finally {
    ponerConfig(null);
  }
});

test("el plan viaja al renderer sólo si está prendido", () => {
  const v = (plan: string) => vistaModelos(null, false, [], false, ["opencode/big-pickle"], {}, plan) as any;
  assert.equal(v("gratis").opencodePlan, undefined);
  assert.equal(v("go").opencodePlan, "go");
  assert.equal(v("go-plus").opencodePlan, "go-plus");
});

// --- El 402 de «GPT-6 Luna» sin plan: es el modelo chico de opencode, no Trama ---------------------------------------------------------

test("sin Go, el modelo chico (título y resumen de sesión) se fija en uno gratis; con Go o con config propia, no se toca", () => {
  const d = carpeta();
  const base = { TRAMA_MODELOS: path.join(d, "m.json"), XDG_CONFIG_HOME: path.join(d, "cfg"), XDG_DATA_HOME: path.join(d, "datos") } as Record<string, string | undefined>;
  const chico = (env: Record<string, string | undefined>) => JSON.parse(conModeloChico(env, d).OPENCODE_CONFIG_CONTENT ?? "{}").small_model;
  assert.equal(chico(base), MODELO_CHICO_GRATIS);
  assert.ok(MODELO_CHICO_GRATIS.startsWith("opencode/") && MODELO_CHICO_GRATIS.endsWith("-free"), "gratis");
  // Con Go activo: opencode elige como siempre.
  writeFileSync(base.TRAMA_MODELOS!, JSON.stringify({ version: 1, opencode_plan: "go" }));
  assert.equal(chico(base), undefined);
  writeFileSync(base.TRAMA_MODELOS!, JSON.stringify({ version: 1 }));
  // Su propio small_model en su opencode.json(c).
  mkdirSync(path.join(d, "cfg", "opencode"), { recursive: true });
  writeFileSync(path.join(d, "cfg", "opencode", "opencode.jsonc"), '{ // mío\n "small_model": "anthropic/claude-haiku" }');
  assert.equal(chico(base), undefined);
  rmSync(path.join(d, "cfg", "opencode", "opencode.jsonc"));
  // Otro proveedor conectado: no se toca.
  mkdirSync(path.join(d, "datos", "opencode"), { recursive: true });
  writeFileSync(path.join(d, "datos", "opencode", "auth.json"), JSON.stringify({ anthropic: { type: "api", key: "NO-SE-LOGUEA" } }));
  assert.equal(chico(base), undefined);
  writeFileSync(path.join(d, "datos", "opencode", "auth.json"), JSON.stringify({ opencode: { type: "api", key: "NO-SE-LOGUEA" } }));
  assert.equal(chico(base), MODELO_CHICO_GRATIS, "sólo OpenCode Console: el caso del 402");
  // Un OPENCODE_CONFIG_CONTENT previo se completa, no se pisa; con small_model propio, queda.
  const previo = conModeloChico({ ...base, OPENCODE_CONFIG_CONTENT: JSON.stringify({ autoupdate: false }) }, d).OPENCODE_CONFIG_CONTENT!;
  assert.deepEqual(JSON.parse(previo), { autoupdate: false, small_model: MODELO_CHICO_GRATIS });
  assert.equal(chico({ ...base, OPENCODE_CONFIG_CONTENT: JSON.stringify({ small_model: "x/y" }) }), "x/y");
  assert.equal(conModeloChico({ ...base, OPENCODE_CONFIG_CONTENT: "{roto" }, d).OPENCODE_CONFIG_CONTENT, "{roto");
});

test("el runner de workers (motor/opencode/config.mjs) dice lo mismo que la app (electron/opencode.ts)", () => {
  const d = carpeta();
  const env = { TRAMA_MODELOS: path.join(d, "m.json"), XDG_CONFIG_HOME: path.join(d, "cfg"), XDG_DATA_HOME: path.join(d, "datos") };
  for (const id of ["opencode:opencode-go/x", "opencode-go/x", "opencode:opencode/big-pickle", "dsh:opencode-go/x"]) assert.equal(motor.esModeloGo(id), esModeloGo(id), id);
  for (const plan of [undefined, "gratis", "go", "go-plus", "oro"]) {
    writeFileSync(env.TRAMA_MODELOS, JSON.stringify({ version: 1, ...(plan ? { opencode_plan: plan } : {}) }));
    assert.equal(motor.planOpencode(env, d), planOpencode(env, d), String(plan));
    assert.equal(motor.conModeloChico(env, d).OPENCODE_CONFIG_CONTENT, conModeloChico(env, d).OPENCODE_CONFIG_CONTENT, String(plan));
  }
  assert.equal(motor.MODELO_CHICO_GRATIS, MODELO_CHICO_GRATIS);
  assert.equal(motor.VENCE_GO_MS, 5 * 3600_000);
});

test("el runner de workers: un modelo de Go cuesta 0 (plan fijo) y un 429 dice que se acabó el cupo de ESE modelo", () => {
  const paso = { type: "step_finish", part: { reason: "stop", cost: 0.37, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } } };
  const texto = { type: "text", part: { text: "listo" } };
  const modelo = "opencode:opencode-go/deepseek-v4.1-flash";
  const bien = aResultado({ eventos: [texto, paso], modelo, rc: 0, stderr: "", segundos: 2, gratis: motor.esModeloGo(modelo) });
  assert.equal(bien.total_cost_usd, 0, "no se cobra por token: es un plan");
  assert.equal(bien.is_error, false);
  const mal = aResultado({ eventos: [{ type: "error", error: { name: "APIError", data: { message: "Too Many Requests", statusCode: 429 } } }], modelo, rc: 1, stderr: "", segundos: 1, gratis: true });
  assert.equal(mal.is_error, true);
  assert.match(mal.result, /OpenCode Go: se acabó el cupo de 5 h de opencode:opencode-go\/deepseek-v4\.1-flash \(los demás modelos de Go siguen\)/);
  const gratis = aResultado({ eventos: [{ type: "error", error: { name: "FreeUsageLimitError", data: { message: "429", statusCode: 429 } } }], modelo: "opencode:opencode/big-pickle", rc: 1, stderr: "", segundos: 1, gratis: true });
  assert.match(gratis.result, /OpenCode cortó por límite de uso/, "los gratis siguen con su mensaje");
});
