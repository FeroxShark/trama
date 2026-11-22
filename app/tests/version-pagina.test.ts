import { test } from "node:test";
import assert from "node:assert/strict";
import { faseEfectiva, yaEstrenada } from "../src/barra/version-pagina.ts";

test("yaEstrenada: si la página ya corre la versión instalada no se pide reiniciar la ventana; sin saberla, sí", () => {
  assert.equal(yaEstrenada("0.2.76", "0.2.76"), true);
  assert.equal(yaEstrenada("0.2.76", "0.2.75"), false, "la ventana todavía corre la vieja");
  assert.equal(yaEstrenada("0.2.76", null), false, "sin la versión de la página, como antes");
});

test("faseEfectiva: al reintentar tras un error de Trama, fase actualizando gana sobre act.fase === error para deshabilitar el botón", () => {
  const errMain = { fase: "error" as const, error: "falló antes" };
  assert.deepEqual(faseEfectiva(true, { tipo: "nada" }, errMain, "0.2.75"), { tipo: "error", texto: "falló antes" });
  assert.deepEqual(faseEfectiva(true, { tipo: "actualizando" }, errMain, "0.2.75"), { tipo: "actualizando" });
  assert.deepEqual(faseEfectiva(true, { tipo: "error", texto: "nuevo fallo" }, errMain, "0.2.75"), { tipo: "error", texto: "nuevo fallo" });
  assert.deepEqual(faseEfectiva(false, { tipo: "actualizando" }, errMain, "0.2.75"), { tipo: "actualizando" });
});
