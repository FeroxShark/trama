// El modo debate en la ventana, la lógica sin React (src/hilo/debate-logica.ts): cuándo sigue vivo, qué botones tiene cada fase, quién habla.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accionesDebate, claveMotivo, debateVivo, duracionDebate, minutosQueFaltan, peorCasoLlamadas, quienHabla } from "../src/hilo/debate-logica.ts";
import type { FaseDebate } from "../electron/debate-texto.ts";

const FASES: FaseDebate[] = ["corriendo", "esperando", "concluyendo", "entregando", "hecho", "cancelado", "fallo"];

test("debateVivo: corre hasta que termina, se cancela o falla", () => {
  assert.deepEqual(FASES.map((fase) => debateVivo({ fase })), [true, true, true, true, false, false, false]);
  assert.equal(debateVivo(null), false);
});

test("botones por fase: cortar sólo mientras debaten, cancelar hasta que empieza la entrega, «Ver la tarjeta» sólo al terminar bien", () => {
  const a = (f: FaseDebate) => accionesDebate(f);
  assert.deepEqual(a("corriendo"), { cortar: true, cancelar: true, ver: false, cerrar: false });
  assert.deepEqual(a("esperando"), { cortar: true, cancelar: true, ver: false, cerrar: false });
  assert.deepEqual(a("concluyendo"), { cortar: false, cancelar: true, ver: false, cerrar: false });
  assert.deepEqual(a("entregando"), { cortar: false, cancelar: false, ver: false, cerrar: false });
  assert.deepEqual(a("hecho"), { cortar: false, cancelar: false, ver: true, cerrar: true });
  assert.deepEqual(a("cancelado"), { cortar: false, cancelar: false, ver: false, cerrar: true });
  assert.deepEqual(a("fallo"), { cortar: false, cancelar: false, ver: false, cerrar: true });
});

test("quienHabla: el primero que sigue y todavía no habló en la ronda; nadie al concluir", () => {
  const ps = [
    { modelo: "a", nombre: "A", effort: "", turnos: 1, activo: true },
    { modelo: "b", nombre: "B", effort: "", turnos: 0, activo: false },
    { modelo: "c", nombre: "C", effort: "", turnos: 0, activo: true },
  ];
  assert.equal(quienHabla({ fase: "corriendo", ronda: 1, participantes: ps })?.modelo, "c");
  assert.equal(quienHabla({ fase: "corriendo", ronda: 2, participantes: ps })?.modelo, "a");
  assert.equal(quienHabla({ fase: "concluyendo", ronda: 1, participantes: ps }), null);
  assert.equal(quienHabla({ fase: "corriendo", ronda: 0, participantes: ps }), null);
});

test("tiempo, costo y plazo de la pregunta", () => {
  assert.equal(duracionDebate({ inicio: 1000, fin: null }, 4000), 3000);
  assert.equal(duracionDebate({ inicio: 1000, fin: 2000 }, 9999), 1000);
  assert.equal(peorCasoLlamadas(3, 3), 10);
  assert.equal(peorCasoLlamadas(2, 2), 5);
  assert.equal(peorCasoLlamadas(2, 9), 7, "las rondas topean en 3");
  assert.equal(minutosQueFaltan(10 * 60_000, 0), 10);
  assert.equal(minutosQueFaltan(60_000, 59_999), 1);
  assert.equal(minutosQueFaltan(0, 5000), 1);
  assert.equal(claveMotivo("cortado"), "debate.motivo.cortado");
  assert.equal(claveMotivo(null), "debate.motivo.tope");
});
