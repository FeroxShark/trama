// Tests de los ayudantes puros de Acople (src/barra/acople-logica.ts) y sus textos i18n.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cambiarIdioma, t } from "../src/i18n/index.ts";
import {
  CLAVE_ACOPLE,
  acopleDeFabrica,
  alternarPlegado,
  barraInsercion,
  cajasSoltar,
  cerrar,
  divisorPanelInerte,
  leerAcople,
  mover,
  panelesEnZona,
  redimensionar,
  renglonesMenuPanel,
  renglonesMenuPaneles,
  repartir,
  restablecerPartes,
  restablecerZona,
  zonaTodoPlegado,
  type GeoDestino,
  type Rect,
} from "../src/barra/acople-logica.ts";

describe("renglonesMenuPanel y renglonesMenuPaneles", () => {
  test("renglonesMenuPanel deshabilita sólo la zona donde está el panel", () => {
    const base = acopleDeFabrica();
    assert.deepEqual(renglonesMenuPanel(base, "chats"), [
      { zona: "izq", deshabilitada: true },
      { zona: "der", deshabilitada: false },
      { zona: "abajo", deshabilitada: false },
    ]);
    assert.deepEqual(renglonesMenuPanel(base, "contexto"), [
      { zona: "izq", deshabilitada: false },
      { zona: "der", deshabilitada: true },
      { zona: "abajo", deshabilitada: false },
    ]);

    const movido = mover(base, "cupo", "abajo");
    assert.deepEqual(renglonesMenuPanel(movido, "cupo"), [
      { zona: "izq", deshabilitada: false },
      { zona: "der", deshabilitada: false },
      { zona: "abajo", deshabilitada: true },
    ]);
  });

  test("renglonesMenuPanel habilita las tres zonas si el panel está cerrado", () => {
    const cerrado = cerrar(acopleDeFabrica(), "chats");
    assert.deepEqual(renglonesMenuPanel(cerrado, "chats"), [
      { zona: "izq", deshabilitada: false },
      { zona: "der", deshabilitada: false },
      { zona: "abajo", deshabilitada: false },
    ]);
  });

  test("renglonesMenuPaneles respeta vivos, deduplica y marca abierto y zona", () => {
    let a = acopleDeFabrica();
    a = cerrar(a, "contexto");
    a = mover(a, "cupo", "abajo");
    assert.deepEqual(renglonesMenuPaneles(a, ["chats", "contexto", "chats"]), [
      { panel: "chats", abierto: true, zona: "izq" },
      { panel: "contexto", abierto: false, zona: null },
    ]);
    assert.deepEqual(renglonesMenuPaneles(a, ["cupo"]), [
      { panel: "cupo", abierto: true, zona: "abajo" },
    ]);
  });
});

describe("visibilidad y estado de plegado por zona", () => {
  test("panelesEnZona filtra por vivos conservando el orden", () => {
    const a = mover(acopleDeFabrica(), "chats", "der", 0);
    assert.deepEqual(panelesEnZona(a, "der", ["chats", "cupo"]), ["chats", "cupo"]);
    assert.deepEqual(panelesEnZona(a, "izq", ["chats", "cupo"]), []);
  });

  test("zonaTodoPlegado considera sólo paneles en vivos", () => {
    const base = acopleDeFabrica();
    assert.equal(zonaTodoPlegado(base, "der", ["chats", "contexto", "cupo"]), false);
    assert.equal(zonaTodoPlegado(base, "der", ["chats", "cupo"]), true);
    assert.equal(zonaTodoPlegado(base, "abajo", ["chats", "contexto", "cupo"]), false);

    const abajoPlegado = mover(base, "cupo", "abajo");
    assert.equal(zonaTodoPlegado(abajoPlegado, "abajo", ["chats", "contexto", "cupo"]), true);
    const abajoAbierto = alternarPlegado(abajoPlegado, "cupo");
    assert.equal(zonaTodoPlegado(abajoAbierto, "abajo", ["chats", "contexto", "cupo"]), false);
  });

  test("divisorPanelInerte queda inerte si cualquiera de los dos está plegado", () => {
    const base = acopleDeFabrica();
    assert.equal(divisorPanelInerte(base, "contexto", "cupo"), true);
    const desplegado = alternarPlegado(base, "cupo");
    assert.equal(divisorPanelInerte(desplegado, "contexto", "cupo"), false);
  });
});

