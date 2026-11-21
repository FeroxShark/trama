// Lógica de «nota-compactar» del lado del main (electron/nota-compactar-main.ts), líderes (Claude y Gemini) y UI (ajustes-nota-compactar.ts).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esperarHasta } from "./esperar.ts";
import { debeAutoCompactar, extraerNotaDeTexto, guardarNotaSiCambia, consumirNotaParaDevolver, tokensDeUso, usoDeLineaStream } from "../electron/nota-compactar-main.ts";
import type { EstadoModelos } from "../electron/modelos-config.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && ctx.parentURL?.startsWith("file:")) {
      const dir = path.dirname(fileURLToPath(ctx.parentURL));
      if (spec.endsWith(".js") && ctx.parentURL.includes("/electron/")) {
        const ts = path.join(dir, spec.slice(0, -3) + ".ts");
        if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
      }
      if (!/\.\w+$/.test(spec) && existsSync(path.resolve(dir, spec + ".ts"))) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { pctNotaDe, ponerNotaCompactar, ponerNotaCompactarPct, ponerNotaCompactarTarea, ponerNotaCompactarTareaPct } = await import("../src/paneles/ajustes-nota-compactar.ts");
const { borradorDe, configDe, sucio } = await import("../src/paneles/modelos-borrador.ts");

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-nota-main-"));
const estadoLider = path.join(tmp, "estado-lider");
after(() => rmSync(tmp, { recursive: true, force: true }));
let seq = 0;
const nuevoDir = () => {
  const d = path.join(tmp, `m${++seq}`);
  mkdirSync(d, { recursive: true });
  return d;
};

test("debeAutoCompactar: pura con suave, fuerte fallback, mtime > compactadoMs y yaEncolado", () => {
  const u = { fuerte: 750_000, suave: 600_000 };
  assert.equal(debeAutoCompactar({ uso: 610_000, umbrales: u, notaMs: 2000, compactadoMs: 1000, yaEncolado: false }), true);
  assert.equal(debeAutoCompactar({ uso: 599_000, umbrales: u, notaMs: 2000, compactadoMs: 1000, yaEncolado: false }), false, "bajo suave");
  assert.equal(debeAutoCompactar({ uso: 610_000, umbrales: u, notaMs: 1000, compactadoMs: 1000, yaEncolado: false }), false, "nota no posterior");
  assert.equal(debeAutoCompactar({ uso: 610_000, umbrales: u, notaMs: 900, compactadoMs: 1000, yaEncolado: false }), false, "nota vieja");
  assert.equal(debeAutoCompactar({ uso: 610_000, umbrales: u, notaMs: null, compactadoMs: 0, yaEncolado: false }), false, "sin nota");
  assert.equal(debeAutoCompactar({ uso: 610_000, umbrales: u, notaMs: 2000, compactadoMs: 1000, yaEncolado: true }), false, "ya encolado");
  assert.equal(debeAutoCompactar({ uso: null, umbrales: u, notaMs: 2000, compactadoMs: 0, yaEncolado: false }), false, "sin uso");
  // Si suave es null (tarea_pct=0), usa fuerte
  assert.equal(debeAutoCompactar({ uso: 700_000, umbrales: { fuerte: 750_000, suave: null }, notaMs: 2000, compactadoMs: 0, yaEncolado: false }), false);
  assert.equal(debeAutoCompactar({ uso: 750_000, umbrales: { fuerte: 750_000, suave: null }, notaMs: 2000, compactadoMs: 0, yaEncolado: false }), true);
});

test("extracción de nota, guardado idempotente, renombrado a .devuelta.md y tokensDeUso", () => {
  const dir = nuevoDir();
  assert.equal(extraerNotaDeTexto("sin bloque"), null);
  assert.equal(extraerNotaDeTexto("[[nota-compactar]]primera[[/nota-compactar]] texto [[nota-compactar]]\nsegunda\n[[/nota-compactar]]"), "segunda");
  assert.equal(tokensDeUso({ input_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 40 }), 550);
  assert.equal(usoDeLineaStream(JSON.stringify({ type: "assistant", parent_tool_use_id: "p1", message: { usage: { input_tokens: 999 } } })), null);
  assert.equal(usoDeLineaStream(JSON.stringify({ type: "result", usage: { input_tokens: 120_000 } })), 120_000);

  assert.equal(guardarNotaSiCambia(dir, "s1", "mi nota"), true);
  assert.equal(guardarNotaSiCambia(dir, "s1", "mi nota"), false, "no reescribe igual");
  const c1 = consumirNotaParaDevolver(dir, "s1", Date.now());
  assert.equal(c1?.nota, "mi nota");
  assert.ok(c1?.archivo.endsWith("s1.devuelta.md"));
  assert.equal(existsSync(path.join(dir, "notas", "s1.md")), false);
  assert.equal(consumirNotaParaDevolver(dir, "s1", Date.now()), null, "no devuelve la misma nota dos veces");
});

