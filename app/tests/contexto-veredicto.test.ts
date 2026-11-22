// La regla del veredicto de cada pieza fija del panel de contexto (src/paneles/contexto-vista.ts: `veredictoDe`, `resumenFijo`, `ordenarPorVeredicto`).
import assert from "node:assert/strict";
import test from "node:test";
import { desgloseFalso, USOS_FALSOS } from "../src/datos/fixtures-contexto.ts";
import { FRACCION_DUDOSO, itemsDe, ordenarPorVeredicto, recuperable, resumenFijo, UMBRAL_LIVIANA, UMBRAL_PESADA, USOS_POCO, veredictoDe, type Pieza } from "../src/paneles/contexto-vista.ts";

/** Una pieza de skills con todo en neutro; cada caso cambia lo suyo. */
const pieza = (p: Partial<Pieza> = {}): Pieza => ({
  cat: "skills",
  tokens: 500,
  usos: 0,
  recientes: null,
  nunca: false,
  porHook: false,
  diferida: false,
  fantasma: false,
  protegida: false,
  sis: null,
  duplicadaCon: null,
  ...p,
});

test("muy usada: vale, con cuántas veces", () => {
  const j = veredictoDe(pieza({ tokens: 5_000, usos: 3, recientes: 31 }))!;
  assert.equal(j.veredicto, "vale");
  assert.equal(j.razon.clave, "ctxp.vd.usada30");
  assert.equal(j.razon.vars.n, 31);
});

test("nunca usada: sobra; con el historial de 30 días lo dice así, sin él es sólo de la sesión", () => {
  assert.deepEqual(veredictoDe(pieza({ nunca: true, recientes: 0 }))?.veredicto, "sobra");
  assert.equal(veredictoDe(pieza({ nunca: true, recientes: 0 }))!.razon.clave, "ctxp.vd.nunca30");
  assert.equal(veredictoDe(pieza({ nunca: true, cat: "herramientas" }))!.razon.clave, "ctxp.vd.nuncaSesion");
});

test("nunca usada pero liviana: dudosa (el ahorro no se nota)", () => {
  const j = veredictoDe(pieza({ nunca: true, tokens: UMBRAL_LIVIANA - 1 }))!;
  assert.equal(j.veredicto, "dudoso");
  assert.equal(j.razon.clave, "ctxp.vd.nuncaLiviana");
});

test("duplicada con otra: sobra y nombra con cuál, aunque el nombre se use mucho (el historial es por nombre)", () => {
  const j = veredictoDe(pieza({ duplicadaCon: "ui-ux-pro-max", usos: 0, recientes: 0 }))!;
  assert.equal(j.veredicto, "sobra");
  assert.equal(j.razon.clave, "ctxp.vd.duplicada");
  assert.equal(j.razon.vars.con, "ui-ux-pro-max");
  assert.equal(veredictoDe(pieza({ duplicadaCon: "x", recientes: USOS_POCO + 20 }))!.veredicto, "sobra");
});

test("pesada y poco usada: dudosa; pesada y muy usada, vale; liviana y poco usada, vale", () => {
  const poco = veredictoDe(pieza({ tokens: UMBRAL_PESADA, usos: 1, recientes: 3 }))!;
  assert.equal(poco.veredicto, "dudoso");
  assert.equal(poco.razon.clave, "ctxp.vd.pesadaPoco");
  assert.equal(veredictoDe(pieza({ tokens: UMBRAL_PESADA, recientes: USOS_POCO + 1 }))!.veredicto, "vale");
  assert.equal(veredictoDe(pieza({ tokens: UMBRAL_PESADA - 1, recientes: 1 }))!.veredicto, "vale");
});

test("sin datos de uso (memoria, sesión sin medir): nunca «sobra»; la pesada queda dudosa y la liviana vale", () => {
  const sin = (tokens: number) => veredictoDe(pieza({ cat: "memoria", tokens, usos: null, recientes: null }))!;
  assert.equal(sin(UMBRAL_PESADA + 1).veredicto, "dudoso");
  assert.equal(sin(UMBRAL_PESADA + 1).razon.clave, "ctxp.vd.pesadaSinDato");
  assert.equal(sin(300).veredicto, "vale");
  assert.equal(sin(300).razon.clave, "ctxp.vd.sinDato");
});

