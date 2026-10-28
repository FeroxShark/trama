#!/usr/bin/env node
// Un `claude -p --output-format json` falso con guion, para los casos de lanzar (casos-lanzar.ts). Lee de $GUION_DIR/guion.json
// una lista de respuestas (una por llamada, la última se repite): { json, err, rc, crear }. `json` es el objeto que imprime
// (con "@SID@" cambiado por el --session-id/--resume que le pasaron); `err` va a stderr; `crear` son archivos que deja en el cwd
// (trabajo sin commitear del worker). Anota el argv en TRAMA_FALSO_LOG como claude-falso.mjs. En la PRIMERA llamada guarda una
// foto del estado de pa y del proyecto en $GUION_DIR/antes (y el entorno en antes/env.json): es el «justo antes de lanzar» que
// el test de paridad de lanzar usa para correr la versión TS desde el mismo punto.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  process.stdout.write("2.1.287 (Claude Code)\n");
  process.exit(0);
}
const dir = process.env.GUION_DIR;
if (process.env.TRAMA_FALSO_LOG) appendFileSync(process.env.TRAMA_FALSO_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\n");
const antes = path.join(dir, "antes");
if (!existsSync(antes)) {
  mkdirSync(antes, { recursive: true });
  cpSync(process.env.PA_STATE, path.join(antes, "estado"), { recursive: true, verbatimSymlinks: true });
  cpSync(process.env.GUION_PROY, path.join(antes, "proy"), { recursive: true, verbatimSymlinks: true });
  writeFileSync(path.join(antes, "env.json"), JSON.stringify(process.env));
}
const val = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};
const sid = val("--session-id") ?? val("--resume") ?? "";
const nf = path.join(dir, "guion.n");
const n = existsSync(nf) ? Number(readFileSync(nf, "utf8")) : 0;
writeFileSync(nf, String(n + 1));
const guion = JSON.parse(readFileSync(path.join(dir, "guion.json"), "utf8"));
const r = guion[Math.min(n, guion.length - 1)];
for (const f of r.crear ?? []) writeFileSync(path.join(process.cwd(), f), "trabajo del worker\n");
if (r.json) process.stdout.write(JSON.stringify(r.json).split("@SID@").join(sid) + "\n");
if (r.err) process.stderr.write(r.err);
process.exit(r.rc ?? 0);
