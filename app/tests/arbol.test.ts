import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aDesplegar,
  aLaVista,
  aVistaTodo,
  armarArbol,
  arrancando,
  ARRANQUE_S,
  claveError,
  claveEspera,
  claveDormidos,
  DORMIDO_S,
  comoQuitar,
  ESPERA_S,
  estadoVisto,
  filasVisibles,
  fin,
  HUERFANO_S,
  lideresSinProceso,
  ordenCarpetas,
  lugarLider,
  nombreCarpeta,
  normal,
  puntaje,
  resumen,
  salidaDe,
  salidaWorker,
  seOculta,
  settleLider,
  settleWorker,
  type Arbol,
} from "../src/barra/arbol.ts";
import { comoSettle, SHARK } from "../src/datos/contrato.ts";
import { argvIntegrar, argvSettle, comoSettle as comoSettleMain } from "../electron/settle.ts";
import type { Estado, Hilo, Lider } from "../src/datos/contrato.ts";

const AHORA = 2_000_000_000;
const MIN = 60;
let n = 0;

const hilo = (p: Partial<Hilo> & Pick<Hilo, "proyecto" | "estado">): Hilo => ({
  id: `20261003-100000-${10000 + n++}`,
  tarea: "Tarea inventada",
  modelo: "claude-opus-5-5",
  effort: "medium",
  origen: "jefe",
  jefe: null,
  jefe_id: null,
  sigue_de: null,
  en_cola: false,
  inicio: AHORA - 10 * MIN,
  duracion_s: p.estado === "trabajando" ? null : 5 * MIN,
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
});

const lider = (id: string, actividad = AHORA - MIN, ocupado = false, creado = AHORA - 6 * 3600): Lider => ({
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
  modelo: "claude-opus-5-5",
  effort: "high",
});

const deL = (id: string) => ({ jefe: `ana-${id}`, jefe_id: id });
const nombres = (a: Arbol) => a.carpetas.map((c) => c.proyecto);
const ids = (xs: { h: Hilo }[]) => xs.map((x) => x.h.id);
const ramaDe = (a: Arbol, sid: string) => a.carpetas.flatMap((c) => c.ramas).find((r) => r.tipo === "lider" && r.lider?.id === sid)!;

test("el líder va a la carpeta de su primer worker; sin workers, a general (primera)", () => {
  const viejo = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 50 * MIN, ...deL("a") });
  const nuevo = hilo({ proyecto: "brote", estado: "trabajando", inicio: AHORA - 5 * MIN, ...deL("a") });
  const a = armarArbol([nuevo, viejo], { lideres: [lider("a"), lider("solo", AHORA)], ahora: AHORA });
  assert.equal(a.lideres.get("a")!.proyecto, "atlas");
  assert.equal(a.lideres.get("solo")!.proyecto, "general");
  assert.equal(nombres(a)[0], "general");
  // Los dos workers cuelgan del líder en atlas (la carpeta del líder es una sola).
  const atlas = a.carpetas.find((c) => c.proyecto === "atlas")!;
  assert.deepEqual(atlas.ramas.map((r) => r.clave), ["lider:a"]);
  assert.deepEqual(ids(atlas.ramas[0].vivas), [nuevo.id]);
  assert.deepEqual(ids(atlas.ramas[0].viejas), [viejo.id]);
  // brote sólo tiene lo del líder, que cuelga en atlas: no tiene carpeta.
  assert.ok(!nombres(a).includes("brote"));
});

test("dos líderes en el mismo proyecto: dos ramas, el que se creó primero arriba", () => {
  const h1 = hilo({ proyecto: "libro", estado: "listo", ...deL("x") });
  const h2 = hilo({ proyecto: "libro", estado: "listo", ...deL("y") });
  const x = lider("x", AHORA - MIN, false, AHORA - 2 * 3600);
  const y = lider("y", AHORA - 9 * MIN, false, AHORA - 3600);
  const a = armarArbol([h1, h2], { lideres: [y, x], ahora: AHORA });
  assert.deepEqual(nombres(a), ["libro"]);
  assert.deepEqual(a.carpetas[0].ramas.map((r) => r.clave), ["lider:x", "lider:y"]);
  // Creados en el mismo segundo: por id, nunca por el orden en que llegan.
  const p = lider("p", AHORA - MIN, false, AHORA - 3600);
  const q = lider("q", AHORA - 9 * MIN, false, AHORA - 3600);
  for (const lideres of [[p, q], [q, p]]) assert.deepEqual(armarArbol([], { lideres, ahora: AHORA }).carpetas[0].ramas.map((r) => r.clave), ["lider:p", "lider:q"]);
});

/** La barra como una lista: cada carpeta con sus líderes (los de la vista y los plegados en espera), en orden. */
test("Shark: su sesión jefe y sus workers van a la carpeta Shark, no a la de asistente-voz", () => {
  const w = hilo({ proyecto: "asistente-voz", estado: "trabajando", jefe: "shark-6f", jefe_id: "s" });
  const propio = hilo({ proyecto: "asistente-voz", estado: "trabajando", ...deL("f") });
  // Marcado por el main (cwd /srv/shark) y, sin la marca, por el nombre "shark-…".
  for (const shark of [{ ...lider("s"), nombre: "otro nombre", shark: true }, { ...lider("s"), nombre: "shark-6f" }]) {
    const a = armarArbol([w, propio], { lideres: [shark, lider("f")], ahora: AHORA });
    assert.equal(a.lideres.get("s")!.proyecto, SHARK);
    assert.equal(a.lideres.get("f")!.proyecto, "asistente-voz");
    const sh = a.carpetas.find((c) => c.proyecto === SHARK)!;
    assert.deepEqual(sh.ramas.map((r) => r.clave), ["lider:s"]);
    assert.deepEqual(ids(sh.ramas[0].vivas), [w.id]);
    const av = a.carpetas.find((c) => c.proyecto === "asistente-voz")!;
    assert.deepEqual(av.ramas.map((r) => r.clave), ["lider:f"]);
    assert.ok(!av.ramas.some((r) => r.vivas.some((x) => x.h.id === w.id)));
    assert.equal(nombreCarpeta(SHARK, "ana", "/home/ana"), "Shark");
  }
  // Moverlo a mano sigue mandando.
  const a = armarArbol([w], { lideres: [{ ...lider("s"), shark: true }], mover: new Map([["s", "atlas"]]), ahora: AHORA });
  assert.equal(a.lideres.get("s")!.proyecto, "atlas");
});

const lugares = (a: Arbol) => a.carpetas.map((c) => [c.proyecto, ...[...c.ramas, ...c.espera].filter((r) => r.tipo === "lider").map((r) => r.lider!.id)].join(" "));

