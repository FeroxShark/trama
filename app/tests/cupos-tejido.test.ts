// La tela de Plan y cupos: cuántos hilos prende un carril, qué dice el renglón de una cuenta y cuándo avisa que a la cuenta en uso se le acaba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esEnUso, estadoCuenta, hallazgo, HILOS, hilosPrendidos, nivelCarril, ventanasDeSusc, type FilaResumen } from "../src/paneles/cupos-tejido.ts";

const v = (id: string, pct: number | null, extra: object = {}) => ({ id, pct, vuelve: null, ...extra });

test("los hilos: redondea para arriba, nunca cero con uso y sólo se llena con el 100 %", () => {
  assert.equal(hilosPrendidos(null), 0);
  assert.equal(hilosPrendidos(0), 0);
  assert.equal(hilosPrendidos(0.4), 1);
  assert.equal(hilosPrendidos(5), 2);
  assert.equal(hilosPrendidos(23), 9);
  assert.equal(hilosPrendidos(92), 35);
  assert.equal(hilosPrendidos(99.6), HILOS - 1);
  assert.equal(hilosPrendidos(100), HILOS);
  assert.equal(hilosPrendidos(130), HILOS);
});

test("el nivel de un carril: poco desde 70 %, sin cupo con 100 %", () => {
  assert.equal(nivelCarril(v("5h", 69)), "ok");
  assert.equal(nivelCarril(v("5h", 70)), "poco");
  assert.equal(nivelCarril(v("5h", 100)), "sin");
  assert.equal(nivelCarril(v("5h", null)), "nada");
  assert.equal(nivelCarril(v("5h", 100, { deshabilitada: true })), "off");
});

test("el estado de una cuenta en palabras", () => {
  const ahora = 1000;
  assert.deepEqual(estadoCuenta([v("5h", 5), v("7d", 40)], undefined, true, ahora), { nivel: "ok" });
  assert.deepEqual(estadoCuenta([v("5h", 23), v("7d", 92)], undefined, true, ahora), { nivel: "poco", ventana: "7d" });
  assert.deepEqual(estadoCuenta([v("5h", 95), v("7d", 92)], undefined, true, ahora), { nivel: "poco", ventana: "5h" });
  assert.deepEqual(estadoCuenta([v("5h", 100), v("7d", 58)], undefined, true, ahora), { nivel: "sin", ventana: "5h" });
  assert.deepEqual(estadoCuenta([v("5h", 100), v("7d", 100)], undefined, true, ahora), { nivel: "sin", ventana: "7d" }, "con la semana llena, manda la semana");
  assert.deepEqual(estadoCuenta([v("5h", 100, { deshabilitada: true }), v("7d", 5)], undefined, true, ahora), { nivel: "ok" }, "lo que no rige no cuenta");
  assert.deepEqual(estadoCuenta([], undefined, true, ahora), { nivel: "sindato" });
  assert.deepEqual(estadoCuenta([v("5h", null)], undefined, null, ahora), { nivel: "sindato" });
  assert.deepEqual(estadoCuenta([v("5h", 100)], undefined, false, ahora), { nivel: "desconectada" }, "sin conectar manda sobre el cupo");
  assert.deepEqual(estadoCuenta([v("5h", 5)], ahora + 60, true, ahora), { nivel: "marcada" });
  assert.deepEqual(estadoCuenta([v("5h", 5)], ahora - 60, true, ahora), { nivel: "ok" }, "una marca vencida ya no cuenta");
});

test("una suscripción repartida en grupos muestra el grupo más usado", () => {
  const grupos = [
    { id: "a", nombre: "A", ventanas: [v("5h", 6)] },
    { id: "b", nombre: "B", ventanas: [v("5h", 88)], agotado: 50 },
  ];
  const r = ventanasDeSusc({ grupos });
  assert.equal(r.grupo?.id, "b");
  assert.equal(r.agotado, 50);
  assert.deepEqual(ventanasDeSusc(undefined), { ventanas: [], agotado: undefined, grupo: null });
  assert.equal(ventanasDeSusc({ ventanas: [v("5h", 1)], grupos }).grupo, null, "las ventanas propias mandan");
});

test("la cuenta en uso: la que marca el motor; sin marca, la de siempre", () => {
  const a = { id: "a", preferida: false, defecto: true };
  const b = { id: "b", preferida: true, defecto: false };
  assert.equal(esEnUso(b, [a, b]), true);
  assert.equal(esEnUso(a, [a, b]), false);
  const c = { ...b, preferida: false };
  assert.equal(esEnUso(a, [a, c]), true);
  assert.equal(esEnUso(c, [a, c]), false);
});

const fila = (id: string, enUso: boolean, estado: FilaResumen["estado"], pcts: number[] = []): FilaResumen => ({ id, nombre: id, enUso, estado, ventanas: pcts.map((p, i) => v(String(i), p)) });

test("el aviso: sólo con varias cuentas y con la de uso apretada; propone la de más lugar y nunca cambia sola", () => {
  assert.equal(hallazgo([fila("a", true, { nivel: "poco", ventana: "7d" })]), null, "con una sola no hay a dónde ir");
  assert.equal(hallazgo([fila("a", true, { nivel: "ok" }), fila("b", false, { nivel: "ok" })]), null);
  assert.equal(hallazgo([fila("a", false, { nivel: "poco", ventana: "7d" }), fila("b", true, { nivel: "ok" })]), null, "la que aprieta no es la de uso");
  assert.deepEqual(hallazgo([fila("a", true, { nivel: "poco", ventana: "7d" }, [92]), fila("b", false, { nivel: "ok" }, [40]), fila("c", false, { nivel: "ok" }, [10]), fila("d", false, { nivel: "sin", ventana: "5h" }, [100])]), { nombre: "a", nivel: "poco", ventana: "7d", otra: "c" });
  assert.deepEqual(hallazgo([fila("a", true, { nivel: "sin", ventana: "5h" }, [100]), fila("b", false, { nivel: "sin", ventana: "7d" }, [100])]), { nombre: "a", nivel: "sin", ventana: "5h", otra: null });
});
