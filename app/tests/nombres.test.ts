// Los títulos, carpetas y ocultos que Ana elige a mano (B20): se guardan en
// nombres.json y vuelven igual en el próximo arranque.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { almacenNombres, TITULO_MAX } from "../electron/nombres.ts";

const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), "hilos-nombres-")), "nombres.json");

test("nombres: renombrar persiste y sobrevive a un arranque nuevo", async () => {
  const f = tmp();
  const a = almacenNombres(f, writeFile);
  assert.deepEqual(await a.leer(), { titulos: {}, proyectos: {}, ocultos: [], orden: { carpetas: [], lideres: {} } });
  await a.titulo("20990101-000000-1", "  Login\n  roto  ");
  await a.titulo("sesion-a", "omc v2");
  await a.proyecto("sesion-a", "omc");
  await a.oculto("atlas", true);
  await a.oculto("atlas", true);
  const b = almacenNombres(f, writeFile);
  assert.deepEqual(await b.leer(), {
    titulos: { "20990101-000000-1": "Login roto", "sesion-a": "omc v2" },
    proyectos: { "sesion-a": "omc" },
    ocultos: ["atlas"],
    orden: { carpetas: [], lideres: {} },
  });
  assert.equal(JSON.parse(readFileSync(f, "utf8")).version, 1);
});

test("nombres: vacío o null deshace, y lo raro no se guarda", async () => {
  const f = tmp();
  const a = almacenNombres(f, writeFile);
  await a.titulo("x", "uno");
  await a.titulo("x", "   ");
  await a.proyecto("s", "omc");
  await a.proyecto("s", null);
  await a.oculto("atlas", true);
  await a.oculto("atlas", false);
  await a.titulo("", "nada");
  await a.titulo("y", 3);
  await a.proyecto("s", 4);
  await a.oculto("atlas", "si");
  await a.titulo("largo", "a".repeat(500));
  const b = await almacenNombres(f, writeFile).leer();
  assert.deepEqual(b.proyectos, {});
  assert.deepEqual(b.ocultos, []);
  assert.deepEqual(Object.keys(b.titulos), ["largo"]);
  assert.equal(b.titulos.largo.length, TITULO_MAX);
});

test("nombres: versión desconocida o JSON roto → vacío, sin romper", async () => {
  const f = tmp();
  writeFileSync(f, JSON.stringify({ version: 9, titulos: { x: "y" } }));
  assert.deepEqual((await almacenNombres(f, writeFile).leer()).titulos, {});
  writeFileSync(f, "{roto");
  assert.deepEqual((await almacenNombres(f, writeFile).leer()).ocultos, []);
});