test("orden fijo: la actividad de un líder (mensaje nuevo, responder, un worker que arranca o termina) no mueve a nadie", () => {
  const H = 3600;
  // Tres carpetas, dos líderes en cada una de las primeras; cada uno con su fecha de creación.
  const base = (): { lideres: Lider[]; hilos: Hilo[] } => ({
    lideres: [
      lider("g1", AHORA - 5 * MIN, false, AHORA - 9 * H),
      lider("g2", AHORA - 4 * MIN, false, AHORA - 7 * H),
      lider("a1", AHORA - 3 * MIN, false, AHORA - 8 * H),
      lider("a2", AHORA - 2 * MIN, false, AHORA - 6 * H),
      lider("b1", AHORA - 6 * MIN, false, AHORA - 5 * H),
    ],
    hilos: [
      hilo({ id: "w-a1", proyecto: "atlas", estado: "listo", inicio: AHORA - 7 * H, ...deL("a1") }),
      hilo({ id: "w-a2", proyecto: "atlas", estado: "listo", inicio: AHORA - 5 * H, ...deL("a2") }),
      hilo({ id: "w-b1", proyecto: "brote", estado: "listo", inicio: AHORA - 4 * H, ...deL("b1") }),
    ],
  });
  const ver = ({ lideres, hilos }: { lideres: Lider[]; hilos: Hilo[] }, ahora = AHORA) => lugares(armarArbol(hilos, { lideres, ahora }));
  const fijo = ["general g1 g2", "atlas a1 a2", "brote b1"];
  assert.deepEqual(ver(base()), fijo);

  const cambiar = (id: string, p: Partial<Lider>) => {
    const b = base();
    b.lideres = b.lideres.map((l) => (l.id === id ? { ...l, ...p } : l));
    return b;
  };
  // Mensaje nuevo: sube la actividad del último de cada carpeta, y de la última carpeta.
  for (const id of ["g2", "a2", "b1"]) assert.deepEqual(ver(cambiar(id, { actividad: AHORA })), fijo, `${id} escribió`);
  // Se pone a responder, y deja de responder.
  for (const id of ["g2", "a2", "b1"]) {
    assert.deepEqual(ver(cambiar(id, { ocupado: true, actividad: AHORA })), fijo, `${id} responde`);
    assert.deepEqual(ver(cambiar(id, { ocupado: false, actividad: AHORA })), fijo, `${id} terminó de responder`);
  }
  // Lo matan: queda en su lugar, marcado.
  assert.deepEqual(ver(cambiar("a2", { vivo: false, pid: null, caido: "murio" })), fijo);
  // Un worker que arranca (en su carpeta o en otro proyecto), trabaja, se traba, pide algo, termina, muere.
  for (const estado of ["trabajando", "colgado", "decision", "listo", "murio", "integrado"] as Estado[])
    for (const [jefe, proyecto] of [["a2", "atlas"], ["b1", "brote"], ["b1", "atlas"], ["a2", "cauce"]]) {
      const b = base();
      b.hilos.push(hilo({ proyecto, estado, inicio: AHORA - MIN, ...deL(jefe) }));
      assert.deepEqual(ver(b), fijo, `worker de ${jefe} en ${proyecto}: ${estado}`);
    }
  // El worker que ya tenía cambia de estado.
  for (const estado of ["trabajando", "colgado", "murio"] as Estado[]) {
    const b = base();
    b.hilos = b.hilos.map((h) => (h.id === "w-b1" ? { ...h, estado } : h));
    assert.deepEqual(ver(b), fijo, `w-b1 ${estado}`);
  }
  // El orden en que llegan los datos (el main los manda por actividad) tampoco.
  const alReves = base();
  alReves.lideres.reverse();
  alReves.hilos.reverse();
  assert.deepEqual(ver(alReves), fijo);
  // Pasa el tiempo sin que nadie haga nada: los ociosos se pliegan en espera, sin cambiar de orden.
  assert.deepEqual(ver(base(), AHORA + 2 * H), fijo);

  // Uno nuevo entra al final de su carpeta: los demás no se corren.
  const conNuevo = base();
  conNuevo.lideres.unshift(lider("g3", AHORA, true, AHORA));
  assert.deepEqual(ver(conNuevo), ["general g1 g2 g3", "atlas a1 a2", "brote b1"]);
  // Su primer worker lo lleva a esa carpeta, también al final; los siguientes ya no lo mueven.
  conNuevo.hilos.push(hilo({ proyecto: "atlas", estado: "trabajando", inicio: AHORA - 30, ...deL("g3") }));
  assert.deepEqual(ver(conNuevo), ["general g1 g2", "atlas a1 a2 g3", "brote b1"]);
  conNuevo.hilos.push(hilo({ proyecto: "brote", estado: "trabajando", inicio: AHORA - 10, ...deL("g3") }));
  assert.deepEqual(ver(conNuevo), ["general g1 g2", "atlas a1 a2 g3", "brote b1"]);
});

test("orden fijo: un líder que cierra dejando algo pendiente sigue en su carpeta; su lugar sale de su primer worker", () => {
  const w1 = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 3 * 3600, ...deL("ido") });
  const w2 = hilo({ proyecto: "brote", estado: "murio", inicio: AHORA - 600, ...deL("ido") });
  const viejo = hilo({ proyecto: "atlas", estado: "integrado", inicio: AHORA - 3 * 86400, ...deL("ido") });
  const [ido] = lideresSinProceso([w2, w1, viejo], { lideres: [], ahora: AHORA });
  assert.equal(ido.creado, AHORA - 3 * 86400, "el primero de todos, aunque ya no se vea");
  const antes = lider("antes", AHORA, true, AHORA - 4 * 86400);
  const despues = lider("despues", AHORA, true, AHORA - 3600);
  const wa = hilo({ proyecto: "atlas", estado: "trabajando", ...deL("antes") });
  const wd = hilo({ proyecto: "atlas", estado: "trabajando", ...deL("despues") });
  assert.deepEqual(lugares(armarArbol([w1, w2, viejo, wa, wd], { lideres: [despues, ido, antes], ahora: AHORA })), ["atlas antes ido despues"]);
});

test("bajo el líder: lo terminado se esconde solo (viejas) hasta el Settle, sin importar cuándo; lo cerrado por pa se va", () => {
  const trab = hilo({ proyecto: "atlas", estado: "trabajando", inicio: AHORA - 5 * 3600, ...deL("a") });
  const cola = hilo({ proyecto: "atlas", estado: "listo", en_cola: true, inicio: AHORA - 9 * 3600, ...deL("a") });
  const integrado = hilo({ proyecto: "atlas", estado: "integrado", inicio: AHORA - 60, ...deL("a") });
  const viejo = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 3 * 86400, ...deL("a") });
  const a = armarArbol([trab, cola, integrado, viejo], { lideres: [lider("a")], ahora: AHORA });
  const r = a.carpetas[0].ramas[0];
  assert.deepEqual(ids(r.vivas), [trab.id, cola.id]);
  assert.deepEqual(ids(r.viejas), [viejo.id]);
  assert.deepEqual(ids(a.cerrados), [integrado.id], "lo integrado/archivado por pa ya está settleado");
  // El Settle optimista de uno de líder lo archiva: deja de colgar.
  const b = armarArbol([viejo], { lideres: [lider("a")], optimista: new Map([[viejo.id, "archivado" as Estado]]), ahora: AHORA });
  assert.deepEqual(ids(b.cerrados), [viejo.id]);
});

test("lo activo no sube: ni el líder que responde ni el que tiene workers trabajando pasan al que se creó antes", () => {
  const t = hilo({ proyecto: "libro", estado: "trabajando", ...deL("y") });
  const l = hilo({ proyecto: "libro", estado: "listo", ...deL("x") });
  const x = lider("x", AHORA - 20 * MIN, false, AHORA - 2 * 3600);
  const y = lider("y", AHORA - MIN, false, AHORA - 3600);
  const a = armarArbol([t, l], { lideres: [y, x], ahora: AHORA });
  assert.deepEqual(a.carpetas[0].ramas.map((r) => r.clave), ["lider:x", "lider:y"]);
  const z = lider("z", AHORA, true, AHORA - 60);
  const b = armarArbol([], { lideres: [z, y], ahora: AHORA });
  assert.deepEqual(b.carpetas[0].ramas.map((r) => r.clave), ["lider:y", "lider:z"], "el que responde, en su lugar");
});

test("carpetas: general primera; después por nombre (el título del registry si tiene), sin importar qué trabaja ni qué es más reciente", () => {
  const quieta = hilo({ proyecto: "atlas", estado: "listo", origen: "app", inicio: AHORA - 60 * MIN });
  const trab = hilo({ proyecto: "brote", estado: "trabajando", origen: "app", inicio: AHORA - MIN });
  const otra = hilo({ proyecto: "Cauce", estado: "trabajando", origen: "app", inicio: AHORA - 2 * MIN });
  const hilos = [trab, otra, quieta];
  const a = armarArbol(hilos, { lideres: [lider("solo", AHORA)], ahora: AHORA });
  assert.deepEqual(nombres(a), ["general", "atlas", "brote", "Cauce"]);
  // Se ordena por lo que se ve: con título, por el título (sin mayúsculas ni tildes).
  const titulos = new Map([["atlas", "Órbita"], ["brote", "delta"]]);
  assert.deepEqual(nombres(armarArbol(hilos, { lideres: [lider("solo", AHORA)], titulos, ahora: AHORA })), ["general", "Cauce", "brote", "atlas"]);
  assert.ok(ordenCarpetas("zeta", "general") > 0 && ordenCarpetas("general", "atlas") < 0 && ordenCarpetas("atlas", "atlas") === 0);
});

test("líderes ociosos (sin workers a la vista, sin responder, 30 min quietos) van plegados en espera", () => {
  const w = hilo({ proyecto: "atlas", estado: "listo", ...deL("conWorker") });
  const lideres = [
    lider("dormido", AHORA - ESPERA_S - MIN),
    lider("reciente", AHORA - 5 * MIN),
    lider("responde", AHORA - 2 * 3600, true),
    lider("conWorker", AHORA - 3 * 3600),
  ];
  const a = armarArbol([w], { lideres, ahora: AHORA });
  const gen = a.carpetas.find((c) => c.proyecto === "general")!;
  assert.deepEqual(gen.ramas.map((r) => r.clave), ["lider:reciente", "lider:responde"], "creados a la vez: por id");
  assert.deepEqual(gen.espera.map((r) => r.clave), ["lider:dormido"]);
  // El que tiene un worker sin settlear no está en espera.
  const atlas = a.carpetas.find((c) => c.proyecto === "atlas")!;
  assert.deepEqual(atlas.ramas.map((r) => r.clave), ["lider:conWorker"]);
  assert.deepEqual(atlas.espera, []);
  assert.equal(claveEspera("general"), "espera:general");
  // Buscando no se pliega nada.
  const b = armarArbol([], { lideres, busqueda: "ana-dormido", ahora: AHORA });
  assert.deepEqual(b.carpetas[0].ramas.map((r) => r.clave), ["lider:dormido"]);
});

