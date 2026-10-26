import { test } from "node:test";
import assert from "node:assert/strict";
import { conCuenta, cuentas, filtroVigente, pasa } from "../src/paneles/ramas-vista.ts";
import type { Juicio } from "../src/datos/analista.ts";

const j = (id: string, veredicto: Juicio["veredicto"]): [string, Juicio] => [id, { id, veredicto, motivo: "" }];
const juicios = new Map([j("a", "integrar"), j("b", "descartar"), j("c", "descartar")]);

test("cuentas por veredicto, con las sin juzgar", () => {
  const c = cuentas(["a", "b", "c", "d"], juicios);
  assert.deepEqual(c, { integrar: 1, descartar: 2, retomar: 0, revisar: 0, sin: 1 });
  assert.deepEqual(conCuenta(c), ["integrar", "descartar"]);
});

test("el filtro deja pasar lo que toca", () => {
  assert.equal(pasa("a", juicios, "todas"), true);
  assert.equal(pasa("a", juicios, "descartar"), false);
  assert.equal(pasa("d", juicios, "sin"), true);
  assert.equal(pasa("b", juicios, "sin"), false);
});

test("un filtro vacío vuelve a todas", () => {
  const c = cuentas(["a"], juicios);
  assert.equal(filtroVigente("descartar", c), "todas");
  assert.equal(filtroVigente("integrar", c), "integrar");
});

// --- Aplicar todos los veredictos ---
const { planAplicar, pasosDe, correrLote, resumenLote } = await import("../src/paneles/ramas-vista.ts");
const { promptAgentsMd, medidaLecciones } = await import("../src/paneles/orquestacion-logica.ts");

const rama = (id: string, o: Record<string, boolean> = {}) => ({ id, libre: true, choco: false, conError: false, murio: false, sinVerificar: false, ...o });
const juicio = (id: string, veredicto: string) => [id, { id, veredicto, motivo: "" }] as const;

test("planAplicar: integra lo seguro, descarta, retoma y deja aparte lo dudoso con su motivo", () => {
  const j = new Map([juicio("a", "integrar"), juicio("b", "integrar"), juicio("c", "integrar"), juicio("d", "integrar"), juicio("e", "integrar"), juicio("f", "descartar"), juicio("g", "retomar"), juicio("h", "revisar"), juicio("i", "descartar")]) as never;
  const p = planAplicar(
    [rama("a"), rama("b", { choco: true }), rama("c", { sinVerificar: true }), rama("d", { murio: true }), rama("e", { conError: true }), rama("f"), rama("g"), rama("h"), rama("i", { libre: false }), rama("z")],
    j,
  );
  assert.deepEqual({ i: p.integrar, d: p.descartar, r: p.retomar, total: p.total }, { i: ["a"], d: ["f"], r: ["g"], total: 3 });
  assert.deepEqual(p.aparte, [
    { id: "b", motivo: "choco" },
    { id: "c", motivo: "sinVerificar" },
    { id: "d", motivo: "murio" },
    { id: "e", motivo: "error" },
    { id: "h", motivo: "revisar" },
  ]);
  assert.deepEqual(pasosDe(p).map((x) => x.accion), ["integrar", "retomar", "descartar"]);
});

test("correrLote: de a una, en orden; un fallo no frena a las demás y cada cambio se avisa", async () => {
  const pasos = pasosDe({ integrar: ["a", "b"], retomar: ["c"], descartar: ["d"] });
  const orden: string[] = [];
  const vistos: string[] = [];
  const fin = await correrLote(
    pasos,
    async (p) => {
      orden.push(p.id);
      return p.id === "b" ? "tests rojos" : null;
    },
    (x) => vistos.push(x.map((y) => y.fase[0]).join("")),
  );
  assert.deepEqual(orden, ["a", "b", "c", "d"]);
  assert.equal(vistos[0], "ceee");
  assert.equal(vistos.at(-1), "oeoo");
  assert.deepEqual(resumenLote(fin), { ok: 3, mal: 1, faltan: 0 });
  assert.equal(fin[1].error, "tests rojos");
});

test("correrLote: parar corta antes del siguiente; una excepción cuenta como error", async () => {
  let n = 0;
  const fin = await correrLote(pasosDe({ integrar: ["a", "b", "c"], retomar: [], descartar: [] }), async () => { if (++n === 1) throw new Error("boom"); return null; }, () => {}, () => n >= 2);
  assert.deepEqual(fin.map((p) => p.fase), ["error", "ok", "espera"]);
  assert.equal(fin[0].error, "boom");
});

test("el prompt de AGENTS.md lleva la plantilla y la ruta; la medida de lecciones usa los topes de pa", () => {
  const t = promptAgentsMd("Atlas", "/p/atlas", "# AGENTS.md\n## Qué es\n");
  assert.match(t, /\/p\/atlas\/AGENTS\.md/);
  assert.match(t, /VERIFICASTE/);
  assert.ok(t.endsWith("## Qué es"));
  assert.deepEqual(medidaLecciones("a\nb\n"), { lineas: 2, cars: 4, pasa: false });
  assert.equal(medidaLecciones("x\n".repeat(31)).pasa, true);
  assert.equal(medidaLecciones("x".repeat(3001)).pasa, true);
});
