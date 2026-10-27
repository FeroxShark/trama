import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chipsDe, columnas, estadoVentana, masUsado, renglonesDeGrupos, resumenGrupo, resumenSusc } from "../src/barra/cuposVista.ts";

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

const AHORA = 1_000_000;
const w = (id: string, pct: number | null, vuelve: number | null = null, deshabilitada = false) => ({ id, pct, vuelve, ...(deshabilitada ? { deshabilitada } : {}) });

describe("estadoVentana", () => {
  it("deshabilitada no es 0 %: es `off`; sin dato, `sin`; 100 lleno; desde 90 bajo", () => {
    assert.equal(estadoVentana(w("5h", 0, null, true)), "off");
    assert.equal(estadoVentana(w("5h", null)), "sin");
    assert.equal(estadoVentana(w("5h", 100)), "lleno");
    assert.equal(estadoVentana(w("5h", 90)), "bajo");
    assert.equal(estadoVentana(w("5h", 89)), "ok");
    assert.equal(estadoVentana(w("5h", 0)), "ok");
  });
});

describe("resumenGrupo", () => {
  it("el caso real de Google: Claude/GPT con la semana agotada y la 5 h que no aplica vuelve con la semana", () => {
    const g = { id: "claude-gpt", nombre: "x", ventanas: [w("5h", 0, null, true), w("7d", 100, AHORA + 300_000)] };
    assert.deepEqual(resumenGrupo(g, AHORA), { estado: "lleno", pct: 100, vuelve: AHORA + 300_000 });
  });
  it("una ventana que no rige no cuenta para el porcentaje", () => {
    const g = { id: "g", nombre: "g", ventanas: [w("5h", 99, null, true), w("7d", 5)] };
    assert.deepEqual(resumenGrupo(g, AHORA), { estado: "ok", pct: 5, vuelve: null });
  });
  it("`agotado` vigente es `marcado` (no un 100 % medido) con su hora; vencido, se ignora", () => {
    const g = { id: "g", nombre: "g", ventanas: [w("5h", 100, AHORA + 60), w("7d", 100, AHORA + 60)], agotado: AHORA + 60 };
    assert.deepEqual(resumenGrupo(g, AHORA), { estado: "marcado", pct: null, vuelve: AHORA + 60 });
    assert.equal(resumenGrupo({ ...g, agotado: AHORA - 1, ventanas: [w("7d", 10)] }, AHORA).estado, "ok");
  });
  it("lleno sin hora de vuelta no inventa una; bajo desde 90; sin ningún dato es `sin`", () => {
    assert.equal(resumenGrupo({ id: "g", nombre: "g", ventanas: [w("7d", 100)] }, AHORA).vuelve, null);
    assert.equal(resumenGrupo({ id: "g", nombre: "g", ventanas: [w("7d", 91)] }, AHORA).estado, "bajo");
    assert.equal(resumenGrupo({ id: "g", nombre: "g", ventanas: [w("7d", null)] }, AHORA).estado, "sin");
  });
});