test("Settle: de la app con rama integra; de un líder o sin rama, archiva", () => {
  for (const f of [comoSettle, comoSettleMain]) {
    assert.equal(f({ origen: "app", rama: "pa/atlas/x" }), "integrar");
    assert.equal(f({ origen: "manual", rama: "pa/atlas/x" }), "integrar");
    assert.equal(f({ origen: "jefe", rama: "pa/atlas/x" }), "archivar", "la rama es del líder");
    assert.equal(f({ origen: "app", rama: null }), "archivar");
    assert.equal(f({ origen: "jefe", rama: null }), "archivar");
  }
  const id = "20261003-100000-11111";
  assert.deepEqual(argvSettle({ id, origen: "app", rama: "r" }, "Atlas Web", true), ["Atlas Web", "--integrar", id, "--tests"]);
  assert.deepEqual(argvSettle({ id, origen: "jefe", rama: "r" }, ""), ["--archivar", id]);
});

test("Integrar: --tests sólo si el proyecto tiene `tests` en el registry", () => {
  const id = "20261003-100000-11111";
  assert.deepEqual(argvIntegrar("Atlas Web", id, true), ["Atlas Web", "--integrar", id, "--tests"]);
  assert.deepEqual(argvIntegrar("brote", id, false), ["brote", "--integrar", id], "sin tests, pa sale 2 con --tests");
  assert.deepEqual(argvSettle({ id, origen: "app", rama: "r" }, "brote", false), ["brote", "--integrar", id]);
  assert.deepEqual(argvSettle({ id, origen: "app", rama: "r" }, "brote"), ["brote", "--integrar", id], "por defecto, sin --tests");
});

test("Lo que murió no hace Settle: sin commits se quita, con commits se elige", () => {
  const vivos = new Set(["a"]);
  const sinRama = hilo({ proyecto: "atlas", estado: "murio", origen: "app" });
  const ramaVacia = hilo({ proyecto: "atlas", estado: "murio", origen: "app", rama: "pa/atlas/x", commits: 0 });
  const conCommits = hilo({ proyecto: "atlas", estado: "murio", origen: "app", rama: "pa/atlas/y", commits: 3 });
  const listo = hilo({ proyecto: "atlas", estado: "listo", origen: "app", rama: "pa/atlas/z", commits: 2 });
  assert.equal(salidaDe(sinRama, "murio"), "quitar");
  assert.equal(salidaDe(ramaVacia, "murio"), "quitar", "rama sin commits: nada que perder");
  assert.equal(salidaDe(conCommits, "murio"), "elegir");
  assert.equal(salidaDe(listo, "listo"), "settle");
  assert.equal(salidaDe({ rama: "r", commits: null as unknown as number }, "murio"), "quitar");
  // Quitar: con rama la descarta (pa --descartar exige rama); sin rama, archiva.
  assert.equal(comoQuitar(ramaVacia), "descartar");
  assert.equal(comoQuitar(conCommits), "descartar");
  assert.equal(comoQuitar(sinRama), "archivar");
  // Sólo con Settle propio: lo de un líder a la vista no tiene botones.
  assert.equal(salidaWorker(conCommits, "murio", vivos), "elegir");
  assert.equal(salidaWorker(hilo({ proyecto: "atlas", estado: "murio", ...deL("a") }), "murio", vivos), null);
  assert.equal(salidaWorker(listo, "listo", vivos), "settle");
  assert.equal(salidaWorker(listo, "trabajando", vivos), null);
});

test("Error en la fila: corto tal cual; el stderr largo de pa, una clave corta", () => {
  assert.equal(claveError("Tests failed, main is unchanged"), null);
  assert.equal(claveError("pa: 'hilos' no tiene `tests` en el registry; agregalo o integrá sin --tests."), "fila.errorSinTests");
  assert.equal(
    claveError("pa: el rebase de pa/x/1 sobre main (abc1234) tiene conflictos: otro cambio que ya entró toca lo mismo."),
    "fila.errorConflictos",
  );
  assert.equal(claveError("pa: la rama pa/x/1 la está usando un worker en el puesto 2. Matalo o esperalo primero."), "fila.errorOcupado");
  assert.equal(claveError("pa: algo raro pasó en un lugar que nadie esperaba, con mucho texto"), "fila.errorPa");
});

test("Te necesita sólo para lo que no lanzó un líder", () => {
  const delLider = hilo({ proyecto: "atlas", estado: "decision", ...deL("a") });
  const huerfano = hilo({ proyecto: "atlas", estado: "decision" });
  const deApp = hilo({ proyecto: "atlas", estado: "decision", origen: "app" });
  assert.equal(estadoVisto(delLider), "listo");
  assert.equal(estadoVisto(huerfano), "listo");
  assert.equal(estadoVisto(deApp), "decision");
  assert.equal(estadoVisto(deApp, "archivado" as Estado), "archivado");
  const a = armarArbol([delLider, deApp], { lideres: [lider("a")], ahora: AHORA });
  const todos = filasVisibles(a, () => true, true);
  assert.deepEqual(
    todos.filter((x) => x.estado === "decision").map((x) => x.h.id),
    [deApp.id],
  );
});

test("carpetas activas: líder vivo, trabajando o en cola, o algo de Ana esperando", () => {
  const quieto = hilo({ proyecto: "quieto", estado: "listo" }); // huérfano terminado
  const trabaja = hilo({ proyecto: "trabaja", estado: "trabajando" }); // huérfano trabajando
  const colgado = hilo({ proyecto: "trabado", estado: "colgado" });
  const app = hilo({ proyecto: "app", estado: "listo", origen: "app" });
  const appCerrada = hilo({ proyecto: "cerrada", estado: "archivado", origen: "app" });
  const a = armarArbol([quieto, trabaja, colgado, app, appCerrada], { lideres: [], ahora: AHORA });
  assert.deepEqual(nombres(a).sort(), ["app", "trabado", "trabaja"]);
  assert.deepEqual(ids(a.cerrados), [appCerrada.id]);
  // Lo de Ana cuelga suelto, sin líder; terminado y sin rama, plegado.
  const r = a.carpetas.find((c) => c.proyecto === "app")!.ramas;
  assert.deepEqual(r.map((x) => x.tipo), ["sueltas"]);
  assert.deepEqual(ids(r[0].vivas), []);
  assert.deepEqual(ids(r[0].viejas), [app.id]);
});

test("huérfanos de las últimas 24 h van plegados en 'sin líder'; los viejos no se ven", () => {
  const trab = hilo({ proyecto: "atlas", estado: "trabajando", ...deL("muerto") });
  const reciente = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 3 * 3600, ...deL("muerto") });
  const viejo = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - HUERFANO_S - 3600 });
  const viejoCerrado = hilo({ proyecto: "atlas", estado: "integrado", inicio: AHORA - HUERFANO_S - 3600 });
  const a = armarArbol([trab, reciente, viejo, viejoCerrado], { lideres: [], ahora: AHORA });
  const r = a.carpetas[0].ramas;
  assert.deepEqual(r.map((x) => x.clave), ["huerfanos:atlas"]);
  assert.deepEqual(ids(r[0].vivas), [trab.id], "lo que trabaja no se pliega");
  assert.deepEqual(ids(r[0].viejas), [reciente.id]);
  assert.deepEqual(ids(a.cerrados), [viejoCerrado.id]);
});

test("el buscador encuentra lo escondido: huérfanos viejos y carpetas quietas", () => {
  const viejo = hilo({ proyecto: "duna", estado: "listo", tarea: "Migrar YAML", inicio: AHORA - 3 * 86400 });
  const otro = hilo({ proyecto: "duna", estado: "listo", tarea: "Otra cosa", inicio: AHORA - 3 * 86400 });
  const delLider = hilo({ proyecto: "eco", estado: "listo", tarea: "Nada que ver", ...deL("a") });
  assert.deepEqual(nombres(armarArbol([viejo, otro], { lideres: [], ahora: AHORA })), []);
  const a = armarArbol([viejo, otro, delLider], { lideres: [lider("a")], busqueda: "yaml", ahora: AHORA });
  assert.deepEqual(nombres(a), ["duna"]);
  assert.deepEqual(ids(a.carpetas[0].ramas[0].viejas), [viejo.id]);
  // Por nombre del líder.
  const b = armarArbol([viejo, delLider], { lideres: [lider("a")], busqueda: "ana-a", ahora: AHORA });
  assert.deepEqual(nombres(b), ["eco"]);
  assert.deepEqual(ids(b.carpetas[0].ramas[0].viejas), [delLider.id]);
});

test("el líder conserva su objeto si la carpeta no cambia (la fila es memo)", () => {
  const l = { ...lider("a"), proyecto: "atlas" };
  const a = armarArbol([hilo({ proyecto: "atlas", estado: "trabajando", ...deL("a") })], { lideres: [l], ahora: AHORA });
  assert.equal(a.lideres.get("a"), l);
});

