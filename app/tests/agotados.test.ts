// El rótulo «sin cupo gratis» del selector y el «Cambiar de modelo» del aviso (src/hilo/agotados.ts), y la marca de electron/opencode-agotado.ts
// (el mismo agotado.json que lee motor/bin/reparto).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { esAvisoSinCupoOpencode, esGratisOpencode, marcarAgotadas, opencodeAgotadoDe, proveedorLibre } from "../src/hilo/agotados.ts";
import { dirEstadoReparto, esLimiteGratisOpencode, marcarOpencodeAgotado, opencodeAgotadoHasta, VENCE_SIN_HORA_MS } from "../electron/opencode-agotado.ts";

const ops = [
  { id: "claude-opus-5-5", nombre: "Opus", desc: "", grupo: "Anthropic" },
  { id: "opencode:opencode/deepseek-v4.1-flash-free", nombre: "DS", desc: "", grupo: "OpenCode" },
  { id: "opencode:opencode/big-pickle", nombre: "BP", desc: "", grupo: "OpenCode" },
  { id: "opencode:anthropic/claude-x", nombre: "Pago", desc: "", grupo: "OpenCode" },
];

test("el rótulo agota a todos los gratis de OpenCode, no a los de pago ni a otros proveedores", () => {
  assert.ok(esGratisOpencode(ops[1].id) && esGratisOpencode(ops[2].id));
  assert.ok(!esGratisOpencode(ops[3].id) && !esGratisOpencode(ops[0].id));
  const r = marcarAgotadas(ops, 2000, 1000);
  assert.deepEqual(r.map((o) => !!(o as any).agotada), [false, true, true, false]);
  assert.equal(marcarAgotadas(ops, null, 1000), ops);
  assert.equal(marcarAgotadas(ops, 500, 1000), ops, "vencida: sin rótulo");
});

test("el Uso trae la marca como suscripción opencode; sin ella o vencida, nada", () => {
  const uso: any = { version: 1, suscripciones: [{ id: "opencode", nombre: "OpenCode", ts: 0, grupos: [{ id: "opencode-free", nombre: "x", ventanas: [], agotado: 2000 }] }] };
  assert.equal(opencodeAgotadoDe(uso, 1000), 2000);
  assert.equal(opencodeAgotadoDe(uso, 3000), null);
  assert.equal(opencodeAgotadoDe(null), null);
  assert.equal(opencodeAgotadoDe({ version: 9, error: "x" } as any), null);
});

test("«Cambiar de modelo» abre en un proveedor que no es OpenCode gratis", () => {
  assert.equal(proveedorLibre(marcarAgotadas(ops, 2000, 1000)), "Anthropic");
  assert.equal(proveedorLibre(marcarAgotadas(ops.slice(1, 3), 2000, 1000)), null);
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
