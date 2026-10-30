// El refresco automático del panel de contexto (src/paneles/contexto-refresco.ts): cada 3 s mientras se ve, pausado cuando está oculto o
// minimizado (y al volver sigue), sin duplicar el reloj, y la comparación que evita re-pintar cuando el desglose no cambió.
import assert from "node:assert/strict";
import { test } from "node:test";
import { crearRefresco, mismoDesglose, REFRESCO_MS } from "../src/paneles/contexto-refresco.ts";

/** Un reloj de mentira: `avanzar(ms)` dispara los intervalos que caen en ese tramo, en orden. */
function relojFalso() {
  let t = 0;
  let id = 0;
  const timers = new Map<number, { f: () => void; ms: number; next: number }>();
  return {
    setInterval(f: () => void, ms: number) {
      const k = ++id;
      timers.set(k, { f, ms, next: t + ms });
      return k;
    },
    clearInterval(k: unknown) {
      timers.delete(k as number);
    },
    avanzar(ms: number) {
      const hasta = t + ms;
      for (;;) {
        let prox: [number, { f: () => void; ms: number; next: number }] | null = null;
        for (const e of timers) if (e[1].next <= hasta && (!prox || e[1].next < prox[1].next)) prox = e;
        if (!prox) break;
        t = prox[1].next;
        prox[1].next += prox[1].ms;
        prox[1].f();
      }
      t = hasta;
    },
    activos: () => timers.size,
  };
}

test("con el panel visible, pide el desglose cada 3 s", () => {
  const reloj = relojFalso();
  let pedidos = 0;
  const r = crearRefresco({ alTick: () => pedidos++, reloj });
  assert.equal(REFRESCO_MS, 3000);
  r.ver(true);
  reloj.avanzar(9000);
  assert.equal(pedidos, 3);
  assert.equal(r.activo(), true);
});

test("oculto o minimizado: no pide nada; al volver a verse, sigue", () => {
  const reloj = relojFalso();
  let pedidos = 0;
  const r = crearRefresco({ alTick: () => pedidos++, reloj });
  r.ver(true);
  reloj.avanzar(3000);
  assert.equal(pedidos, 1);
  r.ver(false);
  assert.equal(r.activo(), false);
  assert.equal(reloj.activos(), 0);
  reloj.avanzar(60_000);
  assert.equal(pedidos, 1, "oculto: ni un pedido en un minuto");
  r.ver(true);
  reloj.avanzar(3000);
  assert.equal(pedidos, 2, "al volver, el primer pedido sale a los 3 s");
});

test("ver(true) repetido no duplica el reloj; parar lo apaga", () => {
  const reloj = relojFalso();
  let pedidos = 0;
  const r = crearRefresco({ alTick: () => pedidos++, reloj });
  r.ver(true);
  r.ver(true);
  assert.equal(reloj.activos(), 1);
  reloj.avanzar(3000);
  assert.equal(pedidos, 1);
  r.parar();
  reloj.avanzar(30_000);
  assert.equal(pedidos, 1);
  assert.equal(reloj.activos(), 0);
});

test("mismoDesglose: igual en contenido, aunque sea otro objeto; distinto si cambia una cifra", () => {
  const a = { usado: 1000, categorias: [{ id: "mensajes", tokens: 900 }] };
  assert.equal(mismoDesglose(a, JSON.parse(JSON.stringify(a))), true);
  assert.equal(mismoDesglose(a, { ...a, usado: 1001 }), false);
  assert.equal(mismoDesglose(null, a), false);
});