test("lo optimista manda: un Cerrar de algo de Ana lo lleva a Cerrados", () => {
  const app = hilo({ proyecto: "app", estado: "listo", origen: "app" });
  const a = armarArbol([app], { lideres: [], optimista: new Map([[app.id, "archivado" as Estado]]), ahora: AHORA });
  assert.deepEqual(nombres(a), []);
  assert.deepEqual(ids(a.cerrados), [app.id]);
});

test("la carpeta del home lleva el usuario del sistema (o Inicio); las demás, su nombre", () => {
  assert.equal(nombreCarpeta("general", "ana", "Home"), "ana");
  assert.equal(nombreCarpeta("general", null, "Home"), "Home");
  assert.equal(nombreCarpeta("general", "  ", "Inicio"), "Inicio");
  assert.equal(nombreCarpeta("atlas", "ana", "Home"), "atlas");
  // El `titulo` del registry gana sobre el nombre; vacío o en General, no.
  assert.equal(nombreCarpeta("hilos", "ana", "Home", "trama"), "trama");
  assert.equal(nombreCarpeta("hilos", "ana", "Home", " "), "hilos");
  assert.equal(nombreCarpeta("general", "ana", "Home", "trama"), "ana");
});

test("líder nuevo de la app: arranca en general; con workers en varios proyectos, queda en el del primero", () => {
  const solo = armarArbol([], { lideres: [lider("nuevo", AHORA)], ahora: AHORA });
  assert.deepEqual(nombres(solo), ["general"]);
  assert.equal(solo.lideres.get("nuevo")!.proyecto, "general");
  const a1 = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 40 * MIN, ...deL("nuevo") });
  const b1 = hilo({ proyecto: "brote", estado: "listo", inicio: AHORA - 20 * MIN, ...deL("nuevo") });
  const c1 = hilo({ proyecto: "cauce", estado: "trabajando", inicio: AHORA - 30 * MIN, ...deL("nuevo") });
  const a = armarArbol([a1, b1, c1], { lideres: [lider("nuevo", AHORA)], ahora: AHORA });
  // El primero por inicio (atlas), aunque el de cauce siga trabajando; ya no está en general.
  assert.equal(a.lideres.get("nuevo")!.proyecto, "atlas");
  assert.ok(!nombres(a).includes("general"));
  const atlas = a.carpetas.find((c) => c.proyecto === "atlas")!;
  assert.deepEqual(ids(atlas.ramas[0].vivas), [c1.id]);
  assert.deepEqual(ids(atlas.ramas[0].viejas), [b1.id, a1.id]);
  // Lanza otro en brote: no se muda.
  const b2 = hilo({ proyecto: "brote", estado: "trabajando", inicio: AHORA - MIN, ...deL("nuevo") });
  assert.equal(armarArbol([a1, b1, c1, b2], { lideres: [lider("nuevo", AHORA)], ahora: AHORA }).lideres.get("nuevo")!.proyecto, "atlas");
});

test("Settle de worker: sólo terminado y sin líder a la vista (viejo, de la app o huérfano)", () => {
  const vivos = new Set(["a"]);
  const conLider = hilo({ proyecto: "atlas", estado: "listo", ...deL("a") });
  const huerfano = hilo({ proyecto: "atlas", estado: "listo", ...deL("muerto") });
  const app = hilo({ proyecto: "atlas", estado: "decision", origen: "app" });
  const trabajando = hilo({ proyecto: "atlas", estado: "trabajando", origen: "app" });
  assert.equal(settleWorker(conLider, "listo", vivos), false);
  assert.equal(settleWorker(conLider, "decision", vivos), false);
  assert.equal(settleWorker(huerfano, "listo", vivos), true);
  assert.equal(settleWorker(app, "decision", vivos), true);
  assert.equal(settleWorker(trabajando, "trabajando", vivos), false);
  assert.equal(settleWorker(app, "archivado", vivos), false);
});

test("Settle de líder: sólo quieto; archiva sus terminados y cuenta las ramas sin integrar", () => {
  const it = (h: Hilo) => ({ h, estado: h.estado });
  const t1 = hilo({ proyecto: "atlas", estado: "listo", rama: "pa/atlas/1", commits: 3, ...deL("a") });
  const t1b = hilo({ proyecto: "atlas", estado: "decision", rama: "pa/atlas/1", commits: 4, ...deL("a") });
  const t2 = hilo({ proyecto: "brote", estado: "murio", rama: "pa/brote/2", commits: 0, ...deL("a") });
  const t3 = hilo({ proyecto: "brote", estado: "entregado", rama: "pa/brote/3", commits: 1, ...deL("a") });
  const leer = hilo({ proyecto: "brote", estado: "listo", leer: true, ...deL("a") });
  const quieto = settleLider(lider("a"), [t1, t1b, t2, t3, leer].map(it));
  assert.deepEqual(quieto, { puede: true, archivar: [t1.id, t1b.id, t2.id, t3.id, leer.id], ramas: 2 });
  // Respondiendo, o con un worker trabajando o en cola: no hay Settle.
  assert.equal(settleLider(lider("a", AHORA, true), [t1].map(it)).puede, false);
  assert.equal(settleLider(lider("a"), [t1, hilo({ proyecto: "atlas", estado: "trabajando", ...deL("a") })].map(it)).puede, false);
  assert.equal(settleLider(lider("a"), [t1, hilo({ proyecto: "atlas", estado: "listo", en_cola: true, ...deL("a") })].map(it)).puede, false);
  // Sin workers: Settle igual (cierra la conversación), nada que archivar.
  assert.deepEqual(settleLider(lider("a"), []), { puede: true, archivar: [], ramas: 0 });
});

test("líder settleado no se ve hasta que tenga actividad nueva; sus workers sin archivar quedan huérfanos", () => {
  const w = hilo({ proyecto: "atlas", estado: "listo", ...deL("a") });
  const settleados = new Map([["a", AHORA - MIN]]);
  const a = armarArbol([w], { lideres: [lider("a", AHORA - 2 * MIN)], settleados, ahora: AHORA });
  assert.ok(!a.lideres.has("a"));
  const b = armarArbol([w], { lideres: [lider("a", AHORA)], settleados, ahora: AHORA });
  assert.ok(b.lideres.has("a"));
});

// --- B15: lo terminado se esconde solo; "sólo líderes" ---------------------------

test("qué se esconde solo: tabla de estados × con líder vivo, huérfano y de Ana", () => {
  const RAMA = { rama: "pa/atlas/x", commits: 2 };
  // [estado, extra, con líder vivo, huérfano, de Ana (app)]: true = se esconde.
  const tabla: [Estado, Partial<Hilo>, boolean, boolean, boolean][] = [
    ["trabajando", {}, false, false, false],
    ["colgado", {}, false, false, false],
    ["listo", { en_cola: true }, false, false, false],
    ["murio", {}, false, false, false],
    ["murio", RAMA, false, false, false],
    ["decision", {}, true, false, false],
    ["decision", RAMA, true, false, false],
    ["listo", {}, true, true, true],
    ["entregado", {}, true, true, true],
    ["listo", RAMA, true, false, false],
    ["entregado", RAMA, true, false, false],
    ["listo", { rama: "pa/atlas/x", commits: 0 }, true, true, true],
    ["integrado", RAMA, true, true, true],
    ["archivado", {}, true, true, true],
    ["descartado", RAMA, true, true, true],
    ["revertido", RAMA, true, true, true],
  ];
  for (const [estado, extra, conLider, huerfano, deAna] of tabla) {
    const nota = `${estado} ${JSON.stringify(extra)}`;
    const jefe = hilo({ proyecto: "atlas", estado, ...extra, ...deL("a") });
    const app = hilo({ proyecto: "atlas", estado, ...extra, origen: "app" });
    const it = (h: Hilo) => ({ h, estado: estadoVisto(h) });
    assert.equal(seOculta(it(jefe), true), conLider, `${nota}, con líder vivo`);
    assert.equal(seOculta(it(jefe), false), huerfano, `${nota}, huérfano`);
    assert.equal(seOculta(it(app), false), deAna, `${nota}, de Ana`);
  }
  // Lo optimista manda: una decisión que Ana ya settleó no vuelve a la vista.
  const dec = hilo({ proyecto: "atlas", estado: "decision", origen: "app" });
  assert.equal(seOculta({ h: dec, estado: "archivado" }, false), true);
});

