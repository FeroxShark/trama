// B149 / NOCHE-6: un worker entregado que falló (rc ≠ 0 o is_error) dice «No terminó» con glifo de fallo, no «Terminó».
// Sólo pide atención (chip, «N falló») si terminó hace menos de 24 h; sin esperas por reloj: `ahora` se inyecta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { atencionItem, FALLO_RECIENTE_S, noTermino, seOculta, type Item } from "../src/barra/arbol.ts";
import { readFileSync } from "node:fs";
import { es } from "../src/i18n/es.ts";
import { en } from "../src/i18n/en.ts";
import type { Hilo } from "../src/datos/contrato.ts";

const AHORA = 1_800_000_000;
const HORA = 3600;

const item = (o: Partial<Hilo>): Item => ({
  h: { id: "w", estado: "entregado", inicio: AHORA - 2 * HORA, duracion_s: 600, origen: "jefe", rama: null, commits: 0, ...o } as Hilo,
  estado: "entregado",
});

test("un entregado fallado (agy con rc 130) dice «No terminó», tipo fallo, y pide atención", () => {
  const it = item({ fallo: true });
  assert.equal(noTermino(it), true);
  assert.equal(atencionItem(it, undefined, AHORA), "fallo");
  assert.equal(seOculta(it, true, AHORA), false, "no se pliega en «N terminados»");
});

test("un entregado fallado de hace más de 24 h conserva palabra e ícono pero no pide atención", () => {
  const it = item({ fallo: true, inicio: AHORA - FALLO_RECIENTE_S - 2 * HORA });
  assert.equal(noTermino(it), true, "sigue con palabra e ícono");
  assert.equal(atencionItem(it, undefined, AHORA), null);
  assert.equal(seOculta(it, true, AHORA), true);
});

test("un entregado sano sigue diciendo «Terminó»", () => {
  const it = item({ fallo: false });
  assert.equal(noTermino(it), false);
  assert.equal(atencionItem(it, undefined, AHORA), null);
  assert.equal(seOculta(it, true, AHORA), true);
  // un `pa` viejo sin el campo se comporta igual
  assert.equal(noTermino(item({})), false);
});

test("la fila lo dibuja con la palabra «No terminó» y el tipo fallo (nunca sólo color)", () => {
  assert.equal(es["estado.noTermino"], "No terminó");
  assert.ok(en["estado.noTermino"]);
  const piezas = readFileSync(new URL("../src/barra/piezas.tsx", import.meta.url), "utf8");
  assert.match(piezas, /NO_TERMINO = tipo\("fallo", "estado\.noTermino"\)/);
  assert.match(piezas, /estado === "entregado" && h\.fallo\s*\? NO_TERMINO/);
});
