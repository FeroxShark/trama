import { test } from "node:test";
import assert from "node:assert/strict";
import { conCuenta, cuentas, filtroVigente, pasa } from "../src/paneles/ramas-vista.ts";
import type { Juicio } from "../src/datos/analista.ts";

const j = (id: string, veredicto: Juicio["veredicto"]): [string, Juicio] => [id, { id, veredicto, motivo: "" }];
const juicios = new Map([j("a", "integrar"), j("b", "descartar"), j("c", "descartar")]);

test("cuentas por veredicto, con las sin juzgar", () => {
  const c = cuentas(["a", "b", "c", "d"], juicios);
  assert.deepEqual(c, { integrar: 1, descartar: 2, retomar: 0, revisar: 0, sin: 1 });
  assert.deepEqual(conCuenta(c), ["integrar", "descartar"]);
});

test("el filtro deja pasar lo que toca", () => {
  assert.equal(pasa("a", juicios, "todas"), true);
  assert.equal(pasa("a", juicios, "descartar"), false);
  assert.equal(pasa("d", juicios, "sin"), true);
  assert.equal(pasa("b", juicios, "sin"), false);
});

test("un filtro vacío vuelve a todas", () => {
  const c = cuentas(["a"], juicios);
  assert.equal(filtroVigente("descartar", c), "todas");
  assert.equal(filtroVigente("integrar", c), "integrar");
});
