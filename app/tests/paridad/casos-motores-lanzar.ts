// Casos de paridad de lanzar un worker con los otros motores (agy, codex, opencode, dsh y ollama): el `pa` bash (A) contra cli/pa.ts
// entero (B, otros-motores.ts + lanzar.ts + orquesta.ts). Los programas son falsos (otro-falso.mjs, un shim por nombre): anotan su
// argv, su cwd, el entorno que pa les arma y la tarea que reciben, así que la paridad cubre el argv de cada motor, el chequeo previo
// (agy -p /hooks, codex login status), el .json que pa arma del stream (agy, codex) o el que deja el runner (opencode, dsh), el latido
// y el código de salida. ollama es el claude falso con guion contra el servidor "local" (PA_ASYNC=1 se saltea la prueba del servidor).
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";
import { ponerGuion, type Respuesta } from "./casos-lanzar.ts";

const BRIEF = "Objetivo: x\nArchivos: a.ts\nListo cuando: pasa el test\nCómo verificar: npm test\nNo tocar: b.ts";
const FALSO = path.join(import.meta.dirname, "otro-falso.mjs");
const BLOQUE = "RESULTADO: hice x.\nARCHIVOS: a.ts\nVERIFICACION: npm test\n  ok 3 tests\nDECISION: nada\nSIGUE: nada";

/** Los programas falsos en el PATH del sandbox. */
function programas(c: Contexto): void {
  for (const p of ["agy", "codex", "opencode", "dsh"]) {
    const shim = path.join(c.raiz, "shim", p);
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${FALSO}" ${p} "$@"\n`);
    chmodSync(shim, 0o755);
  }
}

const mo = (nombre: string, args: string[], rc: number, o: Partial<Caso> = {}): Caso => ({
  nombre: `motores-lanzar: ${nombre}`,
  args,
  rc,
  preparar: programas,
  ...o,
  // los runners no salen a la red (go-topes) ni dejan procesos sueltos
  env: { TRAMA_GO_SIN_RED: "1", ...(o.env as Record<string, string> | undefined) },
});

// el .json de codex y el de los runners llevan la duración real: se compara todo lo demás
const SIN_DURACION = [/\.json$/];

const ok = (result: string): Respuesta => ({
  json: { type: "result", subtype: "success", is_error: false, result, session_id: "@SID@", num_turns: 3, duration_ms: 4200, total_cost_usd: 0.12345 },
});

export const casosMotoresLanzar: Caso[] = [
  // --- agy ---
  mo("agy: worktree con resultado completo", ["demo", "--sin-jefe", "-m", "gemini-4-argon-medium", BRIEF], 0),
  mo("agy: --leer", ["demo", "--sin-jefe", "--leer", "-m", "gemini-3.8-flash-low", "¿qué hace esto?"], 0),
  mo("agy: modelo de Claude por agy y --max-turns", ["demo", "--sin-jefe", "-m", "agy:claude-sonnet-5-5-high", "--max-turns", "9", BRIEF], 0),
  mo("agy: sin cupo (429) falla con 1", ["demo", "--sin-jefe", "-m", "gemini-4-argon-low", BRIEF], 1, { env: { FALSO_MODO: "cupo" } }),
  mo("agy: sin el plugin pa-worker cae a Claude", ["demo", "--sin-jefe", "-m", "gemini-4-argon-low", BRIEF], 78, { env: { FALSO_MODO: "sin-hooks" } }),
  mo("agy: --seguir no va", ["demo", "--sin-jefe", "--seguir", "-m", "gemini-4-argon-low", BRIEF], 2),
  // --- codex ---
  mo("codex: worktree con resultado completo", ["demo", "--sin-jefe", "-m", "codex:gpt-6-sol-medium", BRIEF], 0, { estadoIgnorar: SIN_DURACION }),
  mo("codex: --leer (sandbox de sólo lectura)", ["demo", "--sin-jefe", "--leer", "-m", "codex:gpt-6-luna-low", "¿qué hace esto?"], 0, { estadoIgnorar: SIN_DURACION }),
  mo("codex: sin sesión cae a Claude", ["demo", "--sin-jefe", "-m", "codex:gpt-6-sol-medium", BRIEF], 78, { env: { FALSO_MODO: "sin-login" }, estadoIgnorar: SIN_DURACION }),
  mo("codex: límite de uso falla con 1", ["demo", "--sin-jefe", "-m", "codex:gpt-6-astra-high", BRIEF], 1, { env: { FALSO_MODO: "cupo" }, estadoIgnorar: SIN_DURACION }),
  // --- opencode y dsh (el runner node que ya es node) ---
  mo("opencode: worktree con resultado completo", ["demo", "--sin-jefe", "-m", "opencode:opencode/big-pickle", BRIEF], 0, { estadoIgnorar: SIN_DURACION }),
  mo("opencode: con --effort", ["demo", "--sin-jefe", "-m", "opencode:opencode/big-pickle", "--effort", "high", BRIEF], 0, { estadoIgnorar: SIN_DURACION }),
  mo("opencode: cortó por límite (97)", ["demo", "--sin-jefe", "-m", "opencode:opencode/big-pickle", BRIEF], 97, { env: { FALSO_MODO: "cupo" }, estadoIgnorar: SIN_DURACION }),
  mo("dsh: deepseek con su key", ["demo", "--sin-jefe", "-m", "dsh:deepseek/deepseek-v4-flash", "--max-turns", "7", BRIEF], 0, { env: { DEEPSEEK_API_KEY: "sk-prueba" }, estadoIgnorar: SIN_DURACION }),
  mo("dsh: sin la key no lanza (95)", ["demo", "--sin-jefe", "-m", "dsh:deepseek/deepseek-v4-flash", BRIEF], 95),
  // --- ollama: el claude CLI contra el servidor local ---
  {
    nombre: "motores-lanzar: ollama: claude contra el servidor local",
    args: ["demo", "--sin-jefe", "-m", "ollama:qwen3-coder:30b", BRIEF],
    env: { PA_ASYNC: "1" },
    rc: 0,
    preparar: (c) => ponerGuion(c, [ok(BLOQUE)]),
  },
];
