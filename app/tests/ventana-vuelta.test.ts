// La ventana cliente y un motor que vuelve sin haber dicho `saliendo` (electron/ventana-cliente.ts `resinc`), y la
// carpeta que se pide desde un mensaje (src/datos/carpeta-abrir.ts): un pedido que rechaza NO es «no es una carpeta».
import assert from "node:assert/strict";
import { test } from "node:test";
import { vueltaDelMotor } from "../electron/relanzar.ts";
import { resultadoCarpeta } from "../src/datos/carpeta-abrir.ts";

test("build cambiado sin saliendo: la ventana se relanza", () => {
  assert.equal(vueltaDelMotor("sello-viejo", "sello-nuevo"), "relanzar");
});

test("mismo build: sólo se recarga la página", () => {
  assert.equal(vueltaDelMotor("sello-igual", "sello-igual"), "recargar");
});

test("sin huella de algún lado (build a medias): se recarga como antes, nunca un relanzo a ciegas", () => {
  assert.equal(vueltaDelMotor(null, "sello"), "recargar");
  assert.equal(vueltaDelMotor("sello", null), "recargar");
  assert.equal(vueltaDelMotor(null, null), "recargar");
});

test("la carpeta abierta da «abierta»", async () => {
  const registro: unknown[] = [];
  assert.equal(await resultadoCarpeta(async () => true, (e) => registro.push(e)), "abierta");
  assert.equal(registro.length, 0);
});

test("el main contestó false: «no-carpeta» (el aviso de no es una carpeta)", async () => {
  const registro: unknown[] = [];
  assert.equal(await resultadoCarpeta(async () => false, (e) => registro.push(e)), "no-carpeta");
  assert.equal(registro.length, 0);
});

test("el pedido rechazó (canal sin manejador): «app», el error va al log y NO es «no-carpeta»", async () => {
  const registro: unknown[] = [];
  const error = new Error("No handler registered for 'archivo:abrirCarpeta'");
  const r = await resultadoCarpeta(async () => Promise.reject(error), (e) => registro.push(e));
  assert.equal(r, "app");
  assert.deepEqual(registro, [error]);
});
