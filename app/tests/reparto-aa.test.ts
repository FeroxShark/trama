// Inteligencia de Artificial Analysis en `reparto` (motor/bin/reparto): el emparejamiento de nombres (aa_tokens / aa_buscar), la calibración a la
// escala de reparto (aa_calibracion), y la precedencia en `--tabla`: modelos.json (usuario) > Artificial Analysis > defaults > estimada,
// con `origen` y `aa_fecha`. Todo con un archivo de caché falso (REPARTO_AA): no mira la red ni el estado real.
import { test, after } from "node:test";
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
    M("Claude Opus 5.5 (Reasoning)", 66, 64),
    M("Claude Opus 5.5 (Non-reasoning)", 50, 40),
    M("Claude Sonnet 5.5", 56, 54),
    M("Claude Haiku 5.5", 40, 38),
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

test("calibración: Opus 5.5 → 100 y Haiku 5.5 → 60 (anclas), recta por los puntos, clamp 0–100, una sola ancla proporcional", () => {
  const cal = (pts: [number, number][]) => py(`print(json.dumps(R.aa_calibracion(${JSON.stringify(pts)})))`) as [number, number] | null;
  const [a, b] = cal([[65, 100], [39, 60]])!;
  assert.ok(Math.abs(a * 65 + b - 100) < 1e-9 && Math.abs(a * 39 + b - 60) < 1e-9);
  assert.deepEqual(cal([[50, 100]]), [2, 0]);
  assert.deepEqual(cal([[30, 60]]), [2, 0]);
  assert.equal(cal([]), null);
  assert.equal(cal([[65, 60], [39, 100]]), null, "anclas al revés: no sirve");
  assert.equal(cal([[50, 100], [50, 60]]) === null, false, "dos anclas con el mismo puntaje: proporcional a la primera");
  // de punta a punta con el archivo: Opus 65 → 100, Haiku 39 → 60, GLM-5.3 Flash (42) → 65, Sonnet (55)
  const f = arch(AA);
  const t = py(`aa = R.aa_cargar()\nprint(json.dumps({m: R.aa_calidad(aa, m)[0] for m in ["claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-5-5", "opencode:opencode/glm-5.3-flash-free", "opencode:opencode/nemotron-3-ultra-free"]}))`, { REPARTO_AA: f });
  assert.equal(t["claude-opus-5-5"], 100);
  assert.equal(t["claude-haiku-5-5"], 60);
  assert.ok(t["claude-sonnet-5-5"] > 60 && t["claude-sonnet-5-5"] < 100);
  assert.equal(t["opencode:opencode/glm-5.3-flash-free"], 65);
  const alto = arch({ ...AA, modelos: [...AA.modelos, M("Supermodelo 9", 200, 200)] });
  const c = py(`aa = R.aa_cargar()\nprint(json.dumps(R.aa_calidad(aa, "supermodelo-9")[0]))`, { REPARTO_AA: alto });
  assert.equal(c, 100, "clamp a 100");
  const bajo = arch({ ...AA, modelos: [...AA.modelos, M("Piso 1", 0, 0)] });
  assert.equal(py(`aa = R.aa_cargar()\nprint(json.dumps(R.aa_calidad(aa, "piso-1")[0]))`, { REPARTO_AA: bajo }), 0, "clamp a 0");
});

