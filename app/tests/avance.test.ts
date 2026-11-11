// La lógica de `Avance` (src/ui/avance-logica.ts): el paso «n de 4», el tiempo y el tope de 3 minutos sin línea nueva.
import assert from "node:assert/strict";
import { test } from "node:test";
import { avance, formatoTiempo, LENTO_MS, PASOS, textoPaso } from "../src/ui/avance-logica.ts";
import { es } from "../src/i18n/es.ts";

const T0 = 1_700_000_000_000;

test("el paso se numera en el orden de la instalación", () => {
  assert.deepEqual(PASOS, ["bajando", "compilando", "motor", "ventana"]);
  assert.deepEqual(PASOS.map((p) => avance({ paso: p, ahora: T0 }).n), [1, 2, 3, 4]);
  assert.equal(avance({ paso: "ventana", ahora: T0 }).total, 4);
});

test("sin paso (un estado viejo) muestra el primero, y un paso raro también", () => {
  assert.equal(avance({ ahora: T0 }).paso, "bajando");
  assert.equal(avance({ paso: "otro" as never, ahora: T0 }).n, 1);
});

test("el texto del paso: «Compilando · paso 2 de 4»", () => {
  const tr = (k: string, v?: Record<string, string | number>) => (es as Record<string, string>)[k].replace(/\{(\w+)\}/g, (_, n) => String(v?.[n]));
  assert.equal(textoPaso(avance({ paso: "compilando", ahora: T0 }), tr), "Compilando · paso 2 de 4");
});

test("formatoTiempo: m:ss, con horas h:mm:ss, y lo negativo es cero", () => {
  assert.equal(formatoTiempo(0), "0:00");
  assert.equal(formatoTiempo(72_000), "1:12");
  assert.equal(formatoTiempo(59_999), "0:59");
  assert.equal(formatoTiempo(12 * 60_000 + 5_000), "12:05");
  assert.equal(formatoTiempo(3_723_000), "1:02:03");
  assert.equal(formatoTiempo(-5_000), "0:00");
});

test("el tiempo cuenta desde el inicio del paso; sin `desde` no hay tiempo", () => {
  const a = avance({ paso: "compilando", desde: T0, ahora: T0 + 72_000 });
  assert.equal(a.tiempo, "1:12");
  assert.equal(a.transcurrido, 72_000);
  assert.equal(avance({ paso: "compilando", ahora: T0 }).tiempo, null);
  assert.equal(avance({ paso: "compilando", desde: T0 + 5_000, ahora: T0 }).tiempo, "0:00");
});

test("lento: más de 3 minutos sin línea nueva; justo 3:00 todavía no", () => {
  assert.equal(LENTO_MS, 180_000);
  assert.equal(avance({ paso: "compilando", desde: T0, ahora: T0 + LENTO_MS }).lento, false);
  assert.equal(avance({ paso: "compilando", desde: T0, ahora: T0 + LENTO_MS + 1 }).lento, true);
  assert.equal(avance({ paso: "compilando", desde: T0, ahora: T0 + 60_000 }).lento, false);
});

test("lento mira la línea más reciente del log, no sólo el inicio del paso", () => {
  const ahora = T0 + 10 * 60_000;
  // El paso lleva 10 min pero el log habló hace 1: no es lento.
  assert.equal(avance({ paso: "compilando", desde: T0, ultimaLinea: ahora - 60_000, ahora }).lento, false);
  // El log calló hace 3:01: lento.
  assert.equal(avance({ paso: "compilando", desde: T0, ultimaLinea: ahora - LENTO_MS - 1000, ahora }).lento, true);
  // Una línea más vieja que el inicio del paso no estira el plazo.
  assert.equal(avance({ paso: "motor", desde: ahora - 30_000, ultimaLinea: T0, ahora }).lento, false);
  // Sin `desde` pero con línea vieja: cuenta desde la línea.
  assert.equal(avance({ paso: "motor", ultimaLinea: ahora - LENTO_MS - 1, ahora }).lento, true);
  // Sin nada que contar, no se avisa.
  assert.equal(avance({ paso: "motor", ahora }).lento, false);
});

test("el porcentaje, si llega, se acota a 0–1; sin él es null (la barra se mueve sola)", () => {
  assert.equal(avance({ ahora: T0 }).porcentaje, null);
  assert.equal(avance({ ahora: T0, porcentaje: 0.4 }).porcentaje, 0.4);
  assert.equal(avance({ ahora: T0, porcentaje: 7 }).porcentaje, 1);
  assert.equal(avance({ ahora: T0, porcentaje: -1 }).porcentaje, 0);
  assert.equal(avance({ ahora: T0, porcentaje: NaN }).porcentaje, null);
});
