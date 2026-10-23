// El orden que Ana le da a la barra arrastrando: gana sobre el de siempre, lo nuevo entra
// al final, lo que se fue no deja basura y lo guardado en nombres.json vuelve igual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { armarArbol, compararCarpetas, lideresEnOrden, type Arbol } from "../src/barra/arbol.ts";
import { hayOrdenManual, moverJunto, ORDEN0, ordenDe, podar, porManual, prioridadPrendida, reordenar, reordenarPaso } from "../src/barra/orden.ts";
import { almacenNombres } from "../electron/nombres.ts";
import type { Lider, Orden } from "../src/datos/contrato.ts";

const AHORA = 2_000_000_000;
const MIN = 60;
const H = 3600;

const lider = (id: string, creado: number, actividad = AHORA - MIN, ocupado = false): Lider => ({
  id,
  nombre: `ana-${id}`,
  proyecto: "lo-que-diga-el-cwd",
  titulo: "Opus 5.5",
  actividad,
  creado,
  cache_ttl_s: 3600,
  cache_vence: AHORA + 30 * MIN,
  origen: "app",
  pid: 4242,
  vivo: true,
  ocupado,
});

/** Dos líderes en general, tres en atlas, uno en brote y uno en zeta; cada uno con su fecha de creación. */
const LIDERES = (): Lider[] => [
  lider("g1", AHORA - 9 * H),
  lider("g2", AHORA - 8 * H),
  lider("a1", AHORA - 7 * H),
  lider("a2", AHORA - 6 * H),
  lider("a3", AHORA - 5 * H),
  lider("b1", AHORA - 4 * H),
  lider("z1", AHORA - 3 * H),
];
const mover = new Map([
  ["a1", "atlas"],
  ["a2", "atlas"],
  ["a3", "atlas"],
  ["b1", "brote"],
  ["z1", "zeta"],
  ["a4", "atlas"],
]);
/** La barra como una lista: cada carpeta con sus líderes (los de la vista y los plegados en espera), en orden. */
const lugares = (a: Arbol) => a.carpetas.map((c) => [c.proyecto, ...[...c.ramas, ...c.espera].flatMap((r) => (r.lider ? [r.lider.id] : []))].join(" "));
const ver = (orden: Orden | undefined, lideres = LIDERES(), ahora = AHORA) => lugares(armarArbol([], { lideres, mover, orden, ahora }));

const DEFECTO = ["general g1 g2", "atlas a1 a2 a3", "brote b1", "zeta z1"];

test("orden: sin nada movido a mano es el de siempre (por creación; carpetas por nombre, general primera)", () => {
  assert.deepEqual(ver(undefined), DEFECTO);
  assert.deepEqual(ver(ORDEN0), DEFECTO);
  assert.deepEqual(ver({ carpetas: [], lideres: { atlas: [] } }), DEFECTO);
});

test("orden: lo que se movió a mano gana sobre el orden por defecto", () => {
  // Líderes dentro de su carpeta: el más nuevo arriba porque Ana lo puso ahí.
  assert.deepEqual(ver({ carpetas: [], lideres: { atlas: ["a3", "a1", "a2"] } }), ["general g1 g2", "atlas a3 a1 a2", "brote b1", "zeta z1"]);
  assert.deepEqual(ver({ carpetas: [], lideres: { general: ["g2", "g1"] } })[0], "general g2 g1");
  // Carpetas entre sí; la del home sigue primera aunque esté en la lista en otro lugar.
  assert.deepEqual(ver({ carpetas: ["zeta", "atlas", "brote"], lideres: {} }), ["general g1 g2", "zeta z1", "atlas a1 a2 a3", "brote b1"]);
  assert.deepEqual(ver({ carpetas: ["zeta", "general", "atlas"], lideres: {} }), ["general g1 g2", "zeta z1", "atlas a1 a2 a3", "brote b1"]);
  // Las dos cosas a la vez.
  assert.deepEqual(ver({ carpetas: ["brote"], lideres: { atlas: ["a2"] } }), ["general g1 g2", "brote b1", "atlas a2 a1 a3", "zeta z1"]);
});

