// `reparto --resumen` (motor/bin/reparto): el bloque corto que el líder lleva en contexto para elegir modelo y effort; y los avisos de `pa`
// cuando el líder no pasa `-m` (sigue con la sugerencia de reparto, pero avisa) o pasa un `-m` sin cupo (avisa y sugiere otro; sin_cupo=fallar no lanza).
// Cupos, hora y modelos fijos por entorno, y un `claude` falso: no mira nada real.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-resumen-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const AHORA = "2026-10-26T12:00:00Z";
let n = 0;
const archivo = (nombre: string, j: object) => {
  const f = path.join(tmp, `${nombre}-${n++}.json`);
  writeFileSync(f, JSON.stringify(j));
  return f;
};
/** Cupos de Claude: `usado` de la ventana de 5 h y de la semanal (1 = llena). */
const cupos = (usado5: number, usado7 = usado5) =>
  archivo("cupos", {
    version: 1,
    leido: AHORA,
    suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: usado5, vuelve: "2026-10-26T14:00:00Z" }, { id: "7d", usado: usado7, vuelve: "2026-10-30T00:00:00Z" }] }],
  });
/** Caché de AA vacía: reparto igual suma la tabla suplementaria del repo (inteligencia por effort medida), sin leer la del usuario. */
const AA = archivo("aa", { version: 1, modelos: [] });
const modelos = (j: object = {}) => archivo("modelos", { version: 1, ...j });

const home = path.join(tmp, "home");
const proy = path.join(tmp, "proy");
const estado = path.join(tmp, "estado");
const shim = path.join(tmp, "shim");
for (const d of [path.join(home, ".config", "proyectos"), proy, estado, shim]) mkdirSync(d, { recursive: true });
const git = (...a: string[]) => spawnSync("git", ["-C", proy, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("commit", "-q", "--allow-empty", "-m", "init");
writeFileSync(path.join(home, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: proy }] }));
const BIEN = "RESULTADO: hecho\nARCHIVOS: ninguno\nVERIFICACION: npm test\n  ok 1 - todo pasa\nDECISION: nada\nSIGUE: nada";
writeFileSync(
  path.join(shim, "claude"),
  `#!/bin/bash
if [[ "$1" == --version ]]; then echo "9.9.9 (Claude Code)"; exit 0; fi
printf '{"type":"result","is_error":false,"result":%s,"session_id":"%s","num_turns":2,"duration_ms":1000,"total_cost_usd":0.01}' "$(printf '%s' "$FALSO_RESULT" | jq -Rs .)" "$(cat /proc/sys/kernel/random/uuid)"
`,
);
chmodSync(path.join(shim, "claude"), 0o755);

const limpio = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PA_|REPARTO_|TRAMA_)/.test(k) && k !== "STATE"));
const entorno = (fijos: string, mod: string) => ({
  ...limpio,
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  PA_STATE: estado,
  STATE: estado,
  PA_PROJ: path.join(home, "claude-proyectos"),
  PROYECTOS_REGISTRY: path.join(home, ".config", "proyectos", "registry.json"),
  TRAMA_CLAVES: path.join(home, "no-hay.env"),
  TRAMA_MODELOS: mod,
  REPARTO_STATE: path.join(tmp, "rep"),
  REPARTO_CUPOS_FIJOS: fijos,
  REPARTO_AHORA: AHORA,
  REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
  REPARTO_OPENCODE_FIJO: '["opencode/glm-5.3-flash-free"]',
  REPARTO_AGY: "0",
  REPARTO_AA: AA,
  REPARTO_AA_SUPLEMENTO: path.join(MOTOR, "datos", "aa-suplemento.json"),
  FALSO_RESULT: BIEN,
  PATH: `${MOTOR}/bin:${shim}:${process.env.PATH}`,
});
const run = (cmd: string, args: string[], fijos: string, mod: string) => {
  const r = spawnSync(path.join(MOTOR, "bin", cmd), args, { encoding: "utf8", timeout: 90_000, env: entorno(fijos, mod) });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};
const reparto = (args: string[], fijos = cupos(0.2), mod = modelos()) => run("reparto", args, fijos, mod);
const BRIEF = "Objetivo: x\nArchivos: a.ts\nListo cuando: pasa el test\nCómo verificar: npm test\nNo tocar: b.ts";
const pa = (args: string[], fijos: string, mod = modelos()) => run("pa", ["demo", "--sin-jefe", "--tipo", "codigo-acotado", ...args, BRIEF], fijos, mod);