test("en el árbol: lo escondido va a viejas (el +N del líder), lo que pide algo a vivas; lo cerrado bajo un líder, a Cerrados", () => {
  const RAMA = { rama: "pa/atlas/x", commits: 2 };
  const trab = hilo({ proyecto: "atlas", estado: "trabajando", inicio: AHORA - MIN, ...deL("a") });
  const fallo = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 2 * MIN, ...deL("a") });
  const listo = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 3 * MIN, ...RAMA, ...deL("a") });
  const decide = hilo({ proyecto: "atlas", estado: "decision", inicio: AHORA - 4 * MIN, ...deL("a") });
  const integrado = hilo({ proyecto: "atlas", estado: "integrado", ...deL("a") });
  const hRama = hilo({ proyecto: "atlas", estado: "entregado", inicio: AHORA - 5 * MIN, ...RAMA, ...deL("muerto") });
  const hFallo = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 6 * MIN, ...deL("muerto") });
  const hDecide = hilo({ proyecto: "atlas", estado: "decision", inicio: AHORA - 7 * MIN, ...deL("muerto") });
  const hListo = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 8 * MIN, ...deL("muerto") });
  const fDecide = hilo({ proyecto: "atlas", estado: "decision", inicio: AHORA - 9 * MIN, origen: "app" });
  const fRama = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 10 * MIN, origen: "app", ...RAMA });
  const fListo = hilo({ proyecto: "atlas", estado: "entregado", inicio: AHORA - 11 * MIN, origen: "app" });
  const todos = [trab, fallo, listo, decide, integrado, hRama, hFallo, hDecide, hListo, fDecide, fRama, fListo];
  const a = armarArbol(todos, { lideres: [lider("a")], ahora: AHORA });
  const [l, s, h] = a.carpetas[0].ramas;
  assert.deepEqual([l.tipo, s.tipo, h.tipo], ["lider", "sueltas", "huerfanos"]);
  assert.deepEqual(ids(l.vivas), [trab.id, fallo.id]);
  assert.deepEqual(ids(l.viejas), [listo.id, decide.id]);
  assert.deepEqual(ids(h.vivas), [hRama.id, hFallo.id, hDecide.id]);
  assert.deepEqual(ids(h.viejas), [hListo.id]);
  assert.deepEqual(ids(s.vivas), [fDecide.id, fRama.id]);
  assert.deepEqual(ids(s.viejas), [fListo.id]);
  assert.deepEqual(ids(a.cerrados), [integrado.id]);
  // El worker que termina pasa de vivas a viejas: la fila se va sola.
  const b = armarArbol([{ ...trab, estado: "listo", duracion_s: 60 }], { lideres: [lider("a")], ahora: AHORA });
  assert.deepEqual(ids(b.carpetas[0].ramas[0].vivas), []);
  assert.deepEqual(ids(b.carpetas[0].ramas[0].viejas), [trab.id]);
});

test("una carpeta sin líder se ve si un huérfano pide algo (rama sin integrar, falló); si sólo terminó, no", () => {
  const conRama = hilo({ proyecto: "rama", estado: "listo", rama: "pa/rama/x", commits: 1, ...deL("muerto") });
  const fallo = hilo({ proyecto: "fallo", estado: "murio", ...deL("muerto") });
  const quieto = hilo({ proyecto: "quieto", estado: "listo", ...deL("muerto") });
  const viejo = hilo({ proyecto: "viejo", estado: "listo", rama: "pa/viejo/x", commits: 1, inicio: AHORA - HUERFANO_S - 3600 });
  const a = armarArbol([conRama, fallo, quieto, viejo], { lideres: [], ahora: AHORA });
  assert.deepEqual(nombres(a).sort(), ["fallo", "rama"]);
});

test("toggle sólo líderes: los workers de un líder no tienen fila salvo con su pliegue abierto; lo sin líder sigue", () => {
  const trab = hilo({ proyecto: "atlas", estado: "trabajando", inicio: AHORA - MIN, ...deL("a") });
  const listo = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 2 * MIN, ...deL("a") });
  const deB = hilo({ proyecto: "atlas", estado: "colgado", inicio: AHORA - 3 * MIN, ...deL("b") });
  const deAna = hilo({ proyecto: "atlas", estado: "decision", inicio: AHORA - 4 * MIN, origen: "app" });
  const huerfano = hilo({ proyecto: "atlas", estado: "trabajando", inicio: AHORA - 5 * MIN, ...deL("muerto") });
  const cerrado = hilo({ proyecto: "atlas", estado: "archivado", origen: "app" });
  const a = armarArbol([trab, listo, deB, deAna, huerfano, cerrado], { lideres: [lider("a"), lider("b", AHORA - 5 * MIN)], ahora: AHORA });
  const ver = (abiertas: string[], solo: boolean, cerrados = false) =>
    ids(filasVisibles(a, (k) => !k.includes(":") || abiertas.includes(k), cerrados, solo));
  // Todo: lo vivo de cada líder; lo terminado, sólo con el "+N" abierto.
  assert.deepEqual(ver([], false), [trab.id, deB.id, deAna.id, huerfano.id]);
  assert.deepEqual(ver(["lider:a"], false), [trab.id, listo.id, deB.id, deAna.id, huerfano.id]);
  // Sólo líderes: ni lo vivo; lo que no cuelga de un líder sigue a la vista.
  assert.deepEqual(ver([], true), [deAna.id, huerfano.id]);
  // Desplegar un líder muestra todo lo suyo, y sólo lo suyo.
  assert.deepEqual(ver(["lider:a"], true), [trab.id, listo.id, deAna.id, huerfano.id]);
  // Buscando (todo abierto) y con Cerrados, igual que siempre.
  assert.deepEqual(ids(filasVisibles(a, () => true, true, true)), [trab.id, listo.id, deB.id, deAna.id, huerfano.id, cerrado.id]);
  // El default es "todo": el tercer parámetro de antes sigue valiendo.
  assert.deepEqual(ids(filasVisibles(a, (k) => !k.includes(":"), false)), ver([], false));
});

test("vista de todo: debajo de un líder vivo se listan lo que trabaja, está en cola o te necesita; murió, terminó y frenado no", () => {
  const it = (estado: Estado, extra: Partial<Hilo> = {}) => ({ h: hilo({ proyecto: "atlas", estado, ...extra }), estado });
  assert.equal(aLaVista(it("trabajando"), true), true);
  assert.equal(aLaVista(it("colgado"), true), true);
  assert.equal(aLaVista(it("trabajando", { en_cola: true }), true), true);
  assert.equal(aLaVista(it("decision"), true), true);
  assert.equal(aLaVista(it("murio"), true), false);
  assert.equal(aLaVista(it("murio", { frenado_en: AHORA - MIN }), true), false);
  assert.equal(aLaVista(it("listo"), true), false);
  assert.equal(aLaVista(it("entregado"), true), false);
  assert.equal(aLaVista(it("listo", { rama: "pa/atlas/x", commits: 2 }), true), false);
  assert.equal(aLaVista(it("archivado"), true), false);
});

test("vista de todo: de un líder sin proceso queda a la vista lo que dejó una rama con commits; lo demás se pliega", () => {
  const it = (estado: Estado, extra: Partial<Hilo> = {}) => ({ h: hilo({ proyecto: "atlas", estado, ...extra }), estado });
  assert.equal(aLaVista(it("listo", { rama: "pa/atlas/x", commits: 2 }), false), true);
  assert.equal(aLaVista(it("listo"), false), false);
  assert.equal(aLaVista(it("murio"), false), false);
  assert.equal(aLaVista(it("murio", { frenado_en: AHORA - MIN }), false), false);
  assert.equal(aLaVista(it("archivado", { rama: "pa/atlas/x", commits: 2 }), false), false);
  assert.equal(aLaVista(it("trabajando"), false), true);
  assert.equal(aLaVista(it("decision"), false), true);
});

test("vista de todo: bajo el líder, lo que no se ve pasa a viejas (N terminados) y el de sólo líderes no cambia", () => {
  const trab = hilo({ proyecto: "atlas", estado: "trabajando", inicio: AHORA - MIN, ...deL("a") });
  const cola = hilo({ proyecto: "atlas", estado: "trabajando", en_cola: true, inicio: AHORA - 2 * MIN, ...deL("a") });
  const fallo = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 3 * MIN, ...deL("a") });
  const frenado = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 4 * MIN, frenado_en: AHORA - 4 * MIN, ...deL("a") });
  const listo = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 5 * MIN, ...deL("a") });
  const huerfano = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 6 * MIN, ...deL("muerto") });
  const a = armarArbol([trab, cola, fallo, frenado, listo, huerfano], { lideres: [lider("a")], ahora: AHORA });
  const v = aVistaTodo(a);
  const r = ramaDe(v, "a");
  assert.deepEqual(ids(r.vivas), [trab.id, cola.id]);
  assert.deepEqual(ids(r.viejas), [fallo.id, frenado.id, listo.id]);
  // Sólo líderes: el árbol de siempre (lo muerto en vivas: su resumen cuenta los fallos y los frenados).
  assert.deepEqual(ids(ramaDe(a, "a").vivas), [trab.id, cola.id, fallo.id, frenado.id]);
  assert.deepEqual(ids(ramaDe(a, "a").viejas), [listo.id]);
  // Sin líder, lo muerto se pliega igual (B15 + "sin líder" de la vista de todo); el total de la carpeta tampoco cambia.
  const sinLider = v.carpetas[0].ramas.find((x) => x.tipo === "huerfanos")!;
  assert.deepEqual(ids(sinLider.vivas), []);
  assert.deepEqual(ids(sinLider.viejas), [huerfano.id]);
  assert.equal(v.carpetas[0].cuenta, a.carpetas[0].cuenta);
  assert.equal(r.vivas.length + r.viejas.length, 5);
});

