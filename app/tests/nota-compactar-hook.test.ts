// Hook «nota-compactar» (motor/hooks/nota-compactar.mjs y nota-compactar-textos.mjs), las claves de modelos.json y su
// registro en líderes de la app (cierre-cupo-texto.ts + lider.ts) y workers de `pa` (cli/pa/lanzar.ts).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { soloPosix } from "./plataforma.ts";
import { esperarHasta } from "./esperar.ts";
import { ARCHIVOS_NOTA_COMPACTAR, comandoNotaCompactar, EVENTOS_NOTA_COMPACTAR } from "../electron/cli/hooks.ts";
import { settingsCierreCupo } from "../electron/cierre-cupo-texto.ts";
import { argvLider } from "../electron/lider-arma.ts";
import { armarLanzamiento, settingsWorker, type Corrida } from "../electron/cli/pa/lanzar.ts";
import { Modelos, problemaModelos } from "../electron/cli/pa/modelos.ts";
import type { Pa } from "../electron/cli/pa/entorno.ts";
import { guardarModelos, leerModelos, notaCompactarGuardado, notaCompactarPctGuardado, notaCompactarTareaPctGuardado } from "../electron/modelos-config.ts";
import { leerConfig, umbralesNota, unir, validarConfig } from "../electron/modelos-tipos.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const HOOKS = path.join(import.meta.dirname, "..", "..", "motor", "hooks");
const HOOK = path.join(HOOKS, "nota-compactar.mjs");
const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");

const hookMod = (await import(pathToFileURL(HOOK).href)) as {
  TAIL_BYTES: number;
  estadoHilos: (e?: Record<string, string | undefined>, plat?: string) => string;
  parsearArgs: (argv?: string[]) => { umbral: number | null; umbralTarea: number | null };
  leerColaTranscript: (ruta: string, maxBytes?: number) => string[];
  ultimoUsoDeLineas: (lineas: string[]) => { tokens: number | null; compactada: boolean };
  extraerNotaDeTexto: (texto: string) => string | null;
  ultimaNotaDeLineas: (lineas: string[], o?: { trasCompact?: boolean }) => { texto: string; tsMs: number | null } | null;
  decidir: (o: {
    evento: string;
    source?: string;
    sesion: string;
    transcript?: string;
    umbral?: number | null;
    umbralTarea?: number | null;
    hilos?: string;
    ahoraMs?: number;
    idioma?: string;
    tailBytes?: number;
    esSubagente?: boolean;
  }) => Promise<{ hookSpecificOutput: { hookEventName: string; additionalContext: string } } | null>;
};

const { textoDevolucionNota, TOPE_NOTA } = (await import(pathToFileURL(path.join(HOOKS, "nota-compactar-textos.mjs")).href)) as {
  TOPE_NOTA: number;
  textoDevolucionNota: (o: { idioma?: string; nota: string; minutos?: number | null; archivo?: string; tope?: number }) => string;
};

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-nota-compactar-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let seq = 0;
const nuevoDir = () => {
  const d = path.join(tmp, `c${++seq}`);
  mkdirSync(d, { recursive: true });
  return d;
};

const linAsistente = (content: unknown, usage?: Record<string, number>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", timestamp: "2026-11-21T10:00:00Z", message: { id: "m1", model: "claude-opus-5-5", content, ...(usage ? { usage } : {}) }, ...extra });

const escribirTranscript = (ruta: string, lineas: string[]) => writeFileSync(ruta, lineas.join("\n") + "\n");

// ============================================================================ Hook puro y estado en disco

test("ruta de estado en win32 con usuario de mentira trama-falso y en Linux", () => {
  assert.equal(hookMod.estadoHilos({ USERPROFILE: "C:\\Users\\trama-falso" }, "win32"), "C:\\Users\\trama-falso\\AppData\\Local\\trama\\estado\\hilos");
  assert.equal(
    hookMod.estadoHilos({ USERPROFILE: "C:\\Users\\trama-falso", LOCALAPPDATA: "D:\\datos" }, "win32"),
    "D:\\datos\\trama\\estado\\hilos",
  );
  assert.equal(hookMod.estadoHilos({ HOME: "/home/trama-falso" }, "linux"), "/home/trama-falso/.local/state/hilos");
  assert.equal(hookMod.estadoHilos({ HILOS_STATE: "/estado/propio", USERPROFILE: "C:\\Users\\trama-falso" }, "win32"), "/estado/propio");
});

test("parsearArgs lee --umbral y --umbral-tarea y los deja null si faltan o no sirven", () => {
  assert.deepEqual(hookMod.parsearArgs(["--umbral", "255000", "--umbral-tarea", "180000"]), { umbral: 255000, umbralTarea: 180000 });
  assert.deepEqual(hookMod.parsearArgs(["--umbral=170000", "--umbral-tarea=120000"]), { umbral: 170000, umbralTarea: 120000 });
  assert.deepEqual(hookMod.parsearArgs([]), { umbral: null, umbralTarea: null });
  assert.deepEqual(hookMod.parsearArgs(["--umbral", "abc", "--umbral-tarea", "-1"]), { umbral: null, umbralTarea: null });
  assert.deepEqual(hookMod.parsearArgs(["--umbral", "-5"]), { umbral: null, umbralTarea: null });
});

test("no pide bajo el umbral ni sin umbral; pide suave una vez y fuerte una sola vez por ciclo", async () => {
  const dir = nuevoDir();
  const tr = path.join(dir, "s1.jsonl");
  const usoBajo = { input_tokens: 1000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 5000 };
  escribirTranscript(tr, [linAsistente([{ type: "text", text: "hola" }], usoBajo)]);
  assert.equal(await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, umbralTarea: 120_000, hilos: dir }), null);
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), false);
  assert.equal(existsSync(path.join(dir, "notas", "s1.sugerida")), false);

  // Entre suave (120k) y fuerte (170k): sugiere una sola vez (.sugerida)
  escribirTranscript(tr, [linAsistente([{ type: "text", text: "a mitad" }], { input_tokens: 100, cache_read_input_tokens: 130_000 })]);
  const rSuave = await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, umbralTarea: 120_000, hilos: dir, idioma: "es" });
  assert.ok(rSuave);
  assert.match(rSuave.hookSpecificOutput.additionalContext, /cuando termines la tarea actual/i);
  assert.match(rSuave.hookSpecificOutput.additionalContext, /todavía no la escribas/i);
  assert.equal(existsSync(path.join(dir, "notas", "s1.sugerida")), true);
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), false);
  assert.equal(await hookMod.decidir({ evento: "UserPromptSubmit", sesion: "s1", transcript: tr, umbral: 170_000, umbralTarea: 120_000, hilos: dir, idioma: "es" }), null);

  const usoAlto = { input_tokens: 100, cache_read_input_tokens: 160_000, cache_creation_input_tokens: 10_000 };
  escribirTranscript(tr, [linAsistente([{ type: "text", text: "trabajando" }], usoAlto)]);
  // Sin umbrales, nunca pide
  assert.equal(await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: null, umbralTarea: null, hilos: dir }), null);

  const r1 = await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, umbralTarea: 120_000, hilos: dir, idioma: "es" });
  assert.ok(r1);
  assert.equal(r1.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(r1.hookSpecificOutput.additionalContext, /\[\[nota-compactar\]\]/);
  assert.match(r1.hookSpecificOutput.additionalContext, /\[\[\/nota-compactar\]\]/);
  assert.match(r1.hookSpecificOutput.additionalContext, /Si te falta poco para un corte natural, terminá y escribila/);
  assert.match(r1.hookSpecificOutput.additionalContext, /Objetivo.*Pedidos de la persona.*Estado.*Decisiones.*Qué sigue.*Rutas.*Qué NO hacer/s);
  assert.match(r1.hookSpecificOutput.additionalContext, /600 palabras/);
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), true);

  // En el mismo ciclo no vuelve a pedir ni en PostToolUse ni en UserPromptSubmit
  assert.equal(await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, umbralTarea: 120_000, hilos: dir }), null);
  assert.equal(await hookMod.decidir({ evento: "UserPromptSubmit", sesion: "s1", transcript: tr, umbral: 170_000, umbralTarea: 120_000, hilos: dir }), null);

  // Otra sesión sí recibe su propio pedido, y en inglés si preferencias.json dice en
  writeFileSync(path.join(dir, "preferencias.json"), JSON.stringify({ idioma: "en" }));
  const r2 = await hookMod.decidir({ evento: "UserPromptSubmit", sesion: "s2", transcript: tr, umbral: 170_000, hilos: dir });
  assert.equal(r2?.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(r2?.hookSpecificOutput.additionalContext ?? "", /NEXT response.*Objective.*What NOT to do/s);
});

