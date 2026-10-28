#!/usr/bin/env node
// El `claude -p --output-format json` falso de la prueba de humo del motor (scripts/humo-motor.mjs). Corre igual en Linux y en
// Windows (se lanza con node, no hace falta un ejecutable). HUMO_CLAUDE_MODO: `ok` (default) contesta un RESULTADO y sale 0;
// `colgar` no contesta nunca (para probar --matar). HUMO_CLAUDE_LOG: una línea JSON por arranque con el argv y el cwd.
// HUMO_CLAUDE_PID: archivo donde deja su pid.
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("2.1.287 (Claude Code)\n");
  process.exit(0);
}
if (process.env.HUMO_CLAUDE_LOG) appendFileSync(process.env.HUMO_CLAUDE_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\n");
if (process.env.HUMO_CLAUDE_PID) writeFileSync(process.env.HUMO_CLAUDE_PID, String(process.pid));
const val = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : "";
};
if (process.env.HUMO_CLAUDE_MODO === "colgar") {
  setInterval(() => {}, 1000);
} else {
  const result = "RESULTADO: hice la tarea de humo.\nARCHIVOS: ninguno\nVERIFICACION: node humo\n  ok 1\nDECISION: nada\nSIGUE: nada";
  const sid = val("--session-id") || val("--resume");
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result, session_id: sid, num_turns: 1, duration_ms: 10, total_cost_usd: 0.001 }) + "\n");
  process.exit(0);
}
