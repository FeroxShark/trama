// CTX-11: `pa` lee el tipo de suscripción de las credenciales de Claude Code (sólo el plan, nunca los tokens) cuando no hay un plan elegido.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { planDe, planDeCuentaEnUso } from "../electron/cli/pa/entorno.ts";
import { haySesionClaude, planDeCredenciales, planPaDeClaude } from "../electron/credenciales-claude.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "plan-cred-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const io = { out: () => undefined, err: () => undefined } as unknown as Parameters<typeof planDe>[2];
/** Un home falso con `.claude/.credentials.json` (token inventado) del tipo pedido; `null` = sin archivo. */
function homeCon(tipo: string | null, tier = "default_claude_max_5x"): string {
  const home = path.join(tmp, `h${n++}`);
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  if (tipo !== null) writeFileSync(path.join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "token-falso", subscriptionType: tipo, rateLimitTier: tier } }));
  return home;
}
const estado = () => {
  const d = path.join(tmp, `s${n++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

describe("plan desde las credenciales de Claude Code", () => {
  test("planDe: una cuenta Max (5x) sin plan elegido no cae a pro", () => {
    assert.equal(planDe({}, estado(), io, homeCon("max")), "max");
    assert.equal(planDe({}, estado(), io, homeCon("max", "default_claude_max_20x")), "max");
  });
  test("planDe: una cuenta Pro da pro, y sin archivo o con un tipo raro queda en pro", () => {
    assert.equal(planDe({}, estado(), io, homeCon("pro", "default_claude_pro")), "pro");
    assert.equal(planDe({}, estado(), io, homeCon(null)), "pro");
    assert.equal(planDe({}, estado(), io, homeCon("enterprise")), "pro");
  });
  test("planDe: PA_PLAN y `$STATE/plan` mandan sobre las credenciales", () => {
    assert.equal(planDe({ PA_PLAN: "pro" }, estado(), io, homeCon("max")), "pro");
    const st = estado();
    writeFileSync(path.join(st, "plan"), "pro\n");
    assert.equal(planDe({}, st, io, homeCon("max")), "pro");
  });
  test("planDe: CLAUDE_CONFIG_DIR apunta a la carpeta de la sesión", () => {
    const otro = path.join(tmp, `o${n++}`);
    mkdirSync(otro, { recursive: true });
    writeFileSync(path.join(otro, ".credentials.json"), JSON.stringify({ claudeAiOauth: { subscriptionType: "max", rateLimitTier: "x_max_5x" } }));
    assert.equal(planDe({ CLAUDE_CONFIG_DIR: otro }, estado(), io, homeCon("pro", "x")), "max");
  });
  test("planDeCuentaEnUso: una cuenta agregada sin plan propio usa el de su carpeta", () => {
    const home = homeCon(null);
    const dir = path.join(home, "gonza");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { subscriptionType: "max", rateLimitTier: "x_max_20x" } }));
    const f = path.join(home, "cuentas.json");
    writeFileSync(f, JSON.stringify({ version: 1, cuentas: [{ id: "gonza", proveedor: "claude", nombre: "G", dir }], preferidas: { claude: "gonza" } }));
    assert.equal(planDeCuentaEnUso({ TRAMA_CUENTAS: f }, home), "max");
    // el plan elegido a mano sigue mandando
    writeFileSync(f, JSON.stringify({ version: 1, cuentas: [{ id: "gonza", proveedor: "claude", nombre: "G", dir, plan: "pro" }], preferidas: { claude: "gonza" } }));
    assert.equal(planDeCuentaEnUso({ TRAMA_CUENTAS: f }, home), "pro");
  });
  test("las funciones no devuelven nada del token", () => {
    const home = homeCon("max");
    const dir = path.join(home, ".claude");
    for (const r of [planPaDeClaude(dir), planDeCredenciales(JSON.stringify({ claudeAiOauth: { accessToken: "token-falso", subscriptionType: "pro" } }))]) assert.ok(!String(r).includes("token"));
    assert.equal(haySesionClaude(dir), true);
    assert.equal(haySesionClaude(homeCon(null)), false);
  });
});
