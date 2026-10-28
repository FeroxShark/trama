// src/datos/pasos.ts: validar lo que manda el main y poner al día una vista con un lote; y que el fixture
// cubra cada tipo de paso. Puro; los módulos de src/ se importan sin extensión.
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

const { aplicar, cambioDe, vistaDe } = await import("../src/datos/pasos.ts");
const { pasosFijos } = await import("../src/datos/pasos-fixture.ts");

test("el fixture trae un paso de cada tipo, con un recorte y un fallo, y pasa la validación", () => {
  const v = vistaDe(JSON.parse(JSON.stringify(pasosFijos("20260310-100000-111"))))!;
  assert.equal(v.hay, true);
  const tipos = new Set(v.pasos.map((p) => p.tipo));
  for (const t of ["pensar", "leer", "buscar", "editar", "escribir", "correr", "delegar", "texto"]) assert.ok(tipos.has(t as never), t);
  assert.ok(v.pasos.some((p) => p.estado === "fallo"));
  assert.ok(v.pasos.some((p) => p.detalle.clase === "correr" && p.detalle.salida?.recortado));
  assert.ok(v.pasos.some((p) => p.detalle.clase === "delegar" && p.detalle.pasos.length > 0));
});

test("lo que no tiene forma de vista o de lote se descarta", () => {
  assert.equal(vistaDe(null), null);
  assert.equal(vistaDe({ hay: true }), null);
  assert.equal(vistaDe({ id: "x", hay: false })!.pasos.length, 0);
  assert.equal(cambioDe({ id: "x" }), null);
  assert.equal(cambioDe("hola"), null);
});

test("aplicar: los pasos nuevos se suman, los tocados se reemplazan y repetir el lote no cambia nada", () => {
  const base = pasosFijos("w");
  const cola = base.pasos[base.pasos.length - 1];
  const tocado = { ...cola, v: base.v + 1, titulo: "cambió" };
  const nuevo = { ...cola, n: cola.n + 1, id: "otro", v: base.v + 1, titulo: "nuevo" };
  const lote = { id: "w", gen: base.gen, desde: base.v, v: base.v + 1, omitidos: 0, total: base.pasos.length + 1, encabezado: base.encabezado, cambios: [tocado, nuevo] };
  const r = aplicar(base, lote);
  assert.ok(r && "vista" in r);
  if (!r || !("vista" in r)) return;
  assert.equal(r.vista.pasos.length, base.pasos.length + 1);
  assert.equal(r.vista.pasos.at(-2)!.titulo, "cambió");
  assert.equal(r.vista.v, base.v + 1);
  const otra = aplicar(r.vista, lote);
  assert.ok(otra && "vista" in otra);
  if (otra && "vista" in otra) assert.deepEqual(otra.vista, r.vista);
});

test("aplicar: otro worker se ignora; otro gen o un lote perdido piden la vista de nuevo", () => {
  const base = pasosFijos("w");
  const lote = { id: "w", gen: base.gen, desde: base.v, v: base.v + 1, omitidos: 0, total: base.pasos.length, encabezado: base.encabezado, cambios: [] };
  assert.equal(aplicar(base, { ...lote, id: "otro" }), null);
  assert.deepEqual(aplicar(base, { ...lote, gen: base.gen + 1 }), { pedirDeNuevo: true });
  assert.deepEqual(aplicar(base, { ...lote, desde: base.v + 5, v: base.v + 6 }), { pedirDeNuevo: true });
});

test("aplicar: lo que el main descartó por tope también se saca de la vista", () => {
  const base = pasosFijos("w");
  const total = base.pasos.length;
  const r = aplicar(base, { id: "w", gen: base.gen, desde: base.v, v: base.v + 1, omitidos: 3, total, encabezado: base.encabezado, cambios: [] });
  assert.ok(r && "vista" in r);
  if (r && "vista" in r) {
    assert.equal(r.vista.pasos.length, total - 3);
    assert.equal(r.vista.omitidos, 3);
  }
});
