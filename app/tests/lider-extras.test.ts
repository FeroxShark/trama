// Ultracode y Fast de un líder de la app, con el claude falso de scripts/ (que contesta apply_flag_settings y get_settings como el 2.1.329 real):
// al arrancar (Fast en el argv, Ultracode por apply_flag_settings), en vivo, rechazado, y re-pedido tras un cambio de esfuerzo (que lo apaga).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esperarHasta } from "./esperar.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-extras-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
const LOG = path.join(tmp, "falso.log");
process.env.TRAMA_FALSO_LOG = LOG;
process.env.TRAMA_FALSO_MS = "5";

const lider = await import("../electron/lider.ts");
after(() => lider.cerrarTodos(true));

const OPUS = { modelo: "claude-opus-5-5", effort: "high" };
const lineas = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { args?: string[]; control?: string; settings?: Record<string, unknown> }) : []);
const controles = () => lineas().filter((l) => l.control === "apply_flag_settings").map((l) => l.settings);
const guardado = async (sid: string) => (await lider.lideresApp()).find((g) => g.sid === sid);

test("un líder nuevo con Fast y Ultracode: --fast-mode on en el argv y Ultracode por apply_flag_settings tras el arranque", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ ...OPUS, texto: "hola", ultracode: true, fast: true });
  assert.equal((await guardado(sid))?.ultracode, true);
  assert.equal((await guardado(sid))?.fast, true);
  await esperarHasta(() => controles().some((s) => s?.ultracode === true));
  const arranque = lineas().find((l) => l.args?.includes("--session-id") && l.args.includes(sid));
  assert.ok(arranque?.args?.join(" ").includes("--fast-mode on"), "Fast va en el argv");
  assert.ok(!arranque?.args?.join(" ").includes("ultracode"), "Ultracode no va en el argv");
});

test("Fast con un modelo que no lo sirve (Sonnet): se anota pero el argv no lleva --fast-mode; sin nada pedido, cambiarExtras falla", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-sonnet-5-5", effort: "high", texto: "hola", fast: true });
  // Queda anotado (el modelo puede cambiar a uno que sí lo sirva), pero el argv no lleva --fast-mode: sólo Opus y Fable lo sirven.
  assert.equal((await guardado(sid))?.fast, true);
  const arranque = lineas().find((l) => l.args?.includes("--session-id") && l.args.includes(sid));
  assert.ok(!arranque?.args?.includes("--fast-mode"));
  await assert.rejects(lider.cambiarExtras(sid, {}), /extrasDato/);
});

test("cambiarExtras en vivo: prende y apaga Ultracode y Fast, comprueba con get_settings y lo guarda", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ ...OPUS, texto: "hola" });
  await esperarHasta(() => lider.procDe(sid)?.ocupado === false, { tope: 8000 });
  assert.equal((await guardado(sid))?.ultracode, undefined);
  const antes = controles().length;
  assert.deepEqual(await lider.cambiarExtras(sid, { ultracode: true }), { ok: true });
  assert.equal((await guardado(sid))?.ultracode, true);
  assert.deepEqual(controles().slice(antes), [{ ultracode: true }]);
  assert.deepEqual(await lider.cambiarExtras(sid, { fast: true }), { ok: true });
  assert.equal((await guardado(sid))?.fast, true);
  assert.deepEqual(controles().at(-1), { fastMode: true });
  assert.deepEqual(await lider.cambiarExtras(sid, { ultracode: false, fast: false }), { ok: true });
  const g = await guardado(sid);
  assert.equal("ultracode" in g!, false);
  assert.equal("fast" in g!, false);
});

test("si Claude Code no lo deja en vigor, Ultracode queda apagado, no se guarda y se devuelve el rechazo", { timeout: 20_000 }, async () => {
  process.env.TRAMA_FALSO_ULTRACODE = "no";
  try {
    const sid = await lider.nuevo({ ...OPUS, texto: "hola" });
    await esperarHasta(() => lider.procDe(sid)?.ocupado === false, { tope: 8000 });
    const r = await lider.cambiarExtras(sid, { ultracode: true });
    assert.equal(r.ok, false);
    assert.equal((await guardado(sid))?.ultracode, undefined);
    // Lo deja apagado también del lado de claude (la última orden fue ultracode: false).
    assert.deepEqual(controles().at(-1), { ultracode: false });
    // Pedido desde la caja de un líder nuevo, el rechazo del arranque lo apaga solo.
    const nuevo = await lider.nuevo({ ...OPUS, texto: "hola", ultracode: true });
    await esperarHasta(async () => (await guardado(nuevo))?.ultracode === undefined);
  } finally {
    delete process.env.TRAMA_FALSO_ULTRACODE;
  }
});

test("un cambio de esfuerzo en vivo apaga Ultracode en Claude Code: la app lo vuelve a pedir", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ ...OPUS, texto: "hola" });
  await esperarHasta(() => lider.procDe(sid)?.ocupado === false, { tope: 8000 });
  assert.deepEqual(await lider.cambiarExtras(sid, { ultracode: true }), { ok: true });
  const antes = controles().length;
  await lider.mandar({ sid, texto: "otra", modelo: OPUS.modelo, effort: "low" });
  await esperarHasta(() => controles().length >= antes + 2);
  assert.deepEqual(controles().slice(antes, antes + 2), [{ effortLevel: "low" }, { ultracode: true }]);
  assert.equal((await guardado(sid))?.ultracode, true);
});

test("sin proceso (dormido) sólo se guarda: vale desde el próximo arranque", { timeout: 20_000 }, async () => {
  const sid = await lider.nuevo({ ...OPUS, texto: "hola" });
  await esperarHasta(() => lider.procDe(sid)?.ocupado === false, { tope: 8000 });
  // Sin proceso pero todavía en la lista (como al reiniciar Trama): sólo se guarda.
  await lider.cerrarTodos(true);
  await esperarHasta(() => !lider.procDe(sid));
  const antes = controles().length;
  assert.deepEqual(await lider.cambiarExtras(sid, { ultracode: true, fast: true }), { ok: true });
  assert.equal(controles().length, antes, "sin proceso no hay a quién decírselo");
  assert.equal((await guardado(sid))?.ultracode, true);
  assert.equal((await guardado(sid))?.fast, true);
});
