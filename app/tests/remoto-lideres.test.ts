// El celular entra por POST /rpc a los mismos manejadores que la ventana (electron/nucleo.ts, `llamarRemoto`),
// menos los de SOLO_VENTANA. Traer, retomar y la cola de los líderes tienen que estar del lado de los que
// valen por red: si alguno pasa a SOLO_VENTANA, el celular se queda sin poder escribirle a un líder de una
// terminal ni retomar uno que murió. Es una guarda de lectura del código
// (nucleo.ts lo prueba entero tests/nucleo.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SOLO_VENTANA } from "../electron/canales/contrato.ts";

const fuente = (f: string) => readFileSync(path.join(import.meta.dirname, "..", "electron", f), "utf8");
const nucleo = fuente("nucleo.ts");
const solo = SOLO_VENTANA.map((c) => `"${c}"`).join(",");
const preload = fuente("preload.cts");

for (const canal of ["lider:traer", "lider:retomar", "lider:encolar", "lider:colaYa", "lider:colaSeleccion", "lider:colaQuitar", "lider:colas", "lider:mandar", "lider:mandarYa", "lider:cerrar", "lider:rebobinar", "lider:ramificar"]) {
  test(`${canal}: lo atiende el main y el celular puede pedirlo`, () => {
    assert.ok(nucleo.includes(`manejar("${canal}"`), "tiene manejador");
    assert.ok(preload.includes(`invocar("${canal}"`), "el preload lo expone (corre también en el navegador)");
    assert.equal(solo.includes(`"${canal}"`), false, "no es sólo de la ventana");
  });
}

test("lo que abre cosas en la pantalla de la PC sigue siendo sólo de la ventana", () => {
  for (const canal of ["lider:ir", "lider:ubicable"]) assert.ok(solo.includes(`"${canal}"`), canal);
});
