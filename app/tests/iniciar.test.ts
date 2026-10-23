// "Iniciar" del tablero: cómo se agrupan las tareas marcadas, a qué líder va cada grupo y qué
// mensaje recibe (src/datos/iniciar.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NUEVO, agrupar, cambiaElModelo, destinoDe, modeloDeInicio, promptIniciar, type LiderDe } from "../src/datos/iniciar.ts";
import type { Item } from "../src/datos/tablero.ts";

const item = (id: number, proyecto: string, titulo: string, mas: Partial<Item> = {}): Item => ({
  id,
  columna: "sigue",
  proyecto,
  titulo,
  detalle: "",
  prueba: "",
  origen: "",
  clave: "",
  head: null,
  creado: "2026-03-01T10:00:00Z",
  tocado: "2026-03-01T10:00:00Z",
  cerrado: null,
  hasta: null,
  ...mas,
});

const lider = (id: string, carpeta: string, actividad: number, ocupado = false): LiderDe => ({ id, nombre: `líder ${id}`, carpeta, ocupado, actividad });

const CARPETAS = { "Atlas Web": "atlas", atlas: "atlas", brote: "brote" };

test("agrupar: un grupo por proyecto, en el orden en que aparecen, con sus tareas en orden", () => {
  const gs = agrupar([item(1, "brote", "a"), item(2, "Atlas Web", "b"), item(3, "brote", "c")], CARPETAS, []);
  assert.deepEqual(
    gs.map((g) => [g.proyecto, g.carpeta, g.items.map((i) => i.id)]),
    [
      ["brote", "brote", [1, 3]],
      ["Atlas Web", "atlas", [2]],
    ],
  );
});

test("agrupar: un área, un proyecto que trama no conoce y lo que no tiene proyecto van a Inicio, cada uno en su grupo", () => {
  const gs = agrupar([item(1, "sistema", "a"), item(2, "", "b"), item(3, "nadie", "c"), item(4, "sistema", "d"), item(5, "toString", "e")], CARPETAS, [lider("x", "general", 9)]);
  assert.deepEqual(
    gs.map((g) => [g.proyecto, g.carpeta, g.items.length, g.lideres.length]),
    [
      ["sistema", null, 2, 0],
      ["", null, 1, 0],
      ["nadie", null, 1, 0],
      ["toString", null, 1, 0],
    ],
  );
});

test("agrupar y destinoDe: se reusa el líder más reciente de la carpeta; se puede elegir otro, o uno nuevo", () => {
  const ls = [lider("viejo", "atlas", 10), lider("otro", "brote", 99), lider("nuevo", "atlas", 50, true)];
  const [g] = agrupar([item(1, "Atlas Web", "a")], CARPETAS, ls);
  assert.deepEqual(g.lideres.map((l) => l.id), ["nuevo", "viejo"]);
  assert.equal(destinoDe(g)?.id, "nuevo");
  assert.equal(destinoDe(g, "viejo")?.id, "viejo");
  assert.equal(destinoDe(g, NUEVO), null);
  // El elegido ya no está (lo cerraron mientras se confirmaba): el de siempre.
  assert.equal(destinoDe(g, "se-fue")?.id, "nuevo");
  const [sin] = agrupar([item(2, "brote", "b")], CARPETAS, [lider("viejo", "atlas", 10)]);
  assert.equal(destinoDe(sin), null);
});

