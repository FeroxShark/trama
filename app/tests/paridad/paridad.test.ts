// Paridad del `pa`: cada caso de casos.ts corre con el bash (A) y con el segundo `pa` (B, TRAMA_PA_B); deben dar lo
// mismo (salida normalizada, código, argv de claude, archivos de estado). Sin TRAMA_PA_B compara bash contra bash:
// comprueba que el caso es determinista y que la normalización alcanza. TRAMA_PARIDAD_SOLO=<texto> filtra por nombre.
import assert from "node:assert/strict";
import { testPosix as test } from "../plataforma.ts";
import { casos } from "./casos.ts";
import { PA_BASH, comandoB, correr, diferencias } from "./arnes.ts";

const B = comandoB() ?? [PA_BASH];
const filtro = process.env.TRAMA_PARIDAD_SOLO;

for (const caso of casos) {
  if (filtro && !caso.nombre.includes(filtro)) continue;
  test(`paridad: ${caso.nombre}`, { timeout: 300_000 }, () => {
    const a = correr(caso, [PA_BASH]);
    const esperado = caso.pasos ? caso.pasos.map((p) => p.rc) : [caso.rc];
    esperado.forEach((rc, i) => {
      if (rc !== undefined) assert.equal(a.pasos[i]?.rc, rc, `el bash dio otro código en el paso ${i + 1}: ${a.pasos[i]?.stderr}`);
    });
    const b = correr(caso, B);
    const dif = diferencias(a, b);
    assert.equal(dif, "", `A (bash) y B difieren:\n${dif}`);
  });
}