test("si el uso bajó de la mitad del umbral, borra las marcas (.pedida y .sugerida) para el nuevo ciclo", async () => {
  const dir = nuevoDir();
  const tr = path.join(dir, "s1.jsonl");
  escribirTranscript(tr, [linAsistente([{ type: "text", text: "suave" }], { input_tokens: 1000, cache_read_input_tokens: 130_000 })]);
  assert.ok(await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, umbralTarea: 120_000, hilos: dir, idioma: "es" }));
  assert.equal(existsSync(path.join(dir, "notas", "s1.sugerida")), true);

  escribirTranscript(tr, [linAsistente([{ type: "text", text: "lleno" }], { input_tokens: 1000, cache_read_input_tokens: 180_000 })]);
  assert.ok(await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, umbralTarea: 120_000, hilos: dir, idioma: "es" }));
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), true);

  // Bajo de la mitad (< 60 000): se compactó por fuera y borra ambas marcas
  escribirTranscript(tr, [linAsistente([{ type: "text", text: "fresco" }], { input_tokens: 1000, cache_read_input_tokens: 40_000 })]);
  assert.equal(await hookMod.decidir({ evento: "UserPromptSubmit", sesion: "s1", transcript: tr, umbral: 170_000, umbralTarea: 120_000, hilos: dir, idioma: "es" }), null);
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), false);
  assert.equal(existsSync(path.join(dir, "notas", "s1.sugerida")), false);

  // Al volver a pasar el umbral pide otra vez
  escribirTranscript(tr, [linAsistente([{ type: "text", text: "lleno otra vez" }], { input_tokens: 1000, cache_read_input_tokens: 175_000 })]);
  assert.ok(await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, hilos: dir, idioma: "es" }));

  // Si ya hay compact_boundary después del último assistant con usage, no dispara con el usage viejo y limpia .pedida
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "antes" }], { input_tokens: 1000, cache_read_input_tokens: 185_000 }),
    JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto" } }),
  ]);
  assert.equal(await hookMod.decidir({ evento: "UserPromptSubmit", sesion: "s1", transcript: tr, umbral: 170_000, hilos: dir, idioma: "es" }), null);
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), false);
});