test("calibración por tramos: Haiku<Sonnet<Opus en AA → Sonnet exacto 88; entre Sonnet y Opus entre 88 y 100; bajo Haiku extrapola y acota", () => {
  const AA3 = { ...AA, modelos: [M("Claude Opus 5.5", 66, 64), M("Claude Sonnet 5.5", 56, 54), M("Claude Haiku 5.5", 40, 38), M("Medio 1", 60, 60), M("Bajo 1", 30, 30), M("Piso 2", 0, 0), M("Alto 2", 200, 200)] };
  const q = (f: string, ids: string[]) => py(`aa = R.aa_cargar()\nprint(json.dumps({m: R.aa_calidad(aa, m)[0] for m in ${JSON.stringify(ids)}}))`, { REPARTO_AA: f }) as Record<string, number>;
  const t = q(arch(AA3), ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "medio-1", "bajo-1", "piso-2", "alto-2"]);
  assert.equal(t["claude-sonnet-5-5"], 88, "la recta Haiku-Opus lo dejaba en ~74");
  assert.equal(t["claude-opus-5-5"], 100);
  assert.equal(t["claude-haiku-5-5"], 60);
  assert.ok(t["medio-1"] > 88 && t["medio-1"] < 100, `entre Sonnet y Opus: ${t["medio-1"]}`);
  assert.ok(t["bajo-1"] < 60 && t["bajo-1"] > 0, `bajo Haiku extrapola: ${t["bajo-1"]}`);
  assert.equal(t["piso-2"], 0, "acota a 0");
  assert.equal(t["alto-2"], 100, "acota a 100");
  // anclas no monótonas (Sonnet por debajo de Haiku en AA): vuelve a la recta Opus-Haiku
  const raro = { ...AA, modelos: [M("Claude Opus 5.5", 66, 64), M("Claude Sonnet 5.5", 30, 30), M("Claude Haiku 5.5", 40, 38)] };
  const r = q(arch(raro), ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  assert.deepEqual([r["claude-opus-5-5"], r["claude-haiku-5-5"]], [100, 60]);
  assert.ok(r["claude-sonnet-5-5"] < 60);
  // sin Haiku: la recta por Sonnet y Opus (dos anclas) sigue clavando a los dos
  const sinH = { ...AA, modelos: [M("Claude Opus 5.5", 66, 64), M("Claude Sonnet 5.5", 56, 54)] };
  const s2 = q(arch(sinH), ["claude-opus-5-5", "claude-sonnet-5-5"]);
  assert.deepEqual([s2["claude-opus-5-5"], s2["claude-sonnet-5-5"]], [100, 88]);
});

test("sin anclas en los datos, caché rota, vacía o apagada: reparto sigue con los defaults", () => {
  const sin = arch({ version: 1, fetched: "2026-10-25T08:00:00Z", modelos: [M("GLM-5.3 Flash", 42, 40)] });
  for (const f of [sin, arch("{roto"), arch({ version: 1 }), path.join(tmp, "no-hay.json"), "0"]) {
    assert.equal(py(`print(json.dumps(R.aa_cargar()))`, { REPARTO_AA: f }), null);
  }
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
  assert.deepEqual([t["claude-opus-5-5"].origen, t["claude-opus-5-5"].calidad, t["claude-opus-5-5"].aa_fecha], ["defecto", 100, null]);
  assert.deepEqual([t["opencode:opencode/zeta-ultra-free"].origen, t["opencode:opencode/zeta-ultra-free"].estimada], ["estimada", true]);
  assert.equal(t["opencode:opencode/glm-5.3-flash-free"].origen, "defecto");
});

test("--tabla con AA: lo medido pisa defaults y estimaciones; lo que AA no conoce sigue como estaba; lleva la fecha del dato", () => {
  const t = tabla(arch(AA));
  assert.deepEqual([t["claude-opus-5-5"].origen, t["claude-opus-5-5"].calidad, t["claude-opus-5-5"].aa_fecha], ["artificial-analysis", 100, "2026-10-25"]);
  assert.equal(t["claude-haiku-5-5"].calidad, 60);
  assert.equal(t["claude-sonnet-5-5"].origen, "artificial-analysis");
  assert.ok(t["claude-sonnet-5-5"].calidad > 60 && t["claude-sonnet-5-5"].calidad < 100);
  assert.equal(t["opencode:opencode/glm-5.3-flash-free"].calidad, 65, "defecto 55 → medido 65");
  assert.equal(t["opencode:opencode/glm-5.3-flash-free"].estimada, false);
  // Nemotron 3 Ultra: sólo trae inteligencia (47): sirve de reserva y estaba en defecto 55
  assert.equal(t["opencode:opencode/nemotron-3-ultra-free"].origen, "artificial-analysis");
  // AA no lo conoce: se queda con su defecto / su estimación por el nombre
  assert.deepEqual([t["opencode:opencode/big-pickle"].origen, t["opencode:opencode/big-pickle"].calidad], ["defecto", 60]);
  assert.deepEqual([t["opencode:opencode/zeta-ultra-free"].origen, t["opencode:opencode/zeta-ultra-free"].estimada], ["estimada", true]);
  // el local de Ollama: 30b no es 30b-a3b → sigue en su defecto de 35
  assert.deepEqual([t["dsh:ollama/qwen3-coder:30b"].origen, t["dsh:ollama/qwen3-coder:30b"].calidad], ["defecto", 35]);
});

