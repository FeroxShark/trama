// "Recientes" y "A-Z" en la barra (src/barra/recientes.ts + armarArbol): los proyectos por lo último que se usó (líderes,
// workers y "De Claude Code"), los líderes de cada uno por su actividad, el A-Z, lo acomodado a mano que sigue ganando,
// la foto congelada que no se mueve con la actividad nueva y el modo que se guarda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarArbol, type Arbol } from "../src/barra/arbol.ts";
import { fotoRecientes, igualRecientes } from "../src/barra/recientes.ts";
import { modoOrden, ordenDe, ORDEN0 } from "../src/barra/orden.ts";
import { limpiarOrden } from "../electron/nombres.ts";
import { cambiarIdioma } from "../src/i18n/index.ts";
import { pintorHace } from "../src/tiempo.ts";
import type { ConvClaudeCode, Hilo, Lider, Orden } from "../src/datos/contrato.ts";

const AHORA = 2_000_000_000;
const MIN = 60;
const DIA = 86400;

const L = (id: string, proyecto: string, hace: number, p: Partial<Lider> = {}): Lider => ({
  id,
  nombre: `ana-${id}`,
  proyecto,
  titulo: "Opus 5.5",
  actividad: AHORA - hace,
  creado: AHORA - 9 * DIA + id.charCodeAt(0),
  cache_ttl_s: 3600,
  cache_vence: AHORA - MIN,
  origen: "app",
  pid: 1,
  vivo: true,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: null,
  inferido: proyecto,
  ...p,
});

const worker = (jefe: string, proyecto: string, hace: number): Hilo =>
  ({
    id: `20261003-100000-${jefe}${proyecto}`,
    proyecto,
    tarea: "Tarea inventada",
    estado: "listo",
    modelo: "claude-opus-5-5",
    effort: "medium",
    origen: "jefe",
    jefe: `ana-${jefe}`,
    jefe_id: jefe,
    sigue_de: null,
    en_cola: false,
    inicio: AHORA - hace - 60,
    duracion_s: 60,
    puesto: "1",
    rama: null,
    commits: 0,
    decision: null,
    decision_nada: null,
    resultado: null,
    archivado: null,
    leer: false,
    cache_ttl_s: null,
    cache_vence: null,
    cache_frio: null,
    cache_modelo: null,
  }) as Hilo;

const conv = (sid: string, proyecto: string | null, hace: number): ConvClaudeCode =>
  ({ sid, titulo: "Conversación inventada", cwd: `/tmp/${proyecto ?? "otra"}`, proyecto, ms: (AHORA - hace) * 1000, existe: true, ajena: false, modelo: null }) as ConvClaudeCode;

const arbol = (lideres: Lider[], o: { hilos?: Hilo[]; orden?: Orden; convs?: ConvClaudeCode[]; foto?: boolean } = {}): Arbol => {
  const hilos = o.hilos ?? [];
  const recientes = o.foto === false ? undefined : fotoRecientes(lideres, hilos, o.convs ?? []);
  return armarArbol(hilos, { lideres, ahora: AHORA, orden: o.orden, recientes });
};
const proyectos = (a: Arbol) => a.carpetas.map((c) => c.proyecto);
const lideresDe = (a: Arbol, p: string) => {
  const c = a.carpetas.find((x) => x.proyecto === p)!;
  return [...c.ramas, ...c.espera, ...c.dormidos].filter((r) => r.tipo === "lider").map((r) => r.lider!.id);
};

test("Recientes (de fábrica): el proyecto que más se usó arriba, el home primero", () => {
  const ls = [L("a", "atlas", 5 * 3600), L("b", "brote", 20 * MIN), L("c", "cauce", 3 * DIA), L("g", "general", 9 * DIA)];
  assert.deepEqual(proyectos(arbol(ls)), ["general", "brote", "atlas", "cauce"]);
  assert.equal(modoOrden(undefined), "recientes");
  assert.equal(modoOrden(ORDEN0), "recientes");
});

test("Recientes: dentro de un proyecto, el líder más reciente arriba; a igual, el de siempre", () => {
  const ls = [L("a", "atlas", 25 * MIN), L("b", "atlas", 10 * MIN), L("c", "atlas", 20 * MIN), L("d", "atlas", 20 * MIN)];
  assert.deepEqual(lideresDe(arbol(ls), "atlas"), ["b", "c", "d", "a"]);
  // Los ociosos (más de 30 min) siguen plegados en "en espera", también del más reciente al más viejo.
  const viejos = [L("a", "atlas", 3 * DIA), L("b", "atlas", 2 * 3600), L("c", "atlas", 5 * MIN)];
  const a = arbol(viejos);
  assert.deepEqual(a.carpetas[0].ramas.map((r) => r.lider?.id), ["c"]);
  assert.deepEqual(a.carpetas[0].espera.map((r) => r.lider?.id), ["b", "a"]);
});

