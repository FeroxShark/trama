// Seguir el fondo de un scroll mientras llega contenido (el chat entero y la
// lista de pasos de un trabajo abierto): pegado al fondo, cada cosa nueva lo
// deja al fondo; si el usuario sube a mano, se suelta; cuando vuelve al final, se
// pega de nuevo. Sin polling: lo llama quien sabe que llegó algo (un
// ResizeObserver, un layout effect) y el evento `scroll`.
// Puro sobre lo que mide un elemento: lo prueba `tests/seguir.test.ts`.

/** Lo que se mira de un elemento con scroll. */
export type Zona = { scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number };

/**
 * `top`: dónde quedó el scroll la última vez que se miró (lo que baje de ahí, lo subió el usuario).
 * `alto`: cuánto medía el contenido esa vez (para saber si estaba al final antes de que creciera).
 */
export type Seguidor = { pegado: boolean; top: number; alto: number };

/** A menos de esto del final cuenta como "al final" (px: medio renglón). */
export const UMBRAL = 8;

export const seguidor = (): Seguidor => ({ pegado: true, top: 0, alto: 0 });

export const lejos = (z: Zona) => z.scrollHeight - z.scrollTop - z.clientHeight;

/** Escondida (un panel encima, `display: none`) no mide nada: de ahí no se saca si el usuario subió o volvió. */
const escondida = (z: Zona) => !z.clientHeight;

/** Al fondo sí o sí (mandó un mensaje, abrió la vista) y, desde ahí, siguiendo. */
export function bajar(z: Zona, s: Seguidor) {
  z.scrollTop = z.scrollHeight;
  s.top = z.scrollTop;
  s.alto = z.scrollHeight;
  s.pegado = true;
}

/**
 * Llegó contenido: al fondo si venía pegado. Si el scroll está más arriba de
 * donde se lo dejó, el usuario subió y el evento `scroll` todavía no llegó: se suelta.
 * Y al revés: suelto, pero parado en el final de lo que había antes de que
 * creciera, es que volvió al fondo y el `scroll` tampoco llegó: se pega.
 * Escondida y suelto, queda como estaba (pegado, al volver a verse va al fondo).
 */
export function seguir(z: Zona, s: Seguidor) {
  if (!s.pegado) {
    if (escondida(z)) return;
    const volvio = z.scrollHeight > s.alto && s.alto - z.scrollTop - z.clientHeight < UMBRAL;
    if (volvio) return bajar(z, s);
    s.alto = z.scrollHeight;
    return;
  }
  if (z.scrollTop + 1 < s.top && lejos(z) >= UMBRAL) {
    s.pegado = false;
    s.top = z.scrollTop;
    s.alto = z.scrollHeight;
    return;
  }
  bajar(z, s);
}

/**
 * El evento `scroll`. Sólo subir suelta: que el contenido crezca abajo aleja el
 * final sin mover el scroll, y eso no es el usuario yéndose.
 */
export function alScroll(z: Zona, s: Seguidor) {
  if (escondida(z)) return;
  if (lejos(z) < UMBRAL) s.pegado = true;
  else if (z.scrollTop + 1 < s.top) s.pegado = false;
  // Suelto y sin llegar al final de ahora, pero sí al de antes de que creciera: volvió al fondo.
  else if (!s.pegado && z.scrollTop > s.top && s.alto - z.scrollTop - z.clientHeight < UMBRAL) s.pegado = true;
  s.top = z.scrollTop;
  s.alto = z.scrollHeight;
}

/** Se movió el scroll a propósito (al anteponer una página): no es el usuario subiendo. */
export function anotar(z: Zona, s: Seguidor) {
  if (escondida(z)) return;
  s.top = z.scrollTop;
  s.alto = z.scrollHeight;
  s.pegado = lejos(z) < UMBRAL;
}
