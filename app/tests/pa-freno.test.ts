// FRENÓ del worker (`pa`): `frenoDe` saca la línea del resultado, `normaFreno` y `frenosPor` agrupan los parecidos para `pa --rinde`.
// Sin sandbox: son funciones puras. La paridad con el bash (frenos_de, freno_de_corrida) está en tests/paridad/casos-medicion.ts y casos-lanzar.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { frenoDe } from "../electron/cli/pa/resultado-lanzar.ts";
import { frenosPor, normaFreno } from "../electron/cli/pa/rinde.ts";

test("frenoDe: la línea FRENÓ del resultado, con o sin negrita, sin tabs; sin línea sale vacío", () => {
  assert.equal(frenoDe("RESULTADO: x\nDECISION: nada\nSIGUE: nada\nFRENÓ: el test se colgó dos veces."), "el test se colgó dos veces.");
  assert.equal(frenoDe("SIGUE:\n**FRENO:** el entorno tardó."), "el entorno tardó.");
  assert.equal(frenoDe("FRENÓ: a\tb"), "a b");
  assert.equal(frenoDe("RESULTADO: sin nada"), "");
});

test("normaFreno: sin acentos ni signos, en minúsculas ASCII", () => {
  assert.equal(normaFreno("El test de paridad se colgó."), "el test de paridad se colgo ");
  assert.equal(normaFreno("Ñandú, ÁRBOL"), "nandu arbol");
});

const CABECERA = "fecha\tid\tproyecto\tmodelo\tfreno";
const fila = (f: string, p: string, t: string) => [f, "x", p, "m", t].join("\t");
const DESDE = "2000-01-01";

test("frenosPor: parecidos juntos, orden por proyecto, después por n y texto; top 3 por proyecto", () => {
  const texto = [
    CABECERA,
    fila("2026-10-01", "proy", "El test de paridad se colgó."),
    fila("2026-10-02", "proy", "El test de paridad se colgó."),
    fila("2026-10-03", "proy", "Falta la cuenta de OpenCode."),
    fila("2026-10-03", "proy", "Se cayó el servidor."),
    fila("2026-10-04", "proy", "La ventana no abre."),
    fila("2026-10-04", "proy", ""),
    fila("2026-10-05", "otro", "Un error de permisos en el puerto 8080."),
    fila("2026-10-05", "otro", "Un error de permisos en el puerto 8080"),
    fila("1999-01-01", "viejo", "Algo de hace mucho"),
  ].join("\n");
  assert.deepEqual(frenosPor(texto, DESDE), [
    { proyecto: "otro", n: 2, freno: "Un error de permisos en el puerto 8080." },
    { proyecto: "proy", n: 2, freno: "El test de paridad se colgó." },
    { proyecto: "proy", n: 1, freno: "Falta la cuenta de OpenCode." },
    { proyecto: "proy", n: 1, freno: "La ventana no abre." },
  ]);
});

test("frenosPor: sin ningún FRENÓ en la ventana sale vacío", () => {
  assert.deepEqual(frenosPor(`${CABECERA}\n${fila("2026-10-01", "proy", "")}`, DESDE), []);
  assert.deepEqual(frenosPor("", DESDE), []);
});