test("Recientes: la actividad de un worker y de las 'De Claude Code' sube a su proyecto", () => {
  const ls = [L("a", "atlas", 3 * 3600), L("b", "brote", 2 * 3600), L("c", "cauce", 5 * DIA)];
  // Un worker de c terminó hace 5 min: cauce pasa a primero y c a ser el reciente de su carpeta.
  const conWorker = arbol(ls, { hilos: [worker("c", "cauce", 5 * MIN)] });
  assert.deepEqual(proyectos(conWorker), ["cauce", "brote", "atlas"]);
  // Una conversación de Claude Code de atlas, de hace 1 min (sin líder en la barra), también.
  const conCC = arbol(ls, { convs: [conv("zz", "atlas", MIN)] });
  assert.deepEqual(proyectos(conCC), ["atlas", "brote", "cauce"]);
});

test("A-Z: proyectos y líderes por nombre, sin mayúsculas ni tildes", () => {
  const ls = [L("a", "zeta", 10 * MIN, { nombre: "Árbol" }), L("b", "zeta", 5 * MIN, { nombre: "zorro" }), L("c", "zeta", 20 * MIN, { nombre: "Abeja" }), L("d", "alfa", 9 * DIA)];
  const a = arbol(ls, { orden: { ...ORDEN0, modo: "az" } });
  assert.deepEqual(proyectos(a), ["alfa", "zeta"]);
  assert.deepEqual(lideresDe(a, "zeta"), ["c", "a", "b"]);
});

test("lo acomodado a mano gana sobre el modo en lo que está listado", () => {
  const ls = [L("a", "atlas", 5 * 3600), L("b", "brote", 20 * MIN), L("c", "cauce", 3 * DIA)];
  const manual: Orden = { carpetas: ["cauce"], lideres: {} };
  assert.deepEqual(proyectos(arbol(ls, { orden: manual })), ["cauce", "brote", "atlas"]);
});

test("la foto congelada no se mueve con la actividad nueva; los líderes que no están en ella entran por su actividad", () => {
  const ls = [L("a", "atlas", 2 * MIN), L("b", "atlas", 3 * MIN)];
  const antes = fotoRecientes(ls, [], []);
  // b escribe ahora, pero se mira la lista: la foto sigue siendo la de antes.
  const movido = [ls[0], { ...ls[1], actividad: AHORA - 1 }];
  const congelada = armarArbol([], { lideres: movido, ahora: AHORA, recientes: antes });
  assert.deepEqual(lideresDe(congelada, "atlas"), ["a", "b"]);
  // Al soltarla se pone al día.
  assert.deepEqual(lideresDe(arbol(movido), "atlas"), ["b", "a"]);
  // Uno nuevo, que la foto no conoce, entra con su actividad (arriba, que es lo último que se usó).
  const nuevo = [...movido, L("n", "atlas", 1)];
  assert.deepEqual(lideresDe(armarArbol([], { lideres: nuevo, ahora: AHORA, recientes: antes }), "atlas")[0], "n");
});

test("sin foto de actividad rige el orden fijo de siempre (por creación)", () => {
  const ls = [L("b", "atlas", 5 * MIN), L("a", "atlas", 20 * MIN)];
  assert.deepEqual(lideresDe(arbol(ls, { foto: false }), "atlas"), ["a", "b"]);
});

test("fotoRecientes: lo más reciente de cada líder y de cada carpeta; igualRecientes compara por contenido", () => {
  const ls = [L("a", "atlas", 3600)];
  const f = fotoRecientes(ls, [worker("a", "atlas", 60)], [conv("x", null, 30)]);
  assert.equal(f.lideres.get("a"), AHORA - 60);
  assert.equal(f.carpetas.get("atlas"), AHORA - 60);
  assert.equal(f.carpetas.get("\u0001otras"), AHORA - 30);
  assert.ok(igualRecientes(f, fotoRecientes(ls, [worker("a", "atlas", 60)], [conv("x", null, 30)])));
  assert.ok(!igualRecientes(f, fotoRecientes(ls, [], [])));
});

test("el modo se guarda: lo desconocido se descarta", () => {
  assert.equal(ordenDe({ carpetas: [], lideres: {}, modo: "az" }).modo, "az");
  assert.equal(limpiarOrden({ modo: "az" }).modo, "az");
  assert.equal(limpiarOrden({ modo: "recientes" }).modo, "recientes");
  assert.equal("modo" in limpiarOrden({ modo: "raro" }), false);
  assert.equal("modo" in ordenDe(null), false);
});

test("la fecha de la fila: relativa hasta una semana, después '27 oct'", () => {
  cambiarIdioma("es");
  const fila = (hace: number) => pintorHace(AHORA - hace)(AHORA).texto;
  assert.equal(fila(5 * MIN), "hace 5 m");
  assert.equal(fila(30 * 3600), "ayer");
  assert.equal(fila(3 * DIA), "hace 3 d");
  assert.match(fila(20 * DIA), /^\d{1,2} [a-zñ]{3,4}$/);
  cambiarIdioma("en");
});