test("orden: lo que nunca se movió va después de lo movido, con el orden de siempre", () => {
  // Sólo a2 está en la lista: va primero; a1 y a3, después, por creación.
  assert.deepEqual(ver({ carpetas: [], lideres: { atlas: ["a2"] } })[1], "atlas a2 a1 a3");
  // Sólo zeta está en la lista: va primera (tras general); atlas y brote, después, por nombre.
  assert.deepEqual(ver({ carpetas: ["zeta"], lideres: {} }), ["general g1 g2", "zeta z1", "atlas a1 a2 a3", "brote b1"]);
});

test("orden: una sesión nueva entra al final de su carpeta", () => {
  const orden: Orden = { carpetas: [], lideres: { atlas: ["a3", "a1", "a2"] } };
  const nuevo = lider("a4", AHORA - 10);
  assert.deepEqual(ver(orden, [...LIDERES(), nuevo])[1], "atlas a3 a1 a2 a4");
  // También si llega primero en los datos, o si es más vieja que las que ya estaban: lo movido a mano no se corre.
  assert.deepEqual(ver(orden, [nuevo, ...LIDERES()])[1], "atlas a3 a1 a2 a4");
  assert.deepEqual(ver(orden, [...LIDERES(), lider("a4", AHORA - 30 * H)])[1], "atlas a3 a1 a2 a4");
  // Sin orden a mano, lo mismo de siempre: la nueva al final.
  assert.deepEqual(ver(undefined, [nuevo, ...LIDERES()])[1], "atlas a1 a2 a3 a4");
  // Una carpeta nueva entra después de las acomodadas.
  const m = new Map([...mover, ["n1", "nueva"]]);
  const a = armarArbol([], { lideres: [...LIDERES(), lider("n1", AHORA - 10)], mover: m, orden: { carpetas: ["zeta", "brote", "atlas"], lideres: {} }, ahora: AHORA });
  assert.deepEqual(a.carpetas.map((c) => c.proyecto), ["general", "zeta", "brote", "atlas", "nueva"]);
});

test("orden: el orden a mano tampoco cambia solo (ni por actividad, ni por responder, ni por cómo llegan los datos)", () => {
  const orden: Orden = { carpetas: ["zeta", "atlas"], lideres: { atlas: ["a3", "a1", "a2"] } };
  const base = ver(orden);
  assert.deepEqual(base, ["general g1 g2", "zeta z1", "atlas a3 a1 a2", "brote b1"]);
  const con = (f: (l: Lider) => Lider) => ver(orden, LIDERES().map(f));
  assert.deepEqual(con((l) => (l.id === "a2" ? { ...l, actividad: AHORA, ocupado: true } : l)), base);
  assert.deepEqual(con((l) => (l.id === "b1" ? { ...l, actividad: AHORA, ocupado: true } : l)), base);
  assert.deepEqual(ver(orden, LIDERES().reverse()), base);
  // Pasa el tiempo: los ociosos se pliegan en espera sin cambiar de orden entre ellos.
  assert.deepEqual(ver(orden, LIDERES(), AHORA + 3 * H), base);
});

test("orden: una sesión que desaparece no deja basura", () => {
  const orden: Orden = { carpetas: ["zeta", "vieja", "atlas"], lideres: { atlas: ["a3", "ido", "a1"], brote: ["ido2"], zeta: ["z1"] } };
  const existe = { lideres: new Set(LIDERES().map((l) => l.id)), carpetas: new Set(["atlas", "brote", "zeta"]) };
  assert.deepEqual(podar(orden, existe), { carpetas: ["zeta", "atlas"], lideres: { atlas: ["a3", "a1"], zeta: ["z1"] } });
  // Con la sesión todavía en la lista guardada, la barra igual se ve bien: lo que no está no ocupa lugar.
  assert.deepEqual(ver(orden), ["general g1 g2", "zeta z1", "atlas a3 a1 a2", "brote b1"]);
  // Nada que sacar: el mismo objeto (no se reescribe ni se rearma el árbol).
  const limpio = podar(orden, existe);
  assert.equal(podar(limpio, existe), limpio);
  // Sin saber todavía qué existe (los líderes o el registry sin leer) no se toca nada.
  assert.equal(podar(orden, { lideres: null, carpetas: null }), orden);
  assert.deepEqual(podar(orden, { lideres: null, carpetas: existe.carpetas }).lideres, orden.lideres);
  assert.deepEqual(podar(orden, { lideres: existe.lideres, carpetas: null }).carpetas, orden.carpetas);
});

