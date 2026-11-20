// El movimiento de Trama (`src/movimiento.ts` + `src/movimiento-estilos.css`): un solo juego de constantes, el CSS lo espeja, y con
// `prefers-reduced-motion` no queda desplazamiento ni escala, sólo fundido. Sólo opacity/transform (nunca width/height).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CURVA_CORTA, CURVA_SUAVE, DESPLAZA, DUR, ESCALA_BOTON, ESCALON, retardo, desplaza, variantesLista, variantesPanel } from "../src/movimiento.ts";

const css = readFileSync(new URL("../src/movimiento-estilos.css", import.meta.url), "utf8");
const indice = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const [base, reducido = ""] = css.split("@media (prefers-reduced-motion: reduce)");
const raiz = base.match(/:root \{([^}]*)\}/)![1];
const valor = (nombre: string, bloque = raiz) => bloque.match(new RegExp(`--${nombre}:\\s*([^;]+);`))?.[1].trim();

test("el CSS espeja las constantes de movimiento.ts", () => {
  assert.equal(valor("mov-entra"), `${DUR.entra}ms`);
  assert.equal(valor("mov-sale"), `${DUR.sale}ms`);
  assert.equal(valor("mov-fundido"), `${DUR.fundido}ms`);
  assert.equal(valor("mov-boton"), `${DUR.boton}ms`);
  assert.equal(valor("mov-escalon"), `${ESCALON.paso}ms`);
  assert.equal(valor("mov-desp-panel"), `${DESPLAZA.panel}px`);
  assert.equal(valor("mov-desp-mensaje"), `${DESPLAZA.mensaje}px`);
  assert.equal(valor("mov-desp-lista"), `${DESPLAZA.lista}px`);
  assert.equal(valor("mov-pulsa"), String(ESCALA_BOTON));
  assert.equal(valor("mov-resorte"), CURVA_SUAVE);
  assert.equal(valor("mov-resorte-corto"), CURVA_CORTA);
});

test("con prefers-reduced-motion no hay desplazamiento ni escala: sólo fundido", () => {
  for (const n of ["mov-desp-panel", "mov-desp-mensaje", "mov-desp-lista"]) assert.equal(valor(n, reducido), "0px", n);
  assert.equal(valor("mov-pulsa", reducido), "1");
  assert.equal(valor("mov-escalon", reducido), "0ms");
  // Y lo que mueve cosas en JS también: desplazamiento cero y un fundido en vez del resorte.
  assert.equal(desplaza(DESPLAZA.panel, true), 0);
  const p = variantesPanel(true);
  assert.equal(p.initial.y, 0);
  assert.equal(p.animate.transition.type, undefined);
  assert.equal(variantesLista(3, true).initial.y, 0);
  assert.equal(variantesLista(3, true).animate.transition.delay, 0);
  assert.equal(variantesPanel(false).initial.y, DESPLAZA.panel);
  assert.equal(variantesPanel(false).animate.transition.type, "spring");
});

test("lo que sale es más rápido que lo que entra", () => {
  assert.ok(DUR.sale < DUR.entra);
  assert.ok(variantesPanel(false).exit.transition.duration < DUR.entra / 1000);
});

test("el escalonado se corta en el máximo: el resto entra junto", () => {
  assert.equal(retardo(0), 0);
  assert.equal(retardo(1), ESCALON.paso / 1000);
  assert.equal(retardo(ESCALON.max - 1), retardo(ESCALON.max + 20));
  assert.equal(retardo(-3), 0);
  assert.equal(retardo(5, true), 0);
  // En CSS: del primero al séptimo su `--i`, y del octavo en adelante el último.
  const maxima = [...css.matchAll(/:nth-child\((\d+)\)[^{]*\{\s*--i: (\d+);/g)].map((m) => [+m[1], +m[2]]);
  assert.equal(maxima.length, ESCALON.max - 1);
  for (const [n, i] of maxima) assert.equal(i, n - 1);
  assert.match(css, new RegExp(`\\.mov-lista > \\*[^{]*\\{\\s*--i: ${ESCALON.max - 1};`));
});

test("sólo opacity, translate y scale: nada de width/height ni duraciones sueltas", () => {
  for (const k of css.matchAll(/@keyframes [\w-]+ \{[\s\S]*?\n\}/g)) assert.doesNotMatch(k[0], /width|height|margin|top:|left:/);
  const lineas = css.split("\n").filter((l) => /^\s*(animation|transition)(-delay)?:/.test(l));
  assert.ok(lineas.length > 5);
  for (const l of lineas) assert.doesNotMatch(l, /\d(ms|s)\b(?!\))/, l);
});

test("el CSS que apaga animaciones en reduced-motion deja pasar lo de movimiento-estilos.css", () => {
  const regla = indice.match(/\.app \*:not\(:is\(([^]*?)\)\),\n\s*\.app \*::before/)![1];
  for (const s of [".seg", ".at-caja", ".vuelo", ".avc-g", ".cmenu", ".seg-fondo", ".at", ".conv[data-asentado] > *", ".mov-lista > *"]) {
    assert.ok(regla.includes(s), `falta ${s} en la excepción de reduced-motion`);
    assert.ok(css.includes(s), `${s} no está en movimiento-estilos.css`);
  }
});
