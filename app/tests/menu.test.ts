// El menú del clic derecho (B20): qué acciones se ven según la fila y su estado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accionesCarpeta, accionesLider, accionesWorker, type Opcion } from "../src/barra/menu-logica.ts";
import type { Estado } from "../src/datos/contrato.ts";

const as = (xs: Opcion[]) => xs.map((x) => (x.confirmar ? `${x.a}?` : x.a));
const sinRama = { rama: null, commits: 0 };
const conRama = { rama: "pa/atlas/x", commits: 3 };

test("worker: según su estado", () => {
  const tabla: [Estado, typeof sinRama | typeof conRama, boolean, string[]][] = [
    ["trabajando", conRama, false, ["renombrar", "parar", "copiar"]],
    ["colgado", sinRama, false, ["renombrar", "parar", "copiar"]],
    // Terminado, caído o esperando una decisión: se puede seguir con otro modelo (#1791). Corriendo o ya cerrado por `pa`, no.
    ["listo", sinRama, true, ["renombrar", "settle", "seguir", "copiar", "borrar"]],
    ["listo", conRama, true, ["renombrar", "settle", "seguir", "copiar", "borrar", "descartar?"]],
    // Bajo un líder vivo no tiene Settle propio, pero se puede borrar igual.
    ["listo", conRama, false, ["renombrar", "seguir", "copiar", "borrar", "descartar?"]],
    ["murio", sinRama, true, ["renombrar", "settle", "seguir", "copiar", "borrar"]],
    ["decision", { rama: "pa/x", commits: 0 }, true, ["renombrar", "settle", "seguir", "copiar", "borrar"]],
    // Lo que `pa` ya cerró: sólo nombre e id.
    ["integrado", conRama, false, ["renombrar", "copiar"]],
    ["archivado", sinRama, false, ["renombrar", "copiar"]],
  ];
  for (const [estado, h, settle, quiero] of tabla) assert.deepEqual(as(accionesWorker(h, estado, settle)), quiero, `${estado} ${h.rama} ${settle}`);
  assert.ok(accionesWorker(conRama, "listo", true).find((o) => o.a === "descartar")!.peligro);
});

test("líder: los de la app se paran y se borran; los de la terminal no se tocan", () => {
  assert.deepEqual(as(accionesLider({ origen: "app", ocupado: true }, null)), ["renombrar", "mover", "parar", "copiar", "borrar?"]);
  assert.deepEqual(as(accionesLider({ origen: "app", ocupado: false }, 0)), ["renombrar", "mover", "settle?", "seguir", "copiar", "borrar?"]);
  assert.deepEqual(as(accionesLider({ origen: "app", ocupado: false }, 2)), ["renombrar", "mover", "settle?", "seguir", "copiar", "borrar?"]);
  assert.deepEqual(as(accionesLider({ origen: "terminal", ocupado: true }, null)), ["renombrar", "mover", "copiar"]);
  assert.deepEqual(as(accionesLider({ origen: "terminal", ocupado: false }, 0)), ["renombrar", "mover", "settle", "seguir", "copiar"]);
});

test("carpeta: nueva tarea aquí y ocultar/mostrar terminados", () => {
  assert.deepEqual(as(accionesCarpeta(false)), ["nueva", "ocultar", "limpiar"]);
  assert.deepEqual(as(accionesCarpeta(true)), ["nueva", "mostrar", "limpiar"]);
});

test("orden a mano: Subir y Bajar sólo si hay adónde, Orden por defecto sólo si hay algo puesto; los workers no", () => {
  const todo = { sube: true, baja: true, defecto: true };
  const l = { origen: "app", ocupado: false } as const;
  assert.deepEqual(as(accionesLider(l, 0, todo)), ["renombrar", "mover", "subir", "bajar", "defecto", "prioridad", "settle?", "seguir", "copiar", "borrar?"]);
  assert.deepEqual(as(accionesLider(l, 0, { sube: false, baja: true, defecto: false })), ["renombrar", "mover", "bajar", "prioridad", "settle?", "seguir", "copiar", "borrar?"]);
  assert.deepEqual(as(accionesLider(l, 0, { sube: false, baja: false, defecto: false })), [...as(accionesLider(l, 0)).slice(0, 2), "prioridad", ...as(accionesLider(l, 0)).slice(2)]);
  assert.deepEqual(as(accionesCarpeta(false, { sube: true, baja: false, defecto: true })), ["nueva", "ocultar", "limpiar", "subir", "defecto", "prioridad"]);
  // Con "Activas" prendido el orden a mano sigue (arrastrar, Subir y Bajar): la opción de prioridad no lo esconde.
  const prendido = { sube: true, baja: true, defecto: true, prioridad: true };
  assert.deepEqual(as(accionesLider(l, 0, prendido)), as(accionesLider(l, 0, todo)));
  assert.deepEqual(as(accionesCarpeta(false, prendido)), ["nueva", "ocultar", "limpiar", "subir", "bajar", "defecto", "prioridad"]);
  assert.deepEqual(as(accionesCarpeta(true)), ["nueva", "mostrar", "limpiar"]);
});

test("carpeta con logo: cambiar siempre, y volver al automático sólo si ya tiene uno elegido", () => {
  assert.deepEqual(as(accionesCarpeta(false, undefined, { propio: false })), ["nueva", "ocultar", "renombrar", "logo"]);
  assert.deepEqual(as(accionesCarpeta(false, undefined, { propio: true })), ["nueva", "ocultar", "renombrar", "logo", "logoQuitar"]);
});
