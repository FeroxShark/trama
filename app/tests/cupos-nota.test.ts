// La nota de una tarjeta de cupo (src/barra/cuposNota.ts): con hora de vuelta dice cuándo vuelve; sin ella, el nombre de la ventana
// (chica) o «sin hora de vuelta», nunca vacía. Los nombres de ventana se traducen: en castellano, «semana», nunca «week».
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cambiarIdioma } from "../src/i18n/index.ts";
import { formatearFalta } from "../src/barra/usoFila.ts";
import { notaDeCelda, textoVuelve, ventanaCorta } from "../src/barra/cuposNota.ts";

const AHORA = Date.parse("2026-11-01T12:00:00Z") / 1000;
const U = { d: "d", h: "h", min: "min", s: "s", ya: "ya" };

/** Corre `f` en un idioma y vuelve al de antes (los tests no se contaminan entre sí). */
function en(idioma: "es" | "en", f: () => void) {
  cambiarIdioma(idioma);
  try {
    f();
  } finally {
    cambiarIdioma("en");
  }
}

describe("nota de una tarjeta", () => {
  it("con hora de vuelta, dice cuándo vuelve (en la chica y en la grande)", () => {
    assert.deepEqual(notaDeCelda({ chica: true, hasta: AHORA + 3600, ventana: "semana" }), { tipo: "vuelve" });
    assert.deepEqual(notaDeCelda({ chica: false, hasta: AHORA + 3600, ventana: "semana" }), { tipo: "vuelve" });
  });

  it("sin hora, la chica dice el nombre de su ventana (la fuente no trae el cuándo)", () => {
    assert.deepEqual(notaDeCelda({ chica: true, hasta: 0, ventana: "semana" }), { tipo: "ventana", texto: "semana" });
  });

  it("sin hora, la grande dice «sin hora de vuelta»: su nombre ya va en el título", () => {
    assert.deepEqual(notaDeCelda({ chica: false, hasta: 0, ventana: "semana" }), { tipo: "sinHora" });
  });

  it("un grupo sin ventana (sin límite) no tiene nombre que mostrar: dice «sin hora de vuelta», nunca queda vacía", () => {
    assert.deepEqual(notaDeCelda({ chica: true, hasta: 0, ventana: "" }), { tipo: "sinHora" });
  });

  it("ninguna combinación deja la nota sin contenido", () => {
    for (const chica of [true, false])
      for (const hasta of [0, AHORA + 60])
        for (const ventana of ["", "semana"]) {
          const n = notaDeCelda({ chica, hasta, ventana });
          if (n.tipo === "ventana") assert.ok(n.texto.length > 0);
          else assert.ok(n.tipo === "vuelve" || n.tipo === "sinHora");
        }
  });
});

describe("nombre de la ventana", () => {
  it("se traduce: en castellano «semana», y «week» sólo en inglés", () => {
    en("es", () => assert.equal(ventanaCorta("7d"), "semana"));
    en("en", () => assert.equal(ventanaCorta("7d"), "week"));
  });

  it("5 h y un id desconocido (sin nombre traducido, el id tal cual)", () => {
    en("es", () => {
      assert.equal(ventanaCorta("5h"), "5 h");
      assert.equal(ventanaCorta("30d"), "30d");
    });
  });
});

describe("texto de la vuelta", () => {
  it("de más de un día: «vuelve en 1 d 17 h», igual en todas las tarjetas", () => {
    en("es", () => assert.equal(textoVuelve(AHORA + 86400 + 17 * 3600 + 30, AHORA, U).texto, "vuelve en 1 d 17 h"));
  });

  it("de horas: «vuelve en 3 h58» (el minuto va pegado a la hora)", () => {
    en("es", () => assert.equal(textoVuelve(AHORA + 3 * 3600 + 58 * 60, AHORA, U).texto, "vuelve en 3 h58"));
  });

  it("con el formato largo, en el detalle del riel: «vuelve en 3 h 58 min»", () => {
    en("es", () => assert.equal(textoVuelve(AHORA + 3 * 3600 + 58 * 60, AHORA, U, formatearFalta).texto, "vuelve en 3 h 58 min"));
  });

  it("en inglés, la misma forma con «back in»", () => {
    en("en", () => assert.equal(textoVuelve(AHORA + 3 * 3600 + 58 * 60, AHORA, U).texto, "back in 3 h58"));
  });
});
