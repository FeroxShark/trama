// Paridad de la etapa 9 (ramas, integrar, descartar, lecciones, validaciones de auditar/actualizar): cada caso de casos-ramas.ts
// con el bash (A) y con el `pa` de TS (B). B es TRAMA_PA_B si está (el `pa` completo) o, mientras tanto, la entrada provisoria
// app/electron/cli/pa/ramas.ts corrida desde el fuente. TRAMA_PARIDAD_SOLO=<texto> filtra por nombre, como paridad.test.ts.
import assert from "node:assert/strict";
import path from "node:path";
import { testPosix as test } from "../plataforma.ts";
import { casosRamas } from "./casos-ramas.ts";
import { comandoB, comandoOriginal, correr, diferencias } from "./arnes.ts";

const B = comandoB(process.env) ?? [process.execPath, path.join(import.meta.dirname, "..", "..", "electron", "cli", "pa", "ramas.ts")];
const filtro = process.env.TRAMA_PARIDAD_SOLO;

for (const caso of casosRamas) {
  if (filtro && !caso.nombre.includes(filtro)) continue;
  test(`paridad ts: ${caso.nombre}`, { timeout: 300_000 }, () => {
    const a = correr(caso, comandoOriginal());
    const esperado = caso.pasos ? caso.pasos.map((p) => p.rc) : [caso.rc];
    esperado.forEach((rc, i) => {
      if (rc !== undefined) assert.equal(a.pasos[i]?.rc, rc, `el bash dio otro código en el paso ${i + 1}: ${a.pasos[i]?.stderr}`);
    });
    const b = correr(caso, B);
    const dif = diferencias(a, b);
    assert.equal(dif, "", `bash y TS difieren:\n${dif}`);
  });
}
