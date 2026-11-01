import { test } from "node:test";
import assert from "node:assert/strict";
import { armarArbol, atencionItem, pendientes, type Item, type Rama } from "../src/barra/arbol.ts";
import { resueltosDe } from "../src/barra/atencion-vigente.ts";
import type { Estado, Hilo, Lider } from "../src/datos/contrato.ts";

const AHORA = 1_800_000_000;
const MIN = 60;

// Lo que pide atención de los workers de una rama: el primero que falla o pregunta.
const atencionRama = (r: Rama, resueltos?: ReadonlySet<string>) => [...r.vivas, ...r.viejas].map((it) => atencionItem(it, resueltos)).find(Boolean) ?? null;

// Un worker de `pa` con lo mínimo; cada test pisa lo suyo.
const hilo = (o: Partial<Hilo> & { id: string; estado: Estado }): Hilo => ({
  proyecto: "atlas",
  tarea: "tarea",
  modelo: "claude-opus-5-5",
  effort: "",
  origen: "jefe",
  jefe: "ana",
  jefe_id: "ana-s",
  sigue_de: null,
  en_cola: false,
  inicio: AHORA - 60 * MIN,
  duracion_s: 5 * MIN,
  puesto: null,
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
  ...o,
});

const it = (h: Hilo): Item => ({ h, estado: h.estado });

// Un líder de terminal, vivo, sin nada que decidir.
const lider = (id: string): Lider => ({
  id,
  nombre: id,
  proyecto: "atlas",
  titulo: "",
  actividad: AHORA,
  creado: AHORA - 3600,
  cache_ttl_s: null,
  cache_vence: null,
  origen: "terminal",
  pid: 1,
  vivo: true,
  ocupado: false,
  modelo: null,
  effort: null,
});

test("un fallo relanzado con --seguir ya no pide atención; el que sigue sin reemplazo, sí", () => {
  const viejo = hilo({ id: "f1", estado: "murio", rama: "pa/atlas/f1", inicio: AHORA - 90 * MIN, murio_en: AHORA - 80 * MIN });
  const relanzado = hilo({ id: "f2", estado: "trabajando", sigue_de: "f1", rama: "pa/atlas/f1", inicio: AHORA - 70 * MIN });
  const vigente = hilo({ id: "f3", estado: "murio", inicio: AHORA - 30 * MIN, murio_en: AHORA - 20 * MIN });
  const r = resueltosDe([viejo, relanzado, vigente].map(it), {});
  assert.ok(r.has("f1"), "el viejo, relanzado, no cuenta");
  assert.ok(!r.has("f3"), "el fallo vigente cuenta");
  assert.ok(!r.has("f2"), "el relanzado que sigue corriendo no es un fallo");
});

test("un fallo relanzado sobre la misma rama (--actualizar) también queda resuelto", () => {
  const viejo = hilo({ id: "g1", estado: "murio", rama: "pa/atlas/g1", inicio: AHORA - 90 * MIN, murio_en: AHORA - 80 * MIN });
  const nuevo = hilo({ id: "g2", estado: "listo", rama: "pa/atlas/g1", inicio: AHORA - 60 * MIN, commits: 2 });
  assert.ok(resueltosDe([viejo, nuevo].map(it), {}).has("g1"));
});

test("un fallo cuya rama ya se integró o se descartó no cuenta", () => {
  const fallo = hilo({ id: "h1", estado: "murio", rama: "pa/atlas/h1", commits: 1, inicio: AHORA - 90 * MIN, murio_en: AHORA - 80 * MIN });
  const integrada = hilo({ id: "h2", estado: "integrado", rama: "pa/atlas/h1", inicio: AHORA - 60 * MIN });
  assert.ok(resueltosDe([fallo, integrada].map(it), {}).has("h1"), "rama integrada");
  const descartada = hilo({ id: "h3", estado: "murio", rama: "pa/atlas/h3", commits: 1, inicio: AHORA - 90 * MIN, murio_en: AHORA - 80 * MIN });
  const cortada = hilo({ id: "h4", estado: "descartado", rama: "pa/atlas/h3", inicio: AHORA - 60 * MIN });
  assert.ok(resueltosDe([descartada, cortada].map(it), {}).has("h3"), "rama descartada no cuenta");
  // Sin rama no hay nada que integrar ni descartar: el fallo se queda pidiendo atención.
  const sinRama = hilo({ id: "h5", estado: "murio", inicio: AHORA - 30 * MIN, murio_en: AHORA - 20 * MIN });
  assert.ok(!resueltosDe([sinRama].map(it), {}).has("h5"));
});