test("ignora subagentes (isSidechain, agent_id en stdin y subagents/) sin gastar marcas", async () => {
  const dir = nuevoDir();
  const tr = path.join(dir, "s1.jsonl");
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "principal bajo" }], { input_tokens: 500, cache_read_input_tokens: 20_000 }),
    linAsistente([{ type: "text", text: "[[nota-compactar]]nota de subagente[[/nota-compactar]]" }], { input_tokens: 500, cache_read_input_tokens: 200_000 }, { isSidechain: true }),
    linAsistente([{ type: "text", text: "[[nota-compactar]]sintético[[/nota-compactar]]" }], { input_tokens: 0 }, { isApiErrorMessage: true, message: { id: "e1", model: "<synthetic>", content: [{ type: "text", text: "[[nota-compactar]]sintético[[/nota-compactar]]" }], usage: { input_tokens: 0 } } }),
  ]);
  assert.equal(await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, hilos: dir }), null);
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), false);
  assert.equal(existsSync(path.join(dir, "notas", "s1.md")), false);

  // Si el último mensaje del transcript es isSidechain (subagente en curso), PostToolUse no gasta la marca aunque el principal haya pasado umbral
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "principal alto" }], { input_tokens: 500, cache_read_input_tokens: 180_000 }),
    linAsistente([{ type: "text", text: "subagente" }], { input_tokens: 100 }, { isSidechain: true }),
  ]);
  assert.equal(await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, hilos: dir }), null);
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), false);

  // Stdin del hook con agent_id (CLI subagente): tampoco gasta la marca
  const rCliSub = spawnSync(process.execPath, [HOOK, "--umbral", "170000"], {
    input: JSON.stringify({ hook_event_name: "PostToolUse", session_id: "s1", transcript_path: tr, agent_id: "a-sub-1" }),
    env: { ...process.env, HILOS_STATE: dir },
    encoding: "utf8",
  });
  assert.equal(rCliSub.status, 0);
  assert.equal(rCliSub.stdout, "");
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), false);

  // UserPromptSubmit sobre la sesión principal sí puede pedir cuando el mensaje anterior era sintético
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "principal alto" }], { input_tokens: 500, cache_read_input_tokens: 180_000 }),
    JSON.stringify({ type: "assistant", isApiErrorMessage: true, message: { id: "e2", model: "<synthetic>", content: [{ type: "text", text: "rate limit" }], usage: { input_tokens: 0 } } }),
  ]);
  assert.ok(await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, hilos: dir, idioma: "es" }));
  assert.equal(existsSync(path.join(dir, "notas", "s1.pedida")), true);
});

test("copia el bloque [[nota-compactar]] en PostToolUse/PreCompact (modo 0600, sin reescribir si es igual) y sólo lee la cola", async () => {
  const dir = nuevoDir();
  const tr = path.join(dir, "grande.jsonl");
  const vieja = linAsistente([{ type: "text", text: `[[nota-compactar]]vieja ${"x".repeat(270 * 1024)}[[/nota-compactar]]` }], { input_tokens: 100, cache_read_input_tokens: 190_000 });
  const actual = linAsistente([{ type: "text", text: "Sigo.\n[[nota-compactar]]\n## Objetivo\nArreglar X\n[[/nota-compactar]]" }], { input_tokens: 100, cache_read_input_tokens: 50_000 });
  escribirTranscript(tr, [vieja, actual]);

  assert.equal(await hookMod.decidir({ evento: "PreCompact", sesion: "s1", transcript: tr, hilos: dir }), null);
  const md = path.join(dir, "notas", "s1.md");
  assert.equal(readFileSync(md, "utf8"), "## Objetivo\nArreglar X");
  if (!soloPosix("modos POSIX")) assert.equal(statSync(md).mode & 0o777, 0o600);

  const viejoMs = Date.now() - 120_000;
  utimesSync(md, viejoMs / 1000, viejoMs / 1000);
  await hookMod.decidir({ evento: "PostToolUse", sesion: "s1", transcript: tr, umbral: 170_000, hilos: dir });
  assert.ok(Math.abs(statSync(md).mtimeMs - viejoMs) < 1500, "no reescribe si no cambió");

  const trSoloVieja = path.join(dir, "solo-vieja.jsonl");
  escribirTranscript(trSoloVieja, [vieja, linAsistente([{ type: "text", text: "fin sin nota ".repeat(20_000) }], { input_tokens: 100, cache_read_input_tokens: 10_000 })]);
  assert.equal(await hookMod.decidir({ evento: "PreCompact", sesion: "s-vieja", transcript: trSoloVieja, hilos: dir }), null);
  assert.equal(existsSync(path.join(dir, "notas", "s-vieja.md")), false);
});

test("devuelve sólo en SessionStart con source compact, renombra .md a .devuelta.md, borra marcas y cae a la cola del transcript", async () => {
  const dir = nuevoDir();
  const tr = path.join(dir, "s1.jsonl");
  const notas = path.join(dir, "notas");
  mkdirSync(notas, { recursive: true });
  writeFileSync(path.join(notas, "s1.pedida"), "1\n");
  writeFileSync(path.join(notas, "s1.sugerida"), "1\n");
  writeFileSync(path.join(notas, "s1.md"), "## Objetivo\nGuardar nota");
  const mtime = statSync(path.join(notas, "s1.md")).mtimeMs;

  for (const source of ["startup", "resume", "clear", undefined]) {
    assert.equal(await hookMod.decidir({ evento: "SessionStart", source, sesion: "s1", transcript: tr, hilos: dir, idioma: "es" }), null);
    assert.equal(existsSync(path.join(notas, "s1.pedida")), true);
  }

  const r = await hookMod.decidir({ evento: "SessionStart", source: "compact", sesion: "s1", transcript: tr, hilos: dir, ahoraMs: mtime + 7 * 60_000, idioma: "es" });
  assert.ok(r);
  assert.equal(r.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(r.hookSpecificOutput.additionalContext, /^Nota que te escribiste antes de compactar; escrita hace 7 min\n\n## Objetivo\nGuardar nota$/);
  assert.equal(existsSync(path.join(notas, "s1.pedida")), false);
  assert.equal(existsSync(path.join(notas, "s1.sugerida")), false);
  assert.equal(existsSync(path.join(notas, "s1.md")), false, "renombra .md a .devuelta.md");
  assert.equal(readFileSync(path.join(notas, "s1.devuelta.md"), "utf8"), "## Objetivo\nGuardar nota");

  // Un segundo SessionStart(compact) sin nota nueva no devuelve la vieja (.md ya no existe y .devuelta.md no se lee)
  assert.equal(await hookMod.decidir({ evento: "SessionStart", source: "compact", sesion: "s1", transcript: tr, hilos: dir, idioma: "es" }), null);

  const tsNota = Date.parse("2026-11-21T10:00:00Z");
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "[[nota-compactar]]nota del transcript[[/nota-compactar]]" }], { input_tokens: 100, cache_read_input_tokens: 180_000 }),
    JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto" } }),
  ]);
  writeFileSync(path.join(notas, "s-fb.pedida"), "1\n");
  const fb = await hookMod.decidir({ evento: "SessionStart", source: "compact", sesion: "s-fb", transcript: tr, hilos: dir, ahoraMs: tsNota + 3 * 60_000, idioma: "es" });
  assert.match(fb?.hookSpecificOutput.additionalContext ?? "", /^Nota que te escribiste antes de compactar; escrita hace 3 min\n\nnota del transcript$/);
  assert.equal(existsSync(path.join(notas, "s-fb.pedida")), false);
});

