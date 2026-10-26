// "Activas" y los proyectos que flotan en la barra (src/barra/activas.ts + armarArbol): qué es estar caliente y en qué
// prioridad, que lo caliente no se repite en su proyecto, que al enfriarse vuelve a su lugar del orden a mano, qué
// proyectos suben, que el teclado recorre las filas como se ven y cuándo hay que diferir el reacomodo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVAS, armarArbol, aVistaTodo, filasVisibles, lugarLider, type Arbol } from "../src/barra/arbol.ts";
import { calorLider, compararActivas, diferir, flotar, fotoCalor, igualFoto, proximoVencimiento, repartir, workerVivo, type Trabajador } from "../src/barra/activas.ts";
import type { Hilo, Lider, Orden } from "../src/datos/contrato.ts";

const AHORA = 2_000_000_000;
const MIN = 60;
const H = 3600;

const L = (id: string, proyecto: string, p: Partial<Lider> = {}): Lider => ({
  id,
  nombre: `ana-${id}`,
  proyecto,
  titulo: "Opus 5.5",
  actividad: AHORA - 20 * MIN,
  creado: AHORA - 9 * H + id.charCodeAt(0),
  cache_ttl_s: 3600,
  cache_vence: AHORA - MIN, // frío: "Uncached"
  origen: "app",
  pid: 1,
  vivo: true,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: null,
  inferido: proyecto === "general" ? null : proyecto,
  ...p,
});
const caliente = { cache_vence: AHORA + 30 * MIN };

let n = 0;
const worker = (jefe: string, proyecto: string, p: Partial<Hilo> = {}): Hilo =>
  ({
    id: `20261003-100000-${20000 + n++}`,
    proyecto,
    tarea: "Tarea inventada",
    estado: "trabajando",
    modelo: "claude-opus-5-5",
    effort: "medium",
    origen: "jefe",
    jefe: `ana-${jefe}`,
    jefe_id: jefe,
    sigue_de: null,
    en_cola: false,
    inicio: AHORA - 5 * MIN,
    duracion_s: null,
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
    ...p,
  }) as Hilo;

const trab = (hilos: Hilo[]): Trabajador[] => hilos.map((h) => ({ jefe_id: h.jefe_id ?? null, proyecto: h.proyecto, vivo: workerVivo(h) }));
const foto = (lideres: Lider[], hilos: Hilo[] = []) => fotoCalor(lideres, trab(hilos), AHORA);
const arbol = (lideres: Lider[], o: { hilos?: Hilo[]; orden?: Orden; busqueda?: string; sinFoto?: boolean } = {}): Arbol => {
  const hilos = o.hilos ?? [];
  return armarArbol(hilos, { lideres, ahora: AHORA, orden: o.orden, busqueda: o.busqueda, prioridad: o.sinFoto ? undefined : foto(lideres, hilos) });
};
const enActivas = (a: Arbol) => a.activas.map((r) => r.lider!.id);
const proyectos = (a: Arbol) => a.carpetas.map((c) => c.proyecto);
const lideresDe = (a: Arbol, p: string) => {
  const c = a.carpetas.find((x) => x.proyecto === p)!;
  return [...c.ramas, ...c.espera, ...c.dormidos].filter((r) => r.tipo === "lider").map((r) => r.lider!.id);
};

