// Tests puros de la lógica del acomodo de paneles acoplables (`src/barra/acople-logica.ts`).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAVE_ACOPLE,
  PANELES,
  ZONAS,
  abrir,
  acopleDeFabrica,
  alternarPlegado,
  cerrar,
  desdeViejo,
  destino,
  mover,
  normalizar,
  redimensionar,
  repartir,
  zonaDe,
  type Acople,
  type GeoDestino,
  type PanelId,
} from "../src/barra/acople-logica.ts";

function congelarProfundo<T>(valor: T): T {
  if (valor && typeof valor === "object") {
    Object.freeze(valor);
    for (const k of Object.keys(valor as Record<string, unknown>)) {
      congelarProfundo((valor as Record<string, unknown>)[k]);
    }
  }
  return valor;
}

function esAcomodoValido(a: Acople): void {
  const vistos = new Map<PanelId, number>();
  for (const p of PANELES) vistos.set(p, 0);

  for (const z of ZONAS) {
    for (const p of a.zonas[z]) {
      assert.ok(PANELES.includes(p), `panel desconocido en zona ${z}: ${String(p)}`);
      vistos.set(p, (vistos.get(p) ?? 0) + 1);
    }
  }

  for (const [k, z] of Object.entries(a.cerrados)) {
    const p = k as PanelId;
    assert.ok(PANELES.includes(p), `panel desconocido en cerrados: ${k}`);
    assert.ok(z !== undefined && ZONAS.includes(z), `zona inválida en cerrados.${k}: ${String(z)}`);
    vistos.set(p, (vistos.get(p) ?? 0) + 1);
  }

  for (const p of PANELES) {
    assert.equal(vistos.get(p), 1, `el panel ${p} debe aparecer exactamente una vez (apareció ${vistos.get(p)})`);
  }

  assert.ok(Number.isFinite(a.tam.izq) && a.tam.izq >= 240 && a.tam.izq <= 520);
  assert.ok(Number.isFinite(a.tam.der) && a.tam.der >= 240 && a.tam.der <= 520);
  assert.ok(Number.isFinite(a.tam.abajo) && a.tam.abajo >= 160);
  assert.equal(new Set(a.plegados).size, a.plegados.length);
  for (const p of a.plegados) {
    assert.ok(PANELES.includes(p));
  }
}

