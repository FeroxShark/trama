// `reparto --tabla [--json]` (motor/bin/reparto): todos los modelos que conoce, con inteligencia (estimada por el nombre si nadie la fijó),
// gratis/pago, cupo, urgencia y si `excluir` los permite; y la prioridad por plan (Claude que se reinicia pronto con cupo de sobra gana a un
// gratis de OpenCode; con poco cupo y reset lejano gana el gratis). Cupos, hora y modelos fijos por entorno: no mira nada real.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-tabla-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
const cupos = (c5: [number, string], c7: [number, string]) => {
  const f = path.join(tmp, `c-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(
    f,
    JSON.stringify({
      version: 1,
      leido: AHORA,
      suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: c5[0], vuelve: c5[1] }, { id: "7d", usado: c7[0], vuelve: c7[1] }] }],
    }),
  );
  return f;
};
const modelos = (j: object) => {
  const f = path.join(tmp, `m-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify({ version: 1, ...j }));
  return f;
};

function reparto(args: string[], fijos: string, mod?: string) {
  const r = spawnSync(REPARTO, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      REPARTO_CUPOS_FIJOS: fijos,
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/big-pickle","opencode/zeta-ultra-free","opencode/kilo-mini-free","opencode/glm-5.3-flash-free"]',
      REPARTO_AGY: "0",
      REPARTO_STATE: path.join(tmp, "estado"),
      // Sin esto reparto mira los workers vivos y el uso de ESTA máquina (~/.local/state/pa): la elección cambia con ellos.
      PA_STATE: path.join(tmp, "pa-estado"),
      TRAMA_MODELOS: mod ?? path.join(tmp, "no-hay.json"),
    },
  });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}

type Fila = { id: string; calidad: number; estimada: boolean; gratis: boolean; permitido: boolean; excluido_por: string | null; proveedor: string; familia: string; cupo_libre: number | null; ventanas: { id: string; libre: number; vuelve: string }[] };
const tabla = (mod?: string, fijos = cupos([0.2, "2026-10-26T14:00:00Z"], [0.3, "2026-10-27T00:00:00Z"])) => {
  const r = reparto(["--tabla", "--json"], fijos, mod);
  assert.equal(r.rc, 0, r.err);
  const j = JSON.parse(r.out) as { version: number; modelos: Fila[] };
  assert.equal(j.version, 1);
  return Object.fromEntries(j.modelos.map((m) => [m.id, m]));
};

test("--tabla --json: Claude con sus dos ventanas y los gratis de OpenCode, con inteligencia y costo", () => {
  const t = tabla();
  const opus = t["claude-opus-5-5"]!;
  assert.equal(opus.proveedor, "claude");
  assert.equal(opus.calidad, 58, "unidades de AA: el 100 de la escala vieja");
  assert.equal(opus.estimada, false);
  assert.equal(opus.gratis, false);
  assert.equal(opus.permitido, true);
  assert.deepEqual(opus.ventanas.map((w) => [w.id, w.libre]), [["5h", 0.8], ["7d", 0.7]]);
  const bp = t["opencode:opencode/big-pickle"]!;
  assert.equal(bp.proveedor, "opencode");
  assert.equal(bp.gratis, true);
  assert.equal(bp.calidad, 43);
  assert.equal(bp.estimada, false, "tiene calidad de fábrica");
});

test("inteligencia por defecto: sin `calidad` se estima por el nombre (base 50, ultra/super/pro/max +10, flash/lightning/mini/nano -10) y se marca estimada", () => {
  const t = tabla();
  assert.deepEqual([t["opencode:opencode/zeta-ultra-free"]!.calidad, t["opencode:opencode/zeta-ultra-free"]!.estimada], [43, true]);
  assert.deepEqual([t["opencode:opencode/kilo-mini-free"]!.calidad, t["opencode:opencode/kilo-mini-free"]!.estimada], [37.3, true]);
  // fijada en modelos.json: ya no es estimada
  const m = modelos({ calidad_unidades: "aa", calidad: { "opencode:opencode/kilo-mini-free": 46 } });
  const t2 = tabla(m);
  assert.deepEqual([t2["opencode:opencode/kilo-mini-free"]!.calidad, t2["opencode:opencode/kilo-mini-free"]!.estimada], [46, false]);
});

test("la estimación entra al puntaje: un gratis `ultra` sin calidad propia pasa el mínimo de lectura (43) y uno `mini` no", () => {
  const f = cupos([0.9, "2026-10-26T15:00:00Z"], [0.99, "2026-10-31T12:00:00Z"]); // Claude casi sin cupo
  const r = reparto(["--tipo", "lectura", "--json"], f);
  const j = JSON.parse(r.out) as { candidatos: { modelo: string; calidad: number; descartado_por: string | null }[] };
  const c = Object.fromEntries(j.candidatos.map((x) => [x.modelo, x]));
  assert.equal(c["opencode:opencode/zeta-ultra-free"]!.descartado_por, null);
  assert.match(c["opencode:opencode/kilo-mini-free"]!.descartado_por ?? "", /calidad 37.3/);
});