test("vista de todo: en 'sin líder' se pliega lo muerto y lo terminado; lo que trabaja, pide algo o dejó una rama con commits se queda", () => {
  const trab = hilo({ proyecto: "atlas", estado: "trabajando", inicio: AHORA - MIN, ...deL("muerto") });
  const decide = hilo({ proyecto: "atlas", estado: "decision", inicio: AHORA - 2 * MIN, ...deL("muerto") });
  const conRama = hilo({ proyecto: "atlas", estado: "listo", rama: "pa/atlas/x", commits: 1, inicio: AHORA - 3 * MIN, ...deL("muerto") });
  const muerto = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 4 * MIN, ...deL("muerto") });
  const frenado = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 5 * MIN, frenado_en: AHORA - 5 * MIN, ...deL("muerto") });
  const listo = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 6 * MIN, ...deL("muerto") });
  const sueltaMuerta = hilo({ proyecto: "atlas", estado: "murio", origen: "app", inicio: AHORA - 7 * MIN });
  const a = armarArbol([trab, decide, conRama, muerto, frenado, listo, sueltaMuerta], { lideres: [], caidos: [{ id: deL("muerto").jefe_id, nombre: "muerto", ts: AHORA }], ahora: AHORA });
  const v = aVistaTodo(a);
  const sinLider = v.carpetas[0].ramas.find((x) => x.tipo === "huerfanos")!;
  assert.deepEqual(ids(sinLider.vivas), [trab.id, decide.id, conRama.id]);
  assert.deepEqual(ids(sinLider.viejas), [muerto.id, frenado.id, listo.id]);
  assert.deepEqual(sinLider.muertos, ["muerto"], "el nombre del líder muerto sigue en la cabecera");
  // Lo de Ana sin líder (sin cabecera) no se pliega en la vista de todo.
  const sueltas = v.carpetas[0].ramas.find((x) => x.tipo === "sueltas")!;
  assert.deepEqual(ids(sueltas.vivas), [sueltaMuerta.id]);
  assert.equal(v.carpetas[0].cuenta, a.carpetas[0].cuenta);
});

test("vista de todo: un líder sin proceso deja a la vista lo que dejó una rama con commits (Ana lo integra)", () => {
  const conRama = hilo({ proyecto: "atlas", estado: "listo", rama: "pa/atlas/x", commits: 1, inicio: AHORA - MIN, ...deL("c") });
  const sinRama = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 2 * MIN, ...deL("c") });
  const muerto = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 3 * MIN, ...deL("c") });
  const sinProceso: Lider = { ...lider("c"), caido: "murio" };
  const v = aVistaTodo(armarArbol([conRama, sinRama, muerto], { lideres: [sinProceso], ahora: AHORA }));
  const r = ramaDe(v, "c");
  assert.deepEqual(ids(r.vivas), [conRama.id]);
  assert.deepEqual(ids(r.viejas), [sinRama.id, muerto.id]);
});

test("resumen del líder: cuántos trabajan (o esperan en cola), cuántos están trabados y cuántos fallaron", () => {
  const it = (h: Hilo) => ({ h, estado: estadoVisto(h) });
  const vivas = [
    hilo({ proyecto: "atlas", estado: "trabajando" }),
    hilo({ proyecto: "atlas", estado: "trabajando" }),
    hilo({ proyecto: "atlas", estado: "listo", en_cola: true }),
    hilo({ proyecto: "atlas", estado: "colgado" }),
    hilo({ proyecto: "atlas", estado: "murio" }),
  ].map(it);
  assert.deepEqual(resumen(vivas), { trabajando: 3, trabados: 1, fallaron: 1, frenados: 0 });
  assert.deepEqual(resumen([]), { trabajando: 0, trabados: 0, fallaron: 0, frenados: 0 });
});

test("resumen del líder: el que frenó `pa --parar` cuenta aparte de los que fallaron", () => {
  const it = (h: Hilo) => ({ h, estado: estadoVisto(h) });
  const vivas = [
    hilo({ proyecto: "atlas", estado: "murio", frenado_en: AHORA - MIN }),
    hilo({ proyecto: "atlas", estado: "murio", murio_en: AHORA - MIN }),
    hilo({ proyecto: "atlas", estado: "trabajando" }),
  ].map(it);
  assert.deepEqual(resumen(vivas), { trabajando: 1, trabados: 0, fallaron: 1, frenados: 1 });
});

test("recién lanzado: sin tarea ni rama, y poco después de arrancar, es 'Arrancando…'; pasado el rato, es un worker sin datos", () => {
  const h = hilo({ proyecto: "atlas", estado: "trabajando", tarea: "", rama: null, inicio: AHORA - 5 });
  assert.ok(arrancando(h, AHORA));
  assert.ok(!arrancando({ ...h, inicio: AHORA - ARRANQUE_S - 1 }, AHORA), "pasado el rato ya no");
  assert.ok(arrancando({ ...h, inicio: AHORA - ARRANQUE_S - 1, arrancando: true }, AHORA), "el que armó la app desde el evento sigue arrancando hasta que la lista lo traiga");
  assert.ok(!arrancando({ ...h, tarea: "Ya tiene tarea" }, AHORA));
  assert.ok(!arrancando({ ...h, rama: "pa/atlas/x" }, AHORA));
  assert.ok(!arrancando({ ...h, estado: "murio" }, AHORA));
});

test("recién lanzado sin líder todavía: va suelto en su carpeta, no a 'sin líder' (huérfano)", () => {
  const nuevo = hilo({ proyecto: "atlas", estado: "trabajando", tarea: "", rama: null, inicio: AHORA - 4, ...deL("muerto") });
  const a = armarArbol([nuevo], { lideres: [], ahora: AHORA });
  assert.deepEqual(a.carpetas[0].ramas.map((r) => r.clave), ["sueltas:atlas"]);
  assert.deepEqual(ids(a.carpetas[0].ramas[0].vivas), [nuevo.id]);
  // Con su tarea ya escrita y un líder que no está, sí es huérfano.
  const hecho = armarArbol([{ ...nuevo, tarea: "Con tarea" }], { lideres: [], ahora: AHORA });
  assert.deepEqual(hecho.carpetas[0].ramas.map((r) => r.clave), ["huerfanos:atlas"]);
});

test("recién lanzado con su líder (el que trae el evento `inicio`): cuelga de él desde el primer render, sin esperar la lista", () => {
  const nuevo = hilo({ proyecto: "atlas", estado: "trabajando", tarea: "", rama: null, inicio: AHORA - 2, arrancando: true, ...deL("a") });
  const a = armarArbol([nuevo], { lideres: [lider("a")], ahora: AHORA });
  assert.deepEqual(a.carpetas[0].ramas.map((r) => r.clave), ["lider:a"]);
  assert.deepEqual(ids(a.carpetas[0].ramas[0].vivas), [nuevo.id]);
});

test("B20: carpeta del líder — la que eligió Ana > la de sus workers > la que nombra su primer mensaje > general", () => {
  const conInferido = (id: string, inferido: string | null): Lider => ({ ...lider(id, AHORA), inferido });
  // Sin workers: la del primer mensaje (el líder de omc arrancado en ~ va a omc, no al home).
  const a = armarArbol([], { lideres: [conInferido("omc", "omc"), conInferido("nada", null)], ahora: AHORA });
  assert.equal(a.lideres.get("omc")!.proyecto, "omc");
  assert.equal(a.lideres.get("nada")!.proyecto, "general");
  // Con workers, mandan ellos.
  const w = hilo({ proyecto: "hilos", estado: "trabajando", ...deL("omc") });
  assert.equal(armarArbol([w], { lideres: [conInferido("omc", "omc")], ahora: AHORA }).lideres.get("omc")!.proyecto, "hilos");
  // Mover a proyecto… gana sobre todo, y sus workers lo siguen.
  const m = armarArbol([w], { lideres: [conInferido("omc", "omc")], mover: new Map([["omc", "atlas"]]), ahora: AHORA });
  assert.equal(m.lideres.get("omc")!.proyecto, "atlas");
  assert.deepEqual(ids(m.carpetas.find((c) => c.proyecto === "atlas")!.ramas[0].vivas), [w.id]);
});

