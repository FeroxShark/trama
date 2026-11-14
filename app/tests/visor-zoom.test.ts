// El visor de imágenes (src/hilo/visor-zoom.ts): abre con la imagen entera, el clic alterna Ajustar ↔ 100 % y el arrastre no deja huecos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { escalaAjuste, limitarPan, puedeArrastrar, siguienteEscalaAlClic, zoomHaciaPunto } from "../src/hilo/visor-zoom.ts";

test("Ajustar: una imagen muy alta entra entera; una chica no se agranda", () => {
  assert.equal(escalaAjuste(800, 3000, 1600, 900), 0.3);
  assert.equal(escalaAjuste(200, 100, 1600, 900), 1);
});

test("el clic alterna entre Ajustar y 100 %", () => {
  assert.equal(siguienteEscalaAlClic(0.3, 0.3), 1);
  assert.equal(siguienteEscalaAlClic(1, 0.3), 0.3);
  assert.equal(siguienteEscalaAlClic(2.5, 0.3), 0.3);
});

test("sin zoom, una imagen que no entra se puede arrastrar; ajustada no", () => {
  assert.equal(puedeArrastrar(800, 3000, 0.3, 1600, 900), false);
  assert.equal(puedeArrastrar(800, 3000, 1, 1600, 900), true);
});

test("el arrastre se limita a los bordes de la imagen", () => {
  assert.deepEqual(limitarPan({ x: 500, y: -5000 }, 800, 3000, 1, 1600, 900), { x: 0, y: -1050 });
});

test("zoom hacia un punto: el punto bajo el puntero queda quieto", () => {
  const r = zoomHaciaPunto({ escala: 0.3, pan: { x: 0, y: 0 } }, 1, { ancho: 800, alto: 3000 }, { ancho: 1600, alto: 900 }, 0.3, { x: 0, y: -300 });
  assert.equal(r.escala, 1);
  assert.equal(r.pan.y, 700);
});
