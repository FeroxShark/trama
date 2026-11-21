// Lógica del panel acoplable «Tablero»: qué items son del proyecto del chat, en qué grupo van, el orden y el contador.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { validar } from "../src/datos/tablero.ts";
import { avanceRenglones, contadorPanel, contestadoComo, esDeCarpeta, gruposDelProyecto, opcionesDe } from "../src/paneles/panel-tablero-logica.ts";

const hace = (h: number) => new Date(Date.UTC(2026, 10, 21, 12) - h * 3_600_000).toISOString();

let n = 0;
const crudo = (columna: string, proyecto: string, extra: Record<string, unknown> = {}) => ({
  id: ++n,
  columna,
  proyecto,
  titulo: `item ${n}`,
  detalle: "",
  prueba: "",
  origen: "jefe",
  clave: "",
  head: null,
  creado: hace(n),
  tocado: hace(n),
  cerrado: null,
  hasta: null,
  ...extra,
});

const pregunta = (proyecto: string, extra: Record<string, unknown> = {}) =>
  crudo("espera-dueno", proyecto, { tipo: "pregunta", titulo_simple: "¿Sí o no?", opciones: [{ id: "a", texto: "Sí" }, { id: "b", texto: "No" }], por_defecto: "b", ...extra });
const prueba = (proyecto: string, extra: Record<string, unknown> = {}) => crudo("espera-dueno", proyecto, { tipo: "prueba", prueba: "npm test", ...extra });

function tablero(cols: Record<string, unknown[]>) {
  return validar({ version: 1, vista: { columnas: cols, contadores: {} }, hecho: [], proyectos: [], pospuestosLista: [], aviso: null });
}

const SLUGS = { "Trama": "trama", "Atlas viejo": "atlas" };

describe("panel Tablero: de qué proyecto es un item", () => {
  test("el nombre del registry y el slug valen; otro proyecto no", () => {
    assert.ok(esDeCarpeta({ proyecto: "Trama" }, "trama", SLUGS));
    assert.ok(esDeCarpeta({ proyecto: "trama" }, "trama", SLUGS));
    assert.ok(esDeCarpeta({ proyecto: "Atlas viejo" }, "atlas", SLUGS));
    assert.ok(!esDeCarpeta({ proyecto: "atlas" }, "trama", SLUGS));
    assert.ok(!esDeCarpeta({ proyecto: "" }, "trama", SLUGS));
  });

  test("sin carpeta o en la general: sólo los items sin proyecto", () => {
    for (const c of [null, undefined, "", "general"]) {
      assert.ok(esDeCarpeta({ proyecto: "" }, c, SLUGS));
      assert.ok(esDeCarpeta({ proyecto: "general" }, c, SLUGS));
      assert.ok(!esDeCarpeta({ proyecto: "trama" }, c, SLUGS));
    }
  });
});

