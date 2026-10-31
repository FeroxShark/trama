import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filtrarLista, moverResaltada, type Filtrable } from "../src/hilo/selector-lista.ts";

const expect = <T,>(v: T) => ({
  toEqual: (e: unknown) => assert.deepEqual(v, e),
  toHaveLength: (n: number) => assert.equal((v as unknown as unknown[]).length, n),
});

type Fila = Filtrable & { id: string };
const carpetas: Fila[] = [
  { id: "trama", nombre: "Trama", desc: "/srv/proyectos/trama" },
  { id: "vidrio", nombre: "Diseño de vidrio", desc: "/srv/proyectos/diseño-vidrio" },
  { id: "personal", nombre: "Carpeta personal", desc: "Fuera de un proyecto" },
  { id: "otra", nombre: "Otra carpeta…", desc: "Escribí una ruta o elegí una", fija: true },
];

describe("filtrarLista", () => {
  it("sin búsqueda deja todas, la fija incluida", () => expect(filtrarLista(carpetas, "  ")).toHaveLength(4));
  it("busca por nombre o por ruta, sin mayúsculas ni tildes", () => {
    expect(filtrarLista(carpetas, "DISENO").map((o) => o.id)).toEqual(["vidrio", "otra"]);
    expect(filtrarLista(carpetas, "srv/proyectos/trama").map((o) => o.id)).toEqual(["trama", "otra"]);
    expect(filtrarLista(carpetas, "diseño").map((o) => o.id)).toEqual(["vidrio", "otra"]);
  });
  it("cada palabra tiene que aparecer, en cualquier orden", () => {
    expect(filtrarLista(carpetas, "vidrio proyectos").map((o) => o.id)).toEqual(["vidrio", "otra"]);
    expect(filtrarLista(carpetas, "proyectos vidrio").map((o) => o.id)).toEqual(["vidrio", "otra"]);
    expect(filtrarLista(carpetas, "vidrio trama").map((o) => o.id)).toEqual(["otra"]);
  });
  it("sin coincidencias, la fija sigue", () => {
    expect(filtrarLista(carpetas, "zzz").map((o) => o.id)).toEqual(["otra"]);
  });
  it("las opciones sin fija no aparecen si no coinciden", () => {
    const sin: Fila[] = [{ id: "a", nombre: "Trama", desc: "/srv/proyectos/trama" }];
    expect(filtrarLista(sin, "zzz")).toHaveLength(0);
  });
});

describe("moverResaltada", () => {
  it("abajo y arriba recorren la lista sin pasar de los extremos", () => {
    assert.equal(moverResaltada(3, 0, "ArrowDown"), 1);
    assert.equal(moverResaltada(3, 2, "ArrowDown"), 2);
    assert.equal(moverResaltada(3, 1, "ArrowUp"), 0);
    assert.equal(moverResaltada(3, 0, "ArrowUp"), 0);
  });
  it("sin nada resaltado, abajo va a la primera", () => {
    assert.equal(moverResaltada(3, -1, "ArrowDown"), 0);
  });
  it("sin opciones no hay nada resaltado", () => {
    assert.equal(moverResaltada(0, -1, "ArrowDown"), -1);
    assert.equal(moverResaltada(0, -1, "ArrowUp"), -1);
  });
});
