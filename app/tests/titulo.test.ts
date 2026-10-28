// La franja de la ventana de Windows sin barra de título (src/titulo.ts): los símbolos de los botones nativos son el
// texto del tema pintado y el alto es 4 rem a la letra actual; sólo con la carcasa (window.carcasa.tituloTema).
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { sincronizarTitulo } from "../src/titulo.ts";

const g = globalThis as Record<string, unknown>;

function montar(carcasa: unknown, texto1: string, fontSize = "16px") {
  const attrs = new Map<string, string>();
  g.window = carcasa === undefined ? {} : { carcasa };
  g.document = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } };
  g.getComputedStyle = () => ({ fontSize, getPropertyValue: (n: string) => (n === "--texto-1" ? texto1 : "") });
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

test("con la carcasa, marca la página y le pasa el texto del tema y el alto de la franja", () => {
  let pedido: { simbolo: string; alto: number } | null = null;
  const attrs = montar({ tituloTema: async (t: { simbolo: string; alto: number }) => (pedido = t) }, " #0e1118 ");
  sincronizarTitulo();
  assert.equal(attrs.get("data-titulo-nativo"), "");
  assert.deepEqual(pedido, { simbolo: "#0e1118", alto: 64 });
});

test("la franja sigue a la letra: 4 rem en px a la letra actual", () => {
  let alto = 0;
  montar({ tituloTema: async (t: { alto: number }) => (alto = t.alto) }, "#f4f5f7", "22.1538px");
  sincronizarTitulo();
  assert.equal(alto, 89);
});

test("una carcasa sin tituloTema (versión vieja) no marca nada", () => {
  const attrs = montar({ cuentas: async () => ({}) }, "#f4f5f7");
  sincronizarTitulo();
  assert.equal(attrs.size, 0);
});
