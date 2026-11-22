// El modo debate en la ventana, la lógica sin React (src/hilo/debate-logica.ts): cuándo sigue vivo, qué botones tiene cada fase, quién habla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accionesDebate, aporte, claveMotivo, columnasDebate, debateVivo, duracionDebate, minutosQueFaltan, peorCasoLlamadas, quienHabla, rondasDebate, rondaVista, renglones, resumenDebate, textoVivoLegible } from "../src/hilo/debate-logica.ts";
import type { EstadoDebate, FaseDebate, LineaDebate } from "../electron/debate-texto.ts";

const FASES: FaseDebate[] = ["corriendo", "esperando", "concluyendo", "entregando", "hecho", "cancelado", "fallo"];

test("debateVivo: corre hasta que termina, se cancela o falla", () => {
  assert.deepEqual(FASES.map((fase) => debateVivo({ fase })), [true, true, true, true, false, false, false]);
  assert.equal(debateVivo(null), false);
});

test("botones por fase: cortar sólo mientras debaten, cancelar hasta que empieza la entrega, «Ver la tarjeta» sólo al terminar bien", () => {
  const a = (f: FaseDebate) => accionesDebate(f);
  assert.deepEqual(a("corriendo"), { cortar: true, cancelar: true, ver: false, cerrar: false });
  assert.deepEqual(a("esperando"), { cortar: true, cancelar: true, ver: false, cerrar: false });
  assert.deepEqual(a("concluyendo"), { cortar: false, cancelar: true, ver: false, cerrar: false });
  assert.deepEqual(a("entregando"), { cortar: false, cancelar: false, ver: false, cerrar: false });
  assert.deepEqual(a("hecho"), { cortar: false, cancelar: false, ver: true, cerrar: true });
  assert.deepEqual(a("cancelado"), { cortar: false, cancelar: false, ver: false, cerrar: true });
  assert.deepEqual(a("fallo"), { cortar: false, cancelar: false, ver: false, cerrar: true });
});

test("quienHabla: el primero que sigue y todavía no habló en la ronda; nadie al concluir", () => {
  const ps = [
    { modelo: "a", nombre: "A", effort: "", turnos: 1, activo: true },
    { modelo: "b", nombre: "B", effort: "", turnos: 0, activo: false },
    { modelo: "c", nombre: "C", effort: "", turnos: 0, activo: true },
  ];
  assert.equal(quienHabla({ fase: "corriendo", ronda: 1, participantes: ps })?.modelo, "c");
  assert.equal(quienHabla({ fase: "corriendo", ronda: 2, participantes: ps })?.modelo, "a");
  assert.equal(quienHabla({ fase: "concluyendo", ronda: 1, participantes: ps }), null);
  assert.equal(quienHabla({ fase: "corriendo", ronda: 0, participantes: ps }), null);
});

test("tiempo, costo y plazo de la pregunta", () => {
  assert.equal(duracionDebate({ inicio: 1000, fin: null }, 4000), 3000);
  assert.equal(duracionDebate({ inicio: 1000, fin: 2000 }, 9999), 1000);
  assert.equal(peorCasoLlamadas(3, 3), 10);
  assert.equal(peorCasoLlamadas(2, 2), 5);
  assert.equal(peorCasoLlamadas(2, 9), 7, "las rondas topean en 3");
  assert.equal(minutosQueFaltan(10 * 60_000, 0), 10);
  assert.equal(minutosQueFaltan(60_000, 59_999), 1);
  assert.equal(minutosQueFaltan(0, 5000), 1);
  assert.equal(claveMotivo("cortado"), "debate.motivo.cortado");
  assert.equal(claveMotivo(null), "debate.motivo.tope");
});

const lin = (n: number, x: Partial<LineaDebate>): LineaDebate => ({ n, tipo: "turno", modelo: "a", nombre: "A", ronda: 1, postura: null, argumento: "", plan: null, pregunta: null, error: null, ...x });
const part = (modelo: string, nombre: string, extra: object = {}) => ({ modelo, nombre, effort: "", turnos: 0, activo: true, ...extra });
const base = (x: Partial<EstadoDebate>): Pick<EstadoDebate, "fase" | "motivo" | "ronda" | "participantes" | "lineas"> => ({ fase: "corriendo", motivo: null, ronda: 2, participantes: [part("a", "Fable 5.2"), part("b", "Gemini 4")], lineas: [], ...x });

test("textoVivoLegible: sin encabezados; a medias no se filtra «## Postura»", () => {
  assert.equal(textoVivoLegible(""), "");
  assert.equal(textoVivoLegible("## Postura\nacuerdo"), "");
  assert.equal(textoVivoLegible("## Postura\ncambio\n\n## Argumento\nChoca con la ruta"), "Choca con la ruta");
  assert.equal(textoVivoLegible("Pensando en voz alta"), "Pensando en voz alta");
});

test("rondas: los chips llegan hasta la ronda en curso; se mira la última por defecto", () => {
  assert.deepEqual(rondasDebate({ ronda: 0, lineas: [] }), [1]);
  assert.deepEqual(rondasDebate({ ronda: 2, lineas: [] }), [1, 2]);
  assert.equal(rondaVista({ ronda: 3, lineas: [] }), 3);
});