test("promptIniciar: una tarea lleva título, detalle, prueba, su id y su proyecto", () => {
  const [g] = agrupar([item(648, "Atlas Web", " Exportar a CSV ", { detalle: "Quedó a medias.\nFalta el encabezado.", prueba: "atlas --exportar ejemplo.csv" })], CARPETAS, []);
  const p = promptIniciar(g);
  assert.match(p, /^El usuario quiere que te ocupes de esta tarea de su tablero\.\n\n- Proyecto: Atlas Web\n- Tarea #648: Exportar a CSV\n/);
  assert.match(p, /\n- Detalle: Quedó a medias\.\n {4}Falta el encabezado\.\n/);
  assert.match(p, /\n- Cómo se prueba: atlas --exportar ejemplo\.csv\n/);
  assert.match(p, /`tablero ver 648`/);
  assert.match(p, /`tablero cerrar 648`/);
});

test("promptIniciar: sin detalle ni prueba no deja renglones vacíos de más", () => {
  const [g] = agrupar([item(7, "brote", "Regar")], CARPETAS, []);
  const p = promptIniciar(g);
  assert.doesNotMatch(p, /Detalle|Cómo se prueba/);
  assert.doesNotMatch(p, /\n\n\n/);
});

test("promptIniciar: varias del mismo proyecto van numeradas, cada una con su id y lo suyo", () => {
  const [g] = agrupar(
    [item(11, "brote", "Regar", { prueba: "Abrir Brote y tocar «Regar»" }), item(12, "brote", "Podar", { detalle: "Sólo los rosales." }), item(13, "brote", "Abonar")],
    CARPETAS,
    [],
  );
  const p = promptIniciar(g);
  assert.match(p, /^El usuario quiere que te ocupes de estas 3 tareas de su tablero\.\n\n- Proyecto: brote\n\n1\. #11: Regar\n {3}Cómo se prueba: Abrir Brote y tocar «Regar»\n2\. #12: Podar\n {3}Detalle: Sólo los rosales\.\n3\. #13: Abonar\n\n/);
  assert.match(p, /#11, #12, #13/);
});

test("promptIniciar: lo que trama no conoce lo dice, para que el líder ubique dónde va", () => {
  const [area, nada] = agrupar([item(1, "sistema", "Ordenar los discos"), item(2, "", "Llamar al gasista")], CARPETAS, []);
  assert.match(promptIniciar(area), /- Proyecto: sistema \(no es un proyecto del registry/);
  assert.match(promptIniciar(nada), /- Proyecto: ninguno anotado/);
});

// --- El modelo de cada proyecto ----------------------------------------------------

const idDe = (m: string | null | undefined) => (m?.includes("sonnet") ? "claude-sonnet-5-5" : m?.includes("opus") ? "claude-opus-5-5" : null);

test("modeloDeInicio: sin elegir, el líder sigue con su modelo y su esfuerzo; uno nuevo, el de siempre", () => {
  assert.deepEqual(modeloDeInicio("", { modelo: "claude-sonnet-5-5[1m]", effort: "medium" }, "claude-opus-5-5", idDe), { modelo: "claude-sonnet-5-5[1m]", effort: "medium" });
  assert.deepEqual(modeloDeInicio(null, null, "claude-opus-5-5", idDe), { modelo: "claude-opus-5-5", effort: null });
  assert.deepEqual(modeloDeInicio(undefined, { modelo: null, effort: null }, "claude-opus-5-5", idDe), { modelo: "claude-opus-5-5", effort: null });
});

test("modeloDeInicio: elegido, sale con ese; el esfuerzo del líder sólo se conserva si es el mismo modelo", () => {
  const l = { modelo: "claude-sonnet-5-5[1m]", effort: "medium" };
  assert.deepEqual(modeloDeInicio("claude-opus-5-5", l, "claude-opus-5-5", idDe), { modelo: "claude-opus-5-5", effort: null });
  assert.deepEqual(modeloDeInicio("claude-sonnet-5-5", l, "claude-opus-5-5", idDe), { modelo: "claude-sonnet-5-5", effort: "medium" });
  assert.deepEqual(modeloDeInicio("claude-haiku-5-5", null, "claude-opus-5-5", idDe), { modelo: "claude-haiku-5-5", effort: null });
});

test("cambiaElModelo: sólo si Ana eligió uno distinto del que tiene el líder", () => {
  const l = { modelo: "claude-sonnet-5-5[1m]" };
  assert.equal(cambiaElModelo(l, "", idDe), false);
  assert.equal(cambiaElModelo(l, "claude-sonnet-5-5", idDe), false);
  assert.equal(cambiaElModelo(l, "claude-opus-5-5", idDe), true);
  assert.equal(cambiaElModelo(null, "claude-opus-5-5", idDe), false);
});

test("agrupar: las tareas de otra máquina van en su propio grupo, con líderes de esa máquina, y el mensaje lleva el número de allá", () => {
  const delDell = (id: number, proyecto: string, titulo: string) => item(id as never, proyecto, titulo, { id: `dell:${id}`, maquina: "dell", maquinaNombre: "Dell" } as never);
  const liderDell: LiderDe = { id: "dell:s1", nombre: "del Dell", carpeta: "atlas", ocupado: false, actividad: 5, maquina: "dell" };
  const gs = agrupar([item(1, "atlas", "acá"), delDell(12, "atlas", "allá"), delDell(13, "atlas", "allá 2")], CARPETAS, [lider("s0", "atlas", 9), liderDell]);
  assert.deepEqual(
    gs.map((g) => [g.maquina ?? null, g.proyecto, g.carpeta, g.items.length, g.lideres.map((l) => l.id)]),
    [
      [null, "atlas", "atlas", 1, ["s0"]],
      ["dell", "atlas", null, 2, ["dell:s1"]],
    ],
  );
  const p = promptIniciar(gs[1]);
  assert.match(p, /1\. #12: allá/);
  assert.match(p, /2\. #13: allá 2/);
  assert.doesNotMatch(p, /dell:/);
  assert.match(promptIniciar({ ...gs[1], items: [gs[1].items[0]] }), /`tablero cerrar 12`/);
});
