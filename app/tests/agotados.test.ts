// El rótulo «sin cupo» del selector y el «Cambiar de modelo» del aviso (src/hilo/agotados.ts), y la marca de electron/opencode-agotado.ts
// (el mismo agotado.json que lee motor/bin/reparto). El cupo de cada modelo sale de src/hilo/cupo-modelos.ts (lo prueba cupo-modelos.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { esAvisoSinCupoOpencode, esGratisOpencode, goAgotadosHasta, proveedorLibre } from "../src/hilo/agotados.ts";
import { estadosCupoModelos } from "../src/hilo/cupo-modelos.ts";
import { dirEstadoReparto, esLimiteGratisOpencode, marcarOpencodeAgotado, opencodeAgotadoHasta, VENCE_SIN_HORA_MS } from "../electron/opencode-agotado.ts";

const ops = [
  { id: "claude-opus-5-5", nombre: "Opus", desc: "", grupo: "Anthropic", col: "anthropic" },
  { id: "opencode:opencode/deepseek-v4.1-flash-free", nombre: "DS", desc: "", grupo: "OpenCode", col: "opencode" },
  { id: "opencode:opencode/big-pickle", nombre: "BP", desc: "", grupo: "OpenCode", col: "opencode" },
  { id: "opencode:anthropic/claude-x", nombre: "Pago", desc: "", grupo: "OpenCode", col: "opencode" },
];
const AHORA = 1000;

test("el OpenCode gratis es uno solo: sus modelos gratis se marcan, los de pago no", () => {
  assert.ok(esGratisOpencode(ops[1].id) && esGratisOpencode(ops[2].id));
  assert.ok(!esGratisOpencode(ops[3].id) && !esGratisOpencode(ops[0].id));
  const uso: any = { version: 1, five_hour: null, seven_day: null, suscripciones: [{ id: "opencode", nombre: "OpenCode", ts: 0, grupos: [{ id: "opencode-free", nombre: "x", ventanas: [], agotado: 2000 }] }] };
  const m = estadosCupoModelos(ops.map((o) => o.id), uso, AHORA);
  assert.deepEqual([...m.keys()], [ops[1].id, ops[2].id]);
  assert.equal(m.get(ops[1].id)?.vuelve, 2000);
  assert.equal(m.get(ops[1].id)?.sin, true);
  assert.equal(estadosCupoModelos(ops.map((o) => o.id), uso, 3000).size, 0, "vencida: sin rótulo");
});

test("los de Go agotados se leen por su id en minúsculas", () => {
  const uso: any = { version: 1, five_hour: null, seven_day: null, suscripciones: [{ id: "opencode", nombre: "OpenCode", ts: 0, grupos: [{ id: "opencode:opencode-go/GLM-5", nombre: "Go", ventanas: [], agotado: 2000 }] }] };
  assert.deepEqual([...goAgotadosHasta(uso, 1000)], [["opencode:opencode-go/glm-5", 2000]]);
  assert.equal(goAgotadosHasta(uso, 3000).size, 0);
  assert.equal(goAgotadosHasta(null).size, 0);
  assert.equal(goAgotadosHasta({ version: 9, error: "x" } as any).size, 0);
});

test("«Cambiar de modelo» abre en un proveedor que no es OpenCode gratis ni está sin cupo", () => {
  assert.equal(proveedorLibre(ops, new Map()), "anthropic");
  const sinOpus = new Map([[ops[0].id, { sin: true, vuelve: null, poco: false, libre: 0 }]]);
  assert.equal(proveedorLibre(ops, sinOpus), "opencode", "el primero que queda es el de pago de OpenCode");
  assert.equal(proveedorLibre(ops.slice(0, 1), sinOpus), null);
  assert.equal(proveedorLibre(ops.slice(1, 3), new Map()), null, "sólo gratis de OpenCode");
  assert.ok(esAvisoSinCupoOpencode("\u0001i18n:main.opencodeSinCupo\u0001{}\u0001"));
  assert.ok(!esAvisoSinCupoOpencode("boom"));
});

test("detección del límite gratis (el error crudo del ACP) y marca en agotado.json con vencimiento de 1 h", () => {
  assert.ok(esLimiteGratisOpencode('session/prompt: Internal error: Free usage limit reached. Connect a provider — {"service":"session","errorName":"provider.free-limit"}'));
  assert.ok(esLimiteGratisOpencode("429 FreeUsageLimitError"));
  assert.ok(!esLimiteGratisOpencode("rate limited"));
  const dir = mkdtempSync(path.join(os.tmpdir(), "agotado-"));
  try {
    const env = { REPARTO_STATE: dir } as NodeJS.ProcessEnv;
    assert.equal(dirEstadoReparto(env), dir);
    assert.equal(opencodeAgotadoHasta(env, 1000), null);
    writeFileSync(path.join(dir, "agotado.json"), JSON.stringify({ otro: { hasta: "2999-01-01T00:00:00Z" }, viejo: { hasta: "2000-01-01T00:00:00Z" } }));
    const ahora = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(marcarOpencodeAgotado(undefined, env, ahora), ahora + VENCE_SIN_HORA_MS);
    const f = JSON.parse(readFileSync(path.join(dir, "agotado.json"), "utf8"));
    assert.equal(f["opencode-free"].hasta, "2026-01-01T01:00:00Z");
    assert.ok(f.otro && !f.viejo, "conserva los otros grupos vigentes y tira los vencidos");
    assert.equal(opencodeAgotadoHasta(env, ahora + 1000), ahora + VENCE_SIN_HORA_MS);
    assert.equal(opencodeAgotadoHasta(env, ahora + VENCE_SIN_HORA_MS + 1), null);
    assert.equal(marcarOpencodeAgotado(ahora + 5 * 3600_000, env, ahora), ahora + 5 * 3600_000, "con hora conocida, esa");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
