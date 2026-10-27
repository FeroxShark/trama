// OpenCode Go en `reparto` (motor/bin/reparto), APAGADO por defecto: con `opencode_plan` "go" / "go-plus" en modelos.json los modelos de la tabla
// (motor/opencode/go-topes.json; acá una tabla de prueba por REPARTO_GO_TABLA) entran como candidatos `opencode:opencode-go/<modelo>` con costo
// marginal ~0 y calidad de AA al esfuerzo usado; un worker de código acotado puede ir a DeepSeek V4.1 Flash por Go. Sin el plan no cambia NADA
// (misma salida, byte a byte). Un 429 (`--agotar`) marca SÓLO ese modelo, 5 h. Cupos, hora y modelos fijos por entorno: no mira nada real.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const REAL = path.join(import.meta.dirname, "..", "..", "motor", "opencode", "go-topes.json");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-go-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const arch = (j: object | string) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, typeof j === "string" ? j : JSON.stringify(j));
  return f;
};

const AHORA = "2026-10-26T12:00:00Z";
const cupos = (usado7: number, vuelve7: string) =>
  arch({ version: 1, leido: AHORA, suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: 0.2, vuelve: "2026-10-26T14:00:00Z" }, { id: "7d", usado: usado7, vuelve: vuelve7 }] }] });
/** Claude con la semana casi gastada y el reinicio lejos: hay que cuidarla. Y con la semana por reiniciarse y de sobra: se gasta. */
const CLAUDE_JUSTO = cupos(0.9, "2026-10-30T00:00:00Z");
const CLAUDE_DE_SOBRA = cupos(0.3, "2026-10-27T00:00:00Z");

const TABLA_PRUEBA = arch({
  version: 1,
  fuente: "https://ejemplo.test/go",
  fecha: "2026-10-27",
  modelos: [
    { id: "deepseek-v4.1-flash", nombre: "DeepSeek V4.1 Flash", go: { pedidos_5h: 34670, usd_mes: 80 }, "go-plus": { pedidos_5h: 69330, usd_mes: 160 } },
    { id: "kimi-k3.1-pro", nombre: "Kimi K3.1 Pro", go: { pedidos_5h: 147, usd_mes: 15 }, "go-plus": { pedidos_5h: 588, usd_mes: 60 } },
  ],
});
const DS = "opencode:opencode-go/deepseek-v4.1-flash";
const KIMI = "opencode:opencode-go/kimi-k3.1-pro";
/** DeepSeek V4.1 Flash con una inteligencia que alcanza para código acotado (el mínimo es la de Sonnet: 51 en este archivo sin AA). */
const modelos = (extra: object = {}) => arch({ version: 1, calidad_unidades: "aa", calidad: { [DS]: 52, [KIMI]: 44 }, ...extra });

function reparto(args: string[], o: { cupos: string; modelos: string; estado?: string; env?: Record<string, string> }) {
  const r = spawnSync(REPARTO, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      REPARTO_CUPOS_FIJOS: o.cupos,
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/big-pickle"]',
      REPARTO_AGY: "0",
      REPARTO_AA: "0",
      REPARTO_GO_TABLA: TABLA_PRUEBA,
      REPARTO_STATE: o.estado ?? path.join(tmp, `estado${n++}`),
      TRAMA_MODELOS: o.modelos,
      ...o.env,
    },
  });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}
type Cand = { modelo: string; calidad: number; puntaje: number; descartado_por: string | null; gratis?: boolean; grupo: string };
const elegir = (tipo: string, o: Parameters<typeof reparto>[1]) => {
  const r = reparto(["--tipo", tipo, "--json"], o);
  assert.equal(r.rc, 0, r.err);
  return JSON.parse(r.out) as { modelo: string; motivo: string; candidatos: Cand[] };
};

