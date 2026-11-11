// La barra lisa de cupo (src/ui/barra-cupo-logica.ts): umbrales 80/100, sin dato y cuándo vuelve.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cambiarIdioma } from "../src/i18n/index.ts";
import { ariaBarra, nivelBarra, vistaBarra } from "../src/ui/barra-cupo-logica.ts";

// Un miércoles a las 15:00, hora local.
const AHORA = new Date(2026, 10, 11, 15, 0).getTime() / 1000;
const H = 3600;

describe("barra de cupo", () => {
  cambiarIdioma("es");

  it("neutra hasta el 80 %, ámbar desde 80 y coral sólo al 100 %", () => {
    assert.equal(nivelBarra(0), "normal");
    assert.equal(nivelBarra(79.9), "normal");
    assert.equal(nivelBarra(80), "poco");
    assert.equal(nivelBarra(99.6), "poco");
    assert.equal(nivelBarra(100), "sin");
    assert.equal(nivelBarra(130), "sin");
    assert.equal(nivelBarra(null), "normal");
  });

  it("el estado nunca va sólo en el color: poco y sin llevan su palabra", () => {
    assert.equal(vistaBarra({ pct: 20 }, AHORA).texto, "");
    assert.equal(vistaBarra({ pct: 85 }, AHORA).texto, "queda poco");
    assert.equal(vistaBarra({ pct: 100 }, AHORA).texto, "sin cupo");
  });

  it("la cifra: redondeada, un 99,6 % no se muestra como 100 % y la barra no pasa del tope", () => {
    assert.equal(vistaBarra({ pct: 84.6 }, AHORA).cifra, "85 %");
    const casi = vistaBarra({ pct: 99.6 }, AHORA);
    assert.equal(casi.cifra, "99 %");
    assert.equal(casi.nivel, "poco");
    const pasado = vistaBarra({ pct: 120 }, AHORA);
    assert.equal(pasado.relleno, 100);
    assert.equal(pasado.cifra, "120 %");
  });

  it("sin dato: barra vacía, «sin dato» y sin cuándo vuelve", () => {
    const v = vistaBarra({ pct: null, vuelve: AHORA + H }, AHORA);
    assert.deepEqual(v, { nivel: "normal", sinDato: true, pct: null, relleno: 0, cifra: "—", texto: "sin dato", vuelve: "" });
    assert.equal(ariaBarra("5 h", v), "5 h: sin dato");
  });

  it("vuelve: «a las HH:MM» si es hoy, con el día si es otro; nada con 0 % o sin hora", () => {
    assert.equal(vistaBarra({ pct: 85, vuelve: AHORA + 2 * H + 40 * 60 }, AHORA).vuelve, "vuelve a las 17:40");
    assert.match(vistaBarra({ pct: 100, vuelve: AHORA + 42 * H }, AHORA).vuelve, /^vuelve \S+ 09:00$/);
    assert.equal(vistaBarra({ pct: 0, vuelve: AHORA + H }, AHORA).vuelve, "");
    assert.equal(vistaBarra({ pct: 50, vuelve: 0 }, AHORA).vuelve, "");
    assert.equal(vistaBarra({ pct: 50, vuelve: null }, AHORA).vuelve, "");
  });

  it("el lector de pantalla oye todo junto, en los dos idiomas", () => {
    const v = vistaBarra({ pct: 85, vuelve: AHORA + 2 * H + 40 * 60 }, AHORA);
    assert.equal(ariaBarra("5 h", v), "5 h: 85 % usado, queda poco, vuelve a las 17:40");
    cambiarIdioma("en");
    const w = vistaBarra({ pct: 100, vuelve: AHORA + 2 * H }, AHORA);
    assert.equal(ariaBarra("Week", w), "Week: 100 % used, out of quota, back at 17:00");
    assert.equal(vistaBarra({ pct: null }, AHORA).texto, "no data");
    cambiarIdioma("es");
  });
});
