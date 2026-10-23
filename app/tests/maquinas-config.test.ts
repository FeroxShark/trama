// electron/maquinas-config.ts: las otras máquinas (`maquinas.json`) y el prefijo de máquina en los ids (src/datos/contrato.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { leerMaquinas, parsearMaquinas, SOLA } from "../electron/maquinas-config.ts";
import { conMaquina, sinMaquina } from "../src/datos/contrato.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-maquinas-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("sin archivo: sólo esta máquina, sin error", () => {
  assert.deepEqual(leerMaquinas(path.join(tmp, "no-esta.json")), SOLA);
  assert.deepEqual(SOLA.maquinas, []);
});

test("archivo bueno: esta y las otras, con la url reducida a su origen", () => {
  const f = path.join(tmp, "maquinas.json");
  writeFileSync(f, JSON.stringify({ version: 1, esta: "pc", maquinas: [{ id: "dell", nombre: " Dell ", url: "http://192.0.2.2:4545/algo" }] }));
  assert.deepEqual(leerMaquinas(f), { esta: "pc", maquinas: [{ id: "dell", nombre: "Dell", url: "http://192.0.2.2:4545" }], malas: [] });
});

test("versión desconocida, JSON roto o forma mala: error, no se adivina", () => {
  const f = path.join(tmp, "roto.json");
  writeFileSync(f, "{");
  assert.ok("error" in leerMaquinas(f));
  assert.ok("error" in parsearMaquinas({ version: 2, maquinas: [] }));
  assert.ok("error" in parsearMaquinas(null));
  assert.ok("error" in parsearMaquinas({ version: 1, esta: "PC:1" }));
  assert.ok("error" in parsearMaquinas({ version: 1, maquinas: {} }));
});

test("entradas malas se saltean y se anotan; las buenas quedan", () => {
  const r = parsearMaquinas({
    version: 1,
    esta: "pc",
    maquinas: [
      { id: "dell", url: "http://192.0.2.2:4545" },
      { id: "dell", url: "http://192.0.2.3:4545" },
      { id: "pc", url: "http://192.0.2.4:4545" },
      { id: "mal:id", url: "http://x" },
      { id: "nas", url: "ftp://192.0.2.5" },
      { id: "otra", url: "http://yo:clave@192.0.2.6:1" },
      { id: "rota", url: "no es url" },
    ],
  });
  assert.ok(!("error" in r));
  assert.deepEqual(r.maquinas, [{ id: "dell", nombre: "dell", url: "http://192.0.2.2:4545" }]);
  assert.equal(r.malas.length, 6);
});

test("ids con máquina: los de esta van sin prefijo; ida y vuelta", () => {
  assert.equal(conMaquina(undefined, "20261014-213452-577230"), "20261014-213452-577230");
  assert.equal(conMaquina("dell", "20261014-213452-577230"), "dell:20261014-213452-577230");
  assert.deepEqual(sinMaquina("dell:20261014-213452-577230"), { maquina: "dell", id: "20261014-213452-577230" });
  assert.deepEqual(sinMaquina("2b1c0d9e-uuid"), { maquina: undefined, id: "2b1c0d9e-uuid" });
});