test("con Go activo, un worker de código acotado va a DeepSeek V4.1 Flash por Go cuando hay que cuidar a Claude", () => {
  const r = elegir("codigo-acotado", { cupos: CLAUDE_JUSTO, modelos: modelos({ opencode_plan: "go" }) });
  assert.equal(r.modelo, DS);
  assert.match(r.motivo, /plan Go de OpenCode/);
  assert.doesNotMatch(r.motivo, /key de DeepSeek/, "no se paga con ninguna key: es el plan");
  const ds = r.candidatos.find((c) => c.modelo === DS)!;
  assert.equal(ds.calidad, 52);
  assert.equal(ds.grupo, DS, "el grupo de un modelo de Go es el modelo (cupo por modelo)");
  // Kimi (calidad 44) no llega al mínimo de código acotado: queda afuera por calidad, no por Go.
  assert.match(r.candidatos.find((c) => c.modelo === KIMI)!.descartado_por ?? "", /calidad 44 menor que la 51/);
});

test("Go es costo marginal ~0: a calidad pareja gana al Claude que cuesta; con Claude de sobra, Claude sigue ganando", () => {
  const sobra = elegir("codigo-acotado", { cupos: CLAUDE_DE_SOBRA, modelos: modelos({ opencode_plan: "go" }) });
  assert.equal(sobra.modelo, "claude-sonnet-5-5", "la semana de Claude está por reiniciarse con 70 % libre: se gasta");
  assert.ok(sobra.candidatos.some((c) => c.modelo === DS && !c.descartado_por), "Go es candidato igual");
  // Mismo modelo y calidad: el costo marginal de Go (0,02) es menor que el de Claude por suscripción.
  const j = elegir("codigo-acotado", { cupos: CLAUDE_JUSTO, modelos: modelos({ opencode_plan: "go" }) });
  const ds = j.candidatos.find((c) => c.modelo === DS)!;
  const sonnet = j.candidatos.find((c) => c.modelo === "claude-sonnet-5-5")!;
  assert.ok(ds.puntaje > sonnet.puntaje);
});

test("sin Go no cambia nada: ni sin la clave, ni con «gratis», ni con un plan desconocido (misma salida, byte a byte)", () => {
  const sin = reparto(["--tipo", "codigo-acotado", "--json"], { cupos: CLAUDE_JUSTO, modelos: modelos(), estado: path.join(tmp, "e-fijo") });
  assert.equal(sin.rc, 0, sin.err);
  const otro = JSON.parse(sin.out);
  assert.notEqual(otro.modelo, DS);
  assert.ok(!sin.out.includes("opencode-go"), "ni como candidato descartado");
  for (const plan of ["gratis", "oro", 3]) {
    const r = reparto(["--tipo", "codigo-acotado", "--json"], { cupos: CLAUDE_JUSTO, modelos: modelos({ opencode_plan: plan }), estado: path.join(tmp, "e-fijo") });
    assert.equal(r.out, sin.out, `opencode_plan ${JSON.stringify(plan)}`);
  }
  // Y --tabla: ninguna fila de Go, ningún campo nuevo.
  const t = reparto(["--tabla", "--json"], { cupos: CLAUDE_JUSTO, modelos: modelos({ opencode_plan: "gratis" }), estado: path.join(tmp, "e-fijo") });
  assert.ok(!t.out.includes("opencode-go") && !t.out.includes('"plan"'));
});

test("--tabla --json con Go: la fila trae el plan y los topes de ese plan; no es gratis", () => {
  const por = (plan: string) => {
    const r = reparto(["--tabla", "--json"], { cupos: CLAUDE_JUSTO, modelos: modelos({ opencode_plan: plan }) });
    assert.equal(r.rc, 0, r.err);
    return Object.fromEntries((JSON.parse(r.out).modelos as { id: string; gratis: boolean; plan?: string; go?: { pedidos_5h: number; usd_mes: number }; proveedor: string; grupo: string }[]).map((m) => [m.id, m]));
  };
  const go = por("go");
  assert.deepEqual([go[KIMI]!.plan, go[KIMI]!.go, go[KIMI]!.gratis, go[KIMI]!.proveedor], ["go", { pedidos_5h: 147, usd_mes: 15 }, false, "opencode"]);
  assert.deepEqual(por("go-plus")[KIMI]!.go, { pedidos_5h: 588, usd_mes: 60 });
  assert.equal(go["opencode:opencode/big-pickle"]!.gratis, true);
  assert.equal(go["opencode:opencode/big-pickle"]!.plan, undefined, "los gratis no llevan plan");
  assert.equal(go["opencode:opencode/big-pickle"]!.grupo, "opencode-free");
});

