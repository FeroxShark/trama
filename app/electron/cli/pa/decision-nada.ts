// ¿La DECISION de un worker es «nada»? Una sola función para lanzar (resultado-lanzar.ts), los hilos (hilos.ts) y el tablero
// (ramas.ts). Sólo-TS: el bash congelado acepta nada más que «nada» exacto. Medido el 2026-11-25: «nada. No hay cambios propios
// que commitear… Ningún trabajo quedó sin terminar.» entraba al tablero como pregunta para el dueño (item 2531).
// A propósito es angosta: de 18 decisiones que empezaban negando en 30 días, 15 traían algo para leer (supuestos, lo que
// quedó sin terminar, algo a confirmar) y tienen que seguir como pendiente. Sin imports: es puro.

/** «nada» y sus formas largas, con o sin punto. */
const NADA = /^nada(?: (?:que|para) decidir)?\.?$/i;
/** Lo mismo, seguido de más texto. */
const NADA_Y_MAS = /^nada(?: (?:que|para) decidir)?\.\s+(.+)$/is;
/** Con esto adentro hay algo para leer aunque empiece con «nada»: se deja como pendiente. */
const HAY_ALGO = /\?|supuest|confirm|conviene|hay que|deber|salvo|pero|aunque/i;
/** Una oración que sólo dice que no hay nada («No hay…», «No hice…», «Ningún trabajo quedó…», «Sin cambios»). */
const FIN = "(?![a-záéíóúñ])"; // `\b` no sirve después de una vocal con tilde
const SOLO_NIEGA = new RegExp(
  `^(?:no (?:hay|hubo|hice|qued[oó]|requiere|aplica|hace falta)${FIN}|ning[uú]n[oa]? [^.]*\\b(?:qued[oó]|hay|hubo|pendiente)${FIN}|sin (?:cambios|decisiones|pendientes)${FIN})`,
  "i",
);

/**
 * «nada» (sin asteriscos ni espacios, a lo sumo un punto final; también «nada que decidir») o eso mismo seguido SÓLO de
 * oraciones que dicen que no hay nada. «nada. Supuestos: …», «nada, salvo…» y «nada. Quedó sin terminar…» siguen contando
 * como pendiente.
 */
export function decisionEsNada(d: string): boolean {
  const x = d.replace(/\*/g, "").replace(/^\s+|\s+$/g, "");
  if (NADA.test(x)) return true;
  const m = NADA_Y_MAS.exec(x);
  if (!m) return false;
  const resto = m[1]!;
  if (HAY_ALGO.test(resto)) return false;
  const oraciones = resto
    .split(/[.;]\s+|\n+/)
    .map((s) => s.replace(/[.;\s]+$/, "").trim())
    .filter(Boolean);
  return oraciones.length > 0 && oraciones.every((s) => SOLO_NIEGA.test(s));
}