test("--tabla: lo que fija el dueño en modelos.json gana a AA (por familia, por id exacto y por patrón), y lo demás sigue midiéndose", () => {
  const t = tabla(arch(AA), { calidad: { opus: 90, "opencode:opencode/glm-5.3-flash-free": 12, "opencode:opencode/nemotron-*": 77 } });
  assert.deepEqual([t["claude-opus-5-5"].origen, t["claude-opus-5-5"].calidad, t["claude-opus-5-5"].aa_fecha], ["usuario", 90, null]);
  assert.deepEqual([t["opencode:opencode/glm-5.3-flash-free"].origen, t["opencode:opencode/glm-5.3-flash-free"].calidad], ["usuario", 12]);
  assert.deepEqual([t["opencode:opencode/nemotron-3-ultra-free"].origen, t["opencode:opencode/nemotron-3-ultra-free"].calidad], ["usuario", 77]);
  assert.equal(t["claude-haiku-5-5"].origen, "artificial-analysis");
  // la calibración no se mueve porque el dueño fije Opus: Haiku sigue en 60
  assert.equal(t["claude-haiku-5-5"].calidad, 60);
});

test("--tabla: un valor de usuario que coincide con el default sigue siendo del usuario", () => {
  const t = tabla(undefined, { calidad: { haiku: 60 } });
  assert.equal(t["claude-haiku-5-5"].origen, "usuario");
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
  assert.equal(e("Claude Opus 5.5 (Reasoning)"), null);
});

test("--tabla expone calidad_por_effort calibrada con las mismas anclas; calidad sigue siendo la mejor; low < high", () => {
  const t = tablaEf(arch(AA_EF));
  const o = t["claude-opus-5-5"];
  assert.equal(o.calidad, 100);
  assert.equal(o.calidad_por_effort.max, 100);
  assert.ok(o.calidad_por_effort.low < o.calidad_por_effort.high && o.calidad_por_effort.high < 100);
  assert.deepEqual(Object.keys(o.calidad_por_effort).sort(), ["high", "low", "max"], "medium desconocido no se inventa en el mapa; none no entra");
  assert.equal(t["claude-sonnet-5-5"].calidad, 88);
  assert.deepEqual(t["claude-sonnet-5-5"].calidad_por_effort, {});
});

test("calidad_en_effort: el medido, interpolado entre vecinos, el extremo más cercano, o la mejor sin mapa", () => {
  const q = (mapa: object, ef: string, base: number) => py(`print(json.dumps(R.calidad_en_effort(${JSON.stringify(mapa)}, ${JSON.stringify(ef)}, ${base})))`);
  const m = { low: 80, high: 96, max: 100 };
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
  assert.equal(cfgq({ calidad: { opus: 77 } }, "low"), 77, "calidad fija del dueño: para todos los efforts");
  assert.equal(cfgq({ calidad: { opus: 77 }, calidad_effort: { opus: { low: 55 } } }, "low"), 55, "por effort del dueño gana");
  assert.equal(cfgq({ calidad: { opus: 77 }, calidad_effort: { opus: { low: 55 } } }, "high"), 77);
  const r = pick({ effort_por_tipo: { lectura: "low" } });
  assert.ok(r.modelo, "elige algo");
});
