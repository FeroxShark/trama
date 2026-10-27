// Paridad del `pa`: cada caso de casos.ts corre con el bash (A) y con el segundo `pa` (B, TRAMA_PA_B); deben dar lo
// mismo (salida normalizada, código, argv de claude, archivos de estado). Sin TRAMA_PA_B compara bash contra bash:
// comprueba que el caso es determinista y que la normalización alcanza. TRAMA_PARIDAD_SOLO=<texto> filtra por nombre.
import assert from "node:assert/strict";
import { testPosix as test } from "../plataforma.ts";
import { casos } from "./casos.ts";
import type { Herramienta } from "./arnes.ts";
import { comandoB, correr, diferencias, originalDe, tsDe } from "./arnes.ts";

/** A: el original; B: TRAMA_*_B si está, y si no el TS de las herramientas chicas (o el mismo bash en `pa`, para ver el determinismo). */
const comandoA = (h: Herramienta = "pa") => [originalDe(h)];
const comandoBDe = (h: Herramienta = "pa") => comandoB(process.env, h) ?? (h === "pa" ? [originalDe(h)] : tsDe(h));
const filtro = process.env.TRAMA_PARIDAD_SOLO;

for (const caso of casos) {
  if (filtro && !caso.nombre.includes(filtro)) continue;
  test(`paridad: ${caso.nombre}`, { timeout: 300_000 }, () => {
    const a = correr(caso, comandoA(caso.herramienta));
    const esperado = caso.pasos ? caso.pasos.map((p) => p.rc) : [caso.rc];
    esperado.forEach((rc, i) => {
      if (rc !== undefined) assert.equal(a.pasos[i]?.rc, rc, `el original dio otro código en el paso ${i + 1}: ${a.pasos[i]?.stderr}`);
    });
    const b = correr(caso, comandoBDe(caso.herramienta));
    const dif = diferencias(a, b);
    assert.equal(dif, "", `A (original) y B difieren:\n${dif}`);
  });
}
