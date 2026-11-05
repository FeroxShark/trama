// «Limpiar chats» (src/barra/limpiar-logica.ts): qué líderes entran en la lista del diálogo. Lógica pura aparte del componente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarArbol } from "../src/barra/arbol.ts";
import { aArchivar, candidatosLimpiar, DIAS_DEFECTO, DIAS_LIMPIAR, entradasLimpiar, type EntradaLimpiar } from "../src/barra/limpiar-logica.ts";
import type { Hilo, Lider } from "../src/datos/contrato.ts";

const AHORA = 2_000_000_000;
const DIA = 86400;
let n = 0;

const lider = (id: string, haceDias: number, p: Partial<Lider> = {}): Lider => ({
  id,
  nombre: `chat-${id}`,
  proyecto: "general",
  titulo: "Opus 5.5",
  actividad: AHORA - haceDias * DIA,
  creado: AHORA - 40 * DIA,
  cache_ttl_s: 3600,
  cache_vence: null,
  origen: "app",
  pid: null,
  vivo: false,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: "high",
  ...p,
});
const entrada = (l: Lider, p: Partial<EntradaLimpiar> = {}): EntradaLimpiar => ({ lider: l, proyecto: "atlas", conWorkers: false, ...p });
const sin = new Set<string>();
const sids = (xs: { sid: string }[]) => xs.map((x) => x.sid);

test("los plazos elegibles son 1, 3, 7 y 30 días, y el de fábrica es 3", () => {
  assert.deepEqual([...DIAS_LIMPIAR], [1, 3, 7, 30]);
  assert.equal(DIAS_DEFECTO, 3);
});

test("entra el que lleva más del plazo sin actividad; el justo en el borde y el más reciente, no", () => {
  const es = [entrada(lider("viejo", 5)), entrada(lider("borde", 3)), entrada(lider("hoy", 0.2))];
  assert.deepEqual(sids(candidatosLimpiar(es, { dias: 3, ahora: AHORA, conCola: sin })), ["viejo"]);
  assert.deepEqual(sids(candidatosLimpiar(es, { dias: 1, ahora: AHORA, conCola: sin })), ["viejo", "borde"]);
  assert.deepEqual(sids(candidatosLimpiar(es, { dias: 30, ahora: AHORA, conCola: sin })), []);
});

test("quedan afuera los que responden, piden un permiso, tienen workers, subagentes o cola", () => {
  const es = [
    entrada(lider("ocupado", 9, { ocupado: true, vivo: true, pid: 1 })),
    entrada(lider("pide", 9, { pide: true, vivo: true, pid: 1 })),
    entrada(lider("workers", 9), { conWorkers: true }),
    entrada(lider("subs", 9, { subagentes: 2, vivo: true, pid: 1 })),
    entrada(lider("cola", 9)),
    entrada(lider("libre", 9)),
  ];
  assert.deepEqual(sids(candidatosLimpiar(es, { dias: 3, ahora: AHORA, conCola: new Set(["cola"]) })), ["libre"]);
});

test("los Murió y los Cerrado entran, con su estado; uno quieto con proceso también; uno de terminal abierto en otro lado, no", () => {
  const es = [
    entrada(lider("murio", 8, { caido: "murio" })),
    entrada(lider("cerro", 9, { caido: "cerro", origen: "terminal" })),
    entrada(lider("sinproc", 10)),
    entrada(lider("quieto", 11, { vivo: true, pid: 77 })),
    entrada(lider("terminal", 12, { origen: "terminal", vivo: true, pid: 78 })),
  ];
  const r = candidatosLimpiar(es, { dias: 7, ahora: AHORA, conCola: sin });
  // Los más viejos primero.
  assert.deepEqual(sids(r), ["quieto", "sinproc", "cerro", "murio"]);
  assert.deepEqual(r.map((x) => x.estado), ["quieto", "cerrado", "cerrado", "murio"]);
});

test("desde el menú de una carpeta, sólo los de esa carpeta", () => {
  const es = [entrada(lider("a", 9), { proyecto: "atlas" }), entrada(lider("b", 9), { proyecto: "brote" })];
  assert.deepEqual(sids(candidatosLimpiar(es, { dias: 3, ahora: AHORA, conCola: sin, proyecto: "brote" })), ["b"]);
  assert.deepEqual(sids(candidatosLimpiar(es, { dias: 3, ahora: AHORA, conCola: sin })).sort(), ["a", "b"]);
});

test("un líder repetido (en Activas y en su carpeta) cuenta una vez", () => {
  const l = lider("x", 9);
  assert.deepEqual(sids(candidatosLimpiar([entrada(l), entrada(l)], { dias: 3, ahora: AHORA, conCola: sin })), ["x"]);
});

test("aArchivar: todos marcados menos los destildados", () => {
  const c = candidatosLimpiar([entrada(lider("a", 9)), entrada(lider("b", 10)), entrada(lider("c", 11))], { dias: 3, ahora: AHORA, conCola: sin });
  assert.deepEqual(aArchivar(c, new Set()), ["c", "b", "a"]);
  assert.deepEqual(aArchivar(c, new Set(["b"])), ["c", "a"]);
  assert.deepEqual(aArchivar(c, new Set(["a", "b", "c"])), []);
});

test("sobre el árbol de la barra: un worker vivo saca a su líder; la carpeta sale del árbol, no del líder", () => {
  const w = (jefe_id: string, estado: Hilo["estado"]): Hilo =>
    ({
      id: `20261003-100000-${20000 + n++}`,
      tarea: "x",
      modelo: "claude-opus-5-5",
      effort: "medium",
      origen: "jefe",
      jefe: null,
      jefe_id,
      sigue_de: null,
      en_cola: false,
      inicio: AHORA - 20 * DIA,
      duracion_s: estado === "trabajando" ? null : 300,
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
      proyecto: "atlas",
      estado,
    }) as Hilo;
  const a = armarArbol([w("con", "trabajando"), w("sin", "listo")], { lideres: [lider("con", 9), lider("sin", 9)], ahora: AHORA });
  const es = entradasLimpiar(a);
  assert.equal(es.find((e) => e.lider.id === "con")!.conWorkers, true);
  assert.equal(es.find((e) => e.lider.id === "sin")!.conWorkers, false);
  assert.ok(es.every((e) => e.proyecto === "atlas"), "con la carpeta que le tocó");
  assert.deepEqual(sids(candidatosLimpiar(es, { dias: 3, ahora: AHORA, conCola: sin })), ["sin"]);
});
