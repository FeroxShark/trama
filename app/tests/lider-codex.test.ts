// Un líder de ChatGPT de punta a punta (electron/lider.ts → codex-puente.ts → scripts/codex-falso.mjs): contesta por el stream,
// corre con el modelo y el esfuerzo pedidos, el sandbox del modo y sin OPENAI_API_KEY; retoma su conversación con `resume`
// (también tras cerrar y volver, y en una nueva si codex la perdió); se para y sigue. Nunca el codex de verdad.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-codex-"));
const home = path.join(tmp, "home");
mkdirSync(home, { recursive: true });
writeFileSync(path.join(home, "CLAUDE.md"), "# Reglas de prueba\n- MARCA-CLAUDE-MD\n");
process.env.HOME = home;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "no-existe.json");
process.env.TRAMA_DUENO = "Ana";
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_CODEX = path.join(import.meta.dirname, "..", "scripts", "codex-falso.mjs");
process.env.TRAMA_FALSO_LOG = path.join(tmp, "codex.log");
process.env.OPENAI_API_KEY = "sk-no-se-usa";
process.env.PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");
process.env.TRAMA_FALSO_MS = "10";
process.env.TRAMA_FALSO_MS_LENTO = "3000";

const lider = await import("../electron/lider.ts");
const eventos: { sid: string; e: any }[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});

const de = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).map((x) => x.e);
const llamadas = () =>
  (existsSync(process.env.TRAMA_FALSO_LOG!) ? readFileSync(process.env.TRAMA_FALSO_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []).filter((l) => l.codex);
const textos = (sid: string) => de(sid, "mensaje").map((m) => m.texto as string);
const hilo = (sid: string) => JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "codex", `${sid}.json`), "utf8")).thread_id as string;
const val = (args: string[], f: string) => args[args.indexOf(f) + 1];
const M = "codex:gpt-6.1-sol";

test("un líder de ChatGPT contesta por el stream: modelo, esfuerzo, sandbox, sin OPENAI_API_KEY y con el prefacio; su transcript es aparte", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: M, effort: "high", texto: "herramienta hola" });
  await esperarHasta(() => de(sid, "fin").length === 1, { tope: 30_000 });
  assert.equal(de(sid, "fin")[0].error, null);
  assert.match(textos(sid).join("\n"), /eco: herramienta hola \(turno 1\)/);
  // El comando de codex se ve como un Bash de Claude.
  const hace = de(sid, "hace").filter((h) => h.hace.que === "herramienta").map((h) => h.hace.nombre);
  assert.ok(hace.includes("Bash"), JSON.stringify(hace));
  const [l] = llamadas();
  assert.equal(l.args[0], "exec");
  assert.ok(l.args.includes("--json"));
  assert.equal(val(l.args, "-m"), "gpt-6.1-sol");
  assert.ok(l.args.includes('model_reasoning_effort="high"'));
  assert.ok(l.args.includes('approval_policy="never"'));
  assert.equal(val(l.args, "--sandbox"), "danger-full-access", "el modo por defecto del líder (bypass) corre sin sandbox, como Gemini");
  assert.ok(!l.args.includes("resume"), "el primer turno abre la conversación");
  assert.equal(l.args.at(-1), "-", "el mensaje va por la entrada estándar");
  assert.deepEqual(l.env, [], `ninguna variable de Claude ni la clave de OpenAI: ${l.env}`);
  assert.match(l.prompt, /ChatGPT dentro de `codex`/);
  assert.match(l.prompt, /MARCA-CLAUDE-MD/, "codex no lee CLAUDE.md: el prefacio se lo da");
  assert.match(l.prompt, /Mensaje de [^\n]+:\nherramienta hola/);
  const t = await lider.transcriptDe(sid);
  assert.equal(t, path.join(process.env.HILOS_STATE!, "codex", `${sid}.jsonl`));
  assert.match(readFileSync(t!, "utf8"), /eco: herramienta hola/);
  await lider.cerrarTodos(false);
  assert.deepEqual(readdirSync(process.env.HILOS_SESIONES!).filter((f) => f.endsWith(".json")), []);
});

