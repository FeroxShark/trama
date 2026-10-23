// "Te espera" en el renderer (src/espera.ts): a cuáles se avisa con la notificación y cuándo no.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esperan, porAvisar } from "../src/espera.ts";
import type { Lider } from "../src/datos/contrato.ts";

const lider = (id: string, c: Partial<Lider> = {}): Lider => ({ id, vivo: true, ocupado: false, caido: undefined, ...c }) as Lider;
const espera = (desde: number, motivo: "pide" | "listo" = "listo") => ({ motivo, desde });
const AFUERA = { avisar: true, enfocada: false, primera: false };

test("esperan: sólo los vivos con espera, no los caídos", () => {
  const ls = [lider("a", { espera: espera(1) }), lider("b"), lider("c", { espera: espera(2), vivo: false }), lider("d", { espera: espera(3), caido: "murio" })];
  assert.deepEqual(esperan(ls).map((l) => l.id), ["a"]);
});

test("avisa una vez por líder y por turno, con otro turno vuelve a avisar", () => {
  const ya = new Map<string, number>();
  assert.deepEqual(porAvisar([lider("a", { espera: espera(10) })], ya, AFUERA).map((l) => l.id), ["a"]);
  assert.deepEqual(porAvisar([lider("a", { espera: espera(10) })], ya, AFUERA), [], "la misma lectura de nuevo");
  // Ana lo vio y siguió otro turno: ya no esperaba (se olvida) y el nuevo es otro aviso.
  porAvisar([lider("a")], ya, AFUERA);
  assert.deepEqual(porAvisar([lider("a", { espera: espera(20) })], ya, AFUERA).map((l) => l.id), ["a"]);
});

test("no avisa con la ventana enfocada, con el ajuste apagado ni al abrir trama; igual lo anota", () => {
  for (const o of [{ ...AFUERA, enfocada: true }, { ...AFUERA, avisar: false }, { ...AFUERA, primera: true }]) {
    const ya = new Map<string, number>();
    assert.deepEqual(porAvisar([lider("a", { espera: espera(10) })], ya, o), []);
    assert.equal(ya.get("a"), 10);
    // Pierde el foco después: lo que ya estaba a la vista no avisa tarde.
    assert.deepEqual(porAvisar([lider("a", { espera: espera(10) })], ya, AFUERA), []);
  }
});

test("avisa a cada uno de los que esperan a la vez", () => {
  const ya = new Map<string, number>();
  const ls = [lider("a", { espera: espera(1) }), lider("b", { espera: espera(2, "pide") })];
  assert.deepEqual(porAvisar(ls, ya, AFUERA).map((l) => l.id), ["a", "b"]);
});
