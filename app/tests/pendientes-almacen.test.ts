// Lo que Ana tocó en el tablero nuevo y no mandó (electron/pendientes.ts): se guarda en un archivo propio y
// vuelve igual tras un reinicio; lo raro del archivo (o de un cliente roto) no entra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ITEMS_MAX, TEXTO_MAX, almacenPendientes, limpiarTocado } from "../electron/pendientes.ts";

const dir = mkdtempSync(path.join(os.tmpdir(), "hilos-pendientes-"));
const escribir = async (archivo: string, texto: string) => writeFileSync(archivo, texto);

test("limpiarTocado: sólo entra lo contestado y bien formado", () => {
  const t = limpiarTocado({
    q: {
      "9001": { op: "a", otra: "" },
      "9002": { op: "otra", otra: "  " },
      "9003": { op: "otra", otra: "escrito" },
      "x": { op: "a", otra: "" },
      "9004": { op: "", otra: "" },
      "9005": { op: "a".repeat(41), otra: "" },
      "9006": "no es objeto",
    },
    p: {
      "9011": { res: "anda", nota: "" },
      "9012": { res: "no-anda", nota: "n".repeat(TEXTO_MAX + 50) },
      "9013": { res: "tal vez", nota: "" },
      "7": null,
    },
  });
  assert.deepEqual(Object.keys(t.q).sort(), ["9001", "9003"]);
  assert.deepEqual(t.q["9003"], { op: "otra", otra: "escrito" });
  assert.deepEqual(Object.keys(t.p).sort(), ["9011", "9012"]);
  assert.equal(t.p["9012"]!.nota.length, TEXTO_MAX);
  for (const raro of [null, undefined, "x", 3, [], { q: [], p: "no" }]) assert.deepEqual(limpiarTocado(raro), { q: {}, p: {} });
});

test("limpiarTocado: no pasa de ITEMS_MAX por lado", () => {
  const q = Object.fromEntries(Array.from({ length: ITEMS_MAX + 40 }, (_, i) => [String(i + 1), { op: "a", otra: "" }]));
  assert.equal(Object.keys(limpiarTocado({ q, p: {} }).q).length, ITEMS_MAX);
});

test("el almacén guarda en su archivo y otro arranque lo lee igual", async () => {
  const archivo = path.join(dir, "pendientes.json");
  const uno = almacenPendientes(archivo, escribir);
  assert.deepEqual(await uno.leer(), { q: {}, p: {} });
  await uno.guardar({ q: { "9002": { op: "c", otra: "" } }, p: { "9011": { res: "anda", nota: "ok" } }, basura: 1 });
  assert.equal(JSON.parse(readFileSync(archivo, "utf8")).version, 1);
  assert.equal("basura" in JSON.parse(readFileSync(archivo, "utf8")), false);
  const otro = almacenPendientes(archivo, escribir);
  assert.deepEqual(await otro.leer(), { q: { "9002": { op: "c", otra: "" } }, p: { "9011": { res: "anda", nota: "ok" } } });
  // Mandar vacía lo mandado: el último que escribe gana.
  await otro.guardar({ q: {}, p: {} });
  assert.deepEqual(await almacenPendientes(archivo, escribir).leer(), { q: {}, p: {} });
});

test("un archivo roto, vacío o de otra versión se lee como vacío", async () => {
  const archivo = path.join(dir, "roto.json");
  for (const contenido of ["", "{no es json", JSON.stringify({ version: 2, q: { "1": { op: "a", otra: "" } }, p: {} }), "null"]) {
    writeFileSync(archivo, contenido);
    assert.deepEqual(await almacenPendientes(archivo, escribir).leer(), { q: {}, p: {} });
  }
  assert.deepEqual(await almacenPendientes(path.join(dir, "no-existe.json"), escribir).leer(), { q: {}, p: {} });
  rmSync(dir, { recursive: true, force: true });
});