test("ajustes-nota-compactar y modelos-borrador: defaults limpios, rangos 50..95 y 30..90, sucio y configDe", () => {
  const estado: EstadoModelos = {
    version: 1,
    ruta: "/dev/null",
    existe: false,
    config: { workers: {}, locales: [], excluir: [], permitir_max: false, gemini: {}, claude: {}, destrabar: {} },
    error: null,
    efectivo: null,
  };
  const b0 = borradorDe(estado);
  assert.equal(b0.notaCompactar, true);
  assert.equal(b0.notaCompactarPct, "85");
  assert.equal(b0.notaCompactarTarea, true);
  assert.equal(b0.notaCompactarTareaPct, "60");
  assert.equal(sucio(estado, b0), false);

  const bMal = ponerNotaCompactarPct(b0, "99");
  assert.equal(configDe(bMal), null);
  assert.equal(pctNotaDe("49", 50, 95).error, true);
  assert.equal(pctNotaDe("75", 50, 95).valor, 75);

  const bTareaOff = ponerNotaCompactarTarea(b0, false);
  assert.equal(configDe(bTareaOff)?.nota_compactar_tarea_pct, 0);
  assert.equal(sucio(estado, bTareaOff), true);

  const bTareaEdit = ponerNotaCompactarTareaPct(b0, "55");
  assert.equal(configDe(bTareaEdit)?.nota_compactar_tarea_pct, 55);

  const bOff = ponerNotaCompactar(b0, false);
  assert.equal(configDe(bOff)?.nota_compactar, false);
});

