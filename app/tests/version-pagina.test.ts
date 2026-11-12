import { test } from "node:test";
import assert from "node:assert/strict";
import { yaEstrenada } from "../src/barra/version-pagina.ts";

test("yaEstrenada: si la página ya corre la versión instalada no se pide reiniciar la ventana; sin saberla, sí", () => {
  assert.equal(yaEstrenada("0.2.76", "0.2.76"), true);
  assert.equal(yaEstrenada("0.2.76", "0.2.75"), false, "la ventana todavía corre la vieja");
  assert.equal(yaEstrenada("0.2.76", null), false, "sin la versión de la página, como antes");
});
