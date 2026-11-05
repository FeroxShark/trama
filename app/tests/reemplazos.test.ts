// Los proyectos retirados y su reemplazo (electron/reemplazos.ts): a qué carpeta se ve lo que corrió en un retirado.
import assert from "node:assert/strict";
import test from "node:test";
import { dondeSeVe, esRetirado, mapaReemplazos, type Reemplazable } from "../electron/reemplazos.ts";

const p = (slug: string, estado: string | null = null, reemplazadoPor: string | null = null): Reemplazable => ({ slug, estado, reemplazadoPor });

test("esRetirado: sólo el estado `retirado`", () => {
  assert.equal(esRetirado({ estado: "retirado" }), true);
  for (const e of [null, undefined, "activo", "infra", "pausado"]) assert.equal(esRetirado({ estado: e }), false, String(e));
});

test("un retirado con reemplazo se ve en la carpeta del reemplazo", () => {
  const m = mapaReemplazos([p("hilos", "retirado", "trama"), p("trama", "activo"), p("atlas")]);
  assert.deepEqual([...m], [["hilos", "trama"]]);
  assert.equal(dondeSeVe("hilos", m), "trama");
  assert.equal(dondeSeVe("atlas", m), "atlas");
  assert.equal(dondeSeVe("hilos", undefined), "hilos");
});

test("un retirado sin reemplazo (o con uno que no está en el registry) conserva la suya: nada se pierde de vista", () => {
  const m = mapaReemplazos([p("viejo", "retirado"), p("otro", "retirado", "fantasma"), p("trama")]);
  assert.equal(m.size, 0);
});

test("`reemplazado_por` en un proyecto que no está retirado no mueve nada", () => {
  assert.equal(mapaReemplazos([p("hilos", "activo", "trama"), p("trama")]).size, 0);
});

test("una cadena de retirados llega hasta el último; un ciclo no mueve a nadie", () => {
  const cadena = mapaReemplazos([p("a", "retirado", "b"), p("b", "retirado", "c"), p("c")]);
  assert.equal(cadena.get("a"), "c");
  assert.equal(cadena.get("b"), "c");
  const ciclo = mapaReemplazos([p("a", "retirado", "b"), p("b", "retirado", "a")]);
  assert.equal(ciclo.size, 0);
  assert.equal(mapaReemplazos([p("a", "retirado", "a")]).size, 0);
});