test("flujo Claude de la app (solo Claude, claude-falso): nota escrita + umbral suave encola /compact al frente antes de cola usuario", { timeout: 20_000 }, async () => {
  const dir = nuevoDir();
  const prev = {
    HILOS_STATE: process.env.HILOS_STATE,
    HILOS_SESIONES: process.env.HILOS_SESIONES,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    HILOS_CLAUDE: process.env.HILOS_CLAUDE,
    TRAMA_FALSO_LOG: process.env.TRAMA_FALSO_LOG,
    TRAMA_FALSO_DICHO: process.env.TRAMA_FALSO_DICHO,
    TRAMA_FALSO_MS: process.env.TRAMA_FALSO_MS,
    TRAMA_FALSO_COMPACTA_MS: process.env.TRAMA_FALSO_COMPACTA_MS,
    TRAMA_FALSO_CONTEXTO: process.env.TRAMA_FALSO_CONTEXTO,
    TRAMA_MODELOS: process.env.TRAMA_MODELOS,
  };
  const estadoDir = estadoLider;
  const dichoF = path.join(dir, "dicho.log");
  const modelosF = path.join(dir, "modelos.json");
  process.env.HILOS_STATE = estadoDir;
  process.env.HILOS_SESIONES = path.join(dir, "sesiones");
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, "claude");
  process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
  process.env.TRAMA_FALSO_LOG = path.join(dir, "falso.log");
  process.env.TRAMA_FALSO_DICHO = dichoF;
  process.env.TRAMA_FALSO_MS = "20";
  process.env.TRAMA_FALSO_COMPACTA_MS = "10";
  process.env.TRAMA_FALSO_CONTEXTO = "650000";
  process.env.TRAMA_MODELOS = modelosF;
  writeFileSync(modelosF, JSON.stringify({ version: 1 }));

  const lider = await import("../electron/lider.ts");
  const { crearCola } = await import("../electron/cola.ts");
  let compactoVisto = false;
  const cola = crearCola({
    disponible: (s) => lider.disponible(s),
    traer: (s, x, c) => lider.traer(s, x, c),
    mandar: async (s, x) => { await lider.mandar({ sid: s, ...x }); },
    total: () => Promise.resolve(0),
    textoError: (x) => ("motivo" in x ? x.motivo : String(x.error)),
    guardar: async () => {},
    avisar: () => {},
    agrupar: 5,
    gracia: 20,
  });
  lider.alEvento((sid, e) => {
    if (e.tipo === "aviso" && e.aviso.clase === "compacto") compactoVisto = true;
    if (e.tipo === "fin") {
      cola.finTurno(sid);
      if (!e.error) {
        const auto = lider.planAutoNotaCompactar(sid);
        if (auto) cola.encolarPrimero(sid, { ...lider.paraCola({ sid, ...auto }).item, aviso: true, solo: true });
      }
    }
    if (e.tipo === "estado" && !e.ocupado) void cola.libre(sid);
  });

  try {
    const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "hola [[nota-compactar]]guardar estado[[/nota-compactar]]" });
    cola.encolar(sid, { texto: "después de compactar", modelo: "claude-opus-5-5", effort: "high" });

    await esperarHasta(() => compactoVisto && existsSync(dichoF) && readFileSync(dichoF, "utf8").includes("después de compactar"), { tope: 10_000 });
    const dichos = readFileSync(dichoF, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { sid: string; texto: string });
    const iCompact = dichos.findIndex((d) => d.texto === "/compact");
    const iUser = dichos.findIndex((d) => d.texto === "después de compactar");
    assert.ok(iCompact >= 0, "debe enviar /compact");
    assert.ok(iUser > iCompact, "/compact debe ir ANTES que el mensaje del usuario en cola");
  } finally {
    await lider.cerrarTodos(true);
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("flujo Gemini (solo Gemini, agy-falso): al pasar umbral fuerte pide nota, encola /compact y la pega al próximo mensaje sin turno extra", { timeout: 20_000 }, async () => {
  const dir = nuevoDir();
  const prev = {
    HILOS_STATE: process.env.HILOS_STATE,
    HILOS_SESIONES: process.env.HILOS_SESIONES,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    HILOS_AGY: process.env.HILOS_AGY,
    HILOS_AGY_BRAIN: process.env.HILOS_AGY_BRAIN,
    TRAMA_FALSO_LOG: process.env.TRAMA_FALSO_LOG,
    TRAMA_FALSO_MS: process.env.TRAMA_FALSO_MS,
    TRAMA_FALSO_AGY_TOKENS: process.env.TRAMA_FALSO_AGY_TOKENS,
    TRAMA_FALSO_AUTO_NOTA: process.env.TRAMA_FALSO_AUTO_NOTA,
    TRAMA_MODELOS: process.env.TRAMA_MODELOS,
  };
  const estadoDir = estadoLider;
  const logF = path.join(dir, "agy.log");
  const modelosF = path.join(dir, "modelos.json");
  process.env.HILOS_STATE = estadoDir;
  process.env.HILOS_SESIONES = path.join(dir, "sesiones");
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, "claude");
  process.env.HILOS_AGY = path.join(import.meta.dirname, "..", "scripts", "agy-falso.mjs");
  process.env.HILOS_AGY_BRAIN = path.join(dir, "brain");
  process.env.TRAMA_FALSO_LOG = logF;
  process.env.TRAMA_FALSO_MS = "5";
  process.env.TRAMA_FALSO_AGY_TOKENS = "760000";
  process.env.TRAMA_FALSO_AUTO_NOTA = "1";
  process.env.TRAMA_MODELOS = modelosF;
  writeFileSync(modelosF, JSON.stringify({ version: 1, lider: { modelo: "gemini-4-neon-high" }, gemini: { habilitado: true } }));
  mkdirSync(estadoDir, { recursive: true });
  writeFileSync(path.join(estadoDir, "preferencias.json"), JSON.stringify({ idioma: "es" }));

  const lider = await import("../electron/lider.ts");
  const { crearCola } = await import("../electron/cola.ts");
  let compactoVisto = false;
  const cola = crearCola({
    disponible: (s) => lider.disponible(s),
    traer: (s, x, c) => lider.traer(s, x, c),
    mandar: async (s, x) => { await lider.mandar({ sid: s, ...x }); },
    total: () => Promise.resolve(0),
    textoError: (x) => ("motivo" in x ? x.motivo : String(x.error)),
    guardar: async () => {},
    avisar: () => {},
    agrupar: 5,
    gracia: 20,
  });
  lider.alEvento((sid, e) => {
    if (e.tipo === "aviso" && e.aviso.clase === "compacto") compactoVisto = true;
    if (e.tipo === "fin") {
      cola.finTurno(sid);
      if (!e.error) {
        const auto = lider.planAutoNotaCompactar(sid);
        if (auto) cola.encolarPrimero(sid, { ...lider.paraCola({ sid, ...auto }).item, aviso: true, solo: true });
      }
    }
    if (e.tipo === "estado" && !e.ocupado) void cola.libre(sid);
  });

  try {
    const sid = await lider.nuevo({ modelo: "gemini-4-neon-high", effort: "high", texto: "primer trabajo" });
    await esperarHasta(() => compactoVisto, { tope: 12_000 });
    await esperarHasta(async () => (await lider.disponible(sid)) === "app", { tope: 8_000 });
    assert.equal(existsSync(path.join(estadoDir, "notas", `${sid}.md`)), true);

    await lider.mandar({ sid, modelo: "gemini-4-neon-high", effort: "high", texto: "después del compact" });
    await esperarHasta(
      () => existsSync(path.join(estadoDir, "notas", `${sid}.devuelta.md`)) && existsSync(logF) && readFileSync(logF, "utf8").includes("después del compact"),
      { tope: 8_000 },
    );
    const logs = readFileSync(logF, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { prompt: string });
    const conNota = logs.find((l) => l.prompt.includes("después del compact"));
    assert.ok(conNota);
    assert.match(conNota.prompt, /Nota que te escribiste antes de compactar/);
    assert.match(conNota.prompt, /Nota falsa de Gemini/);
    assert.equal(existsSync(path.join(estadoDir, "notas", `${sid}.md`)), false, "se renombra a .devuelta.md");
  } finally {
    await lider.cerrarTodos(true);
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