test("SessionStart(compact) no devuelve dos veces la misma nota en llamadas consecutivas o simultáneas, pero sí en una segunda compactación", async () => {
  const dir = nuevoDir();
  const tr = path.join(dir, "s-dup.jsonl");
  const boundary = JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto" } });
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "[[nota-compactar]]ESTADO REAL 1[[/nota-compactar]]" }], { input_tokens: 100, cache_read_input_tokens: 180_000 }),
  ]);
  await hookMod.decidir({ evento: "PreCompact", sesion: "s-dup", transcript: tr, hilos: dir, idioma: "es" });
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "[[nota-compactar]]ESTADO REAL 1[[/nota-compactar]]" }], { input_tokens: 100, cache_read_input_tokens: 180_000 }),
    boundary,
  ]);

  const c1 = await hookMod.decidir({ evento: "SessionStart", source: "compact", sesion: "s-dup", transcript: tr, hilos: dir, idioma: "es" });
  const c2 = await hookMod.decidir({ evento: "SessionStart", source: "compact", sesion: "s-dup", transcript: tr, hilos: dir, idioma: "es" });
  assert.match(c1?.hookSpecificOutput.additionalContext ?? "", /ESTADO REAL 1/);
  assert.equal(c2, null, "la segunda ejecución de la misma compactación no debe devolver la nota del transcript");

  // Simultáneas sobre una sesión distinta (sin PreCompact previo, directo desde transcript)
  const [sim1, sim2] = await Promise.all([
    hookMod.decidir({ evento: "SessionStart", source: "compact", sesion: "s-sim", transcript: tr, hilos: dir, idioma: "es" }),
    hookMod.decidir({ evento: "SessionStart", source: "compact", sesion: "s-sim", transcript: tr, hilos: dir, idioma: "es" }),
  ]);
  const noNulas = [sim1, sim2].filter(Boolean);
  assert.equal(noNulas.length, 1, "sólo una de las dos ejecuciones simultáneas devuelve la nota");

  // Segunda compactación legítima de la misma sesión s-dup
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "[[nota-compactar]]ESTADO REAL 1[[/nota-compactar]]" }], { input_tokens: 100, cache_read_input_tokens: 180_000 }),
    boundary,
    linAsistente([{ type: "text", text: "[[nota-compactar]]ESTADO REAL 2[[/nota-compactar]]" }], { input_tokens: 100, cache_read_input_tokens: 190_000 }),
  ]);
  await hookMod.decidir({ evento: "PreCompact", sesion: "s-dup", transcript: tr, hilos: dir, idioma: "es" });
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "[[nota-compactar]]ESTADO REAL 1[[/nota-compactar]]" }], { input_tokens: 100, cache_read_input_tokens: 180_000 }),
    boundary,
    linAsistente([{ type: "text", text: "[[nota-compactar]]ESTADO REAL 2[[/nota-compactar]]" }], { input_tokens: 100, cache_read_input_tokens: 190_000 }),
    boundary,
  ]);
  const seg1 = await hookMod.decidir({ evento: "SessionStart", source: "compact", sesion: "s-dup", transcript: tr, hilos: dir, idioma: "es" });
  const seg2 = await hookMod.decidir({ evento: "SessionStart", source: "compact", sesion: "s-dup", transcript: tr, hilos: dir, idioma: "es" });
  assert.match(seg1?.hookSpecificOutput.additionalContext ?? "", /ESTADO REAL 2/);
  assert.equal(seg2, null);
});

test("extraerNotaDeTexto y ultimaNotaDeLineas ignoran etiquetas dentro de código inline o cercas", async () => {
  assert.equal(hookMod.extraerNotaDeTexto("Usá `[[nota-compactar]]...[[/nota-compactar]]`."), null);
  assert.equal(hookMod.extraerNotaDeTexto("```md\n[[nota-compactar]]\nejemplo en cerca\n[[/nota-compactar]]\n```"), null);
  assert.equal(
    hookMod.extraerNotaDeTexto("Ejemplo: `[[nota-compactar]]falso[[/nota-compactar]]`\n\n[[nota-compactar]]\nnota verdadera\n[[/nota-compactar]]"),
    "nota verdadera",
  );
  assert.equal(
    hookMod.extraerNotaDeTexto("[[nota-compactar]]\nEl cierre es `[[/nota-compactar]]` y sigue acá.\n[[/nota-compactar]]"),
    "El cierre es `[[/nota-compactar]]` y sigue acá.",
  );

  // En el transcript, una explicación posterior con etiquetas en código no pisa la nota real anterior
  const dir = nuevoDir();
  const tr = path.join(dir, "s-cod.jsonl");
  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "[[nota-compactar]]nota real anterior[[/nota-compactar]]" }], { input_tokens: 100, cache_read_input_tokens: 100_000 }),
    linAsistente([{ type: "text", text: "Explicación: usá `[[nota-compactar]]ejemplo[[/nota-compactar]]` para guardar." }], { input_tokens: 100, cache_read_input_tokens: 110_000 }),
  ]);
  await hookMod.decidir({ evento: "PreCompact", sesion: "s-cod", transcript: tr, hilos: dir });
  assert.equal(readFileSync(path.join(dir, "notas", "s-cod.md"), "utf8"), "nota real anterior");
});

