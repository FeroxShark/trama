// src/barra/historial-logica.ts: la lista del historial de chats: conteos, filtros, búsqueda, agrupación y teclado.
import assert from "node:assert/strict";
import test from "node:test";
import type { ChatHistorial } from "../src/datos/contrato.ts";
import { agruparHistorial, contarHistorial, filtrarHistorial, sidsVisibles, vecino } from "../src/barra/historial-logica.ts";
import { OTRAS } from "../src/barra/claude-code.ts";

const c = (sid: string, titulo: string, proyecto: string | null, como: "archivado" | "cerrado", cuando: number): ChatHistorial => ({
  sid, titulo, ms: cuando, cuando, modelo: "claude-opus-5-5", cwd: `/x/${proyecto ?? "otra"}`, proyecto, existe: true, ajena: false, como,
});
const chats = [
  c("a3", "ana-a3", "atlas", "archivado", 300),
  c("b1", "ana-b1", "atlas", "cerrado", 200),
  c("e2", "cauce-e2", "cauce", "archivado", 500),
  c("z9", "Reunión sin proyecto", null, "cerrado", 900),
];
const sin = { nombre: (x: ChatHistorial) => x.titulo, carpeta: (x: ChatHistorial) => x.proyecto ?? "Otras carpetas" };

test("los conteos de los chips cuentan todo el historial", () => {
  assert.deepEqual(contarHistorial(chats), { todos: 4, archivado: 2, cerrado: 2 });
  assert.deepEqual(contarHistorial([]), { todos: 0, archivado: 0, cerrado: 0 });
});

test("filtros y búsqueda: por estado, por palabras del nombre o de la carpeta, sin tildes ni mayúsculas", () => {
  const ids = (q: string, filtro: "todos" | "archivado" | "cerrado") => filtrarHistorial(chats, { q, filtro, ...sin }).map((x) => x.sid);
  assert.deepEqual(ids("", "todos"), ["a3", "b1", "e2", "z9"]);
  assert.deepEqual(ids("", "archivado"), ["a3", "e2"]);
  assert.deepEqual(ids("", "cerrado"), ["b1", "z9"]);
  assert.deepEqual(ids("ANA", "todos"), ["a3", "b1"]);
  assert.deepEqual(ids("atlas b1", "todos"), ["b1"]);
  assert.deepEqual(ids("reunion", "todos"), ["z9"]);
  assert.deepEqual(ids("ana", "cerrado"), ["b1"]);
  assert.deepEqual(ids("nada de esto", "todos"), []);
});

test("por proyecto: la carpeta más reciente primero, «Otras carpetas» al final y lo más reciente adentro", () => {
  const g = agruparHistorial(chats, "proyecto");
  assert.deepEqual(g.map((x) => x.clave), ["cauce", "atlas", OTRAS]);
  assert.deepEqual(g[1]!.chats.map((x) => x.sid), ["a3", "b1"]);
});

test("por fecha: un solo grupo, lo más reciente primero; sin chats, ninguno", () => {
  const g = agruparHistorial(chats, "fecha");
  assert.equal(g.length, 1);
  assert.deepEqual(g[0]!.chats.map((x) => x.sid), ["z9", "e2", "a3", "b1"]);
  assert.deepEqual(agruparHistorial([], "fecha"), []);
});

test("las flechas andan sólo por lo que se ve (sin las carpetas plegadas) y no dan la vuelta", () => {
  const g = agruparHistorial(chats, "proyecto");
  const visibles = sidsVisibles(g, new Set(["atlas"]));
  assert.deepEqual(visibles, ["e2", "z9"]);
  assert.equal(vecino(visibles, null, 1), "e2");
  assert.equal(vecino(visibles, null, -1), "z9");
  assert.equal(vecino(visibles, "e2", 1), "z9");
  assert.equal(vecino(visibles, "z9", 1), "z9");
  assert.equal(vecino(visibles, "e2", -1), "e2");
  assert.equal(vecino([], "x", 1), null);
  // Por fecha no hay carpetas que plegar.
  assert.equal(sidsVisibles(agruparHistorial(chats, "fecha"), new Set(["atlas"])).length, 4);
});