test("--resumen: una línea por modelo habilitado con id para -m, inteligencia por effort, costo, cupo y para qué sirve; cabe en ~30 líneas", () => {
  const r = reparto(["--resumen"]);
  assert.equal(r.rc, 0, r.err);
  const lineas = r.out.trimEnd().split("\n");
  assert.ok(lineas.length <= 30, `${lineas.length} líneas`);
  const sonnet = lineas.find((l) => l.startsWith("-m claude-sonnet-5-5 "))!;
  assert.ok(sonnet, r.out);
  assert.match(sonnet, /int\. low [\d.]+ med [\d.]+ high [\d.]+/);
  assert.match(sonnet, /pago x0\.35/);
  assert.match(sonnet, /cupo 8\d %/, "el libre es la ventana más escasa");
  assert.match(sonnet, /vuelve en/);
  assert.match(sonnet, /pedido ambiguo/);
  const gratis = lineas.find((l) => l.startsWith("-m opencode:opencode/glm-5.3-flash-free "))!;
  assert.match(gratis, / gratis · cupo 100 %/);
  assert.match(r.out, /Haiku por defecto si se describe con precisión, Sonnet si es ambiguo o Haiku falló, Opus sólo bases/);
});

test("--resumen: no lista lo que modelos.json excluye, marca SIN CUPO y --json trae los mismos modelos", () => {
  const r = reparto(["--resumen"], cupos(0.2), modelos({ excluir: ["opus"] }));
  assert.doesNotMatch(r.out, /claude-opus-5-5/);
  assert.match(r.out, /-m claude-haiku-5-5 /);
  const lleno = reparto(["--resumen"], cupos(1));
  assert.match(lleno.out, /-m claude-sonnet-5-5 .*SIN CUPO/);
  const j = JSON.parse(reparto(["--resumen", "--json"]).out) as { version: number; modelos: { id: string; intel: Record<string, { valor: number; estimada: boolean }>; gratis: boolean }[] };
  assert.equal(j.version, 1);
  const s = j.modelos.find((m) => m.id === "claude-sonnet-5-5")!;
  assert.ok(s.intel.high!.valor > 0 && s.intel.high!.estimada === false);
  assert.equal(j.modelos.find((m) => m.id === "opencode:opencode/glm-5.3-flash-free")!.gratis, true);
});

test("reparto --tipo sigue igual (lo usan pa y otros)", () => {
  const r = reparto(["--tipo", "codigo-acotado", "--json"]);
  assert.equal(r.rc, 0, r.err);
  assert.ok(JSON.parse(r.out).modelo);
});

test("pa sin -m: sigue con la sugerencia de reparto pero avisa que elija -m y --effort", () => {
  const r = pa([], cupos(0.2));
  assert.equal(r.rc, 0, r.err);
  assert.match(r.err, /pa: reparto \(codigo-acotado\) → /);
  assert.match(r.err, /pa: aviso: sin -m\. Sigo con \S+.*elegí vos modelo y effort.*-m <id> --effort <e>.*reparto --resumen/);
});

test("pa con -m y cupo: no avisa nada de cupo ni de -m", () => {
  const r = pa(["-m", "claude-sonnet-5-5", "--effort", "high"], cupos(0.2));
  assert.equal(r.rc, 0, r.err);
  assert.doesNotMatch(r.err, /sin -m|no tiene cupo/);
});

test("pa con -m sin cupo: avisa, sugiere la alternativa de reparto y lanza igual (sin_cupo=otro)", () => {
  const r = pa(["-m", "claude-opus-5-5", "--effort", "medium"], cupos(1), modelos({ sin_cupo: "otro" }));
  assert.equal(r.rc, 0, r.err);
  assert.match(r.err, /pa: aviso: claude-opus-5-5 no tiene cupo ahora \(vuelve 2026-10-/);
  assert.match(r.err, /Alternativa que sugiere reparto para codigo-acotado: -m \S+/);
  assert.doesNotMatch(r.err, /sin -m/);
});

test("pa con -m sin cupo y sin_cupo=fallar: no lanza (96) y dice por qué", () => {
  const r = pa(["-m", "claude-opus-5-5", "--effort", "medium"], cupos(1), modelos({ sin_cupo: "fallar" }));
  assert.equal(r.rc, 96, r.err);
  assert.match(r.err, /no tiene cupo ahora/);
  assert.match(r.err, /sin_cupo=fallar.*no lanzo con claude-opus-5-5/);
});
