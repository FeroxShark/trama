// scripts/test.mjs: una ruta o un nombre suelto en argv corre sólo ese archivo (igual que TRAMA_TEST_SOLO); si no existe corta con 2
// y nunca corre todo. Corre el runner sobre scripts/fixtures/dos (TRAMA_TEST_DIR), con dos archivos.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const raiz = path.resolve(import.meta.dirname, "..");
const carpeta = path.join(raiz, "scripts", "fixtures", "dos");

function runner(args: string[], env: Record<string, string> = {}) {
  const e: Record<string, string | undefined> = { ...process.env, TRAMA_TEST_DIR: carpeta, ...env };
  delete e.TRAMA_TEST_SOLO;
  if (env.TRAMA_TEST_SOLO) e.TRAMA_TEST_SOLO = env.TRAMA_TEST_SOLO;
  const r = spawnSync(process.execPath, [path.join(raiz, "scripts", "test.mjs"), ...args], { cwd: raiz, env: e, encoding: "utf8", timeout: 60_000 });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

test("una ruta suelta corre sólo ese archivo", () => {
  const r = runner(["scripts/fixtures/dos/uno.test.ts"]);
  assert.equal(r.codigo, 0);
  assert.match(r.salida, /1\/1 archivos sin fallas/);
  assert.match(r.salida, /marca-uno/);
  assert.doesNotMatch(r.salida, /marca-dos/);
});

test("un nombre pelado y TRAMA_TEST_SOLO también", () => {
  assert.match(runner(["dos.test.ts"]).salida, /1\/1 archivos sin fallas/);
  assert.match(runner([], { TRAMA_TEST_SOLO: "dos.test.ts" }).salida, /1\/1 archivos sin fallas/);
  assert.match(runner(["uno.test.ts", "dos.test.ts"]).salida, /2\/2 archivos sin fallas/);
});

test("sin argumentos corre los dos", () => {
  assert.match(runner([]).salida, /2\/2 archivos sin fallas/);
});

test("un archivo que no existe sale con 2 y su nombre, sin correr nada", () => {
  const r = runner(["scripts/fixtures/dos/tres.test.ts"]);
  assert.equal(r.codigo, 2);
  assert.match(r.salida, /tres\.test\.ts/);
  assert.doesNotMatch(r.salida, /marca-|archivos sin fallas/);
});

test("uno bueno y uno malo también cortan: no corre el bueno solo", () => {
  const r = runner(["uno.test.ts", "tipo.test.ts"]);
  assert.equal(r.codigo, 2);
  assert.match(r.salida, /tipo\.test\.ts/);
  assert.doesNotMatch(r.salida, /marca-uno/);
});

test("un archivo de otra carpeta no se toma por homónimo", () => {
  const r = runner(["tests/uno.test.ts"]);
  assert.equal(r.codigo, 2);
});
