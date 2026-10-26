import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { columnas, masUsado } from "../src/barra/cuposVista.ts";

const v = (id: string, pct: number | null) => ({ id, pct, vuelve: null });
const g = (id: string, ...ventanas: ReturnType<typeof v>[]) => ({ id, nombre: id, ventanas });

describe("columnas", () => {
  it("5 h a la izquierda y semana a la derecha, sin importar el orden", () => {
    assert.deepEqual(columnas([v("7d", 2), v("5h", 1)]), [v("5h", 1), v("7d", 2)]);
  });
  it("un grupo sin 5 h deja esa columna vacía", () => {
    assert.deepEqual(columnas([v("7d", 2)]), [null, v("7d", 2)]);
  });
  it("una ventana de un proveedor nuevo ocupa el lugar que queda", () => {
    assert.deepEqual(columnas([v("1d", 3), v("30d", 4)]), [v("1d", 3), v("30d", 4)]);
    assert.deepEqual(columnas([v("5h", 1), v("30d", 4)]), [v("5h", 1), v("30d", 4)]);
  });
});

describe("masUsado", () => {
  it("elige el grupo con la ventana más llena", () => {
    const grupos = [g("a", v("5h", 14), v("7d", 9)), g("b", v("5h", 0), v("7d", 99)), g("c", v("7d", 100))];
    assert.equal(masUsado(grupos).id, "c");
  });
  it("sin dato en ninguno, el primero; un null no le gana a un 0", () => {
    assert.equal(masUsado([g("a", v("7d", null)), g("b", v("7d", null))]).id, "a");
    assert.equal(masUsado([g("a", v("7d", null)), g("b", v("7d", 0))]).id, "b");
  });
});