describe("panel Tablero: grupos y orden", () => {
  const t = tablero({
    "espera-dueno": [
      pregunta("trama", { creado: hace(5) }),
      pregunta("trama", { creado: hace(1) }),
      pregunta("trama", { respuesta: { texto: "", opcion: "a", opcion_texto: "Sí", fecha: hace(0) } }),
      prueba("trama", { creado: hace(3) }),
      pregunta("atlas"),
    ],
    "espera-externo": [crudo("espera-externo", "trama", { creado: hace(2) }), crudo("espera-externo", "atlas")],
    bandeja: [crudo("bandeja", "trama", { creado: hace(1) }), crudo("bandeja", "atlas")],
    sigue: [crudo("sigue", "trama", { creado: hace(9) })],
    "en-curso": [crudo("en-curso", "trama", { creado: hace(8) })],
    ideas: [crudo("ideas", "trama")],
  });

  test("las preguntas sin contestar van primero y las contestadas pasan a esperas", () => {
    const g = gruposDelProyecto(t, "trama", SLUGS);
    assert.equal(g.preguntas.length, 2);
    assert.ok(g.preguntas.every((i) => i.tipo === "pregunta" && !i.respuesta));
    assert.ok(g.esperas.some((i) => i.tipo === "prueba"));
    assert.ok(g.esperas.some((i) => i.respuesta !== null));
    assert.ok(g.esperas.some((i) => i.columna === "espera-externo"));
    assert.equal(g.esperas.length, 3);
  });

  test("lo más nuevo primero dentro de cada grupo", () => {
    const g = gruposDelProyecto(t, "trama", SLUGS);
    const fechas = g.preguntas.map((i) => Date.parse(i.creado));
    assert.deepEqual(fechas, [...fechas].sort((a, b) => b - a));
    const e = g.esperas.map((i) => Date.parse(i.creado));
    assert.deepEqual(e, [...e].sort((a, b) => b - a));
  });

  test("los pendientes van en curso, sigue y bandeja; las ideas no entran", () => {
    const g = gruposDelProyecto(t, "trama", SLUGS);
    assert.deepEqual(g.pendientes.map((i) => i.columna), ["en-curso", "sigue", "bandeja"]);
  });

  test("no mezcla proyectos y sin tablero queda vacío", () => {
    const g = gruposDelProyecto(t, "atlas", SLUGS);
    assert.equal(g.preguntas.length, 1);
    assert.equal(g.pendientes.length, 1);
    assert.deepEqual(gruposDelProyecto(null, "trama", SLUGS), { preguntas: [], esperas: [], pendientes: [] });
    const general = gruposDelProyecto(t, null, SLUGS);
    assert.equal(general.preguntas.length + general.esperas.length + general.pendientes.length, 0);
  });
});

describe("panel Tablero: contador de la pestaña", () => {
  test("cuenta preguntas sin contestar y pruebas sin hacer; no las contestadas ni lo de otro proyecto", () => {
    const t = tablero({
      "espera-dueno": [
        pregunta("trama"),
        prueba("trama"),
        pregunta("trama", { respuesta: { texto: "", opcion: "a", opcion_texto: "Sí", fecha: hace(0) } }),
        pregunta("atlas"),
      ],
      "espera-externo": [crudo("espera-externo", "trama")],
      bandeja: [crudo("bandeja", "trama")],
    });
    assert.equal(contadorPanel(t, "trama", SLUGS), 2);
    assert.equal(contadorPanel(t, "atlas", SLUGS), 1);
    assert.equal(contadorPanel(t, null, SLUGS), 0);
    assert.equal(contadorPanel(null, "trama", SLUGS), 0);
  });

  test("una prueba con todos los renglones tildados ya no espera", () => {
    const t = tablero({
      "espera-dueno": [prueba("trama", { renglones: [{ texto: "a", hecho: true, clave: "" }, { texto: "b", hecho: true, clave: "" }] }), prueba("trama", { renglones: [{ texto: "a", hecho: true, clave: "" }, { texto: "b", hecho: false, clave: "" }] })],
    });
    assert.equal(contadorPanel(t, "trama", SLUGS), 1);
  });
});

describe("panel Tablero: lo que se ve de un item", () => {
  test("opciones con la sugerida marcada; una sugerida que no existe no marca ninguna", () => {
    const t = tablero({ "espera-dueno": [pregunta("trama"), pregunta("trama", { por_defecto: "z" }), pregunta("trama", { opciones: [] })] });
    const [a, b, c] = t.columnas["espera-dueno"];
    assert.deepEqual(opcionesDe(a).map((o) => o.sugerida), [false, true]);
    assert.deepEqual(opcionesDe(b).map((o) => o.sugerida), [false, false]);
    assert.deepEqual(opcionesDe(c), []);
  });

  test("avance de renglones y respuesta en una línea", () => {
    const t = tablero({
      "espera-dueno": [
        prueba("trama", { renglones: [{ texto: "a", hecho: true, clave: "" }, { texto: "b", hecho: false, clave: "" }, { texto: "c", hecho: false, clave: "" }] }),
        pregunta("trama", { respuesta: { texto: "", opcion: "a", opcion_texto: "Sí", fecha: hace(0) } }),
        pregunta("trama"),
      ],
    });
    const [p, q, sin] = t.columnas["espera-dueno"];
    assert.deepEqual(avanceRenglones(p), { hechos: 1, total: 3 });
    assert.equal(avanceRenglones(q), null);
    assert.equal(contestadoComo(q), "Sí");
    assert.equal(contestadoComo(sin), "");
  });
});