test("orden: soltar un líder o una carpeta al lado de otro arma la lista entera de ese grupo", () => {
  const arbol = armarArbol([], { lideres: LIDERES(), mover, ahora: AHORA });
  const atlas = arbol.carpetas.find((c) => c.proyecto === "atlas")!;
  assert.deepEqual(lideresEnOrden(atlas, ORDEN0), ["a1", "a2", "a3"]);
  // a3 arriba de a1.
  const uno = reordenar(ORDEN0, "atlas", lideresEnOrden(atlas, ORDEN0), "a3", "a1", true)!;
  assert.deepEqual(uno, { carpetas: [], lideres: { atlas: ["a3", "a1", "a2"] } });
  assert.deepEqual(ver(uno), ["general g1 g2", "atlas a3 a1 a2", "brote b1", "zeta z1"]);
  // Sobre lo ya movido: a3 al final.
  const atlas2 = armarArbol([], { lideres: LIDERES(), mover, orden: uno, ahora: AHORA }).carpetas.find((c) => c.proyecto === "atlas")!;
  const dos = reordenar(uno, "atlas", lideresEnOrden(atlas2, uno), "a3", "a2", false)!;
  assert.deepEqual(dos.lideres.atlas, ["a1", "a2", "a3"]);
  // Las carpetas (general no entra: no se mueve): zeta antes de atlas.
  const visibles = arbol.carpetas.map((c) => c.proyecto).filter((p) => p !== "general").sort(compararCarpetas(dos));
  const tres = reordenar(dos, null, visibles, "zeta", "atlas", true)!;
  assert.deepEqual(tres.carpetas, ["zeta", "atlas", "brote"]);
  assert.deepEqual(ver(tres), ["general g1 g2", "zeta z1", "atlas a1 a2 a3", "brote b1"]);
  // Lo guardado que hoy no se ve (un líder archivado) conserva su lugar.
  const con = reordenar({ carpetas: [], lideres: { atlas: ["a2", "oculto", "a1"] } }, "atlas", ["a2", "a1", "a3"], "a3", "a2", true)!;
  assert.deepEqual(con.lideres.atlas, ["a3", "a2", "oculto", "a1"]);
  // Soltar donde ya estaba no cambia nada.
  assert.equal(reordenar(uno, "atlas", ["a3", "a1", "a2"], "a1", "a3", false), null);
  assert.equal(reordenar(uno, "atlas", ["a3", "a1", "a2"], "a1", "a2", true), null);
  assert.equal(reordenar(uno, "atlas", ["a3", "a1", "a2"], "a1", "a1", true), null);
  assert.equal(reordenar(uno, "atlas", ["a3", "a1", "a2"], "a1", "no-esta", true), null);
});

test("orden: moverJunto y porManual", () => {
  assert.deepEqual(moverJunto(["a", "b", "c", "d"], "d", "a", true), ["d", "a", "b", "c"]);
  assert.deepEqual(moverJunto(["a", "b", "c", "d"], "a", "c", false), ["b", "c", "a", "d"]);
  assert.deepEqual(moverJunto(["a", "b", "c", "d"], "a", "d", false), ["b", "c", "d", "a"]);
  assert.equal(moverJunto(["a", "b"], "a", "b", true), null);
  const alfa = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  assert.deepEqual(["d", "c", "b", "a"].sort(porManual(["c", "x", "a"], (s) => s, alfa)), ["c", "a", "b", "d"]);
  assert.deepEqual(["d", "c", "b", "a"].sort(porManual(undefined, (s) => s, alfa)), ["a", "b", "c", "d"]);
});

