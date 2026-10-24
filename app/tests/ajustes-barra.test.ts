// La barra de Guardar de Ajustes (src/paneles/ajustes-barra.ts): suma el estado de cada bloque editable y guarda o
// cancela todos los que tienen cambios. Puro: sin React ni puente.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cancelarTodo, guardarTodo, publicar, resumen, suscribir, vaciar, type Bloque } from "../src/paneles/ajustes-barra.ts";

beforeEach(() => vaciar());

const bloque = (mas: Partial<Bloque> = {}): Bloque => ({ sucio: false, valido: true, guardando: false, ok: false, error: null, guardar: () => {}, cancelar: () => {}, ...mas });

test("sin cambios: no hay nada que guardar ni que avisar", () => {
  publicar("plan", bloque());
  publicar("celular", bloque());
  assert.deepEqual(resumen(), { sucio: false, puedeGuardar: false, guardando: false, ok: false, error: null });
});

test("un bloque con cambios que valen enciende Guardar; si no valen, la barra avisa pero no deja guardar", () => {
  publicar("plan", bloque({ sucio: true }));
  assert.equal(resumen().sucio, true);
  assert.equal(resumen().puedeGuardar, true);
  publicar("celular", bloque({ sucio: true, valido: false, error: "ajustes.errPuerto" }));
  assert.equal(resumen().puedeGuardar, false);
  assert.equal(resumen().error, "ajustes.errPuerto");
  publicar("celular", null);
  assert.equal(resumen().puedeGuardar, true);
});

test("avisa sólo cuando cambia lo que se ve, y deja de avisar al desuscribirse", () => {
  let veces = 0;
  const baja = suscribir(() => veces++);
  publicar("plan", bloque());
  assert.equal(veces, 0);
  publicar("plan", bloque({ sucio: true }));
  publicar("plan", bloque({ sucio: true, guardar: () => {} }));
  assert.equal(veces, 1);
  baja();
  publicar("plan", bloque());
  assert.equal(veces, 1);
});

test("guardar guarda de a uno cada bloque con cambios que vale, y el resto ni se toca", async () => {
  const orden: string[] = [];
  publicar("plan", bloque({ sucio: true, guardar: async () => void orden.push("plan") }));
  publicar("modelos", bloque({ sucio: true, valido: false, guardar: () => void orden.push("modelos") }));
  publicar("celular", bloque({ guardar: () => void orden.push("celular") }));
  publicar("otro", bloque({ sucio: true, guardar: () => void orden.push("otro") }));
  await guardarTodo();
  assert.deepEqual(orden, ["plan", "otro"]);
});

test("cancelar vuelve a lo guardado sólo en los bloques con cambios", () => {
  const vueltos: string[] = [];
  publicar("plan", bloque({ sucio: true, cancelar: () => void vueltos.push("plan") }));
  publicar("celular", bloque({ cancelar: () => void vueltos.push("celular") }));
  cancelarTodo();
  assert.deepEqual(vueltos, ["plan"]);
});

test("'Guardado' se ve mientras no haya cambios nuevos", () => {
  publicar("plan", bloque({ ok: true }));
  assert.equal(resumen().ok, true);
  publicar("plan", bloque({ ok: true, sucio: true }));
  assert.equal(resumen().ok, false);
  assert.equal(resumen().sucio, true);
});
