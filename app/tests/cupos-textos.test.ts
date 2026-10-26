import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cambiarIdioma } from "../src/i18n/index.ts";
import { nombreGrupo, nombreGrupoCorto } from "../src/barra/cuposNombres.ts";
import { textoEstado, textoSusc } from "../src/barra/cuposTextos.ts";
import { resumenGrupo, resumenSusc } from "../src/barra/cuposVista.ts";

const AHORA = Date.parse("2026-10-26T12:00:00Z") / 1000;
const cg = { id: "claude-gpt", nombre: "Claude y GPT por Google", ventanas: [{ id: "5h", pct: 0, vuelve: null, deshabilitada: true }, { id: "7d", pct: 100, vuelve: AHORA + 3 * 86400 }] };

describe("nombres de grupo", () => {
  it("se traducen por id, nunca por el nombre en español de reparto; un id desconocido cae al nombre", () => {
    cambiarIdioma("en");
    assert.equal(nombreGrupo(cg), "Claude and GPT models");
    assert.equal(nombreGrupoCorto(cg), "Claude/GPT");
    assert.equal(nombreGrupo({ id: "gemini-4-argon", nombre: "x" }), "Gemini 4 Argon");
    assert.equal(nombreGrupo({ id: "nuevo", nombre: "Cosa nueva" }), "Cosa nueva");
    cambiarIdioma("es");
    assert.equal(nombreGrupo(cg), "Modelos Claude y GPT");
    cambiarIdioma("en");
  });
});

describe("textos de estado", () => {
  it("agotado dice hasta cuándo; marcado dice que es una marca; parcial nombra el grupo", () => {
    cambiarIdioma("en");
    assert.match(textoEstado(resumenGrupo(cg, AHORA), AHORA), /^Exhausted until /);
    assert.match(textoEstado(resumenGrupo({ ...cg, agotado: AHORA + 7200 }, AHORA), AHORA), /^Marked out of quota until /);
    const gem = { id: "gemini", nombre: "Gemini", ventanas: [{ id: "7d", pct: 5, vuelve: null }] };
    assert.match(textoSusc(resumenSusc({ grupos: [gem, cg] }, AHORA), [gem, cg], AHORA), /^Out of quota: Claude and GPT models, back /);
    assert.equal(textoSusc(resumenSusc({ grupos: [gem] }, AHORA), [gem], AHORA), "OK");
  });
});
