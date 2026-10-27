// "Medir exacto" el peso de arrancar (electron/arranque.ts), a pedido, con el claude falso: los cuatro
// pedidos de a uno, la resta de cada parte, lo que queda guardado, y los fallos que se dicen sin tirar.
import { test } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-arranque-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
const FALSO = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
const { crearArranque, usoDe, partesDe } = await import("../electron/arranque.ts");

const nuevo = (env: NodeJS.ProcessEnv = {}, estado = path.join(tmp, "e" + Math.random().toString(36).slice(2))) =>
  crearArranque({ claude: FALSO, cwd: tmp, env: { ...process.env, ...env }, estado, ahora: () => 1_760_000_000_000 });

test("usoDe: entrada + caché escrito + caché leído, de un objeto o de la lista de mensajes", () => {
  const r = { type: "result", usage: { input_tokens: 6, cache_creation_input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 999 } };
  assert.equal(usoDe(JSON.stringify(r)), 126);
  assert.equal(usoDe(JSON.stringify([{ type: "system" }, r])), 126);
  assert.equal(usoDe(JSON.stringify({ ...r, is_error: true })), null);
  assert.equal(usoDe(JSON.stringify({ type: "result" })), null);
  assert.equal(usoDe("no es json"), null);
});

test("partesDe: cada parte es una resta y nunca da negativo", () => {
  assert.deepEqual(partesDe({ completo: 33480, sinSkills: 30380, sinMcp: 31780, vacio: 14300 }), {
    sistema: 14300, skills: 3100, mcp: 1700, resto: 14380,
  });
  const raro = partesDe({ completo: 100, sinSkills: 120, sinMcp: 100, vacio: 150 });
  for (const n of Object.values(raro)) assert.ok(n >= 0);
});

test("medir: mide los cuatro pedidos, lo guarda y leer lo devuelve", { skip: soloPosix("ejecuta claude-falso.mjs por shebang") }, async () => {
  const a = nuevo();
  assert.equal(await a.leer(), null, "antes de medir no hay nada");
  const r = await a.medir();
  assert.ok(!("error" in r), JSON.stringify(r));
  assert.equal(r.total, 33480);
  assert.deepEqual(r.partes, { sistema: 14300, skills: 3100, mcp: 1700, resto: 14380 });
  assert.equal(r.medido_en, 1_760_000_000_000);
  assert.equal(r.partes.sistema + r.partes.skills + r.partes.mcp + r.partes.resto, r.total, "las partes suman el total");
  assert.deepEqual(await a.leer(), r);
});

test("medir: apretar de nuevo mientras corre espera el mismo resultado", { skip: soloPosix("ejecuta claude-falso.mjs por shebang") }, async () => {
  const a = nuevo();
  const [x, y] = await Promise.all([a.medir(), a.medir()]);
  assert.strictEqual(x, y);
});

test("medir: un error de claude se dice y no deja nada guardado", { skip: soloPosix("ejecuta claude-falso.mjs por shebang") }, async () => {
  const estado = path.join(tmp, "falla");
  const a = nuevo({ TRAMA_FALSO_MEDIR_FALLA: "error" }, estado);
  const r = await a.medir();
  assert.ok("error" in r && r.error.length > 0);
  assert.equal(await a.leer(), null);
  assert.equal(existsSync(path.join(estado, "arranque-medido.json")), false);
});

test("medir: una respuesta sin uso se dice, y lo medido antes sigue ahí", { skip: soloPosix("ejecuta claude-falso.mjs por shebang") }, async () => {
  const estado = path.join(tmp, "sin-uso");
  assert.ok(!("error" in (await nuevo({}, estado).medir())));
  const r = await nuevo({ TRAMA_FALSO_MEDIR_FALLA: "sin-uso" }, estado).medir();
  assert.ok("error" in r);
  assert.equal((await nuevo({}, estado).leer())?.total, 33480);
});

test("leer: un archivo de otra versión o roto es como si no hubiera", async () => {
  const estado = path.join(tmp, "roto");
  const a = nuevo({}, estado);
  await a.medir();
  const f = path.join(estado, "arranque-medido.json");
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), version: 2 }));
  assert.equal(await a.leer(), null);
  writeFileSync(f, "{ roto");
  assert.equal(await a.leer(), null);
});