test("calor: te necesita > responde > workers vivos > caché caliente; lo demás y lo sin proceso, frío", () => {
  const sin = { espera: undefined, pide: undefined, ocupado: false, cache_vence: AHORA - 1, caido: undefined, subagentes: 0 };
  assert.equal(calorLider({ ...sin, espera: { motivo: "listo", desde: 1 }, ocupado: true, cache_vence: AHORA + 99 }, 3, AHORA), 0, "espera gana a todo");
  assert.equal(calorLider({ ...sin, pide: true }, 0, AHORA), 0);
  assert.equal(calorLider({ ...sin, ocupado: true, cache_vence: AHORA + 99 }, 2, AHORA), 1);
  assert.equal(calorLider(sin, 1, AHORA), 2, "con un worker vivo, aunque el caché esté vencido");
  assert.equal(calorLider({ ...sin, subagentes: 2 }, 0, AHORA), 2, "subagentes corriendo");
  assert.equal(calorLider({ ...sin, cache_vence: AHORA + 1 }, 0, AHORA), 3);
  assert.equal(calorLider(sin, 0, AHORA), null, "Uncached");
  assert.equal(calorLider({ ...sin, cache_vence: null }, 0, AHORA), null, "sin dato de caché no se asume");
  assert.equal(calorLider({ ...sin, caido: "murio", pide: true, ocupado: true, cache_vence: AHORA + 99 }, 4, AHORA), null, "sin proceso nunca está activo");
});

test("fotoCalor: cuenta los workers vivos de cada líder y marca los proyectos con workers sin líder caliente", () => {
  const lideres = [L("a", "atlas"), L("b", "brote", caliente), L("c", "cauce")];
  const hilos = [
    worker("a", "atlas"), // a: frío pero con un worker en marcha -> calor 2
    worker("a", "atlas", { en_cola: true, estado: "trabajando" }),
    worker("c", "cauce", { estado: "listo" }), // terminado: no cuenta
    worker("viejo", "delta"), // huérfano que trabaja: su proyecto flota
    worker("b", "brote"), // de un líder caliente: no suma proyecto aparte
  ];
  const f = foto(lideres, hilos);
  assert.deepEqual(
    [...f.lideres].map(([id, r]) => [id, r.c]),
    [
      ["a", 2],
      ["b", 2],
    ],
  );
  assert.deepEqual([...f.carpetas], ["delta"]);
  assert.ok(igualFoto(f, foto(lideres, hilos)));
  assert.ok(!igualFoto(f, foto(lideres, hilos.slice(2))));
  assert.equal(proximoVencimiento(lideres, AHORA), AHORA + 30 * MIN);
  assert.equal(proximoVencimiento([L("x", "atlas", { caido: "cerro", ...caliente })], AHORA), null);
});

test("Activas: por calor, después la actividad más reciente; sin repetirse en su proyecto", () => {
  const lideres = [
    L("w", "atlas", { actividad: AHORA - 1 * MIN, ...caliente }), // caché caliente (3), el más reciente
    L("x", "brote", { actividad: AHORA - 9 * MIN, ...caliente }), // caché caliente (3)
    L("y", "cauce", { ocupado: true, actividad: AHORA - 40 * MIN }), // responde (1)
    L("z", "atlas", { pide: true, actividad: AHORA - 50 * MIN }), // te necesita (0)
    L("v", "brote", { actividad: AHORA - 2 * MIN }), // frío
    L("u", "cauce", {}), // frío con un worker vivo (2)
  ];
  const a = arbol(lideres, { hilos: [worker("u", "cauce")] });
  assert.deepEqual(enActivas(a), ["z", "y", "u", "w", "x"]);
  // Cada líder está en un solo lugar.
  const todos = [...enActivas(a), ...a.carpetas.flatMap((c) => lideresDe(a, c.proyecto))].sort();
  assert.deepEqual(todos, ["u", "v", "w", "x", "y", "z"]);
  assert.deepEqual(lideresDe(a, "brote"), ["v"]);
  // Cada rama de Activas sabe de qué proyecto es y lleva a sus workers.
  assert.equal(a.activas.find((r) => r.lider!.id === "u")!.lider!.proyecto, "cauce");
  assert.equal(a.activas.find((r) => r.lider!.id === "u")!.vivas.length, 1);
  assert.equal(a.lideres.size, 6, "el mapa de líderes sigue teniéndolos a todos");
});