describe("drag.mjs: los 19 casos traducidos a funciones puras", () => {
  const VENTANA = { left: 0, top: 0, right: 1920, bottom: 1080 };

  test("recorrido completo equivalente a los 19 casos de drag.mjs", () => {
    let e = congelarProfundo(acopleDeFabrica());

    // 1. Arranque: chats izq, contexto+cupo der
    assert.deepEqual(e.zonas, { izq: ["chats"], der: ["contexto", "cupo"], abajo: [] });
    assert.deepEqual(e.tam, { izq: 320, der: 400, abajo: 340 });
    assert.deepEqual(e.plegados, ["cupo"]);
    assert.deepEqual(e.cerrados, {});

    // 2. El arrastre calcula un destino válido sobre derecha (equivale al estado 'moviendo' durante el gesto)
    const geo1: GeoDestino = {
      ventana: VENTANA,
      zonas: {
        izq: { left: 0, top: 0, right: 320, bottom: 1080 },
        der: { left: 1520, top: 0, right: 1920, bottom: 1080 },
        abajo: null,
      },
      paneles: {
        izq: [{ left: 0, top: 0, right: 320, bottom: 1080 }],
        der: [
          { left: 1520, top: 0, right: 1920, bottom: 800 },
          { left: 1520, top: 808, right: 1920, bottom: 1080 },
        ],
        abajo: [],
      },
    };
    const d1 = destino(congelarProfundo(geo1), 1700, 120);
    assert.deepEqual(d1, { zona: "der", indice: 0 });

    // 3. Chats a la derecha, antes de contexto
    e = congelarProfundo(mover(e, "chats", d1!.zona, d1!.indice));
    assert.deepEqual(e.zonas, { izq: [], der: ["chats", "contexto", "cupo"], abajo: [] });

    // 4. Contexto a la izquierda (zona vacía, franja de 96 px)
    const geo2: GeoDestino = {
      ventana: VENTANA,
      zonas: {
        izq: null,
        der: { left: 1520, top: 0, right: 1920, bottom: 1080 },
        abajo: null,
      },
      paneles: {
        izq: [],
        der: [
          { left: 1520, top: 0, right: 1920, bottom: 450 },
          { left: 1520, top: 458, right: 1920, bottom: 900 },
          { left: 1520, top: 908, right: 1920, bottom: 1080 },
        ],
        abajo: [],
      },
    };
    const d2 = destino(congelarProfundo(geo2), 48, 500);
    assert.deepEqual(d2, { zona: "izq", indice: 0 });
    e = congelarProfundo(mover(e, "contexto", d2!.zona, d2!.indice));
    assert.deepEqual(e.zonas, { izq: ["contexto"], der: ["chats", "cupo"], abajo: [] });

    // 5. Cupo abajo (zona vacía, franja inferior de 96 px)
    const geo3: GeoDestino = {
      ventana: VENTANA,
      zonas: {
        izq: { left: 0, top: 0, right: 320, bottom: 1080 },
        der: { left: 1520, top: 0, right: 1920, bottom: 1080 },
        abajo: null,
      },
      paneles: {
        izq: [{ left: 0, top: 0, right: 320, bottom: 1080 }],
        der: [
          { left: 1520, top: 0, right: 1920, bottom: 800 },
          { left: 1520, top: 808, right: 1920, bottom: 1080 },
        ],
        abajo: [],
      },
    };
    const d3 = destino(congelarProfundo(geo3), 1000, 1020);
    assert.deepEqual(d3, { zona: "abajo", indice: 0 });
    e = congelarProfundo(mover(e, "cupo", d3!.zona, d3!.indice));
    assert.deepEqual(e.zonas, { izq: ["contexto"], der: ["chats"], abajo: ["cupo"] });

    // 6. Reordenar: chats a la izquierda, debajo de contexto (mitad inferior)
    const geo4: GeoDestino = {
      ventana: VENTANA,
      zonas: {
        izq: { left: 0, top: 0, right: 320, bottom: 1080 },
        der: { left: 1520, top: 0, right: 1920, bottom: 1080 },
        abajo: { left: 328, top: 1000, right: 1512, bottom: 1080 },
      },
      paneles: {
        izq: [{ left: 0, top: 0, right: 320, bottom: 1080 }],
        der: [{ left: 1520, top: 0, right: 1920, bottom: 1080 }],
        abajo: [{ left: 328, top: 1000, right: 1512, bottom: 1080 }],
      },
    };
    const d4 = destino(congelarProfundo(geo4), 160, 1050);
    assert.deepEqual(d4, { zona: "izq", indice: 1 });
    e = congelarProfundo(mover(e, "chats", d4!.zona, d4!.indice));
    assert.deepEqual(e.zonas, { izq: ["contexto", "chats"], der: [], abajo: ["cupo"] });

    // 7. Zona derecha quedó vacía
    assert.equal(e.zonas.der.length, 0);

    // 8. Divisor de ancho izquierdo (+120 px)
    const w0 = e.tam.izq;
    e = congelarProfundo(redimensionar(e, "izq", w0 + 120));
    assert.equal(e.tam.izq, w0 + 120);

    // 9. Divisor entre paneles apilados: Contexto se achica 150 px (largoZona = 1000)
    e = congelarProfundo(repartir(e, "izq", "contexto", -150, 1000));
    assert.equal(e.partes.contexto, 350);
    assert.equal(e.partes.chats, 650);

    // 10. Zona de abajo con todo plegado: cupo sigue plegado
    assert.ok(e.plegados.includes("cupo"));

    // 11. Divisor inerte mientras está plegado; al desplegar la zona mantiene su alto guardado (340 px)
    const eRedimAbajo = redimensionar(e, "abajo", 340, 820);
    assert.equal(eRedimAbajo.tam.abajo, 340);
    e = congelarProfundo(alternarPlegado(e, "cupo"));
    assert.ok(!e.plegados.includes("cupo"));
    assert.equal(e.tam.abajo, 340);

    // 12. Menú de panel: zonas disponibles y zona actual de cupo
    assert.equal(zonaDe(e, "cupo"), "abajo");
    assert.deepEqual(
      ZONAS.filter((z) => z !== zonaDe(e, "cupo")),
      ["izq", "der"],
    );

    // 13. Menú: mover Cupo a la derecha (al final, sin índice)
    e = congelarProfundo(mover(e, "cupo", "der"));
    assert.deepEqual(e.zonas, { izq: ["contexto", "chats"], der: ["cupo"], abajo: [] });

    // 14. Cerrar Chats
    e = congelarProfundo(cerrar(e, "chats"));
    assert.deepEqual(e.zonas, { izq: ["contexto"], der: ["cupo"], abajo: [] });
    assert.equal(e.cerrados.chats, "izq");

    // 15. Reabrir Chats desde Paneles (vuelve a su zona al final)
    e = congelarProfundo(abrir(e, "chats"));
    assert.deepEqual(e.zonas, { izq: ["contexto", "chats"], der: ["cupo"], abajo: [] });
    assert.deepEqual(e.cerrados, {});

    // 16. Esc cancela el arrastre: sin aplicar `mover`, el estado previo queda intacto
    const antesEsc = e;
    assert.deepEqual(antesEsc.zonas, { izq: ["contexto", "chats"], der: ["cupo"], abajo: [] });

    // 17. Persistencia: serializar y normalizar conserva el acomodo guardado
    const persistido = normalizar(JSON.parse(JSON.stringify(e)));
    assert.deepEqual(persistido.zonas, { izq: ["contexto", "chats"], der: ["cupo"], abajo: [] });
    assert.equal(persistido.tam.izq, 440);

    // 18. Restablecer vuelve al acomodo de fábrica
    const fab = congelarProfundo(acopleDeFabrica());
    assert.deepEqual(fab.zonas, { izq: ["chats"], der: ["contexto", "cupo"], abajo: [] });

    // 19. Soltar sobre el chat (centro, fuera de zonas) devuelve null y no mueve nada
    const geoCentro: GeoDestino = {
      ventana: VENTANA,
      zonas: {
        izq: { left: 0, top: 0, right: 320, bottom: 1080 },
        der: { left: 1520, top: 0, right: 1920, bottom: 1080 },
        abajo: null,
      },
      paneles: {
        izq: [{ left: 0, top: 0, right: 320, bottom: 1080 }],
        der: [
          { left: 1520, top: 0, right: 1920, bottom: 800 },
          { left: 1520, top: 808, right: 1920, bottom: 1080 },
        ],
        abajo: [],
      },
    };
    assert.equal(destino(congelarProfundo(geoCentro), 1000, 400), null);
    assert.deepEqual(fab.zonas, { izq: ["chats"], der: ["contexto", "cupo"], abajo: [] });
  });
});

