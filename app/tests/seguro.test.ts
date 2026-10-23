// "Integrar solo lo seguro" (B22): el predicado de electron/seguro.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esSeguro, idLanzado, seguras, ultimasPorRama, type HiloSeguro } from "../electron/seguro.ts";

const ctx = { tests: (p: string) => p === "atlas", liderVivo: (sid: string) => sid === "vivo" };

const h = (x: Partial<HiloSeguro> = {}): HiloSeguro => ({
  id: "20261003-100000-1",
  proyecto: "atlas",
  estado: "listo",
  inicio: 100,
  rama: "pa/atlas/20261003-100000-1",
  commits: 2,
  decision_nada: true,
  en_cola: false,
  jefe_id: null,
  ...x,
});

test("listo o decision con DECISION: nada, commits, sin worker vivo y con tests: seguro", () => {
  assert.equal(esSeguro(h(), undefined, ctx), true);
  assert.equal(esSeguro(h({ estado: "decision" }), undefined, ctx), true);
  assert.equal(esSeguro(h({ rc: 0 }), undefined, ctx), true);
});

test("lo que pide algo, falló, no tiene commits o sigue vivo no es seguro", () => {
  for (const x of [
    { decision_nada: false },
    { decision_nada: null },
    { estado: "murio" },
    { estado: "entregado" },
    { estado: "trabajando" },
    { estado: "colgado" },
    { en_cola: true },
    { commits: 0 },
    { commits: null },
    { rama: null },
    { rc: 1 },
  ] satisfies Partial<HiloSeguro>[])
    assert.equal(esSeguro(h(x), undefined, ctx), false, JSON.stringify(x));
});

test("sin tests en el registry o con su líder vivo, no", () => {
  assert.equal(esSeguro(h({ proyecto: "cauce" }), undefined, ctx), false);
  assert.equal(esSeguro(h({ jefe_id: "vivo" }), undefined, ctx), false);
  assert.equal(esSeguro(h({ jefe_id: "muerto" }), undefined, ctx), true);
});

test("si otra corrida más nueva trabaja sobre la misma rama (un --seguir), la vieja no es segura", () => {
  const vieja = h();
  const nueva = h({ id: "20261003-110000-2", estado: "trabajando", inicio: 200 });
  const u = ultimasPorRama([vieja, nueva]);
  assert.equal(u.get(vieja.rama!)!.id, nueva.id);
  assert.equal(esSeguro(vieja, u.get(vieja.rama!), ctx), false);
  assert.deepEqual(seguras([vieja, nueva], ctx), []);
});

test("seguras: una por rama, lo más viejo primero, sin lo ya resuelto", () => {
  const a = h({ id: "20261003-100000-1", rama: "r/a", inicio: 300 });
  const b = h({ id: "20261003-100000-2", rama: "r/b", inicio: 100 });
  const c = h({ id: "20261003-100000-3", rama: "r/c", estado: "integrado" });
  assert.deepEqual(
    seguras([a, b, c], ctx).map((x) => x.id),
    [b.id, a.id],
  );
});

test("idLanzado lee el id de lo que imprime `pa … --async`", () => {
  assert.equal(idLanzado("pa: 'Atlas Web' lanzado en background en el puesto 1 (id: 20261003-230401-2389243, log: /tmp/x.log)."), "20261003-230401-2389243");
  assert.equal(idLanzado("pa: 'x' lanzado en background, EN COLA: 2 (id: 20261003-230401-9, log: /tmp/y)."), "20261003-230401-9");
  assert.equal(idLanzado("nada"), null);
});
