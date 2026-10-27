// Migración de la inteligencia de modelos.json: escala vieja 0–100 (Haiku 60, Sonnet 88, Opus 100) → unidades reales de Artificial Analysis.
// electron/calidad-migracion.ts es la inversa de la calibración que `reparto` ya no hace; motor/bin/reparto tiene la misma cuenta (`vieja_a_aa`):
// el último test las compara. Con "calidad_unidades": "aa" nada se toca.
import { test } from "node:test";
import { testPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { viejaAAa, migrarValor, esUnidadesAA, AA_REF_VIEJA } from "../electron/calidad-migracion.ts";
import { leerConfig, unir } from "../electron/modelos-tipos.ts";

test("las anclas de la escala vieja caen en sus unidades de AA (Haiku 60 → 43, Sonnet 88 → 51, Opus 100 → 58)", () => {
  assert.deepEqual(AA_REF_VIEJA.map(([v]) => viejaAAa(v)), [43, 51, 58]);
});

test("entre anclas es lineal por tramos; bajo Haiku sigue la pendiente Haiku–Sonnet; nunca negativa; crece con la escala vieja", () => {
  assert.equal(viejaAAa(74), 47);
  assert.equal(viejaAAa(94), 54.5);
  assert.equal(viejaAAa(40), 37.3);
  assert.equal(viejaAAa(0), 25.9);
  assert.equal(viejaAAa(-1000), 0);
  const v = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(viejaAAa);
  assert.deepEqual([...v].sort((a, b) => a - b), v);
});

test("leerConfig: sin calidad_unidades los números son de la escala vieja y se migran; con 'aa' quedan igual", () => {
  assert.deepEqual(leerConfig({ calidad: { opus: 100, haiku: 60, "dsh:x": 40 } }).calidad, { opus: 58, haiku: 43, "dsh:x": 37.3 });
  assert.deepEqual(leerConfig({ calidad_unidades: "aa", calidad: { opus: 58, haiku: 43.4 } }).calidad, { opus: 58, haiku: 43.4 });
  assert.equal(esUnidadesAA({ calidad_unidades: "aa" }), true);
  assert.equal(esUnidadesAA({ calidad_unidades: "viejo" }), false);
  assert.equal(migrarValor(88, {}), 51);
  assert.equal(migrarValor(88, { calidad_unidades: "aa" }), 88);
});

test("unir: migra una sola vez calidad_effort y minimo_por_tipo numérico al escribir el marcador; las familias quedan; ya migrado no se toca", () => {
  const antes = { calidad_effort: { opus: { low: 60, high: 88 } }, minimo_por_tipo: { lectura: 74, debug: "argon" }, calidad: { opus: 100 } };
  const c = leerConfig(antes);
  const j1 = unir(antes, c);
  assert.equal(j1.calidad_unidades, "aa");
  assert.deepEqual(j1.calidad, { opus: 58 });
  assert.deepEqual(j1.calidad_effort, { opus: { low: 43, high: 51 } });
  assert.deepEqual(j1.minimo_por_tipo, { lectura: 47, debug: "argon" });
  const j2 = unir(j1, leerConfig(j1));
  assert.deepEqual(j2.calidad_effort, j1.calidad_effort, "segunda vuelta: igual");
  assert.deepEqual(j2.calidad, j1.calidad);
  assert.equal("calidad_unidades" in unir({ excluir: ["x"] }, leerConfig({ excluir: ["x"] })), false, "sin nada de calidad no se agrega el marcador");
});

testPosix("la misma cuenta en reparto (vieja_a_aa)", () => {
  const xs = [0, 12, 35, 40, 55, 60, 70, 77, 85, 88, 90, 100];
  const r = spawnSync("python3", ["-B", "-c", `import importlib.machinery, importlib.util, json, sys
sys.dont_write_bytecode = True
l = importlib.machinery.SourceFileLoader("reparto", ${JSON.stringify(path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto"))})
sp = importlib.util.spec_from_loader("reparto", l)
R = importlib.util.module_from_spec(sp); l.exec_module(R)
print(json.dumps([R.vieja_a_aa(x) for x in ${JSON.stringify(xs)}]))`], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), xs.map(viejaAAa));
});
