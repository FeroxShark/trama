// "Te espera" en la pantalla de la PC (electron/espera-aviso.ts, electron/bandeja.ts): lo que se acepta del renderer,
// el punto del ícono de la bandeja, el tooltip y la notificación (de mentira en las pruebas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { anunciar, avisoValido, conPunto, estadoValido } from "../electron/espera-aviso.ts";
import { armarBandeja } from "../electron/bandeja.ts";

test("estado de la bandeja: un entero 0–999 y su texto; lo raro se descarta", () => {
  assert.deepEqual(estadoValido({ n: 2, texto: "2 líderes te esperan" }), { n: 2, texto: "2 líderes te esperan" });
  assert.deepEqual(estadoValido({ n: 0, texto: "" }), { n: 0, texto: "" });
  for (const x of [null, {}, { n: -1, texto: "" }, { n: 1.5, texto: "" }, { n: 1000, texto: "" }, { n: "2", texto: "" }, { n: 1 }]) assert.equal(estadoValido(x), null);
  assert.equal(estadoValido({ n: 1, texto: "x".repeat(500) })!.texto.length, 120);
});

test("aviso: un líder y un título; lo demás se acota", () => {
  assert.deepEqual(avisoValido({ sid: "s1", titulo: "ana-t1 te espera", cuerpo: "Terminó" }), { sid: "s1", titulo: "ana-t1 te espera", cuerpo: "Terminó" });
  for (const x of [null, {}, { sid: "", titulo: "a", cuerpo: "" }, { sid: "s", titulo: " ", cuerpo: "" }, { sid: "s", titulo: "a" }, { sid: 1, titulo: "a", cuerpo: "" }]) assert.equal(avisoValido(x), null);
  assert.equal(avisoValido({ sid: "s", titulo: "a".repeat(999), cuerpo: "b".repeat(999) })!.cuerpo.length, 200);
});

test("el punto: pinta la esquina de arriba a la derecha y deja el resto; no toca el original", () => {
  const w = 24;
  const base = new Uint8Array(w * w * 4).fill(10);
  const sal = conPunto(base, w, w, [251, 191, 36]);
  assert.equal(base[0], 10, "el original queda");
  const px = (x: number, y: number) => [...sal.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
  // Centro del punto (BGRA): ámbar opaco.
  const r = Math.round(w * 0.22);
  assert.deepEqual(px(w - r - 1, r + 1), [36, 191, 251, 255]);
  assert.deepEqual(px(0, w - 1), [10, 10, 10, 10], "la esquina de abajo a la izquierda no cambia");
});

test("la bandeja: con alguien esperando cambia el tooltip y el ícono; sin nadie, vuelven", () => {
  const llamadas: string[] = [];
  const b = armarBandeja({
    crear: () => ({ setToolTip: (t) => llamadas.push(`tip:${t}`), setContextMenu: () => {}, on: () => {}, destroy: () => {}, setImage: (i) => llamadas.push(`img:${String(i)}`) }),
    menu: (x) => x,
    abrir: () => {},
    cerrarDelTodo: () => {},
    imagenes: { normal: "normal", espera: "espera" },
  });
  b.espera({ n: 2, texto: "2 líderes te esperan" });
  b.espera({ n: 0, texto: "" });
  assert.deepEqual(llamadas, ["tip:trama", "tip:2 líderes te esperan", "img:espera", "tip:trama", "img:normal"]);
});

test("la notificación: HILOS_NOTIFICAR la anota en el archivo y no muestra nada; en pruebas sin archivo, tampoco", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "espera-"));
  try {
    const a = { sid: "s1", titulo: "t", cuerpo: "c" };
    const mostradas: unknown[] = [];
    const archivo = path.join(dir, "avisos.jsonl");
    anunciar(a, (x) => mostradas.push(x), { HILOS_NOTIFICAR: archivo });
    assert.deepEqual(JSON.parse(readFileSync(archivo, "utf8")), a);
    anunciar(a, (x) => mostradas.push(x), { HILOS_PRUEBA: "1" });
    anunciar(a, (x) => mostradas.push(x), { HILOS_CAPTURA: "lider" });
    assert.deepEqual(mostradas, []);
    anunciar(a, (x) => mostradas.push(x), {});
    assert.deepEqual(mostradas, [a]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