describe("restablecerZona y restablecerPartes", () => {
  test("restablecerZona vuelve una sola zona al tamaño de fábrica sin mutar", () => {
    let a = redimensionar(acopleDeFabrica(), "izq", 480);
    a = redimensionar(a, "der", 260);
    a = redimensionar(a, "abajo", 420);

    const rIzq = restablecerZona(a, "izq");
    assert.equal(rIzq.tam.izq, 320);
    assert.equal(rIzq.tam.der, 260);
    assert.equal(rIzq.tam.abajo, 420);
    assert.equal(a.tam.izq, 480);

    assert.equal(restablecerZona(a, "der").tam.der, 400);
    assert.equal(restablecerZona(a, "abajo").tam.abajo, 340);
  });

  test("restablecerPartes limpia sólo las proporciones de la zona pedida", () => {
    let a = alternarPlegado(acopleDeFabrica(), "cupo");
    a = repartir(a, "der", "contexto", 80, 600);
    assert.ok(a.partes.contexto !== undefined && a.partes.cupo !== undefined);

    const limpio = restablecerPartes(a, "der");
    assert.equal(limpio.partes.contexto, undefined);
    assert.equal(limpio.partes.cupo, undefined);
    assert.ok(a.partes.contexto !== undefined);
  });
});

describe("leerAcople", () => {
  test("lee y normaliza CLAVE_ACOPLE cuando existe", () => {
    const guardado = mover(acopleDeFabrica(), "chats", "abajo");
    const mapa = new Map<string, string>([
      [CLAVE_ACOPLE, JSON.stringify(guardado)],
      ["hilos:barra:ancho", "450"],
      ["hilos:barra:abierta", "0"],
    ]);
    const leido = leerAcople((k) => mapa.get(k) ?? null);
    assert.deepEqual(leido.zonas, guardado.zonas);
  });

  test("vuelve al acomodo de fábrica si CLAVE_ACOPLE tiene JSON roto", () => {
    const mapa = new Map<string, string>([[CLAVE_ACOPLE, "{roto"]]);
    assert.deepEqual(leerAcople((k) => mapa.get(k) ?? null), acopleDeFabrica());
  });

  test("migra desde hilos:barra:ancho y hilos:barra:abierta si falta CLAVE_ACOPLE", () => {
    const mapa = new Map<string, string>([
      ["hilos:barra:ancho", "390"],
      ["hilos:barra:abierta", "0"],
    ]);
    const migrado = leerAcople((k) => mapa.get(k) ?? null);
    assert.equal(migrado.tam.izq, 390);
    assert.deepEqual(migrado.zonas.izq, []);
    assert.equal(migrado.cerrados.chats, "izq");

    const vacio = leerAcople(() => null);
    assert.deepEqual(vacio, acopleDeFabrica());
  });
});

describe("cajasSoltar y barraInsercion", () => {
  const ventana: Rect = { left: 100, top: 50, right: 1300, bottom: 850 };

  test("cajasSoltar usa zonas ocupadas y franja de 96 px para las vacías", () => {
    const geo: GeoDestino = {
      ventana,
      zonas: {
        izq: { left: 100, top: 50, right: 420, bottom: 850 },
        der: null,
        abajo: null,
      },
      paneles: { izq: [], der: [], abajo: [] },
    };
    const cajas = cajasSoltar(geo);
    assert.deepEqual(cajas.izq, { left: 0, top: 0, width: 320, height: 800 });
    assert.deepEqual(cajas.der, { left: 1200 - 96, top: 0, width: 96, height: 800 });
    assert.deepEqual(cajas.abajo, { left: 320, top: 800 - 96, width: 1200 - 320, height: 96 });
  });

  test("barraInsercion dibuja barra horizontal en der y vertical en abajo", () => {
    const geo: GeoDestino = {
      ventana,
      zonas: {
        izq: null,
        der: { left: 900, top: 50, right: 1300, bottom: 850 },
        abajo: { left: 100, top: 600, right: 900, bottom: 850 },
      },
      paneles: {
        izq: [],
        der: [
          { left: 900, top: 50, right: 1300, bottom: 440 },
          { left: 900, top: 448, right: 1300, bottom: 850 },
        ],
        abajo: [{ left: 100, top: 600, right: 500, bottom: 850 }],
      },
    };

    assert.equal(barraInsercion(geo, { zona: "izq", indice: 0 }), null);
    assert.deepEqual(barraInsercion(geo, { zona: "der", indice: 0 }), {
      left: 800,
      top: -5,
      width: 400,
      height: 3,
    });
    assert.deepEqual(barraInsercion(geo, { zona: "der", indice: 2 }), {
      left: 800,
      top: 802,
      width: 400,
      height: 3,
    });
    assert.deepEqual(barraInsercion(geo, { zona: "abajo", indice: 1 }), {
      left: 402,
      top: 550,
      width: 3,
      height: 250,
    });
  });
});

describe("textos i18n de acople", () => {
  test("resuelve rótulos de menú y soltar en es y en", () => {
    cambiarIdioma("es");
    assert.equal(t("acople.moverIzq"), "Mover a la izquierda");
    assert.equal(t("acople.yaEstaAca"), "ya está acá");
    assert.equal(t("acople.soltarAbajo"), "Soltar abajo");
    cambiarIdioma("en");
    assert.equal(t("acople.moverIzq"), "Move to the left");
    assert.equal(t("acople.yaEstaAca"), "already here");
    assert.equal(t("acople.soltarAbajo"), "Drop at the bottom");
    cambiarIdioma("es");
  });
});