test("leerColaTranscript: recupera línea assistant grande (>256 KiB), nota dentro de línea grande y uso antes de herramienta grande", async () => {
  const dir = nuevoDir();

  // 1. Un solo registro assistant de 300 000 caracteres con usage alto y nota incluida
  const trGrande = path.join(dir, "asistente-grande.jsonl");
  const lineaGrande = linAsistente(
    [{ type: "text", text: `${"a".repeat(300_000)}\n[[nota-compactar]]\nnota en linea grande\n[[/nota-compactar]]` }],
    { input_tokens: 900_000 },
  );
  escribirTranscript(trGrande, [lineaGrande]);
  const leidas1 = hookMod.leerColaTranscript(trGrande);
  assert.equal(leidas1.length, 1);
  assert.equal(hookMod.ultimoUsoDeLineas(leidas1).tokens, 900_000);
  assert.equal(hookMod.ultimaNotaDeLineas(leidas1)?.texto, "nota en linea grande");

  const rPedir = await hookMod.decidir({ evento: "PostToolUse", sesion: "s-grande", transcript: trGrande, umbral: 750_000, hilos: dir, idioma: "es" });
  assert.ok(rPedir, "pide la nota aunque la línea assistant supere 256 KiB");
  assert.equal(readFileSync(path.join(dir, "notas", "s-grande.md"), "utf8"), "nota en linea grande");

  // 2. Un resultado de herramienta grande (user) después del último assistant no oculta el uso ni la nota
  const trTool = path.join(dir, "tool-grande.jsonl");
  const lineaAsist = linAsistente(
    [{ type: "text", text: "[[nota-compactar]]nota previa a tool[[/nota-compactar]]" }],
    { input_tokens: 800_000 },
  );
  const lineaTool = JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "z".repeat(300_000) }] } });
  escribirTranscript(trTool, [lineaAsist, lineaTool]);
  const leidas2 = hookMod.leerColaTranscript(trTool);
  assert.equal(hookMod.ultimoUsoDeLineas(leidas2).tokens, 800_000);
  assert.equal(hookMod.ultimaNotaDeLineas(leidas2)?.texto, "nota previa a tool");
});

test("leerColaTranscript: conserva la primera línea cuando el offset coincide con inicio de línea (LF y CRLF)", () => {
  const dir = nuevoDir();
  const l1 = JSON.stringify({ type: "user", message: { content: "registro anterior" } });
  const l2 = linAsistente([{ type: "text", text: "respuesta" }], { input_tokens: 42_000 });

  // LF: offset 0, offset exactamente alineado con l2 y offset dentro de l1
  const trLf = path.join(dir, "alineado-lf.jsonl");
  writeFileSync(trLf, `${l1}\n${l2}\n`);
  const bytesL2Lf = Buffer.byteLength(`${l2}\n`);
  assert.equal(hookMod.leerColaTranscript(trLf, Buffer.byteLength(`${l1}\n${l2}\n`)).length, 2, "offset 0");
  const exactoLf = hookMod.leerColaTranscript(trLf, bytesL2Lf);
  assert.deepEqual(exactoLf, [l2], "offset alineado conserva la línea completa");
  assert.equal(hookMod.ultimoUsoDeLineas(exactoLf).tokens, 42_000);
  assert.deepEqual(hookMod.leerColaTranscript(trLf, bytesL2Lf + 5), [l2], "offset dentro de l1 descarta l1 y conserva l2");

  // CRLF: corte después de \r\n (alineado) y corte en medio de \r\n (entre \r y \n)
  const trCrlf = path.join(dir, "alineado-crlf.jsonl");
  writeFileSync(trCrlf, `${l1}\r\n${l2}\r\n`);
  const bytesL2Crlf = Buffer.byteLength(`${l2}\r\n`);
  assert.deepEqual(hookMod.leerColaTranscript(trCrlf, bytesL2Crlf), [l2], "CRLF: corte justo después de \\n");
  assert.deepEqual(hookMod.leerColaTranscript(trCrlf, bytesL2Crlf + 1), [l2], "CRLF: corte entre \\r y \\n");
  assert.deepEqual(hookMod.leerColaTranscript(trCrlf, bytesL2Crlf + 4), [l2], "CRLF: corte dentro de l1");
});

test("recorta a 12 000 caracteres con aviso de recorte (es y en)", () => {
  const larga = "a".repeat(15_000);
  const es = textoDevolucionNota({ idioma: "es", nota: larga, minutos: 2, archivo: "/estado/notas/s1.md" });
  assert.ok(es.length <= TOPE_NOTA, `largo es: ${es.length}`);
  assert.match(es, /^Nota que te escribiste antes de compactar; escrita hace 2 min/);
  assert.match(es, /nota recortada a 12000 caracteres.*completa en \/estado\/notas\/s1\.md/);

  const en = textoDevolucionNota({ idioma: "en", nota: larga, minutos: 4 });
  assert.ok(en.length <= TOPE_NOTA, `largo en: ${en.length}`);
  assert.match(en, /^Note you wrote to yourself before compacting; written 4 min ago/);
  assert.match(en, /note truncated to 12000 characters/);
});

