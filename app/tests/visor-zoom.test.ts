// El visor de imágenes (src/hilo/visor-zoom.ts): abre con la imagen entera, el clic alterna Ajustar ↔ 100 % y el arrastre no deja huecos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { escalaAjuste, galeriaDe, girar, limitarPan, medidaGirada, porcentajeZoom, puedeArrastrar, siguienteEscalaAlClic, vecino, zoomHaciaPunto, type Giro } from "../src/hilo/visor-zoom.ts";

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

test("girar: un cuarto de vuelta a cada lado, y cuatro vuelven al origen", () => {
  assert.equal(girar(0, 1), 90);
  assert.equal(girar(0, -1), 270);
  assert.equal(girar(270, 1), 0);
  assert.equal(girar(90, -1), 0);
  assert.equal([1, 2, 3, 4].reduce<Giro>((g) => girar(g, 1), 0), 0);
});

test("girada de lado, la imagen intercambia ancho y alto y Ajustar la achica para que entre", () => {
  assert.deepEqual(medidaGirada({ ancho: 1200, alto: 800 }, 0), { ancho: 1200, alto: 800 });
  assert.deepEqual(medidaGirada({ ancho: 1200, alto: 800 }, 90), { ancho: 800, alto: 1200 });
  assert.deepEqual(medidaGirada({ ancho: 1200, alto: 800 }, 180), { ancho: 1200, alto: 800 });
  const g = medidaGirada({ ancho: 1200, alto: 800 }, 270);
  assert.equal(escalaAjuste(g.ancho, g.alto, 1600, 900), 0.75);
});

test("galería: sin repetidas, en orden, y la abierta siempre está (sola si el chat no la lista)", () => {
  assert.deepEqual(galeriaDe(["/a.png", "/b.png", "/a.png", "/c.png"], "/b.png"), { rutas: ["/a.png", "/b.png", "/c.png"], indice: 1 });
  assert.deepEqual(galeriaDe(["/a.png", "/b.png"], "/z.png"), { rutas: ["/z.png"], indice: 0 });
  assert.deepEqual(galeriaDe([], "/z.png"), { rutas: ["/z.png"], indice: 0 });
});

test("anterior y siguiente: no dan la vuelta en los extremos", () => {
  assert.equal(vecino(1, 5, 1), 2);
  assert.equal(vecino(1, 5, -1), 0);
  assert.equal(vecino(0, 5, -1), null);
  assert.equal(vecino(4, 5, 1), null);
  assert.equal(vecino(0, 1, 1), null);
});

test("el porcentaje de la barra es la escala entera: Ajustar 71 %, 100 %, 800 %", () => {
  assert.equal(porcentajeZoom(escalaAjuste(1200, 800, 1275, 850)), 100);
  assert.equal(porcentajeZoom(0.7104), 71);
  assert.equal(porcentajeZoom(8), 800);
});
