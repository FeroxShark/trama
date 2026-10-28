// La franja de la ventana de Windows sin barra de título (src/titulo.ts): los símbolos de los botones nativos son el
// texto del tema pintado; sólo con la carcasa de Windows (window.carcasa.plataforma "win32" y tituloTema).
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { sincronizarTitulo } from "../src/titulo.ts";

const g = globalThis as Record<string, unknown>;

function montar(carcasa: unknown, texto1: string) {
  const attrs = new Map<string, string>();
  g.window = carcasa === undefined ? {} : { carcasa };
  g.document = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } };
  g.getComputedStyle = () => ({ getPropertyValue: (n: string) => (n === "--texto-1" ? texto1 : "") });
  return attrs;
}

afterEach(() => {
  delete g.window;
  delete g.document;
  delete g.getComputedStyle;
});

test("sin la carcasa de Windows no toca la página", () => {
  const attrs = montar(undefined, "#f4f5f7");
  assert.doesNotThrow(() => sincronizarTitulo());
  assert.equal(attrs.size, 0);
});

test("con la carcasa de Windows, marca la página y le pasa el texto del tema", () => {
  let pedido: { simbolo: string } | null = null;
  const attrs = montar({ plataforma: "win32", tituloTema: async (t: { simbolo: string }) => (pedido = t) }, " #0e1118 ");
  sincronizarTitulo();
  assert.equal(attrs.get("data-titulo-nativo"), "");
  assert.deepEqual(pedido, { simbolo: "#0e1118" });
});

test("fuera de Windows (la carcasa dice otra plataforma) no marca nada", () => {
  for (const plataforma of ["linux", "darwin"]) {
    let llamada = false;
    const attrs = montar({ plataforma, tituloTema: async () => (llamada = true) }, "#f4f5f7");
    sincronizarTitulo();
    assert.equal(attrs.size, 0);
    assert.equal(llamada, false);
  }
});

test("una carcasa sin tituloTema (versión vieja) no marca nada", () => {
  const attrs = montar({ plataforma: "win32", cuentas: async () => ({}) }, "#f4f5f7");
  sincronizarTitulo();
  assert.equal(attrs.size, 0);
});
