// Casos de paridad de lanzar un worker de claude (etapa 6 del port, app/electron/cli/pa/lanzar.ts). Cada uno cambia el claude
// del sandbox por claude-guion.mjs, que contesta lo que dice `guion` (resultado completo, sin RESULTADO, límite de sesión, sin
// turnos, claude roto…) y saca una foto del estado justo antes de lanzar. Entran en `casos` (bash contra TRAMA_PA_B) y además
// lanzar.test.ts los corre con la versión TS desde esa foto (bash contra lanzar.ts, sin necesitar el `pa` TS entero).
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";

const M = "claude-sonnet-5-5";
const BRIEF = "Objetivo: x\nArchivos: a.ts\nListo cuando: pasa el test\nCómo verificar: npm test\nNo tocar: b.ts";
const GUION = path.join(import.meta.dirname, "claude-guion.mjs");

/** Una respuesta del claude con guion (ver claude-guion.mjs). */
export interface Respuesta {
  json?: Record<string, unknown>;
  err?: string;
  rc?: number;
  crear?: string[];
}

export interface CasoLanzar extends Caso {
  guion: Respuesta[];
  /** Lo que pa decidió antes de lanzar y no queda en el estado: el tope de turnos, --mcp y --max-budget-usd. */
  lanzar: { maxTurns: string; conMcp?: boolean; maxBudget?: string };
}

/** Deja el guion y cambia el `claude` del sandbox por el del guion. */
export function ponerGuion(c: Contexto, guion: Respuesta[]): void {
  writeFileSync(path.join(c.aux, "guion.json"), JSON.stringify(guion));
  const shim = path.join(c.raiz, "shim", "claude");
  writeFileSync(shim, `#!/bin/sh\nGUION_DIR='${c.aux}' GUION_PROY='${c.proyecto}' exec "${process.execPath}" "${GUION}" "$@"\n`);
  chmodSync(shim, 0o755);
}

const ok = (result: string, extra: Record<string, unknown> = {}): Respuesta => ({
  json: { type: "result", subtype: "success", is_error: false, result, session_id: "@SID@", num_turns: 3, duration_ms: 4200, total_cost_usd: 0.12345, ...extra },
});
const BLOQUE = "RESULTADO: hice x.\nARCHIVOS: a.ts\nVERIFICACION: npm test\n  ok 3 tests\nDECISION: nada\nSIGUE: nada";
const BLOQUE_SIN_VERIF = "RESULTADO: hice x.\nARCHIVOS: a.ts\nVERIFICACION: ninguna, no había tests\nDECISION: Decidir si se publica la versión nueva.\nSIGUE: publicar";

const caso = (nombre: string, args: string[], rc: number, guion: Respuesta[], lanzar: CasoLanzar["lanzar"] = { maxTurns: "100" }, env?: Record<string, string>): CasoLanzar => ({
  nombre: `lanzar: ${nombre}`,
  args,
  rc,
  env,
  guion,
  lanzar,
  preparar: (c) => ponerGuion(c, guion),
});

export const casosLanzar: CasoLanzar[] = [
  caso("resultado completo en el tree principal", ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], 0, [ok(BLOQUE)]),
  caso("worktree, resultado sin verificar y con DECISION", ["demo", "--sin-jefe", "-m", M, BRIEF], 0, [ok(BLOQUE_SIN_VERIF)]),
  caso("sin RESULTADO y con un archivo nuevo del worker", ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], 78, [{ ...ok("terminé, te aviso por mensaje"), crear: ["nuevo.txt"] }]),
  caso("--leer con resultado", ["demo", "--sin-jefe", "--leer", "-m", M, "¿qué hace esto?"], 0, [ok("RESULTADO: lee cosas.\nARCHIVOS: ninguno\nVERIFICACION: ninguna\nDECISION: nada\nSIGUE: nada")]),
  caso("límite de sesión", ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], 76, [
    { json: { type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached. You've hit your session limit · resets 7pm (UTC)", session_id: "@SID@" }, rc: 1 },
  ]),
  caso("sin turnos y el auto-cierre reporta", ["demo", "--sin-jefe", "-m", M, BRIEF], 0, [
    { json: { type: "result", subtype: "error_max_turns", is_error: true, session_id: "@SID@", num_turns: 100, duration_ms: 90000, total_cost_usd: 1.5 }, rc: 1 },
    ok(BLOQUE),
  ]),
  caso("sin turnos y el auto-cierre tampoco termina", ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], 78, [
    { json: { type: "result", subtype: "error_max_turns", is_error: true, session_id: "@SID@", num_turns: 100 }, rc: 1, crear: ["a.ts"] },
  ]),
  caso("fallo con stderr y sin result", ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], 1, [{ err: "Error: algo se rompió\nen la línea 2\n", rc: 1 }]),
  caso("instalación de claude rota", ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], 81, [{ err: "Error: claude native binary not installed\n", rc: 1 }]),
  caso("plan max: abanico y sin tope de Agent", ["demo", "--sin-jefe", "--aca", "-m", M, BRIEF], 0, [ok(BLOQUE)], { maxTurns: "150" }, { PA_PLAN: "max" }),
  caso("--mcp, --max-budget-usd y --max-turns", ["demo", "--sin-jefe", "--aca", "--mcp", "--max-budget-usd", "2", "--max-turns", "9", "-m", M, BRIEF], 0, [ok(BLOQUE)], { maxTurns: "9", conMcp: true, maxBudget: "2" }),
  caso("jefe por PA_JEFE (contrato con SendMessage)", ["demo", "--aca", "-m", M, BRIEF], 0, [ok(BLOQUE)], { maxTurns: "100" }, { PA_JEFE: "trama-jefe", PA_JEFE_ID: "1234" }),
];