test("excluir por id exacto saca a ese modelo (permitido false, con la regla) y deja los demás; una familia saca a todos los de la familia", () => {
  const t = tabla(modelos({ excluir: ["opencode:opencode/big-pickle", "haiku"] }));
  assert.equal(t["opencode:opencode/big-pickle"]!.permitido, false);
  assert.equal(t["opencode:opencode/big-pickle"]!.excluido_por, "opencode:opencode/big-pickle");
  assert.equal(t["opencode:opencode/glm-5.3-flash-free"]!.permitido, true);
  assert.equal(t["claude-haiku-5-5"]!.permitido, false);
  assert.equal(t["claude-haiku-5-5"]!.excluido_por, "haiku");
  assert.equal(t["claude-sonnet-5-5"]!.permitido, true);
});

test("--tabla en texto y --help la nombra", () => {
  const f = cupos([0.2, "2026-10-26T14:00:00Z"], [0.3, "2026-10-27T00:00:00Z"]);
  const r = reparto(["--tabla"], f);
  assert.equal(r.rc, 0);
  assert.match(r.out, /claude-sonnet-5-5\s+claude\s+51.0/);
  assert.match(r.out, /zeta-ultra-free\s+opencode\s+43.0~/);
  const h = reparto(["--help"], f);
  assert.match(h.out, /--tabla \[--json\]/);
});

test("prioridad por plan: Claude con cupo de sobra que se reinicia pronto gana al gratis de OpenCode (lectura)", () => {
  // 5 h: 80 % libre, vuelve en 2 h; semanal: 70 % libre, vuelve en 12 h
  const r = reparto(["--tipo", "lectura", "--json"], cupos([0.2, "2026-10-26T14:00:00Z"], [0.3, "2026-10-27T00:00:00Z"]));
  const j = JSON.parse(r.out) as { modelo: string };
  assert.match(j.modelo, /^claude-haiku/);
});

test("prioridad por plan: Claude con poco cupo y reset lejano pierde contra el gratis de OpenCode (lectura y mecanico)", () => {
  // 5 h: 60 % libre; semanal: 10 % libre, vuelve en 5 días
  for (const tipo of ["lectura", "mecanico"]) {
    const r = reparto(["--tipo", tipo, "--json"], cupos([0.4, "2026-10-26T15:00:00Z"], [0.9, "2026-10-31T12:00:00Z"]));
    const j = JSON.parse(r.out) as { modelo: string };
    assert.match(j.modelo, /^opencode:opencode\//, tipo);
  }
});

test("pa --modelos --json trae la inteligencia de cada modelo (estimada incluida) y el texto la lista", () => {
  const home = path.join(tmp, "home");
  mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
  writeFileSync(path.join(home, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [] }));
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PA_STATE: path.join(tmp, "pa-estado"),
    STATE: path.join(tmp, "pa-estado"),
    TRAMA_MODELOS: path.join(tmp, "no-hay.json"),
    TRAMA_CLAVES: path.join(tmp, "no-hay.env"),
    REPARTO_CUPOS_FIJOS: cupos([0.2, "2026-10-26T14:00:00Z"], [0.3, "2026-10-27T00:00:00Z"]),
    REPARTO_AHORA: AHORA,
    REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
    REPARTO_OPENCODE_FIJO: '["opencode/zeta-ultra-free"]',
    REPARTO_AGY: "0",
    PATH: `${path.dirname(REPARTO)}:${process.env.PATH}`,
  };
  const pa = path.join(path.dirname(REPARTO), "pa");
  const j = spawnSync(pa, ["--modelos", "--json"], { encoding: "utf8", env, timeout: 60_000 });
  assert.equal(j.status, 0, j.stderr);
  const i = JSON.parse(j.stdout).inteligencia;
  assert.deepEqual(i["claude-sonnet-5-5"], { calidad: 51, estimada: false, gratis: false, permitido: true });
  assert.equal(i["opencode:opencode/zeta-ultra-free"].estimada, true);
  const t = spawnSync(pa, ["--modelos"], { encoding: "utf8", env, timeout: 60_000 });
  assert.match(t.stdout, /inteligencia \(unidades de Artificial Analysis/);
  assert.match(t.stdout, /opencode:opencode\/zeta-ultra-free\s+43~ · gratis/);
});
