// motor/bin/pa con TRAMA_PA=ts: corre el pa de TypeScript y, si un modo todavía no está portado (rc 70), sigue con el de bash.
// Sin TRAMA_PA (el caso de hoy) no toca nada: sigue siendo el bash de siempre.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { testPosix as test } from "./plataforma.ts";

const BIN = path.resolve(import.meta.dirname, "../../motor/bin/pa");
const JS = path.resolve(import.meta.dirname, "../dist-electron/cli/pa.js");

function correr(env: Record<string, string>, ...args: string[]) {
  const home = mkdtempSync(path.join(os.tmpdir(), "pa-wrapper-"));
  const limpio = { ...process.env };
  for (const k of ["PA_WORKER", "PA_ASYNC", "PA_JEFE", "PA_JEFE_ID", "TRAMA_PA", "TRAMA_PA_JS"]) delete limpio[k];
  const r = spawnSync("bash", [BIN, ...args], { encoding: "utf8", env: { ...limpio, HOME: home, PA_STATE: path.join(home, "st"), ...env } });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}

test("sin TRAMA_PA corre el bash sin avisos", () => {
  const r = correr({}, "--version");
  assert.equal(r.rc, 0);
  assert.match(r.out, /^pa \d/);
  assert.equal(r.err, "");
});

test("TRAMA_PA=ts sin el js compilado avisa y sigue con el bash", () => {
  const r = correr({ TRAMA_PA: "ts", TRAMA_PA_JS: "/no/existe.js" }, "--version");
  assert.equal(r.rc, 0);
  assert.match(r.out, /^pa \d/);
  assert.match(r.err, /no encuentro node/);
});

test("TRAMA_PA=ts corre el pa de TypeScript", { skip: existsSync(JS) ? false : "falta tsc -p tsconfig.electron.json" }, () => {
  const r = correr({ TRAMA_PA: "ts" }, "--version");
  assert.equal(r.rc, 0);
  assert.match(r.out, /^pa \d/);
  assert.equal(r.err, "");
});

test("TRAMA_PA=ts: un modo no portado (rc 70) cae al bash con aviso", () => {
  // Hoy el pa de TS porta todos los modos, así que el 70 se prueba con un pa.js falso que sale 70 (TRAMA_PA_JS).
  const falso = mkdtempSync(path.join(os.tmpdir(), "pa-js-falso-"));
  const js = path.join(falso, "pa.js");
  writeFileSync(js, 'process.stderr.write("pa-js-falso\\n");\nprocess.exit(70);\n');
  const r = correr({ TRAMA_PA: "ts", TRAMA_PA_JS: js }, "--version");
  assert.equal(r.rc, 0);
  assert.match(r.out, /^pa \d/);
  assert.match(r.err, /pa-js-falso/);
  assert.match(r.err, /sigo con el de bash/);
});

test("TRAMA_PA=bash no pasa por node", () => {
  const r = correr({ TRAMA_PA: "bash", TRAMA_PA_JS: "/no/existe.js" }, "--version");
  assert.equal(r.rc, 0);
  assert.equal(r.err, "");
});
