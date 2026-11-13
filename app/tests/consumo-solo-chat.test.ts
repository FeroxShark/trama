// El panel de consumo (a la derecha, clases `cs-`) sólo se ve con el chat a la vista: con Ajustes (y sus conectores), Tablero, Ramas
// o Estadísticas abiertos no ocupa lugar, a ningún ancho; al volver, lo recordado queda como estaba.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { consumoALaVista } from "../src/barra/consumo-logica.ts";

test("con un panel del pie abierto el consumo no se ve, y sin panel manda lo recordado", () => {
  for (const panel of ["ajustes", "tablero", "ramas", "estadisticas"]) {
    assert.equal(consumoALaVista(true, panel), false, `abierto + ${panel}`);
    assert.equal(consumoALaVista(false, panel), false, `oculto + ${panel}`);
  }
  assert.equal(consumoALaVista(true, null), true);
  assert.equal(consumoALaVista(false, null), false);
});

test("la barra usa esa lógica y el CSS lo esconde sin desmontarlo, a cualquier ancho", () => {
  const barra = readFileSync(new URL("../src/barra/Barra.tsx", import.meta.url), "utf8");
  assert.match(barra, /consumoALaVista\(consumo(?:Vista)?, panel\)/);
  assert.match(barra, /data-sin-consumo=/);
  assert.match(barra, /const tapa = consumoVisible && medio;/);
  const css = readFileSync(new URL("../src/paneles/contexto-panel.css", import.meta.url), "utf8");
  const regla = css.match(/\.app\[data-sin-consumo\] > \.cs,[^{]*\{[^}]*\}/);
  assert.ok(regla[0].includes("acople-panel[data-panel=\"contexto\"]"));
  assert.ok(regla, "falta la regla de data-sin-consumo");
  assert.match(regla[0], /display:\s*none/);
  // No está dentro de una @media: vale a cualquier ancho.
  const antes = css.slice(0, css.indexOf(regla[0]));
  assert.equal((antes.match(/\{/g) ?? []).length, (antes.match(/\}/g) ?? []).length, "la regla no puede ir dentro de un @media");
});