describe("resumenSusc", () => {
  const gem = { id: "gemini", nombre: "Gemini", ventanas: [w("5h", 6), w("7d", 5)] };
  const cg = { id: "claude-gpt", nombre: "cg", ventanas: [w("5h", 0, null, true), w("7d", 100, AHORA + 900)] };
  const arg = { id: "gemini-4-argon", nombre: "a", ventanas: [w("7d", 9)] };
  it("Google real: un grupo agotado y los otros no es `parcial`, con cuáles y cuándo vuelven", () => {
    const r = resumenSusc({ grupos: [gem, cg, arg] }, AHORA);
    assert.equal(r.nivel, "parcial");
    assert.deepEqual(r.agotados, [{ id: "claude-gpt", vuelve: AHORA + 900, marcado: false }]);
    assert.equal(r.vuelve, AHORA + 900);
  });
  it("todo agotado es `lleno`; el peor de los demás manda; ventanas propias valen como un solo grupo", () => {
    assert.equal(resumenSusc({ grupos: [cg] }, AHORA).nivel, "lleno");
    assert.equal(resumenSusc({ grupos: [gem, { ...arg, ventanas: [w("7d", 95)] }] }, AHORA).nivel, "bajo");
    assert.equal(resumenSusc({ grupos: [gem, arg] }, AHORA).nivel, "ok");
    assert.equal(resumenSusc({ ventanas: [w("5h", 4), w("7d", 23)] }, AHORA).nivel, "ok");
    assert.equal(resumenSusc({ ventanas: [w("5h", 1, AHORA + 5), w("7d", 1, AHORA + 5)], agotado: AHORA + 5 }, AHORA).nivel, "lleno");
  });
  it("chipsDe: uno por grupo, con su resumen", () => {
    assert.deepEqual(chipsDe([gem, cg], AHORA).map((c) => [c.g.id, c.r.estado]), [["gemini", "ok"], ["claude-gpt", "lleno"]]);
  });
});

describe("renglonesDeGrupos: la barra dibuja lo que venga, sin suponer grupos ni ventanas", () => {
  const AH = 1_000_000;
  it("Google hoy: Gemini con 5 h y semana, Claude/GPT agotado y Argon sólo semanal, en el orden que vino", () => {
    const filas = renglonesDeGrupos(
      [g("gemini", { id: "5h", pct: 4, vuelve: AH + 3600 }, { id: "7d", pct: 10, vuelve: AH + 9e4 }), g("claude-gpt", { id: "7d", pct: 100, vuelve: AH + 5000 }), g("gemini-4-argon", { id: "7d", pct: 91, vuelve: AH + 9e4 })],
      AH,
    );
    assert.deepEqual(filas.map((f) => [f.g.id, f.r.estado, f.cols.map((c) => c?.id ?? null), f.sinLimite]), [
      ["gemini", "ok", ["5h", "7d"], false],
      ["claude-gpt", "lleno", [null, "7d"], false],
      ["gemini-4-argon", "bajo", [null, "7d"], false],
    ]);
    assert.equal(filas[1].r.vuelve, AH + 5000);
  });
  it("un grupo sin ventanas (Google le saca el tope a Argon): sin límite, no una fila vacía ni un error", () => {
    const [f] = renglonesDeGrupos([g("gemini-4-argon")], AH);
    assert.deepEqual([f.cols, f.sinLimite, f.r.estado], [[null, null], true, "sin"]);
  });
  it("un grupo sin ventanas pero marcado sin cupo (429) no es «sin límite»: está marcado", () => {
    const [f] = renglonesDeGrupos([{ ...g("x"), agotado: AH + 60 }], AH);
    assert.deepEqual([f.sinLimite, f.r.estado], [false, "marcado"]);
  });
  it("un grupo con sólo 5 h: la semana queda vacía y alineada", () => {
    const [f] = renglonesDeGrupos([g("solo-5h", { id: "5h", pct: 50, vuelve: AH + 100 })], AH);
    assert.deepEqual([f.cols.map((c) => c?.id ?? null), f.sinLimite, f.r.estado], [["5h", null], false, "ok"]);
  });
  it("un grupo nuevo que no conocemos, con ventanas de otro id: se dibuja con lo que traiga", () => {
    const filas = renglonesDeGrupos([g("grupo-nuevo-2027", { id: "30d", pct: 20, vuelve: null }), g("otro", { id: "1h", pct: 99, vuelve: null }, { id: "30d", pct: 1, vuelve: null })], AH);
    assert.deepEqual(filas.map((f) => [f.g.id, f.cols.map((c) => c?.id ?? null), f.r.estado]), [
      ["grupo-nuevo-2027", ["30d", null], "ok"],
      ["otro", ["1h", "30d"], "bajo"],
    ]);
  });
  it("sin grupos: nada", () => {
    assert.deepEqual(renglonesDeGrupos([], AH), []);
  });
});