test("columnas: postura del turno dicho, escribiendo con lo leído, espera, salió y sin turno en una ronda ya pasada", () => {
  const e = base({
    participantes: [part("a", "Fable 5.2"), part("b", "Gemini 4", { vivo: { texto: "## Postura\ncambio\n## Argumento\nCoincido", pasos: [{ k: "leer", v: "x.md" }, { k: "otro", v: "Skill" }, { k: "leer", v: "y.md" }] } }), part("c", "Otro", { activo: false })],
    lineas: [lin(1, { modelo: "a", ronda: 1, postura: "acuerdo", argumento: "Va." }), lin(2, { modelo: "a", ronda: 2, postura: "cambio", argumento: "Mover la visita.", plan: "1. Mover", pasos: [{ k: "leer", v: "plan.md" }] })],
  });
  const r2 = columnasDebate(e, 2);
  assert.deepEqual(r2.map((c) => c.estado), ["cambio", "escribiendo", "salio"]);
  assert.equal(r2[0]!.texto, "Mover la visita.");
  assert.equal(r2[0]!.plan, "1. Mover");
  assert.deepEqual(r2[0]!.leyo, [{ k: "leer", v: "plan.md" }]);
  assert.equal(r2[1]!.texto, "Coincido");
  assert.deepEqual(r2[1]!.leyo.map((x) => x.v), ["y.md", "x.md"], "el más nuevo primero");
  assert.deepEqual(r2[1]!.uso, ["Skill"]);
  assert.equal(r2[1]!.leyendo?.v, "y.md");
  assert.equal(r2[0]!.inicial, "F");
  const r1 = columnasDebate(e, 1);
  assert.deepEqual(r1.map((c) => c.estado), ["acuerdo", "sinTurno", "salio"]);
  const espera = columnasDebate(base({ participantes: [part("a", "A"), part("b", "B")] }), 2);
  assert.deepEqual(espera.map((c) => c.estado), ["espera", "espera"]);
});

test("columnas: quien escribe la conclusión se ve «escribiendo» aunque ya haya dicho su turno de esa ronda (B032)", () => {
  const e = base({
    fase: "concluyendo",
    ronda: 2,
    participantes: [part("a", "A", { vivo: { texto: "", pasos: [] } }), part("b", "B")],
    lineas: [lin(1, { modelo: "a", ronda: 2, postura: "acuerdo", argumento: "Va." }), lin(2, { modelo: "b", ronda: 2, postura: "acuerdo", argumento: "Va." })],
  });
  assert.deepEqual(columnasDebate(e, 2).map((c) => c.estado), ["escribiendo", "acuerdo"]);
  assert.deepEqual(columnasDebate({ ...e, lineas: [lin(1, { modelo: "a", ronda: 1, postura: "acuerdo", argumento: "Va." })] }, 1).map((c) => c.estado)[0], "acuerdo", "en una ronda ya pasada se ve lo que dijo");
});

test("renglones y aporte: viñetas, párrafo o nada", () => {
  assert.deepEqual(renglones("- Uno\n- Dos\nsuelto"), ["Uno", "Dos"]);
  assert.deepEqual(renglones("1. Uno\n2) Dos"), ["Uno", "Dos"]);
  assert.deepEqual(renglones("Todo bien\ny sin viñetas"), ["Todo bien y sin viñetas"]);
  assert.deepEqual(renglones("Ninguno"), []);
  assert.deepEqual(renglones("- Ninguno."), []);
  assert.deepEqual(renglones(undefined), []);
  assert.equal(aporte("Detectó el choque. Y propuso otra cosa."), "Detectó el choque.");
  assert.equal(aporte("x".repeat(300), 20).length, 20);
});

test("resumen: acordado, quién dijo qué y sin acuerdo; sólo con conclusión de un debate (no cancelado, fallo ni simple)", () => {
  const lineas = [
    lin(1, { modelo: "a", postura: "cambio", argumento: "Choca con la ruta. Propongo mover." }),
    lin(2, { modelo: "b", postura: "acuerdo", argumento: "Coincido." }),
    lin(3, { tipo: "conclusion", modelo: "a", argumento: "- La visita pasa a las 13\n- Se ajusta cada 3 meses", plan: "1. Mover", desacuerdos: "- Quién firma" }),
  ];
  const r = resumenDebate(base({ fase: "hecho", motivo: "tope", lineas }))!;
  assert.deepEqual(r.acordado, ["La visita pasa a las 13", "Se ajusta cada 3 meses"]);
  assert.deepEqual(r.sinAcuerdo, ["Quién firma"]);
  assert.deepEqual(r.quien.map((q) => [q.nombre, q.dijo]), [["Fable 5.2", "Choca con la ruta."], ["Gemini 4", "Coincido."]]);
  assert.equal(r.rondas, 2);
  assert.equal(resumenDebate(base({ fase: "hecho", motivo: "simple", lineas })), null);
  assert.equal(resumenDebate(base({ fase: "cancelado", lineas })), null);
  assert.equal(resumenDebate(base({ fase: "hecho", motivo: "tope", lineas: lineas.slice(0, 2) })), null);
});