test("orden: el orden persistido se relee igual en un arranque nuevo, y la barra sale con él", async () => {
  const f = path.join(mkdtempSync(path.join(os.tmpdir(), "hilos-orden-")), "nombres.json");
  const a = almacenNombres(f, writeFile);
  assert.deepEqual((await a.leer()).orden, { carpetas: [], lideres: {} });
  const orden: Orden = { carpetas: ["zeta", "atlas", "brote"], lideres: { atlas: ["a3", "a1", "a2"] } };
  await a.titulo("a1", "Un título");
  const guardado = await a.orden(orden);
  assert.deepEqual(guardado.orden, orden);
  // Otro arranque: otro almacén sobre el mismo archivo.
  const b = await almacenNombres(f, writeFile).leer();
  assert.deepEqual(b.orden, orden);
  assert.deepEqual(b.titulos, { a1: "Un título" });
  assert.equal(JSON.parse(readFileSync(f, "utf8")).version, 1);
  assert.deepEqual(ver(ordenDe(b.orden)), ["general g1 g2", "zeta z1", "atlas a3 a1 a2", "brote b1"]);
  // Lo demás que se guarda después no lo pisa.
  const c = almacenNombres(f, writeFile);
  await c.oculto("atlas", true);
  assert.deepEqual((await almacenNombres(f, writeFile).leer()).orden, orden);
});

test("orden: lo raro no se guarda; un nombres.json de antes (sin orden) se lee vacío", async () => {
  const f = path.join(mkdtempSync(path.join(os.tmpdir(), "hilos-orden-")), "nombres.json");
  writeFileSync(f, JSON.stringify({ version: 1, titulos: { x: "y" }, proyectos: {}, ocultos: [] }));
  const a = almacenNombres(f, writeFile);
  assert.deepEqual(await a.leer(), { titulos: { x: "y" }, proyectos: {}, ocultos: [], orden: { carpetas: [], lideres: {} } });
  await a.orden({ carpetas: ["atlas", 3, "", "atlas", null, "brote"], lideres: { atlas: ["a1", "a1", 7], brote: "no", zeta: [], general: ["g2"] }, otra: 1 });
  const b = await almacenNombres(f, writeFile).leer();
  assert.deepEqual(b.orden, { carpetas: ["atlas", "brote"], lideres: { atlas: ["a1"], general: ["g2"] } });
  await a.orden("basura");
  assert.deepEqual((await almacenNombres(f, writeFile).leer()).orden, { carpetas: [], lideres: {} });
  assert.deepEqual(ordenDe(null), { carpetas: [], lideres: {} });
  assert.deepEqual(ordenDe({ carpetas: ["a", 1, "a"], lideres: { p: ["x", "x"], q: 3 } }), { carpetas: ["a"], lideres: { p: ["x"] } });
});

test("orden: Subir y Bajar mueven un lugar; en el primero subir y en el último bajar no hacen nada", () => {
  const lis = ["a1", "a2", "a3"];
  assert.deepEqual(reordenarPaso(ORDEN0, "atlas", lis, "a2", -1)?.lideres.atlas, ["a2", "a1", "a3"]);
  assert.deepEqual(reordenarPaso(ORDEN0, "atlas", lis, "a2", 1)?.lideres.atlas, ["a1", "a3", "a2"]);
  assert.equal(reordenarPaso(ORDEN0, "atlas", lis, "a1", -1), null);
  assert.equal(reordenarPaso(ORDEN0, "atlas", lis, "a3", 1), null);
  assert.equal(reordenarPaso(ORDEN0, "atlas", lis, "nadie", 1), null);
  // Las carpetas: la lista entera queda guardada y el resto del orden no se toca.
  const base: Orden = { carpetas: [], lideres: { atlas: ["a2", "a1"] } };
  const c = reordenarPaso(base, null, ["atlas", "brote", "zeta"], "zeta", -1)!;
  assert.deepEqual(c.carpetas, ["atlas", "zeta", "brote"]);
  assert.deepEqual(c.lideres, base.lideres);
  // Subir uno por uno llega a lo mismo que soltarlo arriba de todo.
  const dos = reordenarPaso(reordenarPaso(ORDEN0, "atlas", lis, "a3", -1)!, "atlas", ["a1", "a3", "a2"], "a3", -1)!;
  assert.deepEqual(dos, reordenar(ORDEN0, "atlas", lis, "a3", "a1", true));
});

