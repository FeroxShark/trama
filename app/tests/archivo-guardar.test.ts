// «Guardar como…» una imagen del visor (electron/archivo-guardar.ts): copia el original donde elige la persona; lo que no es una
// imagen de esta máquina, un cierre del diálogo y un error de copia no copian nada ni lanzan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { guardarComo } from "../electron/archivo-guardar.ts";

const dir = mkdtempSync(path.join(os.tmpdir(), "trama-guardar-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const en = (n: string, c: string) => {
  const r = path.join(dir, n);
  writeFileSync(r, c);
  return r;
};
const linux = process.platform === "win32" ? "win32" : "linux";

test("guardarComo: copia el original al destino elegido y sugiere su nombre y su carpeta", async () => {
  const origen = en("foto.png", "bytes de la foto");
  const destino = path.join(dir, "copia.png");
  let sugerido: [string, string | null] | null = null;
  const r = await guardarComo(origen, { elegir: async (n, c) => ((sugerido = [n, c]), destino) }, linux);
  assert.equal(r, "guardado");
  assert.deepEqual(sugerido, ["foto.png", dir]);
  assert.equal(readFileSync(destino, "utf8"), "bytes de la foto");
});

test("guardarComo: si cierra el diálogo no copia y dice «cancelado»", async () => {
  const origen = en("a.png", "x");
  let copio = false;
  const r = await guardarComo(origen, { elegir: async () => null, copiar: async () => void (copio = true) }, linux);
  assert.equal(r, "cancelado");
  assert.equal(copio, false);
});

test("guardarComo: sólo imágenes que existen, con ruta absoluta (nada de .txt, rutas relativas o faltantes)", async () => {
  let preguntó = 0;
  const p = { elegir: async () => (preguntó++, path.join(dir, "x")), copiar: async () => {} };
  assert.equal(await guardarComo(en("notas.txt", "x"), p, linux), "fallo");
  assert.equal(await guardarComo("foto.png", p, linux), "fallo");
  assert.equal(await guardarComo(path.join(dir, "no-esta.png"), p, linux), "fallo");
  assert.equal(await guardarComo(42, p, linux), "fallo");
  assert.equal(preguntó, 0);
});

test("guardarComo: un error al copiar es «fallo» y no lanza; guardar sobre el mismo archivo no copia", async () => {
  const origen = en("b.png", "x");
  assert.equal(await guardarComo(origen, { elegir: async () => path.join(dir, "y.png"), copiar: async () => Promise.reject(new Error("disco lleno")) }, linux), "fallo");
  let copio = false;
  assert.equal(await guardarComo(origen, { elegir: async () => origen, copiar: async () => void (copio = true) }, linux), "guardado");
  assert.equal(copio, false);
});
