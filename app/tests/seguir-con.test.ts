// «Seguir con otro modelo» (#1791, parte 3), la lógica de la interfaz (src/hilo/seguir-con.ts): cuándo se ofrece (el menú de un hilo y los
// avisos de límite) y cómo se ordena y se marca la lista de modelos que abre.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvisoVisto } from "../src/hilo/avisos.ts";
import type { EstadoCupo } from "../src/hilo/cupo-modelos.ts";
import { filasSeguir, listaSeguir, moverSeguir, ofreceSeguir, resaltadaInicial, seguibleLider, seguibleWorker, type OpcionSeguir } from "../src/hilo/seguir-con.ts";

const op = (id: string, grupo: string, extra: Partial<OpcionSeguir> = {}): OpcionSeguir => ({ id, nombre: id.toUpperCase(), desc: `modelo ${id}`, grupo, ...extra });
const OPCIONES = [op("a1", "Anthropic"), op("a2", "Anthropic"), op("a3", "Anthropic"), op("g1", "Google"), op("g2", "Google"), op("o1", "OpenCode", { col: "oc", colNombre: "OpenCode · gratis" })];
const sin: EstadoCupo = { sin: true, vuelve: 1_900_000_000, poco: false, libre: 0 };
const poco: EstadoCupo = { sin: false, vuelve: null, poco: true, libre: 9 };
const cupos = (o: Record<string, EstadoCupo>) => new Map(Object.entries(o));

test("se ofrece en un worker que ya terminó, murió o espera una decisión; no en uno que corre ni en lo que pa ya cerró", () => {
  for (const e of ["listo", "decision", "murio"] as const) assert.equal(seguibleWorker(e), true, e);
  for (const e of ["trabajando", "colgado", "entregado", "archivado", "integrado", "descartado", "revertido"] as const) assert.equal(seguibleWorker(e), false, e);
});

test("se ofrece en un líder que no está respondiendo", () => {
  assert.equal(seguibleLider({ ocupado: false }), true);
  assert.equal(seguibleLider({ ocupado: true }), false);
});

test("avisos: el límite rechazado, el 429 y el «sin cupo» de OpenCode ofrecen seguir; el resto no", () => {
  const limite = (rechazado: boolean) => ({ clase: "limite", ventana: "five_hour", uso: 1, hasta: 1_900_000_000, rechazado }) as AvisoVisto;
  assert.equal(ofreceSeguir(limite(true)), true);
  assert.equal(ofreceSeguir(limite(false)), false, "cerca del límite todavía no corta");
  assert.equal(ofreceSeguir({ clase: "error", texto: "rate limit", codigo: "rate_limit" } as AvisoVisto), true);
  assert.equal(ofreceSeguir({ clase: "error", texto: "\u0001i18n:main.opencodeSinCupo\u0001", codigo: null } as AvisoVisto), true);
  assert.equal(ofreceSeguir({ clase: "error", texto: "algo raro", codigo: null } as AvisoVisto), false);
  assert.equal(ofreceSeguir({ clase: "reintento", intento: 1, max: 10, espera_ms: 1000, estado: 529, error: null } as AvisoVisto), false);
  assert.equal(ofreceSeguir({ clase: "compacto", auto: true, antes: 1 } as AvisoVisto), false);
});

test("la lista va por proveedor, con lo que tiene cupo primero y lo sin cupo al final de su proveedor", () => {
  const g = listaSeguir(OPCIONES, cupos({ a1: sin, a2: poco }), null, "");
  assert.deepEqual(g.map((x) => x.nombre), ["Anthropic", "Google", "OpenCode · gratis"]);
  // a1 está sin cupo: baja detrás de a2 (con poco cupo) y a3 (sin dato); lo demás conserva su orden.
  assert.deepEqual(g[0].filas.map((f) => f.opcion.id), ["a2", "a3", "a1"]);
  assert.equal(g[0].filas[0].cupo?.poco, true);
  assert.equal(g[0].filas[2].cupo?.sin, true);
});

test("el proveedor donde todo está sin cupo (o sólo queda el actual) va después de los que tienen algo", () => {
  const g = listaSeguir(OPCIONES, cupos({ a1: sin, a2: sin, a3: sin }), null, "");
  assert.deepEqual(g.map((x) => x.clave), ["Google", "oc", "Anthropic"]);
  const soloActual = listaSeguir([op("a1", "Anthropic"), op("g1", "Google")], cupos({}), "a1", "");
  assert.deepEqual(soloActual.map((x) => x.clave), ["Google", "Anthropic"]);
});

test("el modelo actual se ve marcado y los deshabilitados no aparecen", () => {
  const g = listaSeguir([...OPCIONES, op("x1", "Anthropic", { deshabilitada: true })], cupos({}), "a2", "");
  const filas = filasSeguir(g);
  assert.deepEqual(filas.filter((f) => f.actual).map((f) => f.opcion.id), ["a2"]);
  assert.ok(!filas.some((f) => f.opcion.id === "x1"));
});

test("la búsqueda filtra por nombre o descripción, sin mayúsculas ni tildes, y deja sin secciones vacías", () => {
  assert.deepEqual(filasSeguir(listaSeguir(OPCIONES, cupos({}), null, "G1")).map((f) => f.opcion.id), ["g1"]);
  assert.deepEqual(filasSeguir(listaSeguir(OPCIONES, cupos({}), null, "modelo a")).map((f) => f.opcion.id), ["a1", "a2", "a3"]);
  const g = listaSeguir(OPCIONES, cupos({}), null, "o1");
  assert.deepEqual(g.map((x) => x.clave), ["oc"]);
  assert.deepEqual(listaSeguir(OPCIONES, cupos({}), null, "zzz"), []);
});

test("resaltada al abrir: la primera con cupo que se puede elegir; si no hay, la primera elegible; si no, ninguna", () => {
  const f = (g: ReturnType<typeof listaSeguir>) => filasSeguir(g);
  assert.equal(resaltadaInicial(f(listaSeguir(OPCIONES, cupos({ a1: sin }), "a2", ""))), 1, "a3: a2 (el actual) está primero y a1, sin cupo, va al fondo");
  assert.equal(resaltadaInicial(f(listaSeguir([op("a1", "A"), op("a2", "A")], cupos({ a1: sin, a2: sin }), "a2", ""))), 0, "sólo queda a1, sin cupo");
  assert.equal(resaltadaInicial(f(listaSeguir([op("a1", "A")], cupos({}), "a1", ""))), -1);
  assert.equal(resaltadaInicial([]), -1);
});

test("las flechas saltan el modelo actual y no pasan de los extremos", () => {
  const filas = filasSeguir(listaSeguir([op("a1", "A"), op("a2", "A"), op("a3", "A")], cupos({}), "a2", ""));
  assert.equal(moverSeguir(filas, 0, "ArrowDown"), 2, "a2 es el actual: se salta");
  assert.equal(moverSeguir(filas, 2, "ArrowUp"), 0);
  assert.equal(moverSeguir(filas, 2, "ArrowDown"), 2);
  assert.equal(moverSeguir(filas, 0, "ArrowUp"), 0);
  assert.equal(moverSeguir(filas, -1, "ArrowDown"), 0);
});
