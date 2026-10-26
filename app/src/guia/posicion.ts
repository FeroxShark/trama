// Dónde va el globo de una guía respecto de su ancla: del lado que prefiere, o del contrario si ahí no entra, y siempre adentro de la
// ventana. Puro (rectángulos y números): lo prueba tests/guia.test.ts.
import type { Lado } from "./registro";

export type Rect = { x: number; y: number; w: number; h: number };
export type Lugar = { x: number; y: number; lado: Lado };

const CONTRARIO: Record<Lado, Lado> = { arriba: "abajo", abajo: "arriba", izquierda: "derecha", derecha: "izquierda" };

/** El aire entre el ancla y el globo, y entre el globo y el borde de la ventana. */
export const HUECO = 12;
export const MARGEN = 12;

const ajustar = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));

/** ¿Entra el globo del lado `lado` sin salirse de la ventana? */
function entra(a: Rect, g: { w: number; h: number }, v: { w: number; h: number }, lado: Lado): boolean {
  if (lado === "arriba") return a.y - HUECO - g.h >= MARGEN;
  if (lado === "abajo") return a.y + a.h + HUECO + g.h <= v.h - MARGEN;
  if (lado === "izquierda") return a.x - HUECO - g.w >= MARGEN;
  return a.x + a.w + HUECO + g.w <= v.w - MARGEN;
}

/**
 * `a`: el ancla; `g`: el tamaño del globo; `v`: la ventana. Prueba el lado pedido, el contrario y los otros dos; si en ninguno entra
 * (un ancla enorme), lo apoya adentro del ancla, abajo a la derecha, que siempre se ve.
 */
export function colocar(a: Rect, g: { w: number; h: number }, v: { w: number; h: number }, pref: Lado = "abajo"): Lugar {
  const orden: Lado[] = [pref, CONTRARIO[pref], ...(["abajo", "arriba", "derecha", "izquierda"] as Lado[]).filter((l) => l !== pref && l !== CONTRARIO[pref])];
  const lado = orden.find((l) => entra(a, g, v, l));
  const centroX = a.x + a.w / 2 - g.w / 2;
  const centroY = a.y + a.h / 2 - g.h / 2;
  const x0 = (x: number) => ajustar(x, MARGEN, v.w - MARGEN - g.w);
  const y0 = (y: number) => ajustar(y, MARGEN, v.h - MARGEN - g.h);
  if (!lado) return { x: x0(a.x + a.w - g.w - HUECO), y: y0(a.y + a.h - g.h - HUECO), lado: pref };
  if (lado === "arriba") return { x: x0(centroX), y: a.y - HUECO - g.h, lado };
  if (lado === "abajo") return { x: x0(centroX), y: a.y + a.h + HUECO, lado };
  if (lado === "izquierda") return { x: a.x - HUECO - g.w, y: y0(centroY), lado };
  return { x: a.x + a.w + HUECO, y: y0(centroY), lado };
}
