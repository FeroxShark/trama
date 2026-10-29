// scripts/test.mjs: el tope por archivo mata el árbol entero (también lo que se desprendió) y ningún archivo deja procesos
// vivos. Corre el runner sobre las carpetas de scripts/fixtures (TRAMA_TEST_DIR) y mira cada proceso por su pid.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { vivo } from "../electron/cli/base/proc.ts";

const raiz = path.resolve(import.meta.dirname, "..");

/** Corre el runner sobre scripts/fixtures/<carpeta>. `fin` da el código y la salida al terminar. */
function runner(carpeta: string, env: Record<string, string>) {
  const hijo = spawn(process.execPath, [path.join(raiz, "scripts", "test.mjs")], {
    cwd: raiz,
    env: { ...process.env, TRAMA_TEST_DIR: path.join(raiz, "scripts", "fixtures", carpeta), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let salida = "";
  hijo.stdout.setEncoding("utf8").on("data", (d: string) => (salida += d));
  hijo.stderr.setEncoding("utf8").on("data", (d: string) => (salida += d));
  const fin = new Promise<{ codigo: number | null; salida: string }>((r) => hijo.on("close", (codigo) => r({ codigo, salida })));
  return { hijo, fin };
}

async function esperar(cond: () => boolean, ms = 10_000) {
  const t = Date.now();
  while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 100));
  return cond();
}

const pidsEn = () => path.join(mkdtempSync(path.join(os.tmpdir(), "trama-tope-")), "pids.json");
const leerPids = (archivo: string) => JSON.parse(readFileSync(archivo, "utf8")) as number[];

test("un archivo que se cuelga se corta a su tope y no deja vivo ni uno de sus procesos", { timeout: 60_000 }, async () => {
  const pids = pidsEn();
  const r = await runner("cuelga", { TRAMA_TEST_ARCHIVO_S: "2", TRAMA_TEST_PIDS: pids }).fin;
  assert.notEqual(r.codigo, 0);
  assert.match(r.salida, /sin terminar tras 2 s; se cortó/);
  const lista = leerPids(pids);
  assert.equal(lista.length, 2);
  await esperar(() => lista.every((p) => !vivo(p)));
  assert.deepEqual(lista.filter((p) => vivo(p)), []);
});

test("un archivo que termina con un proceso desprendido vivo: lo mata y avisa, sin fallar", { skip: process.platform !== "linux", timeout: 60_000 }, async () => {
  const pids = pidsEn();
  const r = await runner("sobra", { TRAMA_TEST_PIDS: pids }).fin;
  assert.equal(r.codigo, 0);
  assert.match(r.salida, /dejó 1 proceso\(s\) vivo\(s\); se mataron/);
  const lista = leerPids(pids);
  await esperar(() => lista.every((p) => !vivo(p)));
  assert.deepEqual(lista.filter((p) => vivo(p)), []);
});

test("si el runner muere sin avisar (SIGKILL), el vigía mata lo que dejó", { skip: process.platform !== "linux", timeout: 60_000 }, async () => {
  const pids = pidsEn();
  const { hijo } = runner("cuelga", { TRAMA_TEST_ARCHIVO_S: "100", TRAMA_TEST_PIDS: pids });
  assert.ok(await esperar(() => existsSync(pids)), "el archivo no llegó a colgarse");
  hijo.kill("SIGKILL");
  const lista = leerPids(pids);
  await esperar(() => lista.every((p) => !vivo(p)), 15_000);
  assert.deepEqual(lista.filter((p) => vivo(p)), []);
});