test("orden: Subir salta lo plegado en espera: el vecino es el que se ve junto a la fila", () => {
  // a2 está plegado en "en espera": a3 sube por encima de a1 (su vecino a la vista), y a2 no cambia de lugar entre ellos.
  const lis = ["a1", "a2", "a3"];
  const o = reordenarPaso(ORDEN0, "atlas", lis, "a3", -1, ["a1", "a3"])!;
  assert.deepEqual(o.lideres.atlas, ["a3", "a1", "a2"]);
  const b = reordenarPaso(ORDEN0, "atlas", lis, "a1", 1, ["a1", "a3"])!;
  assert.deepEqual(b.lideres.atlas, ["a2", "a3", "a1"]);
  assert.equal(reordenarPaso(ORDEN0, "atlas", lis, "a1", -1, ["a1", "a3"]), null);
});

test("orden: el orden por defecto limpia lo puesto a mano y la barra vuelve a la de siempre", () => {
  assert.equal(hayOrdenManual(undefined), false);
  assert.equal(hayOrdenManual(ORDEN0), false);
  assert.equal(hayOrdenManual({ carpetas: [], lideres: { atlas: [] } }), false);
  const mano: Orden = { carpetas: ["zeta", "atlas"], lideres: { atlas: ["a3", "a1", "a2"] } };
  assert.equal(hayOrdenManual(mano), true);
  assert.notDeepEqual(ver(mano), DEFECTO);
  // "Orden por defecto" guarda ORDEN0 (lo que el main limpia a vacío) y la barra es la de siempre.
  assert.equal(hayOrdenManual(ordenDe(ORDEN0)), false);
  assert.deepEqual(ver(ORDEN0), DEFECTO);
});

test("orden por prioridad: prendido de fábrica; el interruptor sobrevive a guardar, leer y podar; sólo un booleano cuenta", () => {
  // Sin nada guardado (o un nombres.json de antes) está prendido; sólo `false` (Orden fijo) lo apaga.
  assert.equal(prioridadPrendida(undefined), true);
  assert.equal(prioridadPrendida(ORDEN0), true);
  assert.equal(prioridadPrendida({ carpetas: [], lideres: {}, prioridad: true }), true);
  assert.equal(prioridadPrendida({ carpetas: [], lideres: {}, prioridad: false }), false);
  assert.deepEqual(ordenDe({ carpetas: [], lideres: {} }), { carpetas: [], lideres: {} });
  assert.deepEqual(ordenDe({ carpetas: [], lideres: {}, prioridad: true }), { carpetas: [], lideres: {}, prioridad: true });
  assert.deepEqual(ordenDe({ carpetas: [], lideres: {}, prioridad: false }), { carpetas: [], lideres: {}, prioridad: false });
  assert.deepEqual(ordenDe({ carpetas: [], lideres: {}, prioridad: "si" }), { carpetas: [], lideres: {} });
  const apagado = { carpetas: ["a", "b"], lideres: {}, prioridad: false };
  assert.equal(podar(apagado, { lideres: null, carpetas: new Set(["a"]) }).prioridad, false);
  assert.equal(reordenar(apagado, null, ["a", "b"], "a", "b", false)?.prioridad, false);
});