test("CLI por spawnSync: siempre sale con 0, sin salida si no corresponde, y flujo completo pedir -> copiar -> devolver", () => {
  const dir = nuevoDir();
  const tr = path.join(dir, "s-cli.jsonl");
  const env = { ...process.env, HILOS_STATE: dir, LANG: "es_AR.UTF-8" };

  const vacio = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "compact", session_id: "prueba-1", transcript_path: "no-existe.jsonl" }),
    env,
    encoding: "utf8",
  });
  assert.equal(vacio.status, 0);
  assert.equal(vacio.stdout, "");
  assert.equal(existsSync(path.join(dir, "notas")), false);

  const raro = spawnSync(process.execPath, [HOOK, "--umbral", "100"], {
    input: JSON.stringify({ hook_event_name: "PostToolUse", session_id: "../raro", transcript_path: tr }),
    env,
    encoding: "utf8",
  });
  assert.equal(raro.status, 0);
  assert.equal(raro.stdout, "");

  escribirTranscript(tr, [linAsistente([{ type: "text", text: "paso 1" }], { input_tokens: 1000, cache_read_input_tokens: 90_000 })]);
  const rPedir = spawnSync(process.execPath, [HOOK, "--umbral", "85000"], {
    input: JSON.stringify({ hook_event_name: "PostToolUse", session_id: "s-cli", transcript_path: tr }),
    env,
    encoding: "utf8",
  });
  assert.equal(rPedir.status, 0);
  assert.match(JSON.parse(rPedir.stdout).hookSpecificOutput.additionalContext, /\[\[nota-compactar\]\]/);

  escribirTranscript(tr, [
    linAsistente([{ type: "text", text: "[[nota-compactar]]mi nota final[[/nota-compactar]]" }], { input_tokens: 1000, cache_read_input_tokens: 92_000 }),
  ]);
  const rPre = spawnSync(process.execPath, [HOOK, "--umbral", "85000"], {
    input: JSON.stringify({ hook_event_name: "PreCompact", session_id: "s-cli", transcript_path: tr }),
    env,
    encoding: "utf8",
  });
  assert.equal(rPre.status, 0);
  assert.equal(rPre.stdout, "");

  const rStart = spawnSync(process.execPath, [HOOK, "--umbral", "85000"], {
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "compact", session_id: "s-cli", transcript_path: tr }),
    env,
    encoding: "utf8",
  });
  assert.equal(rStart.status, 0);
  assert.match(JSON.parse(rStart.stdout).hookSpecificOutput.additionalContext, /mi nota final/);
  assert.equal(existsSync(path.join(dir, "notas", "s-cli.pedida")), false);
});

// ============================================================================ Configuración nota_compactar, porcentajes y umbralesNota

test("nota_compactar, nota_compactar_pct y nota_compactar_tarea_pct en modelos.json y umbralesNota", async () => {
  assert.equal(leerConfig({}).nota_compactar, undefined);
  assert.equal(leerConfig({ nota_compactar: false }).nota_compactar, false);
  assert.equal(leerConfig({ nota_compactar_pct: 70, nota_compactar_tarea_pct: 0 }).nota_compactar_pct, 70);
  assert.equal(leerConfig({ nota_compactar_pct: 99, nota_compactar_tarea_pct: 20 }).nota_compactar_pct, undefined);
  assert.throws(() => validarConfig({ nota_compactar: "no" }));
  assert.throws(() => validarConfig({ nota_compactar_pct: 49 }));
  assert.throws(() => validarConfig({ nota_compactar_tarea_pct: 25 }));
  assert.equal(validarConfig({ nota_compactar_pct: 80, nota_compactar_tarea_pct: 55 }).nota_compactar_pct, 80);

  // Defaults 85 y 60 salen del archivo al unir; otros se guardan; undefined conserva
  assert.equal(unir({ version: 1, nota_compactar: false, nota_compactar_pct: 75 }, validarConfig({})).nota_compactar_pct, 75);
  const vuelto = unir({ version: 1, nota_compactar: false, nota_compactar_pct: 75, nota_compactar_tarea_pct: 45 }, validarConfig({ nota_compactar: true, nota_compactar_pct: 85, nota_compactar_tarea_pct: 60 }));
  assert.equal("nota_compactar" in vuelto, false);
  assert.equal("nota_compactar_pct" in vuelto, false);
  assert.equal("nota_compactar_tarea_pct" in vuelto, false);

  assert.equal(problemaModelos({ version: 1, nota_compactar: false, nota_compactar_pct: 75, nota_compactar_tarea_pct: 0 }), "");
  assert.match(problemaModelos({ version: 1, nota_compactar: "si" }), /nota_compactar/);
  assert.match(problemaModelos({ version: 1, nota_compactar_pct: 40 }), /nota_compactar_pct/);
  assert.match(problemaModelos({ version: 1, nota_compactar_tarea_pct: 95 }), /nota_compactar_tarea_pct/);

  // umbralesNota: nativo nunca supera 75% de la ventana y suave siempre < fuerte
  assert.deepEqual(umbralesNota({ tope: null, ventana: 1_000_000, pct: 85, tareaPct: 60 }), { fuerte: 750_000, suave: 600_000 });
  const uCap = umbralesNota({ tope: null, ventana: 1_000_000, pct: 95, tareaPct: 80 });
  assert.equal(uCap.fuerte, 750_000);
  assert.ok(uCap.suave !== null && uCap.suave < uCap.fuerte);
  assert.deepEqual(umbralesNota({ tope: 300_000, ventana: 1_000_000, pct: 85, tareaPct: 60 }), { fuerte: 255_000, suave: 180_000 });
  assert.deepEqual(umbralesNota({ tope: 300_000, ventana: 1_000_000, pct: 85, tareaPct: 0 }), { fuerte: 255_000, suave: null });

  const dir = nuevoDir();
  const f = path.join(dir, "modelos.json");
  const prev = process.env.TRAMA_MODELOS;
  process.env.TRAMA_MODELOS = f;
  try {
    assert.equal(notaCompactarGuardado(), true);
    assert.equal(notaCompactarPctGuardado(), 85);
    assert.equal(notaCompactarTareaPctGuardado(), 60);
    await guardarModelos({ ...(await leerModelos(undefined, f)).config, nota_compactar: false, nota_compactar_pct: 70, nota_compactar_tarea_pct: 0 }, undefined, f);
    assert.equal(notaCompactarGuardado(), false);
    assert.equal(notaCompactarPctGuardado(), 70);
    assert.equal(notaCompactarTareaPctGuardado(), 0);
    const mod = new Modelos({ TRAMA_MODELOS: f }, { out: () => {}, err: () => {} });
    assert.equal(mod.notaCompactar(), false);
    assert.equal(mod.notaCompactarPct(), 70);
    assert.equal(mod.notaCompactarTareaPct(), 0);
  } finally {
    if (prev === undefined) delete process.env.TRAMA_MODELOS;
    else process.env.TRAMA_MODELOS = prev;
  }
});