test("el segundo turno retoma la conversación de codex; también tras cerrar y volver; y si codex la perdió, se repite lo hablado", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: M, effort: "low", texto: "uno" });
  await esperarHasta(() => de(sid, "fin").length === 1, { tope: 30_000 });
  const hiloId = hilo(sid);
  assert.ok(hiloId);
  const n0 = llamadas().length;

  await lider.mandar({ sid, texto: "dos", modelo: M, effort: "low" });
  await esperarHasta(() => de(sid, "fin").length === 2, { tope: 30_000 });
  let l = llamadas()[n0]!;
  assert.equal(val(l.args, "resume"), hiloId);
  assert.ok(!/ChatGPT dentro de/.test(l.prompt), "el prefacio va sólo en la conversación nueva");
  assert.match(textos(sid).at(-1)!, /eco: dos \(turno 2\)/);

  await lider.cerrarTodos(false);
  await lider.mandar({ sid, texto: "tres", modelo: M, effort: "low" });
  await esperarHasta(() => de(sid, "fin").length === 3, { tope: 30_000 });
  l = llamadas().at(-1)!;
  assert.equal(val(l.args, "resume"), hiloId);
  assert.match(textos(sid).at(-1)!, /\(turno 3\)/);

  rmSync(path.join(process.env.HILOS_STATE!, "codex-falso", hiloId));
  const n1 = llamadas().length;
  await lider.mandar({ sid, texto: "cuatro", modelo: M, effort: "low" });
  await esperarHasta(() => de(sid, "fin").length === 4, { tope: 30_000 });
  const intentos = llamadas().slice(n1);
  assert.equal(intentos.length, 2, "el que falló y el repetido");
  assert.ok(intentos[0]!.args.includes("resume"));
  assert.ok(!intentos[1]!.args.includes("resume"));
  assert.match(intentos[1]!.prompt, /eco: uno/, "lo hablado antes viaja en el prompt");
  assert.equal(de(sid, "fin")[3].error, null, "el turno repetido termina bien y no se ve el error del primero");
  assert.notEqual(hilo(sid), hiloId);
});

test("parar corta el turno de codex y el líder sigue en la misma conversación; si codex se cae, el turno termina con el error", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: M, effort: "medium", texto: "despacio herramienta" });
  await esperarHasta(() => de(sid, "hace").some((h) => h.hace.que === "herramienta"), { tope: 30_000 });
  lider.parar(sid);
  await esperarHasta(() => de(sid, "fin").length === 1, { tope: 30_000 });
  assert.equal(lider.procDe(sid)?.ocupado, false);
  assert.equal(de(sid, "salio").length, 0, "parar no mata al puente");
  const hiloId = hilo(sid);

  // Retomar: el próximo mensaje sigue la misma conversación.
  await lider.mandar({ sid, texto: "seguí", modelo: M, effort: "medium" });
  await esperarHasta(() => de(sid, "fin").length === 2, { tope: 30_000 });
  assert.equal(de(sid, "fin")[1].error, null);
  assert.equal(val(llamadas().at(-1)!.args, "resume"), hiloId);
  assert.match(textos(sid).at(-1)!, /eco: seguí/);

  await lider.mandar({ sid, texto: "morite", modelo: M, effort: "medium" });
  await esperarHasta(() => de(sid, "fin").length === 3, { tope: 30_000 });
  assert.match(String(de(sid, "fin")[2].error), /codex|me muero/);
});

test("el modo plan corre a codex en sólo lectura", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: M, effort: "low", texto: "mirá", modo: "plan" });
  await esperarHasta(() => de(sid, "fin").length === 1, { tope: 30_000 });
  assert.equal(val(llamadas().at(-1)!.args, "--sandbox"), "read-only");
});