test("B20: ocultar los terminados de una carpeta pliega todo lo que no trabaja; las demás, igual", () => {
  const murio = hilo({ proyecto: "atlas", estado: "murio", ...deL("a") });
  const trabaja = hilo({ proyecto: "atlas", estado: "trabajando", ...deL("a") });
  const decide = hilo({ proyecto: "atlas", estado: "decision", origen: "app" });
  const rama = hilo({ proyecto: "brote", estado: "listo", origen: "app", rama: "pa/brote/x", commits: 2 });
  const hs = [murio, trabaja, decide, rama];
  const lideres = [{ ...lider("a", AHORA), proyecto: "atlas" }];
  const sin = armarArbol(hs, { lideres, ahora: AHORA });
  const atlas = (x: Arbol) => x.carpetas.find((c) => c.proyecto === "atlas")!;
  assert.deepEqual(ids(atlas(sin).ramas[0].vivas).sort(), [murio.id, trabaja.id].sort());
  const con = armarArbol(hs, { lideres, ocultos: new Set(["atlas"]), ahora: AHORA });
  assert.deepEqual(ids(atlas(con).ramas[0].vivas), [trabaja.id]);
  assert.deepEqual(ids(atlas(con).ramas[0].viejas), [murio.id]);
  const sueltas = atlas(con).ramas.find((r) => r.tipo === "sueltas")!;
  assert.deepEqual([ids(sueltas.vivas), ids(sueltas.viejas)], [[], [decide.id]]);
  // brote no está oculta: su rama sin integrar sigue a la vista.
  assert.deepEqual(ids(con.carpetas.find((c) => c.proyecto === "brote")!.ramas[0].vivas), [rama.id]);
});

test("buscar: sin mayúsculas ni tildes; igual > empieza > contiene", () => {
  assert.equal(normal("Líder ÁRBOL"), "lider arbol");
  const q = normal("Libro");
  assert.equal(puntaje(q, "libro"), 3);
  assert.equal(puntaje(q, "Libro-movil"), 2);
  assert.equal(puntaje(q, "app de libro"), 1);
  assert.equal(puntaje(q, "trama", null, undefined), 0);
  assert.equal(puntaje(q, "app de libro", "LIBRO"), 3, "gana lo mejor");
  assert.equal(puntaje(normal("lider"), "Nuevo líder"), 1);
});

test("buscar: la carpeta que se llama así va primero, con todo lo suyo plegado; después los hilos por su título", () => {
  // Hilos de otros proyectos que nombran la palabra en su título, más nuevos y trabajando.
  const voz = hilo({ proyecto: "asistente-voz", estado: "trabajando", tarea: "Hablarle a Libro desde el celu", inicio: AHORA - MIN });
  const trama = hilo({ proyecto: "hilos", estado: "listo", origen: "app", tarea: "Ícono de libro en la barra", inicio: AHORA - 2 * MIN });
  // La carpeta Libro: sólo cosas viejas y cerradas.
  const listo = hilo({ proyecto: "libro", estado: "listo", origen: "app", tarea: "Ordenar el panel", inicio: AHORA - 5 * 86400 });
  const integ = hilo({ proyecto: "libro", estado: "integrado", origen: "app", tarea: "Arreglar el sync", inicio: AHORA - 6 * 86400 });
  const fallo = hilo({ proyecto: "libro", estado: "murio", tarea: "Probar otra base", inicio: AHORA - 7 * 86400 });
  // Sólo la rama o el id nombran la palabra: no coincide.
  const rama = hilo({ proyecto: "brote", estado: "listo", origen: "app", tarea: "Otra cosa", rama: "pa/libro/x", jefe: "libro" });
  const todos = [voz, trama, listo, integ, fallo, rama];
  const a = armarArbol(todos, { lideres: [], busqueda: "Libro", ahora: AHORA });
  assert.deepEqual(nombres(a), ["libro", "asistente-voz", "hilos"]);
  const lo = a.carpetas[0];
  assert.deepEqual(lo.ramas.flatMap((r) => ids(r.vivas)), [], "lo inactivo no se despliega");
  assert.deepEqual(lo.ramas.flatMap((r) => ids(r.viejas)).sort(), [listo.id, integ.id, fallo.id].sort());
  assert.deepEqual(ids(a.cerrados), [], "lo cerrado queda en su carpeta, no en Cerrados");
  // Plegado de verdad: con los pliegues cerrados no hay filas de Libro.
  const filas = filasVisibles(a, (k) => !k.includes(":"), false);
  assert.deepEqual(ids(filas), [voz.id], "sólo lo que trabaja se ve sin desplegar");
  // Por el título que le puso el registry, también; y sin tildes.
  const t = armarArbol(todos, { lideres: [], busqueda: "tráma", titulos: new Map([["hilos", "trama"]]), ahora: AHORA });
  assert.deepEqual(nombres(t), ["hilos"]);
  // Igual > empieza > contiene entre carpetas.
  const c = (p: string) => hilo({ proyecto: p, estado: "trabajando", origen: "app", tarea: "x" });
  const orden = armarArbol([c("mi-atlas"), c("atlas-web"), c("atlas")], { lideres: [], busqueda: "atlas", ahora: AHORA });
  assert.deepEqual(nombres(orden), ["atlas", "atlas-web", "mi-atlas"]);
});

test("el líder que se está viendo queda a la vista: su carpeta se abre al elegirlo o al cambiar de carpeta, no en cada render", () => {
  const w = hilo({ proyecto: "atlas", estado: "trabajando", ...deL("nuevo") });
  const lideres = [lider("nuevo"), lider("dormido", AHORA - ESPERA_S - MIN)];
  // Arranca en el home; con su primer worker pasa a la carpeta del proyecto.
  const enHome = lugarLider(armarArbol([], { lideres, ahora: AHORA }), "nuevo");
  assert.deepEqual(enHome, { sid: "nuevo", proyecto: "general", espera: false, dormido: false });
  const a = armarArbol([w], { lideres, ahora: AHORA });
  const enAtlas = lugarLider(a, "nuevo");
  assert.deepEqual(enAtlas, { sid: "nuevo", proyecto: "atlas", espera: false, dormido: false });
  assert.deepEqual(aDesplegar(null, enHome), ["general"], "al elegirlo");
  assert.deepEqual(aDesplegar(enHome, enAtlas), ["atlas"], "cambió de carpeta");
  // Mismo líder en la misma carpeta: si Ana la plegó a mano, se queda plegada.
  assert.deepEqual(aDesplegar(enAtlas, lugarLider(a, "nuevo")), []);
  assert.deepEqual(aDesplegar(enAtlas, null), [], "sin líder a la vista no hay nada que abrir");
  // Otro líder de la misma carpeta es otra selección: se vuelve a abrir.
  assert.deepEqual(aDesplegar({ sid: "otro", proyecto: "atlas", espera: false, dormido: false }, enAtlas), ["atlas"]);
  // El que está entre los "N líderes en espera" necesita además ese pliegue.
  const dormido = lugarLider(a, "dormido");
  assert.deepEqual(dormido, { sid: "dormido", proyecto: "general", espera: true, dormido: false });
  assert.deepEqual(aDesplegar(enAtlas, dormido), ["general", claveEspera("general")]);
  // Cayó en espera mientras se lo miraba: el pliegue sí, la carpeta (plegada a mano o no) no se toca.
  assert.deepEqual(aDesplegar({ ...dormido!, espera: false }, dormido), [claveEspera("general")]);
  assert.deepEqual(aDesplegar(dormido, dormido), []);
  // Lo que no está en la barra (no llegó todavía, o la búsqueda no lo trae) no tiene lugar.
  assert.equal(lugarLider(a, "fantasma"), null);
  assert.equal(lugarLider(armarArbol([w], { lideres, busqueda: "zzz", ahora: AHORA }), "nuevo"), null);
  // Movido a mano a un proyecto que no estaba en la barra: la carpeta aparece con él.
  const movido = armarArbol([], { lideres, mover: new Map([["nuevo", "brote"]]), ahora: AHORA });
  assert.ok(nombres(movido).includes("brote"));
  assert.deepEqual(aDesplegar(enHome, lugarLider(movido, "nuevo")), ["brote"]);
});

test("sin líder dice de quién era: 'muertos' si la sesión del líder quedó sin proceso, 'idos' si cerró", () => {
  const muerto = hilo({ proyecto: "atlas", estado: "murio", jefe: "jefe-caido", jefe_id: "caido", inicio: AHORA - 600 });
  const otro = hilo({ proyecto: "atlas", estado: "murio", jefe: "jefe-caido", jefe_id: "caido", inicio: AHORA - 500 });
  const ido = hilo({ proyecto: "atlas", estado: "murio", jefe: "jefe-ido", jefe_id: "ido", inicio: AHORA - 400 });
  const caidos = [{ id: "caido", nombre: "jefe-caido", ts: AHORA - 300 }];
  const a = armarArbol([muerto, otro, ido], { lideres: [], caidos, ahora: AHORA });
  const h = a.carpetas[0].ramas.find((r) => r.tipo === "huerfanos")!;
  assert.deepEqual(h.muertos, ["jefe-caido"]);
  assert.deepEqual(h.idos, ["jefe-ido"]);

  const sin = armarArbol([ido], { lideres: [], caidos, ahora: AHORA }).carpetas[0].ramas[0];
  assert.deepEqual([sin.muertos, sin.idos], [[], ["jefe-ido"]]);

  // Retomado: el líder vive otra vez y sus workers vuelven a colgar de él, no de "sin líder".
  const vivo = armarArbol([muerto], { lideres: [lider("caido")], caidos, ahora: AHORA }).carpetas[0].ramas;
  assert.deepEqual(vivo.map((r) => r.tipo), ["lider"]);
});