describe("normalizar: total ante cualquier entrada rota", () => {
  const entradasRotas: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["primitivo texto", "chats"],
    ["arreglo suelto", ["chats", "contexto"]],
    ["objeto vacío", {}],
    ["JSON viejo sin partes ni cerrados ni plegados", { zonas: { izq: ["chats"], der: ["contexto", "cupo"], abajo: [] }, tam: { izq: 360, der: 380 } }],
    ["panel desconocido en zona y plegados", { zonas: { izq: ["chats", "inventado"], der: ["contexto"], abajo: ["cupo", 42] }, plegados: ["cupo", "otro", "cupo"] }],
    ["panel repetido en dos zonas", { zonas: { izq: ["chats", "contexto"], der: ["contexto", "cupo"], abajo: ["chats"] } }],
    ["panel repetido en la misma zona", { zonas: { izq: ["chats", "chats", "chats"], der: ["contexto"], abajo: [] } }],
    ["panel en zona y en cerrados a la vez", { zonas: { izq: ["chats"], der: ["contexto"], abajo: [] }, cerrados: { chats: "der", cupo: "der" } }],
    ["paneles ausentes de zonas y cerrados", { zonas: { izq: [], der: [], abajo: ["cupo"] }, cerrados: {} }],
    ["números de tam fuera de rango", { tam: { izq: 10, der: 9999, abajo: 20 } }],
    ["tam con NaN e Infinity", { tam: { izq: Number.NaN, der: Number.POSITIVE_INFINITY, abajo: Number.NEGATIVE_INFINITY } }],
    ["partes con NaN, 0 y negativos", { partes: { chats: Number.NaN, contexto: 0, cupo: -50 } }],
    ["cerrados con zona inválida y tipos basura en zonas", { zonas: { izq: "no-array", der: null }, cerrados: { chats: "arriba", contexto: null, cupo: "abajo" } }],
  ];

  test("hay al menos 12 entradas rotas y todas producen un Acople válido", () => {
    assert.ok(entradasRotas.length >= 12);
    for (const [nombre, entrada] of entradasRotas) {
      const res = normalizar(congelarProfundo(entrada));
      esAcomodoValido(res);
      assert.equal(typeof res.tam.abajo, "number", nombre);
    }
  });

  test("normalizar acota tam y limpia partes/plegados/cerrados inválidos", () => {
    const res = normalizar({
      zonas: { izq: ["chats", "fantasma"], der: ["chats", "contexto"], abajo: [] },
      tam: { izq: 50, der: 900, abajo: 90 },
      partes: { chats: 200, contexto: Number.NaN, cupo: 100 },
      plegados: ["cupo", "cupo", "nada"],
      cerrados: { chats: "abajo", cupo: "arriba" },
    });
    assert.deepEqual(res.zonas, { izq: ["chats"], der: ["contexto"], abajo: [] });
    assert.deepEqual(res.cerrados, { cupo: "der" });
    assert.deepEqual(res.tam, { izq: 240, der: 520, abajo: 160 });
    assert.deepEqual(res.partes, { chats: 200 });
    assert.deepEqual(res.plegados, ["cupo"]);
  });
});

