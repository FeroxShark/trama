// Paridad del `pa`: cada caso de casos.ts corre con el bash (A) y con el segundo `pa` (B, TRAMA_PA_B); deben dar lo
// mismo (salida normalizada, código, argv de claude, archivos de estado). Sin TRAMA_PA_B compara bash contra bash:
// comprueba que el caso es determinista y que la normalización alcanza. TRAMA_PARIDAD_SOLO=<texto> filtra por nombre;
// TRAMA_PARIDAD_HERRAMIENTA=<h1,h2> filtra por herramienta (sin campo = "pa"; lo usa `npm run check:changed`).
// TRAMA_PARIDAD_PARTE=<i>/<n> corre sólo la parte i (de 0 a n-1) de los casos que quedan: check:changed reparte la paridad en
// varios procesos a la vez para entrar en el tiempo del tool de un worker.
import assert from "node:assert/strict";
import { testPosix as test } from "../plataforma.ts";
import { casos } from "./casos.ts";
import type { Herramienta } from "./arnes.ts";
import { comandoB, comandoOriginal, correr, diferencias, tsDe } from "./arnes.ts";

/** A: el original; B: TRAMA_*_B si está, y si no el TS de las herramientas chicas (o el mismo bash en `pa`, para ver el determinismo). */
const comandoA = (h: Herramienta = "pa") => comandoOriginal(h);
const comandoBDe = (h: Herramienta = "pa") => comandoB(process.env, h) ?? (h === "pa" ? comandoOriginal(h) : tsDe(h));
const filtro = process.env.TRAMA_PARIDAD_SOLO;
const herramientas = process.env.TRAMA_PARIDAD_HERRAMIENTA?.split(",").map((h) => h.trim()).filter(Boolean);

const parte = /^(\d+)\/(\d+)$/.exec(process.env.TRAMA_PARIDAD_PARTE ?? "");
let visto = 0;
for (const caso of casos) {
  if (filtro && !caso.nombre.includes(filtro)) continue;
  if (herramientas && !herramientas.includes(caso.herramienta ?? "pa")) continue;
  if (parte && visto++ % Number(parte[2]) !== Number(parte[1])) continue;
  test(`paridad: ${caso.nombre}`, { timeout: 300_000 }, () => {
    const a = correr(caso, comandoA(caso.herramienta));
    const esperado = caso.pasos ? caso.pasos.map((p) => p.rc) : [caso.rc];
    esperado.forEach((rc, i) => {
      if (rc !== undefined) assert.equal(a.pasos[i]?.rc, rc, `el original dio otro código en el paso ${i + 1}: ${a.pasos[i]?.stderr}`);
    });
    const b = correr(caso, comandoBDe(caso.herramienta));
    // el caso puede divergir a propósito del original (el bash está congelado): entonces no se compara el argv de claude.
    const dif = diferencias(a, b, { ignorar: [...(caso.divergencia ? ["argv" as const] : []), ...(caso.divergenciaSalida ? ["salida" as const] : [])] });
    assert.equal(dif, "", `A (original) y B difieren:\n${dif}`);
  });
}