test("el mismo calor se ordena por actividad y, a igual, por id: estable", () => {
  const f = foto([L("p", "atlas", { ...caliente, actividad: 5 }), L("q", "atlas", { ...caliente, actividad: 9 }), L("r", "atlas", { ...caliente, actividad: 9 })]);
  const orden = [{ id: "p" }, { id: "r" }, { id: "q" }].sort(compararActivas(f));
  assert.deepEqual(orden.map((x) => x.id), ["q", "r", "p"]);
  assert.deepEqual(repartir([{ id: "p" }, { id: "fria" }, { id: "q" }], f).frias, [{ id: "fria" }]);
  assert.deepEqual(repartir([{ id: "p" }, { id: "fria" }], undefined), { activas: [], frias: [{ id: "p" }, { id: "fria" }] });
});

test("al enfriarse vuelve a su lugar del orden a mano, también en el medio; lo que nunca se movió, por creación", () => {
  const orden: Orden = { carpetas: [], lideres: { atlas: ["c", "a", "b"] } };
  const [a, b, c, d] = [L("a", "atlas"), L("b", "atlas"), L("c", "atlas"), L("d", "atlas")];
  const frio = [a, b, c, d];
  assert.deepEqual(lideresDe(arbol(frio, { orden }), "atlas"), ["c", "a", "b", "d"]);
  // `a` se calienta: sale de la carpeta, que conserva el orden de los demás.
  const tibio = [{ ...a, ...caliente }, b, c, d];
  const t = arbol(tibio, { orden });
  assert.deepEqual(enActivas(t), ["a"]);
  assert.deepEqual(lideresDe(t, "atlas"), ["c", "b", "d"]);
  // Los arrastres de ahora cuentan a `a` aunque no se vea: ocupa su lugar en la lista que se reordena.
  assert.deepEqual(t.carpetas.find((x) => x.proyecto === "atlas")!.calientes!.map((l) => l.id), ["a"]);
  // `a` se enfría: vuelve entre `c` y `b`, donde el usuario la había dejado.
  assert.deepEqual(lideresDe(arbol(frio, { orden }), "atlas"), ["c", "a", "b", "d"]);
  // Sin orden a mano: por creación (el id decide acá), como siempre.
  assert.deepEqual(lideresDe(arbol(frio), "atlas"), ["a", "b", "c", "d"]);
  // Un caliente no reordena a los fríos entre sí ni cuando es el de abajo ni cuando es el de arriba.
  assert.deepEqual(lideresDe(arbol([a, b, { ...c, pide: true }, d], { orden }), "atlas"), ["a", "b", "d"]);
});

test("un proyecto con algo caliente flota; entre sí y entre los fríos, el orden del usuario; el home primero", () => {
  const orden: Orden = { carpetas: ["delta", "cauce", "brote", "atlas"], lideres: {} };
  // Cada proyecto con un segundo líder frío: un proyecto que sólo tiene calientes no deja carpeta (ver el test de abajo).
  const lideres = [L("g", "general"), L("a", "atlas"), L("b", "brote"), L("c", "cauce"), L("d", "delta"), ...["a", "b", "c", "d"].map((p, i) => L(`${p}2`, ["atlas", "brote", "cauce", "delta"][i]))];
  assert.deepEqual(proyectos(arbol(lideres, { orden })), ["general", "delta", "cauce", "brote", "atlas"], "todos fríos: el orden del usuario");
  // brote y atlas con algo caliente: suben, en el orden del usuario entre sí.
  const a = arbol([lideres[0], { ...lideres[1], ...caliente }, { ...lideres[2], ocupado: true }, ...lideres.slice(3)], { orden });
  assert.deepEqual(proyectos(a), ["general", "brote", "atlas", "delta", "cauce"]);
  // Los workers vivos de un líder frío también (su líder va a Activas y el proyecto sube).
  const w = arbol(lideres, { orden, hilos: [worker("c", "cauce")] });
  assert.deepEqual(proyectos(w), ["general", "cauce", "delta", "brote", "atlas"]);
  // Workers vivos sin líder (huérfano) en un proyecto: sube aunque ningún líder suyo esté caliente.
  const h = arbol(lideres, { orden, hilos: [worker("ido", "brote")] });
  assert.deepEqual(proyectos(h), ["general", "brote", "delta", "cauce", "atlas"]);
  // Un caliente en el home no lo mueve de primero.
  assert.equal(proyectos(arbol([{ ...lideres[0], pide: true }, L("g2", "general"), ...lideres.slice(1)], { orden }))[0], "general");
});