test("un fallo que el usuario ya vio no cuenta; uno que lo abrió antes de que se cayera, sí", () => {
  const f = hilo({ id: "v1", estado: "murio", inicio: AHORA - 30 * MIN, murio_en: AHORA - 20 * MIN });
  assert.ok(resueltosDe([it(f)], { v1: AHORA - 10 * MIN }).has("v1"), "lo abrió después de caerse: visto");
  assert.ok(!resueltosDe([it(f)], { v1: AHORA - 40 * MIN }).has("v1"), "lo abrió antes de caerse: sigue");
});

test("una decisión contestada (la corrida que sigue) no cuenta; una sin contestar sí, aunque se haya abierto", () => {
  const pide = hilo({ id: "d1", estado: "decision", origen: "app", jefe_id: null, rama: "pa/atlas/d1", commits: 1, inicio: AHORA - 40 * MIN });
  const contestada = hilo({ id: "d2", estado: "trabajando", sigue_de: "d1", rama: "pa/atlas/d1", inicio: AHORA - 20 * MIN });
  const r = resueltosDe([pide, contestada].map(it), {});
  assert.ok(r.has("d1"));
  // Abrirla no la contesta: `visto` no vale para una decisión.
  assert.ok(!resueltosDe([it(pide)], { d1: AHORA }).has("d1"));
});

test("un fallo frenado a propósito (`pa --parar`) no entra en la cuenta", () => {
  const frenado = hilo({ id: "p1", estado: "murio", frenado_en: AHORA - 20 * MIN, murio_en: AHORA - 20 * MIN });
  assert.equal(resueltosDe([it(frenado)], {}).size, 0);
});

test("en la barra: el chip y el ícono del líder cuentan sólo lo vigente", () => {
  const viejo = hilo({ id: "b1", estado: "murio", jefe_id: "ana-s", rama: "pa/atlas/b1", inicio: AHORA - 90 * MIN, murio_en: AHORA - 80 * MIN });
  const relanzado = hilo({ id: "b2", estado: "trabajando", sigue_de: "b1", jefe_id: "ana-s", rama: "pa/atlas/b1", inicio: AHORA - 70 * MIN });
  const vigente = hilo({ id: "b3", estado: "murio", jefe_id: "bea-s", inicio: AHORA - 30 * MIN, murio_en: AHORA - 20 * MIN });
  const hilos = [viejo, relanzado, vigente];
  const a = armarArbol(hilos, { lideres: [lider("ana-s"), lider("bea-s")], ahora: AHORA });
  const ramaDe = (sid: string) => a.carpetas.flatMap((c) => c.ramas).find((r) => r.lider?.id === sid)!;

  // Sin resolver nada (lo de antes): el fallo viejo aparece.
  assert.equal(pendientes(a).fallos.length, 2);
  assert.equal(atencionRama(ramaDe("ana-s")), "fallo");

  const resueltos = resueltosDe(hilos.map(it), {});
  assert.deepEqual(pendientes(a, resueltos).fallos.map((d) => d.id), ["b3"]);
  assert.equal(atencionRama(ramaDe("ana-s"), resueltos), null, "su fallo ya no pide atención");
  assert.equal(atencionRama(ramaDe("bea-s"), resueltos), "fallo", "el fallo vigente de otro líder sigue");
});

test("sin nada que pida atención, la barra no tiene chips", () => {
  const ok = hilo({ id: "c1", estado: "listo", jefe_id: "ana-s", rama: "pa/atlas/c1", commits: 2 });
  const a = armarArbol([ok], { lideres: [lider("ana-s")], ahora: AHORA });
  const p = pendientes(a, resueltosDe([it(ok)], {}));
  assert.equal(p.fallos.length + p.esperan.length, 0);
});
