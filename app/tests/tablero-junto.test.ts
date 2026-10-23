// El tablero junto (electron/tablero-junto.ts): puro, sin el CLI. Dos tableros con los mismos números de item.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esperanJuntas, juntarTableros, type TableroOtra } from "../electron/tablero-junto.ts";
import type { TableroCrudo } from "../electron/tablero.ts";
import { numero, validar } from "../src/datos/tablero.ts";

const it = (id: number, titulo: string, extra: object = {}) => ({ id, columna: "espera-dueno", proyecto: "atlas", titulo, ...extra });
const crudo = (columnas: Record<string, unknown[]>, extra: Partial<TableroCrudo> = {}, pospuestos = 0): TableroCrudo => ({
  version: 1,
  vista: { columnas, contadores: { pospuestos } },
  hecho: [],
  proyectos: [],
  pospuestosLista: [],
  aviso: null,
  ...extra,
});
const dell = (tb: TableroCrudo | null): TableroOtra => ({ id: "dell", nombre: "Dell", tb });

test("los items de allá llevan su máquina y su id con prefijo; los de acá no cambian", () => {
  const local = crudo({ "espera-dueno": [it(1, "Acá")], sigue: [it(2, "Acá también")] });
  const otra = crudo({ "espera-dueno": [it(1, "Allá")], ideas: [it(3, "Idea de allá")] });
  const j = juntarTableros(local, [dell(otra)], []);
  const cols = (j.vista as { columnas: Record<string, { id: unknown; maquina?: string }[]> }).columnas;
  assert.deepEqual(cols["espera-dueno"].map((i) => [i.id, i.maquina]), [[1, undefined], ["dell:1", "dell"]]);
  assert.deepEqual(cols.ideas.map((i) => i.id), ["dell:3"]);
  assert.deepEqual(cols.sigue.map((i) => i.id), [2]);
  // Lo que valida la ventana: los dos con su número, y el de allá con su máquina.
  const v = validar(j);
  assert.deepEqual(v.columnas["espera-dueno"].map((i) => [i.id, i.maquina, i.maquinaNombre]), [[1, undefined, undefined], ["dell:1", "dell", "Dell"]]);
  assert.equal(numero("dell:1"), "1");
  assert.equal(numero(7), "7");
});

test("lo hecho, los pospuestos, los proyectos y los contadores se juntan", () => {
  const local = crudo({}, { hecho: [it(5, "a", { cerrado: "2026-10-10T00:00:00Z" })], proyectos: [{ proyecto: "atlas", etapa: "activo", dias: 5, abiertos: 2, sigue: null }], pospuestosLista: [it(9, "p")] }, 1);
  const otra = crudo({}, {
    hecho: [it(5, "b", { cerrado: "2026-10-12T00:00:00Z" })],
    proyectos: [{ proyecto: "atlas", etapa: "pausado", dias: 2, abiertos: 3, sigue: "seguir" }, { proyecto: "faro", etapa: "activo", dias: 1, abiertos: 1, sigue: null }],
    pospuestosLista: [it(9, "q")],
  }, 2);
  const j = juntarTableros(local, [dell(otra)], []);
  assert.deepEqual((j.hecho as { id: unknown }[]).map((i) => i.id), ["dell:5", 5], "lo más nuevo primero");
  assert.deepEqual(j.proyectos, [{ proyecto: "atlas", etapa: "activo", dias: 2, abiertos: 5, sigue: "seguir" }, { proyecto: "faro", etapa: "activo", dias: 1, abiertos: 1, sigue: null }]);
  assert.deepEqual((j.pospuestosLista as { id: unknown }[]).map((i) => i.id), [9, "dell:9"]);
  assert.equal((j.vista as { contadores: { pospuestos: number } }).contadores.pospuestos, 3);
});

test("con la otra caída o sin tablero queda el de acá solo, con su nombre en caidas", () => {
  const local = crudo({ "espera-dueno": [it(1, "Acá")] });
  const j = juntarTableros(local, [dell(null)], ["Dell"]);
  assert.deepEqual(j.vista, local.vista);
  assert.deepEqual(j.caidas, ["Dell"]);
  assert.deepEqual(validar(j).caidas, ["Dell"]);
  assert.deepEqual(validar(local).caidas, [], "sin otras máquinas no viene nada");
});

test("el número del pie suma lo que espera de allá; sin tablero allá, el de acá", () => {
  const otra = crudo({ "espera-dueno": [it(1, "a"), it(2, "b", { respuesta: { texto: "ya" } })] });
  assert.equal(esperanJuntas(3, [dell(otra)]), 4);
  assert.equal(esperanJuntas(null, [dell(otra)]), 1);
  assert.equal(esperanJuntas(3, [dell(null)]), 3);
  assert.equal(esperanJuntas(null, []), null);
});

test("un id de allá mal formado no es un item", () => {
  const v = validar(crudo({ "espera-dueno": [{ ...it(1, "x"), id: "dell:abc" }, { ...it(1, "y"), id: "../1" }, { ...it(1, "ok"), id: "dell:4" }] }));
  assert.deepEqual(v.columnas["espera-dueno"].map((i) => i.id), ["dell:4"]);
});