test("un proyecto cuyos líderes están todos en Activas no deja una carpeta vacía; Activas es una sola lista de todos los proyectos", () => {
  const a = arbol([L("a", "atlas", caliente), L("b", "brote", { pide: true }), L("c", "brote")]);
  assert.deepEqual(proyectos(a), ["brote"]);
  assert.deepEqual(enActivas(a), ["b", "a"]);
  assert.deepEqual(a.activas.map((r) => r.lider!.proyecto), ["brote", "atlas"]);
});

test("buscando, sin Activas ni proyectos que floten: manda la búsqueda; sin foto (orden fijo) tampoco", () => {
  const lideres = [L("a", "atlas"), L("b", "brote", { pide: true })];
  const q = arbol(lideres, { busqueda: "atlas" });
  assert.deepEqual(q.activas, []);
  assert.deepEqual(proyectos(q), ["atlas"]);
  const fijo = arbol(lideres, { sinFoto: true });
  assert.deepEqual(fijo.activas, []);
  assert.deepEqual(proyectos(fijo), ["atlas", "brote"]);
});

test("el teclado recorre las filas como se ven: Activas primero (si está abierta), después los proyectos", () => {
  const lideres = [L("a", "atlas"), L("b", "brote", caliente), L("c", "cauce", { ocupado: true })];
  const hilos = [worker("a", "atlas", { tarea: "de a" }), worker("b", "brote", { tarea: "de b" }), worker("c", "cauce", { tarea: "de c" })];
  const ar = aVistaTodo(arbol(lideres, { hilos }));
  assert.deepEqual(enActivas(ar), ["c", "a", "b"]); // c responde (1), a tiene un worker vivo (2), b sólo el caché (3)
  const tareas = (abierta: (k: string) => boolean) => filasVisibles(ar, abierta, false).map((it) => it.h.tarea);
  const visual = ar.activas.flatMap((r) => r.vivas.map((it) => it.h.tarea));
  assert.deepEqual(tareas(() => true), visual);
  assert.deepEqual(tareas((k) => k !== ACTIVAS), [], "Activas plegada: sus filas no se recorren y no están repetidas abajo");
  // En "sólo líderes" los workers de un líder plegado no tienen fila.
  assert.deepEqual(filasVisibles(ar, (k) => !k.includes(":"), false, true), []);
});

test("lugarLider: un líder de Activas cae en Activas (para abrirla al seleccionarlo)", () => {
  const a = arbol([L("a", "atlas", caliente), L("b", "atlas")]);
  assert.deepEqual(lugarLider(a, "a"), { sid: "a", proyecto: ACTIVAS, espera: false, dormido: false });
  assert.equal(lugarLider(a, "b")!.proyecto, "atlas");
});

test("diferir: nada se reacomoda con el mouse encima, el foco adentro, un arrastre o un menú abierto", () => {
  assert.equal(diferir({}), false);
  assert.equal(diferir({ mouse: false, foco: false, arrastre: false, menu: false }), false);
  for (const k of ["mouse", "foco", "arrastre", "menu"] as const) assert.equal(diferir({ [k]: true }), true, k);
});

test("flotar es estable y no toca lo que recibe", () => {
  const xs = ["g", "a", "b", "c", "d"];
  assert.deepEqual(flotar(xs, (x) => x === "c" || x === "a", (x) => x === "g"), ["g", "a", "c", "b", "d"]);
  assert.deepEqual(xs, ["g", "a", "b", "c", "d"]);
  assert.deepEqual(flotar(xs, () => false), xs);
});
