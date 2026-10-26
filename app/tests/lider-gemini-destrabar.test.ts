// «Destrabar solo cuando se repite» de punta a punta (electron/lider.ts → agy-puente.ts → scripts/agy-falso.mjs): un Gemini que se
// traba pidiendo lo mismo con el porcentaje subiendo se corta, recibe el aviso en su misma conversación y termina; con el
// tope de reintentos para y lo dice; con la opción apagada no hace nada. Nunca el agy de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-destrabar-"));
const home = path.join(tmp, "home");
mkdirSync(home, { recursive: true });
process.env.HOME = home;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "modelos.json");
process.env.TRAMA_DUENO = "Ana";
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_AGY = path.join(import.meta.dirname, "..", "scripts", "agy-falso.mjs");
process.env.TRAMA_FALSO_LOG = path.join(tmp, "agy.log");
process.env.TRAMA_FALSO_MS = "10";

const lider = await import("../electron/lider.ts");
const { leerDestrabos } = await import("../electron/destrabar-registro.ts");
type Ev = { sid: string; e: any };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 30_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const de = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).map((x) => x.e);
const llamadas = () => (existsSync(process.env.TRAMA_FALSO_LOG!) ? readFileSync(process.env.TRAMA_FALSO_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []).filter((l) => "prompt" in l);
const registros = (sid: string) =>
  readFileSync(path.join(process.env.HILOS_STATE!, "gemini", `${sid}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const marcas = (sid: string) => registros(sid).filter((r) => r.type === "system" && r.subtype === "trama_destrabo");
const nudges = () => llamadas().filter((l) => /Te trabaste repitiendo/.test(l.prompt));
const herramientas = (sid: string) => registros(sid).filter((r) => r.type === "assistant" && r.message?.content?.some?.((b: any) => b.type === "tool_use")).length;

test("un Gemini que se repite se corta, recibe el aviso en su conversación y termina bien (con una marca y la cuenta)", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "bucle: descargá eso" });
  await hasta(() => de(sid, "fin").length === 1);
  assert.equal(de(sid, "fin")[0].error, null, "el turno termina bien después del aviso");
  const n = nudges();
  assert.equal(n.length, 1);
  assert.ok(n[0].args.includes("--conversation"), "el aviso va a la misma conversación");
  assert.match(n[0].prompt, /un solo comando que bloquee hasta terminar/);
  const m = marcas(sid);
  assert.equal(m.length, 1);
  assert.equal(m[0].intento, 1);
  assert.match(m[0].que, /Bash: curl -s localhost:9\/progreso/);
  assert.ok(!m[0].agotado);
  // Cortó a los 6, no dejó correr las 12.
  assert.ok(herramientas(sid) < 12, `herramientas: ${herramientas(sid)}`);
  // Cada herramienta que quedó a medias se cerró (el chat no la deja girando).
  const r = registros(sid);
  const usos = r.flatMap((x) => (x.message?.content ?? []).filter?.((b: any) => b.type === "tool_use").map((b: any) => b.id) ?? []);
  const res = r.flatMap((x) => (x.message?.content ?? []).filter?.((b: any) => b.type === "tool_result").map((b: any) => b.tool_use_id) ?? []);
  assert.deepEqual(usos.filter((u: string) => !res.includes(u)), []);
  // La cuenta: una vez, y bien.
  const c = leerDestrabos();
  assert.equal(c.veces, 1);
  assert.equal(c.bien, 1);
});

test("el mismo error repetido también se corta, aunque cambie el comando", { timeout: 60_000 }, async () => {
  const antes = nudges().length;
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "bucle-error: probá eso" });
  await hasta(() => de(sid, "fin").length === 1);
  assert.equal(de(sid, "fin")[0].error, null);
  assert.equal(nudges().length, antes + 1);
  assert.equal(marcas(sid).length, 1);
});

test("si vuelve a trabarse después del aviso: a los 2 reintentos para, lo marca y termina con un error que lo dice", { timeout: 90_000 }, async () => {
  process.env.TRAMA_FALSO_BUCLE = "siempre";
  const antes = nudges().length;
  const veces = leerDestrabos().veces;
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "bucle: otra vez" });
  await hasta(() => de(sid, "fin").length === 1);
  delete process.env.TRAMA_FALSO_BUCLE;
  assert.match(String(de(sid, "fin")[0].error), /sigue repitiendo.*destrabó 2 veces/);
  assert.equal(nudges().length - antes, 2, "dos avisos, no más");
  const m = marcas(sid);
  assert.deepEqual(m.map((x) => x.intento), [1, 2, 3]);
  assert.deepEqual(m.map((x) => !!x.agotado), [false, false, true]);
  const c = leerDestrabos();
  assert.equal(c.veces - veces, 2);
  assert.equal(c.mal, 2);
});

test("con la opción apagada para ese modelo no hace nada: el bucle corre entero", { timeout: 60_000 }, async () => {
  writeFileSync(process.env.TRAMA_MODELOS!, JSON.stringify({ version: 1, destrabar: { "gemini-3.8-flash": false } }));
  const antes = nudges().length;
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "bucle: sin destrabar" });
  await hasta(() => de(sid, "fin").length === 1);
  assert.equal(nudges().length, antes);
  assert.equal(marcas(sid).length, 0);
  assert.equal(herramientas(sid), 12);
});

test("un modelo que no es Gemini 3.8 Flash viene apagado, y se prende desde Ajustes (modelos.json)", { timeout: 60_000 }, async () => {
  writeFileSync(process.env.TRAMA_MODELOS!, JSON.stringify({ version: 1 }));
  const antes = nudges().length;
  const sin = await lider.nuevo({ modelo: "gemini-4-argon", effort: "low", texto: "bucle: otro modelo" });
  await hasta(() => de(sin, "fin").length === 1);
  assert.equal(nudges().length, antes);
  assert.equal(herramientas(sin), 12);
  writeFileSync(process.env.TRAMA_MODELOS!, JSON.stringify({ version: 1, destrabar: { "gemini-4-argon": true } }));
  const con = await lider.nuevo({ modelo: "gemini-4-argon", effort: "low", texto: "bucle: prendido" });
  await hasta(() => de(con, "fin").length === 1);
  assert.equal(nudges().length, antes + 1);
  assert.equal(marcas(con).length, 1);
});