test("un 429 de un modelo de Go lo agota SÓLO a él (5 h): el otro de Go y los gratis siguen; el límite gratis no arrastra a Go", () => {
  const estado = path.join(tmp, "estado-429");
  const o = { cupos: CLAUDE_JUSTO, modelos: modelos({ opencode_plan: "go", calidad: { [DS]: 52, [KIMI]: 52 } }), estado };
  assert.equal(elegir("codigo-acotado", o).modelo, DS, "antes del 429");
  const a = reparto(["--agotar", DS], o);
  assert.equal(a.rc, 0, a.err);
  assert.match(a.out, /opencode:opencode-go\/deepseek-v4\.1-flash agotado hasta 2026-10-26T17:00:00Z/, "5 h desde AHORA");
  const f = JSON.parse(readFileSync(path.join(estado, "agotado.json"), "utf8"));
  assert.deepEqual(Object.keys(f), [DS], "sólo ese grupo: nada de opencode-free");
  const r = elegir("codigo-acotado", o);
  assert.equal(r.modelo, KIMI, "pasa al otro modelo de Go");
  assert.match(r.candidatos.find((c) => c.modelo === DS)!.descartado_por ?? "", /dijo sin cupo \(429\): vuelve 2026-10-26T17:00:00Z/);
  // Al revés: agotar los gratis (opencode-free) no toca a los de Go.
  const estado2 = path.join(tmp, "estado-429b");
  const o2 = { ...o, estado: estado2 };
  assert.equal(reparto(["--agotar", "opencode:opencode/big-pickle"], o2).rc, 0);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(estado2, "agotado.json"), "utf8"))), ["opencode-free"]);
  const r2 = elegir("codigo-acotado", o2);
  assert.equal(r2.modelo, DS);
  assert.equal(r2.candidatos.find((c) => c.modelo === DS)!.descartado_por, null);
  // Con --hasta explícito manda esa hora.
  const estado3 = path.join(tmp, "estado-429c");
  const b = reparto(["--agotar", KIMI, "--hasta", "2026-10-26T13:30:00Z"], { ...o, estado: estado3 });
  assert.match(b.out, /agotado hasta 2026-10-26T13:30:00Z/);
});

test("la tabla real de Go (motor/opencode/go-topes.json) la lee reparto: los 11 modelos con el plan activo", () => {
  const real = JSON.parse(readFileSync(REAL, "utf8"));
  const r = reparto(["--tabla", "--json"], { cupos: CLAUDE_JUSTO, modelos: modelos({ opencode_plan: "go" }), env: { REPARTO_GO_TABLA: "" } });
  assert.equal(r.rc, 0, r.err);
  const go = (JSON.parse(r.out).modelos as { id: string; go?: { pedidos_5h: number } }[]).filter((m) => m.id.startsWith("opencode:opencode-go/"));
  assert.equal(go.length, 11);
  assert.deepEqual(go.map((m) => m.id.split("/")[1]).sort(), real.modelos.map((m: { id: string }) => m.id).sort());
  assert.equal(go.find((m) => m.id.endsWith("deepseek-v4.1-flash"))!.go!.pedidos_5h, 34670);
});

test("si opencode ya listó modelos de Go, sólo se ofrecen esos (con el id que listó); sin tabla no se inventa nada", () => {
  const o = { cupos: CLAUDE_JUSTO, modelos: modelos({ opencode_plan: "go" }) };
  const r = reparto(["--tabla", "--json"], { ...o, env: { REPARTO_OPENCODE_FIJO: '["opencode/big-pickle","opencode-go/Kimi-K3.1-Pro"]' } });
  const ids = (JSON.parse(r.out).modelos as { id: string }[]).map((m) => m.id).filter((i) => i.includes("opencode-go"));
  assert.deepEqual(ids, ["opencode:opencode-go/Kimi-K3.1-Pro"]);
  const sinTabla = reparto(["--tabla", "--json"], { ...o, env: { REPARTO_GO_TABLA: path.join(tmp, "no-existe.json") } });
  assert.ok(!sinTabla.out.includes("opencode-go"));
  const apagado = reparto(["--tabla", "--json"], { ...o, env: { REPARTO_OPENCODE: "0" } });
  assert.ok(!apagado.out.includes("opencode-go"), "REPARTO_OPENCODE=0 apaga también a Go");
});