test("líder sin proceso: sigue en la barra con sus workers colgando mientras alguno pida algo", () => {
  const murio = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 600, murio_en: AHORA - 300, ...deL("caido") });
  const listo = hilo({ proyecto: "atlas", estado: "listo", inicio: AHORA - 900, ...deL("caido") });
  const conRama = hilo({ proyecto: "brote", estado: "listo", rama: "pa/brote/x", commits: 2, ...deL("ido") });
  const nada = hilo({ proyecto: "brote", estado: "listo", ...deL("sin-nada") });
  const viejo = hilo({ proyecto: "brote", estado: "murio", inicio: AHORA - 2 * HUERFANO_S, ...deL("viejo") });
  const deVivo = hilo({ proyecto: "atlas", estado: "murio", ...deL("a") });
  const hilos = [murio, listo, conRama, nada, viejo, deVivo];
  const caidos = [{ id: "caido", nombre: "jefe-caido", ts: AHORA - 300 }];
  const sin = lideresSinProceso(hilos, { lideres: [lider("a")], caidos, ahora: AHORA });
  // "caido": lo mataron (está en `caidos`). "ido": cerró. Sin nada que pedir, viejo, o con el líder en la lista: no.
  assert.deepEqual(sin.map((l) => [l.id, l.caido, l.nombre, l.actividad]), [
    ["caido", "murio", "jefe-caido", AHORA - 300],
    ["ido", "cerro", "ana-ido", fin(conRama)],
  ]);
  assert.ok(sin.every((l) => !l.vivo && l.pid === null && !l.ocupado));
  // Lo que Ana ya sacó (optimista) no lo trae de vuelta.
  const quitados = new Map<string, Estado>([[murio.id, "archivado"], [listo.id, "archivado"]]);
  assert.deepEqual(lideresSinProceso(hilos, { lideres: [lider("a")], caidos, optimista: quitados, ahora: AHORA }).map((l) => l.id), ["ido"]);

  const a = armarArbol(hilos, { lideres: [lider("a"), ...sin], caidos, ahora: AHORA });
  const r = ramaDe(a, "caido");
  // Cuelgan de él con la regla de lo que quedó sin líder: lo que pide algo a la vista, lo demás en el "+N".
  assert.deepEqual(ids(r.vivas), [murio.id]);
  assert.deepEqual(ids(r.viejas), [listo.id]);
  assert.equal(a.carpetas.flatMap((c) => c.ramas).some((x) => x.tipo === "huerfanos" && x.vivas.some((it) => it.h.jefe_id === "caido")), false);
  // No se hace cargo: cada worker lleva su propio Integrar/Archivar, como un huérfano.
  assert.deepEqual([...a.aCargo], ["a"]);
  assert.equal(settleWorker(listo, "listo", a.aCargo), true);
  assert.equal(settleWorker(deVivo, "murio", a.aCargo), settleWorker(deVivo, "murio", new Set(["a"])));
  // Ni se pliega a "en espera" por quieto: es justo el que hay que ver.
  const quieto = { ...sin[0], actividad: AHORA - 2 * ESPERA_S };
  assert.ok(ramaDe(armarArbol([murio], { lideres: [quieto], caidos, ahora: AHORA }), "caido"));
  // Settleado (Archivar o Borrar): no vuelve hasta que haya novedad.
  const settleado = armarArbol(hilos, { lideres: [lider("a"), ...sin], settleados: new Map([["caido", AHORA]]), caidos, ahora: AHORA });
  assert.equal(settleado.lideres.has("caido"), false);
});

test("líder que cerró con workers muertos en varios proyectos: una sola carpeta, no una por proyecto", () => {
  // El caso real del 2026-10-12: un líder cerrado con corridas muertas repartidas en muchos proyectos.
  const proyectos = ["atlas", "brote", "cobre", "duna"];
  const hilos = proyectos.map((proyecto, i) => hilo({ proyecto, estado: "murio", inicio: AHORA - 600 - i, ...deL("ido") }));
  const terminado = hilo({ proyecto: "eco", estado: "listo", inicio: AHORA - 900, ...deL("ido") });
  const sin = lideresSinProceso([...hilos, terminado], { lideres: [], ahora: AHORA });
  assert.deepEqual(sin.map((l) => [l.id, l.caido]), [["ido", "cerro"]]);
  const a = armarArbol([...hilos, terminado], { lideres: sin, ahora: AHORA });
  // La carpeta de su primer worker; los demás proyectos no aparecen.
  assert.deepEqual(nombres(a), ["eco"]);
  assert.deepEqual(a.carpetas[0].ramas.map((r) => r.tipo), ["lider"]);
  assert.deepEqual(ids(ramaDe(a, "ido").vivas), ids(hilos.map((h) => ({ h, estado: h.estado }))));
  assert.deepEqual(ids(ramaDe(a, "ido").viejas), [terminado.id]);

  // Cerró normal, sin nada pendiente: ni líder ni carpeta.
  assert.deepEqual(lideresSinProceso([terminado], { lideres: [], ahora: AHORA }), []);
  assert.deepEqual(nombres(armarArbol([terminado], { lideres: [], ahora: AHORA })), []);
});

test("lo que murió cuenta desde que la app lo vio morir (`murio_en`); sin verlo, desde que arrancó", () => {
  const visto = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 3 * HUERFANO_S, murio_en: AHORA - 60 });
  const sinVer = hilo({ proyecto: "atlas", estado: "murio", inicio: AHORA - 900, duracion_s: null });
  assert.equal(fin(visto), AHORA - 60);
  assert.equal(fin(sinVer), AHORA - 900);
});

test("en cola: con su tarea y su líder cuelga de él, y no es 'Arrancando…' aunque sea recién lanzado", () => {
  const lideres = [{ ...lider("a", AHORA), proyecto: "atlas" }];
  const cola = hilo({ proyecto: "atlas", estado: "trabajando", en_cola: true, tarea: "Índice por fecha", rama: null, inicio: AHORA - 5, ...deL("a") });
  assert.ok(!arrancando(cola, AHORA));
  assert.ok(!arrancando({ ...cola, tarea: "" }, AHORA), "en cola sin tarea tampoco miente 'Arrancando…'");
  const a = armarArbol([cola], { lideres, ahora: AHORA });
  assert.deepEqual(ids(a.carpetas[0].ramas.find((r) => r.clave === "lider:a")!.vivas), [cola.id]);
  assert.equal(resumen([{ h: cola, estado: estadoVisto(cola) }]).trabajando, 1);
});

test("Dormidos: el líder sin proceso con más de un día quieto no se esconde, se pliega al final de su carpeta", () => {
  const viejo = (id: string, extra: Partial<Lider> = {}) => ({ ...lider(id, AHORA - DORMIDO_S - MIN), vivo: false, pid: null, ...extra }) as Lider;
  const lideres = [lider("vivo"), viejo("durmio"), viejo("murio", { caido: "murio" })];
  const a = armarArbol([], { lideres, ahora: AHORA });
  const c = a.carpetas.find((x) => x.proyecto === "general")!;
  assert.deepEqual(c.dormidos.map((r) => r.lider!.id).sort(), ["durmio", "murio"]);
  assert.deepEqual(c.ramas.map((r) => r.lider?.id), ["vivo"]);
  assert.deepEqual(lugarLider(a, "durmio"), { sid: "durmio", proyecto: "general", espera: false, dormido: true });
  assert.deepEqual(aDesplegar(null, lugarLider(a, "durmio")), ["general", claveDormidos("general")]);
  // Buscando no se pliega nada.
  const b = armarArbol([], { lideres, busqueda: "ana", ahora: AHORA });
  assert.equal(b.carpetas.find((x) => x.proyecto === "general")!.dormidos.length, 0);
  // Con un worker colgando, sigue a la vista.
  const w = hilo({ proyecto: "atlas", estado: "trabajando", ...deL("durmio") });
  const d = armarArbol([w], { lideres, ahora: AHORA });
  assert.equal(d.carpetas.flatMap((x) => x.dormidos).some((r) => r.lider!.id === "durmio"), false);
  // Menos de un día: sigue donde estaba.
  const reciente = armarArbol([], { lideres: [{ ...viejo("hoy"), actividad: AHORA - 3 * 3600 } as Lider], ahora: AHORA });
  assert.equal(reciente.carpetas.flatMap((x) => x.dormidos).length, 0);
});

