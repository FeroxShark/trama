// Virtualización de la lista: arriba de 200 filas, cada lista de filas (los
// workers de una carpeta, los cerrados) pinta sólo las que caen cerca de lo
// visible y el resto es relleno (padding). Así Motion mide decenas de nodos y
// no cientos. Las filas miden todas lo mismo (dos líneas): se mide una y listo.
//
// Las posiciones salen de `offsetTop` y no de getBoundingClientRect: los FLIP
// de Motion ponen transforms y el rect mentiría mientras animan.
import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Arriba de esto se virtualiza (regla del proyecto). */
export const UMBRAL = 200;
/** Cuánto se pinta de más arriba y abajo de lo visible, en px. */
const MARGEN = 600;
/** El rango se redondea a múltiplos de esto: scrollear no re-renderiza en cada fila. */
const PASO = 8;
/** Alto de fila hasta que haya una para medir. */
const ALTO_DEF = 44;

let lista: HTMLElement | null = null;
let alto = 0;
const listas = new Set<() => void>();
const buscadores = new Set<(id: string) => boolean>();

/** La caja que scrollea. */
export function ponerLista(el: HTMLElement | null) {
  lista = el;
}

/** Scrolleó, cambió de tamaño o se movió algo: cada lista recalcula su rango. */
export function avisarVentana() {
  for (const f of listas) f();
}

/** Lleva a la vista una fila que puede no estar pintada. `false` si no la encontró. */
export function irA(id: string): boolean {
  for (const f of buscadores) if (f(id)) return true;
  return false;
}

/** Cambió el tamaño de letra: las filas miden otra cosa, se vuelve a medir y a calcular. */
export function olvidarAlto() {
  alto = 0;
  avisarVentana();
}

// El alto del estilo calculado y no `offsetHeight`: con la letra agrandada una
// fila mide px con decimales, y redondeado el relleno se corre de a poco.
function altoFila(): number {
  if (alto) return alto;
  const fila = lista?.querySelector<HTMLElement>(".w");
  const w = fila ? parseFloat(getComputedStyle(fila).height) || fila.offsetHeight : 0;
  if (w > 0) alto = w;
  return w || ALTO_DEF;
}

/** Dónde empieza `el` adentro de la lista (en px de contenido, sin transforms). */
function arriba(el: HTMLElement): number {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== lista) {
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return y;
}

export type Rango = { desde: number; hasta: number; antes: number; despues: number };

/**
 * El rango de filas a pintar de una lista de `ids`. Sin `activo`, todas. El
 * `ref` es el elemento donde empieza la primera fila (su padding de arriba es
 * el relleno de `antes`).
 */
export function useVentana(ref: RefObject<HTMLElement | null>, ids: string[], activo: boolean): Rango {
  const n = ids.length;
  const [r, setR] = useState<[number, number]>(() => (activo ? [0, 0] : [0, n]));

  const calcular = useCallback(() => {
    const el = ref.current;
    let a = 0;
    let b = n;
    if (activo) {
      if (!el || !lista) return;
      const h = altoFila();
      const y = arriba(el);
      const y0 = lista.scrollTop - MARGEN - y;
      const y1 = lista.scrollTop + lista.clientHeight + MARGEN - y;
      a = Math.max(0, Math.floor(Math.floor(y0 / h) / PASO) * PASO);
      b = Math.min(n, Math.ceil(Math.ceil(y1 / h) / PASO) * PASO);
      if (a >= b) a = b = 0;
    }
    setR((p) => (p[0] === a && p[1] === b ? p : [a, b]));
  }, [ref, n, activo]);

  useLayoutEffect(() => {
    calcular();
    listas.add(calcular);
    return () => void listas.delete(calcular);
  }, [calcular]);

  useEffect(() => {
    if (!activo) return;
    const buscar = (id: string) => {
      const i = ids.indexOf(id);
      if (i < 0 || !ref.current || !lista) return false;
      const h = altoFila();
      const y = arriba(ref.current) + i * h;
      if (y < lista.scrollTop) lista.scrollTop = y;
      else if (y + h > lista.scrollTop + lista.clientHeight) lista.scrollTop = y + h - lista.clientHeight;
      return true;
    };
    buscadores.add(buscar);
    return () => void buscadores.delete(buscar);
  }, [ref, ids, activo]);

  const [desde, hasta] = activo ? [Math.min(r[0], n), Math.min(r[1], n)] : [0, n];
  const h = activo ? altoFila() : 0;
  return { desde, hasta, antes: desde * h, despues: (n - hasta) * h };
}
