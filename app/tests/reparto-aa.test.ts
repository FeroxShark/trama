// Inteligencia de Artificial Analysis en `reparto` (motor/bin/reparto): el emparejamiento de nombres (aa_tokens / aa_buscar), la conversión de la escala vieja
// 0-100 a unidades de AA (vieja_a_aa, sin calibración), y la precedencia en `--tabla`: modelos.json (usuario) > Artificial Analysis > defaults > estimada,
// con `origen` y `aa_fecha`. Todo con un archivo de caché falso (REPARTO_AA): no mira la red ni el estado real.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-aa-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const arch = (j: object | string) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, typeof j === "string" ? j : JSON.stringify(j));
  return f;
};

/** Corre un trozo de Python con `reparto` cargado como módulo (`R`); imprime JSON. */
function py(codigo: string, env: Record<string, string> = {}) {
  const prog = `import importlib.machinery, importlib.util, json, sys
sys.dont_write_bytecode = True
l = importlib.machinery.SourceFileLoader("reparto", ${JSON.stringify(REPARTO)})
sp = importlib.util.spec_from_loader("reparto", l)
R = importlib.util.module_from_spec(sp); l.exec_module(R)
${codigo}`;
  const r = spawnSync("python3", ["-B", "-c", prog], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...env } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const M = (name: string, coding: number | null, agentic: number | null, intelligence = 50, slug = "") => ({ name, slug: slug || name.toLowerCase().replace(/[^a-z0-9.]+/g, "-"), creator: "x", intelligence, coding, agentic });
const AA = {
  version: 1,
  fetched: "2026-10-25T08:00:00Z",
  modelos: [
    M("Claude Opus 5.5 (Reasoning)", 66, 64, 70),
    M("Claude Opus 5.5 (Non-reasoning)", 50, 40, 60),
    M("Claude Sonnet 5.5", 56, 54, 62),
    M("Claude Haiku 5.5", 40, 38, 52),
    M("Gemini 3.8 Flash", 44, 46),
    M("GLM-5.3 Flash", 42, null, 45),
    M("DeepSeek V4.1 Flash", 48, 50),
    M("GPT-OSS 120B", 33, 31),
    M("Nemotron 3 Ultra", null, null, 47),
    M("Kimi K3 Max", 60, 60),
    M("Qwen3 Coder 30B A3B", 30, 28),
  ],
};

test("aa_tokens: prefijos, paréntesis, free, esfuerzo, versiones con guion y puntuación", () => {
  const tk = (s: string) => py(`print(json.dumps(R.aa_tokens(${JSON.stringify(s)})))`) as string[];
  assert.deepEqual(tk("claude-opus-5-5"), ["claude", "opus", "5.5"]);
  assert.deepEqual(tk("Claude Opus 5.5"), ["claude", "opus", "5.5"]);
  assert.deepEqual(tk("agy:claude-opus-5-5-high"), ["claude", "opus", "5.5"]);
  assert.deepEqual(tk("opencode:opencode/glm-5.3-flash-free"), ["glm", "5.3", "flash"]);
  assert.deepEqual(tk("opencode:opencode/glm-5.3-flash-free (OpenCode, gratis)"), ["glm", "5.3", "flash"]);
  assert.deepEqual(tk("dsh:deepseek/deepseek-v4.1-flash"), ["deepseek", "v4.1", "flash"]);
  assert.deepEqual(tk("DeepSeek V4.1 Flash"), ["deepseek", "v4.1", "flash"]);
  assert.deepEqual(tk("gemini-3.8-flash"), ["gemini", "3.8", "flash"]);
  assert.deepEqual(tk("Gemini 3.8 Flash (Preview)"), ["gemini", "3.8", "flash"]);
  assert.deepEqual(tk("codex:gpt-6.1-sol-xhigh"), ["gpt", "6.1", "sol"]);
  assert.deepEqual(tk("agy:gpt-oss-120b"), ["gpt", "oss", "120b"]);
  assert.deepEqual(tk("dsh:ollama/qwen3-coder:30b"), ["qwen3", "coder", "30b"]);
  assert.deepEqual(tk("  GLM_5.3  Flash!! "), ["glm", "5.3", "flash"]);
  assert.deepEqual(tk("Kimi K3 Max"), ["kimi", "k3", "max"], "max sólo se saca como esfuerzo si hace falta: no es un sufijo de esfuerzo acá");
  assert.deepEqual(tk(""), []);
  assert.deepEqual(tk("(solo paréntesis)"), []);
});

test("aa_buscar: exacto normalizado primero, después los mismos tokens en otro orden; nada de parecidos", () => {
  const f = arch(AA);
  const q = (id: string) => py(`aa = R.aa_cargar()\nprint(json.dumps(R.aa_calidad(aa, ${JSON.stringify(id)})))`, { REPARTO_AA: f }) as [number, string] | null;
  assert.equal(q("claude-haiku-5-5")![1], "Claude Haiku 5.5");
  assert.equal(q("agy:claude-sonnet-5-5")![1], "Claude Sonnet 5.5");
  assert.equal(q("gemini-3.8-flash")![1], "Gemini 3.8 Flash");
  assert.equal(q("opencode:opencode/glm-5.3-flash-free")![1], "GLM-5.3 Flash");
  assert.equal(q("dsh:opencode/deepseek-v4.1-flash-free")![1], "DeepSeek V4.1 Flash");
  assert.equal(q("dsh:deepseek/deepseek-v4.1-flash")![1], "DeepSeek V4.1 Flash");
  assert.equal(q("agy:gpt-oss-120b")![1], "GPT-OSS 120B");
  assert.equal(q("flash-3.8-gemini")![1], "Gemini 3.8 Flash", "mismos tokens en otro orden");
  assert.equal(q("dsh:ollama/qwen3-coder:30b"), null, "30b no es 30b-a3b: sin parecidos");
  assert.equal(q("opencode:opencode/glm-5.3-flash")![1], "GLM-5.3 Flash", "con o sin -free es el mismo modelo");
  assert.equal(q("claude-opus-5"), null, "5 no es 5.5");
  assert.equal(q("opencode:opencode/big-pickle"), null);
  assert.equal(q("opencode:opencode/glm-5.3"), null, "faltan tokens: no se adivina");
  assert.equal(q("opencode:opencode/glm-5.3-flash-lite-free"), null, "sobran tokens: no se adivina");
  assert.equal(q(""), null);
});

test("Reasoning y Non-reasoning del mismo modelo: gana el de más puntaje; también se empareja por slug", () => {
  const f = arch(AA);
  const r = py(`aa = R.aa_cargar()\nprint(json.dumps([R.aa_buscar(aa, "claude-opus-5-5")[0], R.aa_buscar(aa, "kimi-k3-max")[0]]))`, { REPARTO_AA: f });
  assert.deepEqual(r, [65, 60]);
  const g = arch({ ...AA, modelos: [...AA.modelos, M("Zeta (high)", 30, 30, 30, "zeta-ultra-free")] });
  const z = py(`aa = R.aa_cargar()\nprint(json.dumps(R.aa_buscar(aa, "opencode:opencode/zeta-ultra-free")))`, { REPARTO_AA: g });
  assert.equal(z[0], 30);
});

test("puntaje: promedio de coding y agentic; con uno solo ése; sin ninguno, la inteligencia; sin nada no entra", () => {
  const p = (m: object) => py(`print(json.dumps(R.aa_puntaje(json.loads(${JSON.stringify(JSON.stringify(m))}))))`);
  assert.equal(p({ coding: 60, agentic: 40, intelligence: 99 }), 50);
  assert.equal(p({ coding: 60, agentic: null, intelligence: 99 }), 60);
  assert.equal(p({ coding: null, agentic: 44, intelligence: 99 }), 44);
  assert.equal(p({ coding: null, agentic: null, intelligence: 47 }), 47);
  assert.equal(p({ coding: null, agentic: null, intelligence: null }), null);
  assert.equal(p({ coding: true, agentic: "a" }), null);
});

test("unidades reales de AA, sin calibración: el puntaje de un modelo es su promedio crudo, sin techo ni anclas", () => {
  const f = arch(AA);
  const t = py(`aa = R.aa_cargar()\nprint(json.dumps({m: R.aa_calidad(aa, m)[0] for m in ["claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-5-5", "opencode:opencode/glm-5.3-flash-free", "opencode:opencode/nemotron-3-ultra-free"]}))`, { REPARTO_AA: f });
  assert.equal(t["claude-opus-5-5"], 65, "(66 + 64) / 2, no 100");
  assert.equal(t["claude-haiku-5-5"], 39);
  assert.equal(t["claude-sonnet-5-5"], 55);
  assert.equal(t["opencode:opencode/glm-5.3-flash-free"], 42, "sólo coding: ése");
  assert.equal(t["opencode:opencode/nemotron-3-ultra-free"], 47, "sólo inteligencia general: respaldo, tal cual");
  const alto = arch({ ...AA, modelos: [...AA.modelos, M("Supermodelo 9", 200, 200)] });
  assert.equal(py(`aa = R.aa_cargar()\nprint(json.dumps(R.aa_calidad(aa, "supermodelo-9")[0]))`, { REPARTO_AA: alto }), 200, "sin techo de 100");
  const bajo = arch({ ...AA, modelos: [...AA.modelos, M("Piso 1", -5, -5)] });
  assert.equal(py(`aa = R.aa_cargar()\nprint(json.dumps(R.aa_calidad(aa, "piso-1")[0]))`, { REPARTO_AA: bajo }), 0, "nunca negativa");
});

test("vieja_a_aa: la inversa de la calibración vieja (Haiku 60, Sonnet 88, Opus 100 → 43, 51, 58), por tramos y extrapolando bajo Haiku", () => {
  const v = (xs: number[]) => py(`print(json.dumps([R.vieja_a_aa(x) for x in ${JSON.stringify(xs)}]))`) as number[];
  assert.deepEqual(v([60, 88, 100]), [43, 51, 58], "las anclas clavadas");
  assert.deepEqual(v([74, 94]), [47, 54.5], "a mitad de cada tramo");
  assert.deepEqual(v([40, 35]), [37.3, 35.9], "bajo Haiku sigue con la pendiente Haiku-Sonnet");
  assert.equal(v([0])[0], 25.9);
  assert.equal(v([-500])[0], 0, "nunca negativa");
  const m = v([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.deepEqual([...m].sort((a, b) => a - b), m, "crece con la escala vieja");
});

test("caché rota, vacía, sin modelos o apagada: reparto sigue con los defaults; con modelos sin ninguna familia de referencia igual hay índice", () => {
  for (const f of [arch("{roto"), arch({ version: 1 }), arch({ version: 1, fetched: "2026-10-25T08:00:00Z", modelos: [] }), path.join(tmp, "no-hay.json"), "0"]) {
    assert.equal(py(`print(json.dumps(R.aa_cargar()))`, { REPARTO_AA: f }), null);
  }
  const sin = arch({ version: 1, fetched: "2026-10-25T08:00:00Z", modelos: [M("GLM-5.3 Flash", 42, 40)] });
  assert.equal(py(`aa = R.aa_cargar()\nprint(json.dumps(R.aa_calidad(aa, "glm-5.3-flash")[0]))`, { REPARTO_AA: sin }), 41, "ya no hacen falta anclas");
});

// --- --tabla -------------------------------------------------------------------------------------------------
const AHORA = "2026-10-26T12:00:00Z";
const cuposF = arch({ version: 1, leido: AHORA, suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: 0.2, vuelve: "2026-10-26T14:00:00Z" }, { id: "7d", usado: 0.3, vuelve: "2026-10-27T00:00:00Z" }] }] });
type Fila = { id: string; calidad: number; estimada: boolean; origen: string; aa_fecha: string | null };
function tabla(aa: string | undefined, modelos?: object) {
  const mod = arch({ version: 1, ...(modelos ?? {}) });
  const r = spawnSync(REPARTO, ["--tabla", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      REPARTO_CUPOS_FIJOS: cuposF,
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":["qwen3-coder:30b"],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/big-pickle","opencode/zeta-ultra-free","opencode/glm-5.3-flash-free","opencode/nemotron-3-ultra-free"]',
      REPARTO_AGY: "0",
      REPARTO_STATE: path.join(tmp, "estado"),
      REPARTO_AA: aa ?? "0",
      TRAMA_MODELOS: mod,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return Object.fromEntries((JSON.parse(r.stdout).modelos as Fila[]).map((m) => [m.id, m]));
}

test("--tabla sin caché de AA: origen defecto o estimada, sin fecha; el resto de los campos igual que siempre", () => {
  const t = tabla(undefined);
  assert.deepEqual([t["claude-opus-5-5"].origen, t["claude-opus-5-5"].calidad, t["claude-opus-5-5"].aa_fecha], ["defecto", 58, null], "el 100 de la escala vieja = 58 en unidades de AA");
  assert.deepEqual([t["opencode:opencode/zeta-ultra-free"].origen, t["opencode:opencode/zeta-ultra-free"].estimada], ["estimada", true]);
  assert.equal(t["opencode:opencode/glm-5.3-flash-free"].origen, "defecto");
});

test("--tabla con AA: lo medido pisa defaults y estimaciones; lo que AA no conoce sigue como estaba; lleva la fecha del dato", () => {
  const t = tabla(arch(AA));
  assert.deepEqual([t["claude-opus-5-5"].origen, t["claude-opus-5-5"].calidad, t["claude-opus-5-5"].aa_fecha], ["artificial-analysis", 65, "2026-10-25"]);
  assert.equal(t["claude-haiku-5-5"].calidad, 39);
  assert.equal(t["claude-sonnet-5-5"].origen, "artificial-analysis");
  assert.equal(t["claude-sonnet-5-5"].calidad, 55);
  assert.equal(t["opencode:opencode/glm-5.3-flash-free"].calidad, 42, "defecto 55 viejo (41,6) → medido 42");
  assert.equal(t["opencode:opencode/glm-5.3-flash-free"].estimada, false);
  // Nemotron 3 Ultra: sólo trae inteligencia (47): sirve de reserva y estaba en defecto 55
  assert.equal(t["opencode:opencode/nemotron-3-ultra-free"].origen, "artificial-analysis");
  // AA no lo conoce: se queda con su defecto / su estimación por el nombre
  assert.deepEqual([t["opencode:opencode/big-pickle"].origen, t["opencode:opencode/big-pickle"].calidad], ["defecto", 43]);
  assert.deepEqual([t["opencode:opencode/zeta-ultra-free"].origen, t["opencode:opencode/zeta-ultra-free"].estimada], ["estimada", true]);
  // el local de Ollama: 30b no es 30b-a3b → sigue en su defecto de 35
  assert.deepEqual([t["dsh:ollama/qwen3-coder:30b"].origen, t["dsh:ollama/qwen3-coder:30b"].calidad], ["defecto", 35.9]);
});

test("--tabla: lo que fija el dueño en modelos.json gana a AA (por familia, por id exacto y por patrón), y lo demás sigue midiéndose", () => {
  // Sin "calidad_unidades": "aa" son números de la escala vieja y se migran al leer (vieja_a_aa): 90 → 52.2, 12 → 29.3, 77 → 47.9.
  const t = tabla(arch(AA), { calidad: { opus: 90, "opencode:opencode/glm-5.3-flash-free": 12, "opencode:opencode/nemotron-*": 77 } });
  assert.deepEqual([t["claude-opus-5-5"].origen, t["claude-opus-5-5"].calidad, t["claude-opus-5-5"].aa_fecha], ["usuario", 52.2, null]);
  assert.deepEqual([t["opencode:opencode/glm-5.3-flash-free"].origen, t["opencode:opencode/glm-5.3-flash-free"].calidad], ["usuario", 29.3]);
  assert.deepEqual([t["opencode:opencode/nemotron-3-ultra-free"].origen, t["opencode:opencode/nemotron-3-ultra-free"].calidad], ["usuario", 47.9]);
  assert.equal(t["claude-haiku-5-5"].origen, "artificial-analysis");
  assert.equal(t["claude-haiku-5-5"].calidad, 39, "lo que fija el dueño no mueve a los demás: no hay calibración");
  // Con "calidad_unidades": "aa" valen tal cual.
  const n = tabla(arch(AA), { calidad_unidades: "aa", calidad: { opus: 52, "opencode:opencode/nemotron-*": 44 } });
  assert.deepEqual([n["claude-opus-5-5"].origen, n["claude-opus-5-5"].calidad, n["opencode:opencode/nemotron-3-ultra-free"].calidad], ["usuario", 52, 44]);
});

test("migración de calidad_effort y minimo_por_tipo numérico: escala vieja → AA al leer; con calidad_unidades aa, tal cual", () => {
  const leer = (mod: object) => py(`cfg = R.cargar_config()\nprint(json.dumps({"ce": cfg["calidad_effort_usuario"], "min": cfg["minimo_por_tipo"]["lectura"], "q": cfg["calidad"]["opus"]}))`,
    { REPARTO_AA: "0", TRAMA_MODELOS: arch({ version: 1, ...mod }), REPARTO_STATE: path.join(tmp, "estado") }) as { ce: Record<string, Record<string, number>>; min: number | string; q: number };
  const v = leer({ calidad: { opus: 100 }, calidad_effort: { opus: { low: 60, high: 88 } }, minimo_por_tipo: { lectura: 74 } });
  assert.deepEqual([v.q, v.ce.opus, v.min], [58, { low: 43, high: 51 }, 47]);
  const n = leer({ calidad_unidades: "aa", calidad: { opus: 100 }, calidad_effort: { opus: { low: 60, high: 88 } }, minimo_por_tipo: { lectura: 74 } });
  assert.deepEqual([n.q, n.ce.opus, n.min], [100, { low: 60, high: 88 }, 74]);
  assert.equal(leer({}).min, "haiku", "los mínimos por familia no se tocan");
});

test("--tabla: un valor de usuario que coincide con el default sigue siendo del usuario", () => {
  const t = tabla(undefined, { calidad: { haiku: 60 } });
  assert.equal(t["claude-haiku-5-5"].origen, "usuario");
  assert.equal(t["claude-haiku-5-5"].calidad, 43);
});

// --- calidad por effort ---------------------------------------------------------------------------------------
const ME = (name: string, v: number) => M(name, v, v);
const AA_EF = {
  version: 1,
  fetched: "2026-10-25T08:00:00Z",
  modelos: [
    ME("Claude Opus 5.5 (Reasoning, low)", 50),
    ME("Claude Opus 5.5 (Reasoning, high)", 60),
    ME("Claude Opus 5.5 (Reasoning, max)", 66),
    ME("Claude Opus 5.5 (Non-reasoning)", 30),
    ME("Claude Sonnet 5.5", 56),
    ME("Claude Haiku 5.5", 40),
  ],
};
type FilaEf = Fila & { calidad_por_effort: Record<string, number> };
const tablaEf = (aa: string, modelos?: object) => tabla(aa, modelos) as unknown as Record<string, FilaEf>;

test("aa_esfuerzo: sale de paréntesis y de sufijos del slug; Non-reasoning es none; la entrada pelada no dice", () => {
  const e = (name: string, slug = "") => py(`print(json.dumps(R.aa_esfuerzo({"name": ${JSON.stringify(name)}, "slug": ${JSON.stringify(slug)}})))`) as string | null;
  assert.equal(e("Claude Opus 5.5 (Reasoning, high)"), "high");
  assert.equal(e("Claude Opus 5.5 (xhigh)"), "xhigh");
  assert.equal(e("Claude Opus 5.5", "claude-opus-5-5-low"), "low");
  assert.equal(e("Claude Opus 5.5 (Non-reasoning)"), "none");
  assert.equal(e("Claude Opus 5.5"), null);
  assert.equal(e("Claude Opus 5.5 (Reasoning)"), "high", "Reasoning sin nivel = el effort por defecto (high)");
});

test("--tabla expone calidad_por_effort cruda; calidad es la del esfuerzo que se usaría (high), nunca la del máximo; low < high", () => {
  const t = tablaEf(arch(AA_EF));
  const o = t["claude-opus-5-5"];
  assert.deepEqual(o.calidad_por_effort, { low: 50, high: 60, max: 66 }, "medium desconocido no se inventa en el mapa; none no entra");
  assert.equal(o.calidad, 60, "high, no el 66 del max");
  assert.equal((o as unknown as { effort_usado: string }).effort_usado, "high");
  assert.equal(t["claude-sonnet-5-5"].calidad, 56);
  assert.deepEqual(t["claude-sonnet-5-5"].calidad_por_effort, { high: 56 }, "entrada pelada de claude = el effort por defecto (high)");
});

test("calidad_en_effort: el medido, interpolado entre vecinos, el extremo más cercano, o la mejor sin mapa", () => {
  const q = (mapa: object, ef: string, base: number) => py(`print(json.dumps(R.calidad_en_effort(${JSON.stringify(mapa)}, ${JSON.stringify(ef)}, ${base})))`);
  const m = { low: 80, high: 96, max: 100 };   // los números de este test son sólo de la interpolación
  assert.equal(q(m, "low", 100), 80);
  assert.equal(q(m, "medium", 100), 88, "entre low (80) y high (96)");
  assert.equal(q(m, "xhigh", 100), 98, "entre high (96) y max (100)");
  assert.equal(q({ high: 96 }, "low", 100), 96, "sin vecino por debajo: el más cercano");
  assert.equal(q({}, "low", 100), 100);
  assert.equal(q(m, "raro", 100), 100);
});

test("--tipo con effort low usa la calidad de low; la del dueño por familia vale para todos los efforts salvo el que fija por effort", () => {
  const f = arch(AA_EF);
  const pick = (modelos: object) => {
    const mod = arch({ version: 1, ...modelos });
    const r = spawnSync(REPARTO, ["--tipo", "lectura", "--json"], {
      encoding: "utf8",
      env: { ...process.env, REPARTO_CUPOS_FIJOS: cuposF, REPARTO_AHORA: AHORA, REPARTO_DSH_FIJO: '{"opencode":false,"deepseek":false}', REPARTO_AGY: "0",
        REPARTO_STATE: path.join(tmp, "estado"), REPARTO_AA: f, TRAMA_MODELOS: mod },
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const cfgq = (modelos: object, ef: string) => py(`cfg = R.cargar_config()\nm = R.mapa_efforts(cfg, "opus")\nprint(json.dumps(R.calidad_en_effort(m, ${JSON.stringify(ef)}, cfg["calidad"]["opus"])))`,
    { REPARTO_AA: f, TRAMA_MODELOS: arch({ version: 1, ...modelos }), REPARTO_STATE: path.join(tmp, "estado") });
  const bajo = cfgq({}, "low") as number, alto = cfgq({}, "high") as number;
  assert.ok(bajo < alto);
  const aa = { calidad_unidades: "aa" };
  assert.equal(cfgq({ ...aa, calidad: { opus: 47 } }, "low"), 47, "calidad fija del dueño: para todos los efforts");
  assert.equal(cfgq({ ...aa, calidad: { opus: 47 }, calidad_effort: { opus: { low: 41 } } }, "low"), 41, "por effort del dueño gana");
  assert.equal(cfgq({ ...aa, calidad: { opus: 47 }, calidad_effort: { opus: { low: 41 } } }, "high"), 47);
  assert.equal(cfgq({ calidad: { opus: 77 }, calidad_effort: { opus: { low: 55 } } }, "low"), 41.6, "sin calidad_unidades: escala vieja, 55 → 41.6");
  const r = pick({ effort_por_tipo: { lectura: "low" } });
  assert.ok(r.modelo, "elige algo");
});


// --- emparejamiento y esfuerzos con datos de AA realistas (reporte de Ajustes > Modelos) ------------------------------
const REAL = {
  version: 1,
  fetched: "2026-10-26T08:00:00Z",
  modelos: [
    { name: "Claude Opus 5.5 (Adaptive Reasoning, Max Effort)", slug: "claude-opus-5-5-adaptive", coding: 66, agentic: 64, intelligence: 78 },
    { name: "Claude Opus 5.5 (Reasoning, High Effort)", slug: "claude-opus-5-5-high", coding: 62, agentic: 60, intelligence: 74 },
    { name: "Claude Opus 5.5 (Medium Effort)", slug: "claude-opus-5-5-medium", coding: 56, agentic: 54, intelligence: 70 },
    { name: "Claude Opus 5.5 Low effort", slug: "claude-opus-5-5-low", coding: 47, agentic: 45, intelligence: 64 },
    { name: "Claude Opus 5.5 (Non-reasoning, High Effort)", slug: "claude-opus-5-5-non-reasoning-high", coding: 50, agentic: 44, intelligence: 60 },
    { name: "Claude Sonnet 5.5 (Adaptive Reasoning, High Effort)", slug: "claude-sonnet-5-5-high", coding: 56, agentic: 54, intelligence: 70 },
    { name: "Claude Sonnet 5.5 (Reasoning, Medium Effort)", slug: "claude-sonnet-5-5-medium", coding: 51, agentic: 49, intelligence: 66 },
    { name: "Claude Sonnet 5.5 (Non-reasoning)", slug: "claude-sonnet-5-5-non-reasoning", coding: 40, agentic: 38, intelligence: 55 },
    { name: "Claude Haiku 5.5 (xhigh)", slug: "claude-haiku-5-5-xhigh", coding: 41, agentic: 39, intelligence: 58 },
    { name: "Claude Haiku 5.5 (Reasoning, high)", slug: "claude-haiku-5-5-high", coding: 39, agentic: 37, intelligence: 56 },
    { name: "Claude Haiku 5.5", slug: "claude-haiku-5-5-low", coding: 31, agentic: 29, intelligence: 50 },
    { name: "Gemini 4 Argon", slug: "gemini-4-argon", coding: 52, agentic: 50, intelligence: 68 },
    { name: "Gemini 3.8 Flash (Reasoning)", slug: "gemini-3-8-flash", coding: 44, agentic: 46, intelligence: 60 },
    { name: "Gemini 3.8 Flash (Non-reasoning)", slug: "gemini-3-8-flash-non-reasoning", coding: 30, agentic: 28, intelligence: 50 },
    { name: "GLM-5.3", slug: "glm-5-3", coding: 55, agentic: 53, intelligence: 66 },
    { name: "GLM-5.3 Flash", slug: "glm-5-3-flash", coding: 38, agentic: 36, intelligence: 52 },
    { name: "GLM-5.3 Air", slug: "glm-5-3-air", coding: null, agentic: null, intelligence: 80 },
    { name: "MiMo-V2.6-Flash", slug: "mimo-v2-6-flash", coding: 41, agentic: 39, intelligence: 54 },
    { name: "gpt-oss-120B (high)", slug: "gpt-oss-120b", coding: 33, agentic: 31, intelligence: 48 },
    { name: "gpt-oss-20B (high)", slug: "gpt-oss-20b", coding: 22, agentic: 20, intelligence: 38 },
  ],
};
const ID = (s: string) => `opencode:opencode/${s}`;
const calid = (ids: string[], aa: object = REAL) =>
  py(`aa = R.aa_cargar()\nprint(json.dumps({m: (R.aa_calidad(aa, m) or [None])[0] for m in ${JSON.stringify(ids)}}))`, { REPARTO_AA: arch(aa) }) as Record<string, number | null>;
const efs = (id: string, aa: object = REAL) => py(`aa = R.aa_cargar()\nprint(json.dumps(R.aa_calidad_efforts(aa, ${JSON.stringify(id)})))`, { REPARTO_AA: arch(aa) }) as Record<string, number>;

test("aa_esfuerzo: todas las formas de AA", () => {
  const e = (name: string, slug = "") => py(`print(json.dumps(R.aa_esfuerzo({"name": ${JSON.stringify(name)}, "slug": ${JSON.stringify(slug)}})))`) as string | null;
  assert.equal(e("Claude Opus 5.5 (Adaptive Reasoning, Max Effort)"), "max");
  assert.equal(e("Claude Opus 5.5 (Reasoning, High Effort)"), "high");
  assert.equal(e("Claude Opus 5.5 (high)"), "high");
  assert.equal(e("Claude Opus 5.5 (xhigh)"), "xhigh");
  assert.equal(e("Claude Opus 5.5 (x-high)"), "xhigh");
  assert.equal(e("Claude Opus 5.5 Low effort"), "low");
  assert.equal(e("GPT-6 Astra (minimal)"), "low", "minimal cuenta como low");
  for (const [suf, nivel] of [["low", "low"], ["medium", "medium"], ["high", "high"], ["xhigh", "xhigh"], ["minimal", "low"]]) assert.equal(e("X", `gpt-6-astra-${suf}`), nivel, suf);
  assert.equal(e("X", "claude-opus-5-5-thinking-high"), "high");
  assert.equal(e("Claude Opus 5.5 (Non-reasoning)"), "none");
  assert.equal(e("Claude Opus 5.5 (Reasoning)"), "high", "Reasoning sin nivel = effort por defecto (high)");
  assert.equal(e("Claude Opus 5.5 (Thinking)"), "high");
  assert.equal(e("Kimi K3 Max"), null, "max pegado al nombre no es un esfuerzo");
  assert.equal(e("Claude Opus 5.5"), null);
});

test("aa_tokens: variantes de AA se juntan con el modelo, pero tamaños y variantes nunca", () => {
  const tk = (s: string) => py(`print(json.dumps(R.aa_tokens(${JSON.stringify(s)})))`) as string[];
  assert.deepEqual(tk("mimo-v2-6-flash"), ["mimo", "v2.6", "flash"]);
  assert.deepEqual(tk("MiMo-V2.6-Flash"), ["mimo", "v2.6", "flash"]);
  assert.deepEqual(tk("opencode:opencode/mimo-v2.6-flash-free"), ["mimo", "v2.6", "flash"]);
  assert.deepEqual(tk("claude-opus-5-5-adaptive"), ["claude", "opus", "5.5"]);
  assert.deepEqual(tk("claude-opus-5-5-thinking-high"), ["claude", "opus", "5.5"]);
  assert.deepEqual(tk("Claude Opus 5.5 (Adaptive Reasoning, Max Effort)"), ["claude", "opus", "5.5"]);
  assert.deepEqual(tk("claude-opus-5-5-max-effort"), ["claude", "opus", "5.5"]);
  assert.deepEqual(tk("claude-opus-5-5-non-reasoning-high"), ["claude", "opus", "5.5"]);
  assert.deepEqual(tk("claude-haiku-4-5-20251001"), ["claude", "haiku", "4.5"]);
  for (const v of ["flash", "mini", "lite", "nano", "small", "air"]) assert.ok(tk(`glm-5-3-${v}-free`).includes(v), v);
});

test("emparejamiento: flash/mini/lite/air nunca caen en el modelo base ni en otro tamaño; sin entrada exacta no hay valor de AA", () => {
  const t = calid([ID("glm-5.3-flash-free"), ID("glm-5.3-free"), ID("glm-5.3-lite-free"), ID("glm-5.3-mini-free"), ID("glm-5.3-nano-free"), ID("glm-5.3-small-free"),
    "agy:gpt-oss-120b", "agy:gpt-oss-20b", "gpt-oss-60b", "gpt-oss-120b-mini"]);
  assert.equal(t[ID("glm-5.3-flash-free")], 37, "GLM-5.3 Flash (crudo 37), no el 54 del base");
  assert.equal(t[ID("glm-5.3-free")], 54);
  for (const x of ["lite", "mini", "nano", "small"]) assert.equal(t[ID(`glm-5.3-${x}-free`)], null, `${x}: AA no lo tiene → estimación`);
  assert.ok(t["agy:gpt-oss-120b"]! > t["agy:gpt-oss-20b"]!, "120b y 20b son distintos");
  assert.equal(t["gpt-oss-60b"], null);
  assert.equal(t["gpt-oss-120b-mini"], null);
  // sin la entrada Flash en AA el id flash NO cae en GLM-5.3 (ni en Air)
  const sinFlash = { ...REAL, modelos: REAL.modelos.filter((m) => m.slug !== "glm-5-3-flash") };
  assert.equal(calid([ID("glm-5.3-flash-free")], sinFlash)[ID("glm-5.3-flash-free")], null);
});

test("MiMo V2.6 flash y GPT-OSS: siguen a AA en crudo (slug con v2-6 también empareja)", () => {
  const t = calid([ID("mimo-v2.6-flash-free"), "agy:gpt-oss-120b"]);
  assert.equal(t[ID("mimo-v2.6-flash-free")], 40);
  assert.equal(t["agy:gpt-oss-120b"], 32);
  const soloSlug = { ...REAL, modelos: [...REAL.modelos.filter((m) => m.slug !== "mimo-v2-6-flash"), { name: "MiMo Flash", slug: "mimo-v2-6-flash", coding: 41, agentic: 39, intelligence: 54 }] };
  assert.equal(calid([ID("mimo-v2.6-flash-free")], soloSlug)[ID("mimo-v2.6-flash-free")], 40);
});

test("efforts de Opus: low/medium/high/max, no sólo max; puntaje crudo de AA de cada esfuerzo", () => {
  assert.deepEqual(efs("claude-opus-5-5"), { max: 65, high: 61, medium: 55, low: 46 });
  assert.deepEqual(efs("claude-sonnet-5-5"), { high: 55, medium: 50 });
  assert.deepEqual(efs("claude-haiku-5-5"), { xhigh: 40, high: 38, low: 30 });
  const o = efs("claude-opus-5-5");
  assert.ok(o.low < o.medium && o.medium < o.high && o.high < o.max);
});

test("efforts: Non-reasoning no entra al mapa aunque traiga nivel; la variante razonada gana el mismo nivel", () => {
  const solo = { ...REAL, modelos: REAL.modelos.filter((m) => !/Opus 5\.5 \((?:Reasoning, High|Medium)|Low effort/.test(m.name)) };
  assert.deepEqual(Object.keys(efs("claude-opus-5-5", solo)).sort(), ["high", "max"], "high sólo existe sin razonar: pasa como relleno");
  const sinRelleno = { ...solo, modelos: solo.modelos.filter((m) => !/Non-reasoning, High/.test(m.name)) };
  assert.deepEqual(Object.keys(efs("claude-opus-5-5", sinRelleno)), ["max"]);
});

test("efforts: crecen con el esfuerzo (un nivel más alto nunca vale menos)", () => {
  const raro = { ...REAL, modelos: [...REAL.modelos, { name: "Claude Sonnet 5.5 (Non-reasoning, Low Effort)", slug: "x-low", coding: 54, agentic: 54, intelligence: 60 }] };
  const e = efs("claude-sonnet-5-5", raro);
  const orden = ["low", "medium", "high"].filter((k) => k in e).map((k) => e[k]);
  assert.deepEqual([...orden].sort((a, b) => a - b), orden);
});

test("Gemini Argon y Flash: entrada pelada o Reasoning = effort por defecto (high), por eso hay línea de efforts", () => {
  assert.deepEqual(efs("gemini-4-argon"), { high: 51 });
  assert.deepEqual(efs("gemini-3.8-flash"), { high: 45 });
  const cfg = py(`cfg = R.cargar_config()\nprint(json.dumps({"ef": cfg["calidad_ef"].get("argon"), "q": cfg["calidad"]["argon"], "o": cfg["origen"]["argon"]}))`, { REPARTO_AA: arch(REAL), REPARTO_STATE: path.join(tmp, "estado") }) as { ef: object; q: number; o: string };
  assert.deepEqual(cfg, { ef: { high: 51 }, q: 51, o: "artificial-analysis" });
});

test("sin calibración ni topes: los que sólo traen inteligencia usan ese índice tal cual; nada se acota a 100; piso 0", () => {
  const t = calid([ID("glm-5.3-air-free"), ID("super-9"), ID("piso-9")], {
    ...REAL,
    modelos: [...REAL.modelos, { name: "Super 9", slug: "super-9", coding: 300, agentic: 300, intelligence: 300 }, { name: "Piso 9", slug: "piso-9", coding: -50, agentic: -50, intelligence: 0 }],
  });
  assert.equal(t[ID("glm-5.3-air-free")], 80, "inteligencia 80, tal cual");
  assert.equal(t[ID("super-9")], 300);
  assert.equal(t[ID("piso-9")], 0);
});

test("--aa-diag: por modelo, la entrada de AA y su puntaje crudo por effort; los sin coincidencia lo dicen", () => {
  const r = spawnSync(REPARTO, ["--aa-diag", "--json"], {
    encoding: "utf8",
    env: { ...process.env, REPARTO_CUPOS_FIJOS: cuposF, REPARTO_AHORA: AHORA, REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/glm-5.3-flash-free","opencode/mimo-v2.6-flash-free","opencode/glm-5.3-lite-free"]',
      REPARTO_AGY: "0", REPARTO_STATE: path.join(tmp, "estado"), REPARTO_AA: arch(REAL), TRAMA_MODELOS: arch({ version: 1, excluir: [ID("glm-5.3-flash-free")] }) },
  });
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout) as { aa_fecha: string; modelos: { id: string; aa: null | { nombre: string; slug: string; crudo: number }; efforts: Record<string, { crudo: number; usado: number }>; permitido: boolean }[] };
  const por = Object.fromEntries(d.modelos.map((m) => [m.id, m]));
  assert.equal(d.aa_fecha, "2026-10-26");
  assert.deepEqual(por["claude-opus-5-5"].efforts.max, { crudo: 65, usado: 65 });
  assert.equal(por["claude-opus-5-5"].aa!.nombre, "Claude Opus 5.5 (Adaptive Reasoning, Max Effort)");
  assert.equal(por[ID("mimo-v2.6-flash-free")].aa!.slug, "mimo-v2-6-flash");
  assert.equal(por[ID("mimo-v2.6-flash-free")].aa!.crudo, 40);
  assert.equal(por[ID("glm-5.3-lite-free")].aa, null);
  assert.equal(por[ID("glm-5.3-flash-free")].permitido, false);
  const txt = spawnSync(REPARTO, ["--aa-diag"], { encoding: "utf8", env: { ...process.env, REPARTO_CUPOS_FIJOS: cuposF, REPARTO_AHORA: AHORA, REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_AGY: "0", REPARTO_STATE: path.join(tmp, "estado"), REPARTO_AA: arch(REAL) } });
  assert.equal(txt.status, 0, txt.stderr);
  assert.match(txt.stdout, /claude-opus-5-5\n\s+AA: Claude Opus 5\.5 \(Adaptive Reasoning, Max Effort\) \[claude-opus-5-5-adaptive\]/);
  assert.match(txt.stdout, /por effort: .*max 65\b/);
});

test("modelos excluidos: reparto nunca los elige, aunque tengan la mejor cifra", () => {
  const pick = (excluir: string[]) => {
    const r = spawnSync(REPARTO, ["--tipo", "lectura", "--json"], {
      encoding: "utf8",
      env: { ...process.env, REPARTO_CUPOS_FIJOS: arch({ version: 1, leido: AHORA, suscripciones: [] }), REPARTO_AHORA: AHORA, REPARTO_DSH_FIJO: '{"ollama":[],"opencode":true,"deepseek":false}',
        REPARTO_OPENCODE_FIJO: '["opencode/glm-5.3-flash-free","opencode/mimo-v2.6-flash-free"]', REPARTO_AGY: "0", REPARTO_CLAUDE: "0",
        REPARTO_STATE: path.join(tmp, "estado"), REPARTO_AA: arch(REAL), TRAMA_MODELOS: arch({ version: 1, excluir }) },
    });
    return JSON.parse(r.stdout) as { modelo: string };
  };
  const primero = pick([]).modelo;
  assert.ok([ID("glm-5.3-flash-free"), ID("mimo-v2.6-flash-free")].includes(primero));
  assert.notEqual(pick([primero]).modelo, primero, "excluido por id exacto: se elige el otro");
});

test("codigo-acotado (medium) va a Sonnet, no a Opus: el mínimo de Sonnet se mide al mismo effort que el candidato", () => {
  const r = spawnSync(REPARTO, ["--tipo", "codigo-acotado", "--json"], {
    encoding: "utf8",
    env: { ...process.env, REPARTO_CUPOS_FIJOS: cuposF, REPARTO_AHORA: AHORA, REPARTO_DSH_FIJO: '{"opencode":false,"deepseek":false}', REPARTO_AGY: "0",
      REPARTO_STATE: path.join(tmp, "estado"), REPARTO_AA: arch(REAL), TRAMA_MODELOS: arch({ version: 1 }) },
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout) as { familia?: string; modelo: string; effort?: string };
  assert.match(j.modelo, /sonnet/, JSON.stringify(j));
});