test("workers (settingsWorker y armarLanzamiento): usa umbralesNota (tope 75% nativo y --umbral-tarea), se apaga con nota_compactar=false y nunca va en Ollama", () => {
  const dir = nuevoDir();
  const modelosF = path.join(dir, "modelos.json");
  const paBase = (extraEnv: Record<string, string> = {}): Pa => ({
    env: { PATH: "", ...extraEnv },
    io: { out: () => {}, err: () => {} },
    plat: "linux",
    home: dir,
    state: path.join(dir, "estado"),
    lockdir: path.join(dir, "estado", "lock"),
    bin: path.join(MOTOR, "bin"),
    hooks: HOOKS,
    plan: "pro",
    autocompact: null,
    puestos: 3,
    tope: 10,
    ramWorkerMb: 2048,
    ramReservaMb: 6144,
    ramRecienMin: 3,
  });
  const corrida = (o: Partial<Corrida> = {}): Corrida => ({
    proyecto: "demo",
    slug: "demo",
    ts: "20261121-000000-1",
    ruta: path.join(dir, "proy"),
    rutaTrabajo: path.join(dir, "proy"),
    rama: "",
    base: "",
    origen: "",
    puesto: "aca",
    leer: false,
    usaWorktree: false,
    tengoLock: true,
    modelo: "claude-sonnet-5-5",
    esfuerzo: "high",
    cuenta: "claude",
    tarea: "x",
    tareaJefe: "x",
    lanzo: "jefe",
    sid: "00000000-0000-4000-8000-000000000001",
    resume: false,
    conMcp: false,
    maxTurns: "100",
    maxBudget: "",
    autocompact: "",
    baseDelta: [],
    jefe: "",
    jefeId: "",
    async: false,
    ...o,
  });

  // Nativo 1M (claude-sonnet-5-5) -> 750 000 y --umbral-tarea 600 000
  const s1 = JSON.parse(armarLanzamiento(paBase(), corrida()).settings);
  const cmd1 = s1.hooks.PreCompact[0].hooks[0].command as string;
  assert.match(cmd1, /nota-compactar\.mjs' --umbral 750000 --umbral-tarea 600000$/);
  assert.equal(s1.hooks.SessionStart[0].matcher, "compact");
  assert.ok(s1.hooks.PostToolUse.some((g: { hooks: { command: string }[] }) => g.hooks[0]!.command.includes("nota-compactar.mjs")));
  assert.ok(s1.hooks.UserPromptSubmit.some((g: { hooks: { command: string }[] }) => g.hooks[0]!.command.includes("nota-compactar.mjs")));

  // Con autocompact 300 000 -> 255 000 y 180 000
  const s2 = JSON.parse(armarLanzamiento(paBase(), corrida({ modelo: "claude-haiku-5-5", autocompact: "300000" })).settings);
  assert.match(s2.hooks.PreCompact[0].hooks[0].command, /--umbral 255000 --umbral-tarea 180000$/);

  // Ollama: sin nota-compactar
  const sOllama = JSON.parse(armarLanzamiento(paBase(), corrida({ motor: "ollama", local: { url: "http://127.0.0.1:11434", modelo: "qwen3" } })).settings);
  assert.equal(sOllama.hooks.PreCompact, undefined);
  assert.equal(sOllama.hooks.SessionStart, undefined);

  // Apagado por modelos.json (`nota_compactar: false`)
  writeFileSync(modelosF, JSON.stringify({ version: 1, nota_compactar: false }));
  const sOff = JSON.parse(armarLanzamiento(paBase({ TRAMA_MODELOS: modelosF }), corrida()).settings);
  assert.equal(sOff.hooks.PreCompact, undefined);
  assert.equal(sOff.hooks.SessionStart, undefined);
  assert.ok(sOff.hooks.UserPromptSubmit.some((g: { hooks: { command: string }[] }) => g.hooks[0]!.command.includes("cierre-cupo.mjs")));

  // Llamada directa a settingsWorker con opciones explícitas (claude-opus-4-6 200k nativo -> 150k / 120k)
  const sw = JSON.parse(settingsWorker(paBase(), { hb: "/tmp/hb", leer: false, modelo: "claude-opus-4-6", autocompact: "" }));
  assert.match(sw.hooks.PreCompact[0].hooks[0].command, /--umbral 150000 --umbral-tarea 120000$/);
  assert.deepEqual(ARCHIVOS_NOTA_COMPACTAR, ["nota-compactar.mjs", "nota-compactar-textos.mjs"]);
  assert.equal(EVENTOS_NOTA_COMPACTAR.length, 4);
  assert.equal(comandoNotaCompactar("/h", { umbral: 170000, plataforma: "linux" }), "node '/h/nota-compactar.mjs' --umbral 170000");
  assert.equal(
    comandoNotaCompactar("/h", { umbral: 170000, umbralTarea: 120000, plataforma: "linux" }),
    "node '/h/nota-compactar.mjs' --umbral 170000 --umbral-tarea 120000",
  );
});

test("líderes (settingsCierreCupo y lider.nuevo): un solo JSON con cierre-cupo y nota-compactar, respeta umbralesNota, autocompact_lider y nota_compactar", { timeout: 20_000, skip: soloPosix("claude falso por shebang") }, async () => {
  const dir = nuevoDir();
  const prev = {
    HILOS_STATE: process.env.HILOS_STATE,
    HILOS_SESIONES: process.env.HILOS_SESIONES,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    HILOS_CLAUDE: process.env.HILOS_CLAUDE,
    TRAMA_FALSO_LOG: process.env.TRAMA_FALSO_LOG,
    TRAMA_FALSO_MS: process.env.TRAMA_FALSO_MS,
    TRAMA_MODELOS: process.env.TRAMA_MODELOS,
  };
  const log = path.join(dir, "falso.log");
  const modelosF = path.join(dir, "modelos.json");
  process.env.HILOS_STATE = path.join(dir, "estado");
  process.env.HILOS_SESIONES = path.join(dir, "sesiones");
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, "claude");
  process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
  process.env.TRAMA_FALSO_LOG = log;
  process.env.TRAMA_FALSO_MS = "5";
  process.env.TRAMA_MODELOS = modelosF;

  const lider = await import("../electron/lider.ts");
  try {
    const settingsDe = (sid: string) => {
      const lineas = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { args?: string[] });
      const args = lineas.find((l) => l.args?.includes(sid))?.args ?? [];
      const s: Record<string, unknown>[] = [];
      for (let i = 0; i < args.length; i++) if (args[i] === "--settings" && args[i + 1]) s.push(JSON.parse(args[i + 1]!) as Record<string, unknown>);
      return s;
    };

    // 1. Con autocompact_lider para opus = 400 000 -> 340 000 y --umbral-tarea 240 000
    writeFileSync(modelosF, JSON.stringify({ version: 1, autocompact_lider: { defecto: null, por_modelo: { opus: 400_000 } } }));
    const s1 = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola" });
    await esperarHasta(() => existsSync(log) && readFileSync(log, "utf8").includes(s1), { tope: 8000 });
    const hooks1 = settingsDe(s1).find((x) => x.hooks)?.hooks as Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
    assert.ok(hooks1);
    assert.equal(hooks1.PostToolUse!.length, 2);
    assert.match(hooks1.PostToolUse![0]!.hooks[0]!.command, /cierre-cupo\.mjs/);
    assert.match(hooks1.PostToolUse![1]!.hooks[0]!.command, /nota-compactar\.mjs' --umbral 340000 --umbral-tarea 240000$/);
    assert.equal(hooks1.SessionStart![0]!.matcher, "compact");
    assert.match(hooks1.PreCompact![0]!.hooks[0]!.command, /--umbral 340000 --umbral-tarea 240000$/);

    // 2. Con tope nativo null en Sonnet 5.5 -> 75 % de 1 000 000 = 750 000 (nunca supera 75 %), suave 600 000
    const s2 = await lider.nuevo({ modelo: "claude-sonnet-5-5", effort: "high", texto: "hola" });
    await esperarHasta(() => readFileSync(log, "utf8").includes(s2), { tope: 8000 });
    const hooks2 = settingsDe(s2).find((x) => x.hooks)?.hooks as Record<string, { hooks: { command: string }[] }[]>;
    assert.match(hooks2.PreCompact![0]!.hooks[0]!.command, /--umbral 750000 --umbral-tarea 600000$/);

    // 2b. Sin tope de Trama pero con `autoCompactWindow` en el settings de Claude Code: la nota se pide antes de ESA compactación.
    mkdirSync(path.join(dir, "claude"), { recursive: true });
    writeFileSync(path.join(dir, "claude", "settings.json"), JSON.stringify({ autoCompactWindow: 200_000 }));
    const s2b = await lider.nuevo({ modelo: "claude-sonnet-5-5", effort: "high", texto: "hola" });
    await esperarHasta(() => readFileSync(log, "utf8").includes(s2b), { tope: 8000 });
    const hooks2b = settingsDe(s2b).find((x) => x.hooks)?.hooks as Record<string, { hooks: { command: string }[] }[]>;
    assert.match(hooks2b.PreCompact![0]!.hooks[0]!.command, /--umbral 170000 --umbral-tarea 120000$/);
    // El tope de Trama le gana al del settings.
    writeFileSync(modelosF, JSON.stringify({ version: 1, autocompact_lider: { defecto: null, por_modelo: { sonnet: 400_000 } } }));
    const s2c = await lider.nuevo({ modelo: "claude-sonnet-5-5", effort: "high", texto: "hola" });
    await esperarHasta(() => readFileSync(log, "utf8").includes(s2c), { tope: 8000 });
    const hooks2c = settingsDe(s2c).find((x) => x.hooks)?.hooks as Record<string, { hooks: { command: string }[] }[]>;
    assert.match(hooks2c.PreCompact![0]!.hooks[0]!.command, /--umbral 340000 --umbral-tarea 240000$/);

    // 3. Con nota_compactar: false -> sólo cierre-cupo
    writeFileSync(modelosF, JSON.stringify({ version: 1, nota_compactar: false }));
    const s3 = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola" });
    await esperarHasta(() => readFileSync(log, "utf8").includes(s3), { tope: 8000 });
    const hooks3 = settingsDe(s3).find((x) => x.hooks)?.hooks as Record<string, { hooks: { command: string }[] }[]>;
    assert.equal(hooks3.PreCompact, undefined);
    assert.equal(hooks3.PostToolUse!.length, 1);
    assert.match(hooks3.PostToolUse![0]!.hooks[0]!.command, /cierre-cupo\.mjs/);

    const comb = JSON.parse(settingsCierreCupo("/m/hooks", { plataforma: "linux", umbralNota: 170_000, umbralTareaNota: 120_000 }));
    assert.equal(comb.hooks.SessionStart[0].matcher, "compact");
    assert.equal(comb.hooks.PostToolUse.length, 2);
    const sidTest = "11111111-2222-3333-4444-555555555555";
    assert.ok(!argvLider({ modelo: "qwen3", effort: "medium", sid: sidTest, nombre: "trama-1", resume: false, cierreCupo: JSON.stringify(comb), ollama: { url: "http://127.0.0.1:11434", modelo: "qwen3" } }).includes("--settings"));
    assert.ok(!argvLider({ modelo: "qwen3", effort: "medium", sid: sidTest, nombre: "trama-1", resume: false, cierreCupo: JSON.stringify(comb), local: { url: "http://127.0.0.1:8080", ctx: 32768 } }).includes(JSON.stringify(comb)));
  } finally {
    await lider.cerrarTodos(true);
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