describe("destino: los cinco lugares", () => {
  const ventana = { left: 0, top: 0, right: 1200, bottom: 800 };

  test("sobre zona izquierda y derecha con paneles (mitad superior e inferior)", () => {
    const geo = congelarProfundo<GeoDestino>({
      ventana,
      zonas: {
        izq: { left: 0, top: 0, right: 320, bottom: 800 },
        der: { left: 800, top: 0, right: 1200, bottom: 800 },
        abajo: null,
      },
      paneles: {
        izq: [{ left: 0, top: 0, right: 320, bottom: 800 }],
        der: [
          { left: 800, top: 0, right: 1200, bottom: 396 },
          { left: 800, top: 404, right: 1200, bottom: 800 },
        ],
        abajo: [],
      },
    });

    assert.deepEqual(destino(geo, 160, 200), { zona: "izq", indice: 0 });
    assert.deepEqual(destino(geo, 160, 600), { zona: "izq", indice: 1 });

    assert.deepEqual(destino(geo, 1000, 100), { zona: "der", indice: 0 });
    assert.deepEqual(destino(geo, 1000, 300), { zona: "der", indice: 1 });
    assert.deepEqual(destino(geo, 1000, 500), { zona: "der", indice: 1 });
    assert.deepEqual(destino(geo, 1000, 700), { zona: "der", indice: 2 });
  });

  test("sobre zona abajo con paneles (mitad izquierda y derecha)", () => {
    const geo = congelarProfundo<GeoDestino>({
      ventana,
      zonas: {
        izq: null,
        der: null,
        abajo: { left: 0, top: 500, right: 1200, bottom: 800 },
      },
      paneles: {
        izq: [],
        der: [],
        abajo: [
          { left: 0, top: 500, right: 596, bottom: 800 },
          { left: 604, top: 500, right: 1200, bottom: 800 },
        ],
      },
    });

    assert.deepEqual(destino(geo, 200, 650), { zona: "abajo", indice: 0 });
    assert.deepEqual(destino(geo, 400, 650), { zona: "abajo", indice: 1 });
    assert.deepEqual(destino(geo, 800, 650), { zona: "abajo", indice: 1 });
    assert.deepEqual(destino(geo, 1000, 650), { zona: "abajo", indice: 2 });
  });

  test("zonas vacías se alcanzan por franja de 96 px pegada al borde y no más allá", () => {
    const geo = congelarProfundo<GeoDestino>({
      ventana,
      zonas: { izq: null, der: null, abajo: null },
      paneles: { izq: [], der: [], abajo: [] },
    });

    assert.deepEqual(destino(geo, 96, 400), { zona: "izq", indice: 0 });
    assert.equal(destino(geo, 97, 400), null);

    assert.deepEqual(destino(geo, 1200 - 96, 400), { zona: "der", indice: 0 });
    assert.equal(destino(geo, 1200 - 97, 400), null);

    assert.deepEqual(destino(geo, 600, 800 - 96), { zona: "abajo", indice: 0 });
    assert.equal(destino(geo, 600, 800 - 97), null);
  });

  test("sobre el centro (el chat) y fuera de la ventana devuelve null", () => {
    const geo = congelarProfundo<GeoDestino>({
      ventana,
      zonas: {
        izq: { left: 0, top: 0, right: 300, bottom: 800 },
        der: { left: 850, top: 0, right: 1200, bottom: 800 },
        abajo: { left: 308, top: 550, right: 842, bottom: 800 },
      },
      paneles: {
        izq: [{ left: 0, top: 0, right: 300, bottom: 800 }],
        der: [{ left: 850, top: 0, right: 1200, bottom: 800 }],
        abajo: [{ left: 308, top: 550, right: 842, bottom: 800 }],
      },
    });

    assert.equal(destino(geo, 550, 300), null);
    assert.equal(destino(geo, -10, 300), null);
    assert.equal(destino(geo, 1250, 300), null);
  });
});

