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
