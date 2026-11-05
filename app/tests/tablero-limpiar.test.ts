// «Limpiar» del Tablero: qué se sugiere cerrar (proyecto retirado, rama ya integrada, prueba de una versión vieja), cómo se filtra y se
// marca, la tanda para Deshacer y el cierre en lote. Lógica pura de src/datos/tablero-limpiar.ts; la vuelta entera contra un tablero
// temporal está en scripts/prueba-tablero.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      const base = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec);
      for (const f of [base + ".ts", base + ".tsx", path.join(base, "index.ts")])
        if (existsSync(f)) return next(path.relative(path.dirname(fileURLToPath(ctx.parentURL)), f).replace(/\\/g, "/").replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const L = await import("../src/datos/tablero-limpiar.ts");
const { validar } = await import("../src/datos/tablero.ts");

const AHORA = Date.parse("2026-11-05T12:00:00Z");
const hace = (d: number) => new Date(AHORA - d * 86_400_000).toISOString();
const VERSION = [0, 2, 53] as const;

let n = 0;
function crudo(col: string, o: Record<string, unknown> = {}) {
  n++;
  return { id: n, columna: col, proyecto: "atlas", titulo: `item ${n}`, detalle: "", prueba: "", origen: "jefe", clave: "", head: null, creado: hace(2), tocado: hace(2), cerrado: null, hasta: null, ...o };
}
function tablero(porColumna: Record<string, unknown[]>) {
  return validar({ version: 1, vista: { columnas: porColumna, contadores: {} }, hecho: [], proyectos: [], pospuestosLista: [], aviso: null });
}
const CTX = { retirados: new Set(["viejo"]), integradas: new Set(["20261001-162208-31045"]), version: VERSION };

test("versionesEn: lee versiones de Trama y no confunde una IP ni un número pegado a una letra", () => {
  assert.deepEqual(L.versionesEn("Probar en v0.2.40 y en 0.2.41."), [[0, 2, 40], [0, 2, 41]]);
  assert.deepEqual(L.versionesEn("curl 127.0.0.1 y 10.0.0.1:8080, node22.1.0, 1.2.3-rc1, 1.2.3.4"), []);
});

test("esPruebaVieja: sólo una prueba que nombra una versión anterior de la misma serie", () => {
  const i = (o: Record<string, unknown>) => validar({ version: 1, vista: { columnas: { bandeja: [crudo("bandeja", o)] }, contadores: {} }, hecho: [], proyectos: [], pospuestosLista: [], aviso: null }).columnas.bandeja[0];
  assert.equal(L.esPruebaVieja(i({ prueba: "atlas --x", titulo: "Probar en v0.2.40" }), VERSION), true);
  assert.equal(L.esPruebaVieja(i({ prueba: "atlas --x", titulo: "Probar en v0.2.53" }), VERSION), false, "la actual no es vieja");
  assert.equal(L.esPruebaVieja(i({ prueba: "atlas --x", titulo: "Rota en v0.2.40; sigue en v0.2.54" }), VERSION), false, "gana la más nueva que nombra");
  assert.equal(L.esPruebaVieja(i({ prueba: "atlas --x", titulo: "Con node 22.1.0" }), VERSION), false, "otra serie no es de Trama");
  assert.equal(L.esPruebaVieja(i({ prueba: "atlas --x", titulo: "Sin versión" }), VERSION), false);
  assert.equal(L.esPruebaVieja(i({ titulo: "Una pregunta de v0.2.40" }), VERSION), false, "una pregunta no es una prueba");
});

test("corridaDe: el id de la corrida de una clave pa:<id>", () => {
  assert.equal(L.corridaDe("pa:20261001-162208-31045"), "20261001-162208-31045");
  assert.equal(L.corridaDe("pa:20261001-162208-31045:decision"), "20261001-162208-31045");
  assert.equal(L.corridaDe("doctor:atlas:tests"), null);
  assert.equal(L.corridaDe(""), null);
});

test("motivosDe: retirado, integrada y vieja, cada uno por lo suyo", () => {
  const t = tablero({
    bandeja: [
      crudo("bandeja", { proyecto: "viejo" }),
      crudo("bandeja", { clave: "pa:20261001-162208-31045" }),
      crudo("bandeja", { clave: "pa:20269999-000000-1" }),
      crudo("bandeja", { prueba: "npm test", titulo: "Probar v0.2.10" }),
      crudo("bandeja", { proyecto: "viejo", clave: "pa:20261001-162208-31045" }),
    ],
  });
  const m = t.columnas.bandeja.map((i) => L.motivosDe(i, CTX));
  assert.deepEqual(m, [["retirado"], ["integrada"], [], ["vieja"], ["retirado", "integrada"]]);
});

test("candidatosTablero: filtra por plazo, proyecto y tipo; lo sugerido va primero y lo más viejo antes", () => {
  const t = tablero({
    bandeja: [crudo("bandeja", { tocado: hace(5), titulo: "reciente" }), crudo("bandeja", { tocado: hace(80), titulo: "viejo sin motivo" }), crudo("bandeja", { proyecto: "viejo", tocado: hace(10), titulo: "retirado" })],
    ideas: [crudo("ideas", { proyecto: "viejo", tocado: hace(40), titulo: "idea retirada" })],
    "espera-dueno": [crudo("espera-dueno", { proyecto: "viejo", prueba: "npm test", tocado: hace(1), titulo: "prueba retirada" })],
  });
  const todos = L.abiertosConMotivos(t, CTX, AHORA);
  const f = (o: Partial<import("../src/datos/tablero-limpiar.ts").Filtros> = {}) => ({ dias: 0, proyecto: null, tipos: new Set(L.TIPOS_LIMPIAR), soloSugeridos: false, ...o });
  const titulos = (lista: { item: { titulo: string } }[]) => lista.map((c) => c.item.titulo);

  assert.deepEqual(titulos(L.candidatosTablero(todos, f({ soloSugeridos: true }))), ["idea retirada", "retirado", "prueba retirada"], "sólo lo sugerido, lo más viejo primero");
  assert.deepEqual(titulos(L.candidatosTablero(todos, f())), ["idea retirada", "retirado", "prueba retirada", "viejo sin motivo", "reciente"], "sin «sólo sugeridos» entra todo, lo sugerido primero");
  assert.deepEqual(titulos(L.candidatosTablero(todos, f({ dias: 30 }))), ["idea retirada", "viejo sin motivo"], "sin tocar hace más de 30 días");
  assert.deepEqual(titulos(L.candidatosTablero(todos, f({ tipos: new Set(["idea"]) }))), ["idea retirada"], "sólo ideas");
  assert.deepEqual(titulos(L.candidatosTablero(todos, f({ tipos: new Set(["prueba"]) }))), ["prueba retirada"], "sólo pruebas");
  assert.deepEqual(titulos(L.candidatosTablero(todos, f({ proyecto: "viejo", soloSugeridos: true, tipos: new Set(["pregunta"]) }))), ["retirado"], "pregunta de un proyecto");
  assert.deepEqual(L.contarMotivos(todos), { retirado: 3, integrada: 0, vieja: 0 });
});

test("marcado de entrada: lo sugerido y lo que pidió el plazo; lo demás lo marca el usuario", () => {
  const t = tablero({ bandeja: [crudo("bandeja", { proyecto: "viejo" }), crudo("bandeja")] });
  const lista = L.abiertosConMotivos(t, CTX, AHORA);
  const sin = { dias: 0 };
  assert.deepEqual(L.aCerrar(lista, sin, new Map()).map((c) => c.item.id), [lista[0].item.id], "sólo el sugerido");
  assert.equal(L.aCerrar(lista, { dias: 7 }, new Map()).length, lista.length, "con un plazo elegido entran todos los que pasan el filtro");
  const sacar = new Map([[lista[0].item.id, false]]);
  assert.equal(L.aCerrar(lista, sin, sacar).length, 0, "sacar una casilla sugerida la deja afuera");
  const poner = new Map([[lista[1].item.id, true]]);
  assert.equal(L.aCerrar(lista, sin, poner).length, 2, "marcar a mano una no sugerida la mete");
});

test("tanda: guarda la columna de donde salió cada item y rechaza lo roto", () => {
  const t = tablero({ bandeja: [crudo("bandeja")], sigue: [crudo("sigue")], ideas: [crudo("ideas")] });
  const lista = L.abiertosConMotivos(t, CTX, AHORA);
  const tanda = L.tandaDe(lista, AHORA);
  assert.deepEqual(tanda.items.map((x) => x.columna), ["bandeja", "sigue", "ideas"]);
  assert.deepEqual(L.tandaGuardada(JSON.stringify(tanda)), tanda, "ida y vuelta por localStorage");
  assert.equal(L.tandaGuardada(null), null);
  assert.equal(L.tandaGuardada("{no es json"), null);
  assert.equal(L.tandaGuardada(JSON.stringify({ fecha: 1, items: [] })), null, "vacía no sirve");
  assert.deepEqual(L.tandaGuardada(JSON.stringify({ fecha: 1, items: [{ id: 4, columna: "tirado" }, { id: "x" }] }))?.items, [{ id: 4, columna: "bandeja" }], "una columna rara vuelve a bandeja y lo sin forma se descarta");
});

test("correrEnLote: de a pocos a la vez, avisa el avance y cuenta lo que falla", async () => {
  let activos = 0;
  let maximo = 0;
  const avances: number[] = [];
  const r = await L.correrEnLote(
    Array.from({ length: 20 }, (_, i) => i),
    async (x) => {
      activos++;
      maximo = Math.max(maximo, activos);
      await Promise.resolve();
      activos--;
      if (x === 7) throw new Error("no pude");
    },
    { concurrencia: 3, alAvanzar: (listos) => avances.push(listos) },
  );
  assert.equal(r.hechos.length, 19);
  assert.deepEqual(r.fallos, [{ x: 7, error: "no pude" }]);
  assert.equal(r.cortado, false);
  assert.ok(maximo <= 3 && maximo > 1, `concurrencia ${maximo}`);
  assert.equal(avances.length, 20);
  assert.equal(avances.at(-1), 20);
});

test("correrEnLote: parar corta lo que falta y varias fallas seguidas también", async () => {
  let paro = false;
  const hechos: number[] = [];
  const a = await L.correrEnLote([1, 2, 3, 4, 5, 6], async (x) => void hechos.push(x), { concurrencia: 1, parar: () => paro, alAvanzar: (l) => void (paro = l >= 2) });
  assert.deepEqual(a.hechos, [1, 2]);
  assert.equal(a.cortado, true);

  let llamadas = 0;
  const b = await L.correrEnLote(Array.from({ length: 50 }, (_, i) => i), async () => {
    llamadas++;
    throw new Error("CLI roto");
  }, { concurrencia: 1 });
  assert.equal(b.cortado, true);
  assert.equal(llamadas, 5, "con un CLI roto no se intentan los 50");
  assert.equal(b.fallos.length, 5);
});
