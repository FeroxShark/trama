// «Ver la tarjeta» de una revisión, sin React (la prueba tests/revision-ver.test.ts). La tarjeta del revisor en el chat es
// `section.rv` dentro de `.conv` (TarjetaRevision); la sección viva (`rv rvv`) vive fuera del chat, en la caja de abajo, así que
// no puede ser el destino. Si la tarjeta todavía no llegó (la entrega va por la cola del líder), no hay adónde ir: `RevisionVista`
// espera y vuelve a mirar cuando el chat cambia.

/** El selector de las tarjetas del revisor en el chat. */
export const SELECTOR_TARJETAS = ".conv .rv";

/** Lo mínimo de una tarjeta para llevarla a la vista. */
export type Llevable = { scrollIntoView(opciones: ScrollIntoViewOptions): void };
/** Lo que este módulo necesita del chat: su zona (`.conv-zona`) y cómo buscar sus tarjetas. */
export type ZonaChat<T extends Llevable> = { querySelectorAll(selector: string): ArrayLike<T> };

/** ¿Ya llegó la tarjeta de esta revisión? `base`: cuántas había en el chat al empezarla (`null`: no se midió, alcanza con una). */
export function llego(base: number | null, ahora: number): boolean {
  return base === null ? ahora > 0 : ahora > base;
}

/** Cuántas tarjetas de revisión hay en el chat ahora (con esto se sabe cuándo llega la nueva). */
export function contarTarjetas<T extends Llevable>(zona: ZonaChat<T>): number {
  return zona.querySelectorAll(SELECTOR_TARJETAS).length;
}

/**
 * Lo que hace «Ver la tarjeta»: la tarjeta de la revisión (la última del chat, donde cae lo recién entregado) si ya llegó;
 * `null` si todavía no (el botón dice «En camino» hasta que aparezca).
 */
export function verTarjeta<T extends Llevable>(base: number | null, zona: ZonaChat<T>): T | null {
  const tarjetas = Array.from(zona.querySelectorAll(SELECTOR_TARJETAS));
  if (!llego(base, tarjetas.length)) return null;
  return tarjetas[tarjetas.length - 1] ?? null;
}
