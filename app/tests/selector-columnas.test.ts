import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filtrar, mover, repartir, type Repartible } from "../src/hilo/selector-columnas.ts";

const expect = <T,>(v: T) => ({
  toEqual: (e: unknown) => assert.deepEqual(v, e),
  toHaveLength: (n: number) => assert.equal((v as unknown as unknown[]).length, n),
});

const o = (id: string, extra: Partial<Repartible> = {}): Repartible => ({ id, nombre: id, desc: "", ...extra });

describe("repartir", () => {
  it("las sin grupo van arriba y cada grupo es una columna, en el orden en que aparece", () => {
    const r = repartir([o("uno"), o("a1", { grupo: "Anthropic" }), o("g1", { grupo: "Google" }), o("a2", { grupo: "Anthropic" })]);
    expect(r.arriba.map((x) => x.id)).toEqual(["uno"]);
    expect(r.columnas.map((c) => [c.nombre, c.ops.map((x) => x.id)])).toEqual([
      ["Anthropic", ["a1", "a2"]],
      ["Google", ["g1"]],
    ]);
  });
  it("`col` junta dos grupos en una columna y `colOrden` ordena las columnas", () => {
    const r = repartir([
      o("l1", { grupo: "Qwen", col: "local", colNombre: "Local", colOrden: 3 }),
      o("g1", { grupo: "Google", colOrden: 1 }),
      o("ol", { grupo: "Ollama", col: "local", colNombre: "Local", colOrden: 3 }),
      o("a1", { grupo: "Anthropic", colOrden: 0 }),
    ]);
    expect(r.columnas.map((c) => c.nombre)).toEqual(["Anthropic", "Google", "Local"]);
    expect(r.columnas[2]!.ops.map((x) => x.id)).toEqual(["l1", "ol"]);
  });
});

describe("filtrar", () => {
  const ops = [o("pick", { nombre: "Pick one…" }), o("x", { nombre: "Opus 5.5", grupo: "Anthropic", desc: "El más capaz" }), o("y", { nombre: "Gemini 3.8 Flash", grupo: "Google" })];
  it("sin búsqueda deja todo", () => expect(filtrar(ops, "  ")).toHaveLength(3));
  it("busca sin mayúsculas ni tildes, por nombre, empresa o descripción, con todas las palabras", () => {
    expect(filtrar(ops, "OPUS").map((x) => x.id)).toEqual(["x"]);
    expect(filtrar(ops, "google flash").map((x) => x.id)).toEqual(["y"]);
    expect(filtrar(ops, "capáz").map((x) => x.id)).toEqual(["x"]);
    expect(filtrar(ops, "zzz")).toEqual([]);
  });
  it("con búsqueda no deja la fila de arriba", () => expect(filtrar(ops, "pick")).toEqual([]));
});

describe("mover", () => {
  const largos = [1, 3, 2, 0, 4]; // arriba: 1; columnas 1 a 4 (la 3 vacía)
  it("abajo y arriba recorren la columna y cruzan con la fila de arriba", () => {
    expect(mover(largos, { s: 0, i: 0 }, "ArrowDown")).toEqual({ s: 1, i: 0 });
    expect(mover(largos, { s: 1, i: 0 }, "ArrowUp")).toEqual({ s: 0, i: 0 });
    expect(mover(largos, { s: 1, i: 0 }, "ArrowDown")).toEqual({ s: 1, i: 1 });
    expect(mover(largos, { s: 1, i: 2 }, "ArrowDown")).toEqual({ s: 1, i: 2 });
    expect(mover(largos, { s: 0, i: 0 }, "ArrowUp")).toEqual({ s: 0, i: 0 });
  });
  it("sin fila de arriba, arriba de la primera se queda", () => {
    expect(mover([0, 2], { s: 1, i: 0 }, "ArrowUp")).toEqual({ s: 1, i: 0 });
    expect(mover([0, 2], { s: 0, i: 0 }, "ArrowDown")).toEqual({ s: 1, i: 0 });
  });
  it("izquierda y derecha pasan a la columna de al lado, acotando la altura y saltando las vacías", () => {
    expect(mover(largos, { s: 1, i: 2 }, "ArrowRight")).toEqual({ s: 2, i: 1 });
    expect(mover(largos, { s: 2, i: 1 }, "ArrowRight")).toEqual({ s: 4, i: 1 });
    expect(mover(largos, { s: 4, i: 3 }, "ArrowLeft")).toEqual({ s: 2, i: 1 });
    expect(mover(largos, { s: 1, i: 0 }, "ArrowLeft")).toEqual({ s: 1, i: 0 });
    expect(mover(largos, { s: 4, i: 0 }, "ArrowRight")).toEqual({ s: 4, i: 0 });
    expect(mover(largos, { s: 0, i: 0 }, "ArrowRight")).toEqual({ s: 0, i: 0 });
  });
  it("Inicio y Fin van a la primera y a la última de la columna", () => {
    expect(mover(largos, { s: 4, i: 2 }, "Home")).toEqual({ s: 4, i: 0 });
    expect(mover(largos, { s: 4, i: 1 }, "End")).toEqual({ s: 4, i: 3 });
  });
});
