// Varias cuentas por proveedor, la vista (src/datos/cuentas.ts): cómo se llama cada fila de la barra de cupos y en qué orden.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deProveedor, etiquetaCuenta, filasDeCupos, listaValida, parteCuenta, resultadoValido, sinRepetir } from "../src/datos/cuentas.ts";
import type { SuscripcionCupo } from "../src/datos/contrato.ts";

const sus = (id: string, nombre: string, extra: Partial<SuscripcionCupo> = {}): SuscripcionCupo => ({ id, nombre, ts: 0, ventanas: [{ id: "5h", pct: 10, vuelve: null }], ...extra });

describe("filasDeCupos", () => {
  it("con una cuenta por proveedor queda todo como estaba", () => {
    const r = filasDeCupos([sus("google", "Google AI Pro")], "Claude", "principal");
    assert.equal(r.claude, null);
    assert.deepEqual(r.filas.map((f) => [f.nombre, f.corto, f.primera, f.cuenta]), [["Google AI Pro", "Google AI Pro", true, false]]);
  });

  it("con dos de Claude: la de siempre es «principal» y la otra lleva su nombre; el tooltip trae las dos partes", () => {
    const r = filasDeCupos([sus("trabajo", "Trabajo", { proveedor: "claude", cuenta: "trabajo" })], "Claude", "principal");
    assert.equal(r.claude, "Claude · principal");
    // La fila de Claude sigue diciendo "Claude" (no «principal» suelto): la de siempre sin renombrar es la del proveedor.
    assert.equal(r.claudeCorto, null);
    assert.deepEqual(r.filas.map((f) => [f.nombre, f.corto, f.primera, f.cuenta]), [["Claude · Trabajo", "Trabajo", false, true]]);
  });

  it("si la de siempre se renombró, va con su nombre", () => {
    const r = filasDeCupos([sus("trabajo", "Trabajo", { proveedor: "claude", cuenta: "trabajo" })], "Personal", "principal");
    assert.equal(r.claude, "Claude · Personal");
    assert.equal(r.claudeCorto, "Personal");
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
    // La de siempre es la fila de Google (su nombre, sin «principal» suelto); «Casa» cuelga de ella.
    assert.deepEqual(r.filas.map((f) => [f.corto, f.cuenta]), [["Trabajo", true], ["Google", false], ["Casa", true]]);
  });
});

// Lo que de verdad llega a la barra: `reparto --cupos` (claude se queda afuera: lo arma la cabecera) más la fila de OpenCode que arma Trama.
const delReparto = [
  sus("google", "Google AI Pro", { proveedor: "google", cuenta: "google", grupos: [{ id: "gemini", nombre: "Gemini", ventanas: [{ id: "5h", pct: 4, vuelve: null }] }], ventanas: undefined }),
  // El renglón vacío que `reparto` trae de OpenCode («proveedor sin lectura de cupo»): sin datos.
  sus("opencode", "OpenCode", { proveedor: "opencode", cuenta: "opencode", ventanas: [{ id: "5h", pct: null, vuelve: null }, { id: "7d", pct: null, vuelve: null }] }),
];
const deTrama = (id: string, nombre: string, pedidos = 0) =>
  sus(id, nombre, { proveedor: "opencode", cuenta: id, ventanas: undefined, grupos: [{ id: "opencode-free", nombre: "OpenCode gratis", ventanas: [{ id: "5h", pct: null, vuelve: null, pedidos }] }] });

describe("filas de la barra con 1 y con 2 cuentas por proveedor", () => {
  it("1 cuenta por proveedor: una fila por proveedor, ninguna subfila de cuenta ni «principal», OpenCode una sola vez", () => {
    const r = filasDeCupos([...delReparto, deTrama("opencode", "OpenCode")], "Claude", "principal");
    assert.equal(r.claude, null);
    assert.equal(r.claudeCorto, null);
    assert.deepEqual(r.filas.map((f) => [f.proveedor, f.corto, f.cuenta]), [["google", "Google AI Pro", false], ["opencode", "OpenCode", false]]);
    assert.ok(!r.filas.some((f) => f.corto === "principal" || f.nombre.includes("principal")));
    // La que queda de OpenCode es la que trae los pedidos, no el renglón vacío de reparto (sin importar el orden en que lleguen).
    assert.equal(r.filas[1].s.grupos?.[0].ventanas[0].pedidos, 0);
    const al_reves = filasDeCupos([deTrama("opencode", "OpenCode", 7), ...delReparto], "Claude", "principal");
    assert.deepEqual(al_reves.filas.map((f) => f.proveedor), ["opencode", "google"]);
    assert.equal(al_reves.filas[0].s.grupos?.[0].ventanas[0].pedidos, 7);
  });

  it("2 cuentas de OpenCode: la fila «OpenCode» y, debajo, la agregada con su nombre; ninguna repetida ni vacía", () => {
    const r = filasDeCupos([...delReparto, deTrama("opencode", "OpenCode", 3), deTrama("trabajo", "Trabajo", 5)], "Claude", "principal");
    const oc = r.filas.filter((f) => f.proveedor === "opencode");
    assert.deepEqual(oc.map((f) => [f.corto, f.nombre, f.cuenta, f.primera]), [["OpenCode", "OpenCode · principal", false, true], ["Trabajo", "OpenCode · Trabajo", true, false]]);
    assert.deepEqual(oc.map((f) => f.s.grupos?.[0].ventanas[0].pedidos), [3, 5]);
    assert.equal(r.filas.filter((f) => f.proveedor === "google").length, 1);
  });

  it("2 cuentas por proveedor a la vez: cada agregada cuelga de su proveedor, juntas y en orden", () => {
    const r = filasDeCupos(
      [...delReparto, sus("g2", "Casa", { proveedor: "google", cuenta: "g2" }), deTrama("opencode", "OpenCode"), deTrama("trabajo", "Trabajo"), sus("c2", "Otra", { proveedor: "claude", cuenta: "c2" })],
      "Claude",
      "principal",
    );
    assert.deepEqual(r.filas.map((f) => [f.proveedor, f.corto, f.cuenta]), [["claude", "Otra", true], ["google", "Google", false], ["google", "Casa", true], ["opencode", "OpenCode", false], ["opencode", "Trabajo", true]]);
    assert.equal(r.claudeCorto, null);
  });

  it("sinRepetir deja pasar lo que es de otra cuenta y junta lo que es de la misma", () => {
    assert.equal(sinRepetir([sus("a", "A", { proveedor: "google" }), sus("b", "B", { proveedor: "google" })]).length, 2);
    assert.equal(sinRepetir([sus("a", "A", { proveedor: "google", cuenta: "a" }), sus("a", "A2", { proveedor: "google", cuenta: "a" })]).length, 1);
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