test("lo que Trama o un hook necesitan siempre vale; lo que no está en la ventana no tiene veredicto", () => {
  assert.equal(veredictoDe(pieza({ cat: "sistema", sis: "prompt", nunca: true, tokens: 9_000 }))!.veredicto, "vale");
  assert.equal(veredictoDe(pieza({ cat: "herramientas", protegida: true, nunca: true }))!.veredicto, "vale");
  assert.equal(veredictoDe(pieza({ porHook: true, usos: 0 }))!.razon.clave, "ctxp.vd.hook");
  assert.equal(veredictoDe(pieza({ diferida: true })), null);
  assert.equal(veredictoDe(pieza({ fantasma: true, tokens: null })), null);
  assert.equal(veredictoDe(pieza({ tokens: 0 })), null);
});

test("recuperable: todo lo que sobra y la mitad de lo dudoso", () => {
  assert.equal(
    recuperable([
      { tokens: 1_000, veredicto: "sobra" },
      { tokens: 1_000, veredicto: "dudoso" },
      { tokens: 1_000, veredicto: "vale" },
      { tokens: null, veredicto: null },
    ]),
    1_000 + 1_000 * FRACCION_DUDOSO,
  );
});

test("skills del mismo nombre: se queda la más usada y la otra queda duplicada con ella", () => {
  const d = desgloseFalso({ lider: "s-1" });
  const it = itemsDe(d, "skills", [], { recientes: USOS_FALSOS });
  const duplicada = it.find((x) => x.nombre === "workers" && x.duplicadaCon)!;
  assert.equal(duplicada.clave, "oficina:workers");
  assert.equal(duplicada.duplicadaCon, "workers (user)");
  assert.equal(it.find((x) => x.clave === "workers")!.duplicadaCon, null);
  assert.equal(veredictoDe({ ...duplicada, cat: "skills" })!.veredicto, "sobra");
});

test("resumen fijo: suma lo que se carga siempre y lo recuperable sigue la regla; lo apagado no cuenta", () => {
  const d = desgloseFalso({ lider: "s-1" });
  const r = resumenFijo(d, { recientes: USOS_FALSOS });
  // sistema + herramientas + mcp + skills + memoria de las fixtures (sin mensajes ni agentes).
  assert.equal(r.fijo, 9_800 + 15_500 + 1_159 + 5_420 + 4_940);
  assert.ok(r.recuperable > 0 && r.recuperable < r.fijo);
  const apagado = resumenFijo(d, { recientes: USOS_FALSOS, apagados: { skills: ["investigar", "oficina:workers"], mcp: [], herramientas: [], memoria: [] } });
  assert.equal(apagado.fijo, r.fijo - 2_300 - 300);
  assert.ok(apagado.recuperable < r.recuperable);
});

test("orden: primero lo más caro que menos se usa (lo que sobra pesado antes que lo que vale)", () => {
  const d = desgloseFalso({ lider: "s-1" });
  const orden = ordenarPorVeredicto(itemsDe(d, "skills", [], { recientes: USOS_FALSOS }), "skills");
  const veredictos = orden.map((i) => veredictoDe({ ...i, cat: "skills" })?.veredicto);
  // `investigar` (2 300, dudosa: pesa 1 150 recuperables) antes que `revisar-diseno` (600, sobra) y las que valen al final.
  assert.equal(orden[0].nombre, "investigar");
  assert.equal(orden[1].nombre, "revisar-diseno");
  assert.equal(veredictos[veredictos.length - 1], "vale");
  // Ninguna que vale va antes de una que sobra.
  assert.ok(veredictos.lastIndexOf("sobra") < veredictos.indexOf("vale"));
});

test("prefacio de un motor que no es Claude: sin veredicto (no hay datos de uso), pero suma a «Fijo» y no a lo recuperable", async () => {
  const { desdePrefacio } = await import("../electron/contexto-desglose.ts");
  assert.equal(veredictoDe(pieza({ cat: "prefacio", tokens: 9_000, usos: null })), null);
  const d = desdePrefacio({
    tipo: "lider",
    id: "s1",
    motor: "codex",
    modelo: "codex:gpt-6.2-sol",
    partes: [
      { titulo: "Instrucciones de Trama para este motor", tokens: 3_000, recortado: false, cortados: 0 },
      { titulo: "Memoria", tokens: 2_000, recortado: true, cortados: 500 },
    ],
    usado: 20_000,
    ventana: 500_000,
  });
  assert.deepEqual(resumenFijo(d), { fijo: 5_000, recuperable: 0 });
});
