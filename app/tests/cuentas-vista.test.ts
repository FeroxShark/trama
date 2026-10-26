// Varias cuentas por proveedor, la vista (src/datos/cuentas.ts): cómo se llama cada fila de la barra de cupos y en qué orden.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deProveedor, etiquetaCuenta, filasDeCupos, listaValida, parteCuenta, resultadoValido } from "../src/datos/cuentas.ts";
import type { SuscripcionCupo } from "../src/datos/contrato.ts";

const sus = (id: string, nombre: string, extra: Partial<SuscripcionCupo> = {}): SuscripcionCupo => ({ id, nombre, ts: 0, ventanas: [{ id: "5h", pct: 10, vuelve: null }], ...extra });

describe("filasDeCupos", () => {
  it("con una cuenta por proveedor queda todo como estaba", () => {
    const r = filasDeCupos([sus("google", "Google AI Pro")], "Claude", "principal");
    assert.equal(r.claude, null);
    assert.deepEqual(r.filas.map((f) => [f.nombre, f.corto, f.primera]), [["Google AI Pro", "Google AI Pro", true]]);
  });

  it("con dos de Claude: la de siempre es «principal» y la otra lleva su nombre; el tooltip trae las dos partes", () => {
    const r = filasDeCupos([sus("trabajo", "Trabajo", { proveedor: "claude", cuenta: "trabajo" })], "Claude", "principal");
    assert.equal(r.claude, "Claude · principal");
    assert.equal(r.claudeCorto, "principal");
    assert.deepEqual(r.filas.map((f) => [f.nombre, f.corto, f.primera]), [["Claude · Trabajo", "Trabajo", false]]);
  });

  it("si la de siempre se renombró, va con su nombre", () => {
    const r = filasDeCupos([sus("trabajo", "Trabajo", { proveedor: "claude", cuenta: "trabajo" })], "Personal", "principal");
    assert.equal(r.claude, "Claude · Personal");
  });

  it("las cuentas de un proveedor van juntas, la de siempre primero, y Claude arriba de todo", () => {
    const r = filasDeCupos(
      [
        sus("g2", "Casa", { proveedor: "google", cuenta: "g2" }),
        sus("google", "Google AI Pro", { proveedor: "google", cuenta: "google" }),
        sus("trabajo", "Trabajo", { proveedor: "claude", cuenta: "trabajo" }),
      ],
      "Claude",
      "principal",
    );
    assert.deepEqual(r.filas.map((f) => f.nombre), ["Claude · Trabajo", "Google · principal", "Google · Casa"]);
    assert.deepEqual(r.filas.map((f) => f.primera), [false, true, false]);
  });
});

describe("etiquetas y listas", () => {
  it("etiquetaCuenta y parteCuenta", () => {
    assert.equal(etiquetaCuenta("claude", "trabajo", false, "principal"), "Claude · trabajo");
    assert.equal(etiquetaCuenta("chatgpt", "ChatGPT", true, "principal"), "ChatGPT · principal");
    assert.equal(parteCuenta("claude", "Claude", true, "principal"), "principal");
  });

  it("listaValida descarta lo raro y la de siempre va primera", () => {
    const l = listaValida({ version: 1, cuentas: [{ id: "t", proveedor: "claude", nombre: "T", logueado: false }, { id: "claude", proveedor: "claude" }, { id: "x", proveedor: "otro" }, 3] });
    assert.deepEqual(l?.cuentas.map((c) => [c.id, c.nombre, c.defecto, c.logueado]), [["t", "T", false, false], ["claude", "claude", true, null]]);
    assert.deepEqual(deProveedor(l, "claude").map((c) => c.id), ["claude", "t"]);
    assert.equal(listaValida({ version: 2, cuentas: [] }), null);
    assert.equal(listaValida(null), null);
  });

  it("resultadoValido", () => {
    assert.deepEqual(resultadoValido({ ok: true, id: "a" }), { ok: true, id: "a" });
    assert.deepEqual(resultadoValido({ ok: true }), { ok: true });
    assert.deepEqual(resultadoValido({ ok: false }), { ok: false, error: "main.cuentasFallo" });
  });
});