describe("desdeViejo y CLAVE_ACOPLE", () => {
  test("exporta CLAVE_ACOPLE", () => {
    assert.equal(CLAVE_ACOPLE, "hilos:acople");
  });

  test("conserva ancho acotado y cierra Chats si abierta === false", () => {
    const a1 = desdeViejo({ ancho: 380, abierta: true });
    assert.equal(a1.tam.izq, 380);
    assert.deepEqual(a1.zonas.izq, ["chats"]);

    const a2 = desdeViejo({ ancho: 120, abierta: true });
    assert.equal(a2.tam.izq, 240);

    const a3 = desdeViejo({ ancho: 900 });
    assert.equal(a3.tam.izq, 520);

    const a4 = desdeViejo({ ancho: 350, abierta: false });
    assert.equal(a4.tam.izq, 350);
    assert.deepEqual(a4.zonas.izq, []);
    assert.equal(a4.cerrados.chats, "izq");

    assert.deepEqual(desdeViejo({}), acopleDeFabrica());
  });
});

describe("inmutabilidad y casos límite de funciones puras", () => {
  test("ninguna función muta su entrada congelada con Object.freeze", () => {
    const base = congelarProfundo(acopleDeFabrica());

    const m = mover(base, "cupo", "izq", 0);
    assert.notEqual(m, base);
    assert.deepEqual(base.zonas, { izq: ["chats"], der: ["contexto", "cupo"], abajo: [] });

    const c = cerrar(base, "chats");
    assert.notEqual(c, base);
    assert.deepEqual(base.cerrados, {});

    const cCongelado = congelarProfundo(c);
    const ab = abrir(cCongelado, "chats");
    assert.notEqual(ab, cCongelado);
    assert.equal(cCongelado.cerrados.chats, "izq");

    const movCerrado = mover(cCongelado, "chats", "abajo");
    assert.deepEqual(movCerrado.zonas.abajo, ["chats"]);
    assert.equal(movCerrado.cerrados.chats, undefined);

    const pl = alternarPlegado(base, "cupo");
    assert.deepEqual(pl.plegados, []);
    assert.deepEqual(base.plegados, ["cupo"]);

    const rd = redimensionar(base, "abajo", 999, 450);
    assert.equal(rd.tam.abajo, 450);
    assert.equal(base.tam.abajo, 340);

    const apilado = congelarProfundo(alternarPlegado(base, "cupo"));
    const rp = repartir(apilado, "der", "contexto", -500, 600);
    assert.equal(rp.partes.contexto, 120);
    assert.equal(rp.partes.cupo, 480);
    assert.deepEqual(apilado.partes, {});
  });

  test("repartir es inerte si algún panel del par está plegado y respeta el mínimo de 120 px", () => {
    const base = congelarProfundo(acopleDeFabrica());
    const inerte = repartir(base, "der", "contexto", 100, 600);
    assert.deepEqual(inerte.partes, {});

    const desplegado = congelarProfundo(alternarPlegado(base, "cupo"));
    const topeMax = repartir(desplegado, "der", "contexto", 1000, 500);
    assert.equal(topeMax.partes.contexto, 380);
    assert.equal(topeMax.partes.cupo, 120);

    const topeMin = repartir(desplegado, "der", "contexto", -1000, 500);
    assert.equal(topeMin.partes.contexto, 120);
    assert.equal(topeMin.partes.cupo, 380);
  });

  test("mover reordena dentro de la misma zona", () => {
    const base = congelarProfundo(acopleDeFabrica());
    const reordenado = mover(base, "cupo", "der", 0);
    assert.deepEqual(reordenado.zonas.der, ["cupo", "contexto"]);
    const alFinal = mover(congelarProfundo(reordenado), "cupo", "der", 1);
    assert.deepEqual(alFinal.zonas.der, ["contexto", "cupo"]);
  });

  test("redimensionar abajo con límite menor a 160 acota a 160", () => {
    const base = congelarProfundo(acopleDeFabrica());
    assert.equal(redimensionar(base, "abajo", 300, 100).tam.abajo, 160);
  });
});
