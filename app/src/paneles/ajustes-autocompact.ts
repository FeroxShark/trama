// «Contexto antes de compactar» de Ajustes > Modelos: el tope por familia de `autocompact` en modelos.json (lo lee `pa`). Puro (sin React):
// lo prueba tests/ajustes-autocompact.test.ts. `null` es nativo (`pa` no pasa `--autocompact`); sin la entrada manda `pa`: Haiku 300 000, el resto nativo.
import { AUTOCOMPACT_FAMILIAS, AUTOCOMPACT_HAIKU, AUTOCOMPACT_MAX, AUTOCOMPACT_MIN, type TopeCompactar } from "../../electron/modelos-tipos";
import type { Borrador } from "./modelos-borrador";

export { AUTOCOMPACT_FAMILIAS, AUTOCOMPACT_HAIKU };
export const COMPACTAR_MIN_K = AUTOCOMPACT_MIN / 1000;
export const COMPACTAR_MAX_K = AUTOCOMPACT_MAX / 1000;
/** Atajos del selector, en tokens. */
export const COMPACTAR_PRESETS = [100_000, 200_000, 500_000] as const;
export type Familia = (typeof AUTOCOMPACT_FAMILIAS)[number];

/** El tope que vale para una familia según el borrador (lo mismo que resuelve `pa`, sin `PA_AUTOCOMPACT`). */
export function topeEfectivo(b: Borrador, fam: Familia): TopeCompactar {
  const a = b.autocompact;
  if (fam in a.por_modelo) return a.por_modelo[fam] ?? null;
  if (a.defecto !== null) return a.defecto;
  return fam === "haiku" ? AUTOCOMPACT_HAIKU : null;
}

/** La familia no tiene entrada propia: vale lo predeterminado. */
export const esPredeterminado = (b: Borrador, fam: Familia): boolean => !(fam in b.autocompact.por_modelo);

/**
 * Pone el tope de una familia. Lo que coincide con lo que valdría sin la entrada no se anota (el archivo queda corto); nativo en una
 * familia que de otro modo no lo sería (Haiku, o con un `defecto` numérico) se anota como `null`.
 */
export function ponerTope(b: Borrador, fam: Familia, valor: TopeCompactar): Borrador {
  const por = { ...b.autocompact.por_modelo };
  delete por[fam];
  const sin: Borrador = { ...b, autocompact: { ...b.autocompact, por_modelo: por } };
  if (topeEfectivo(sin, fam) !== valor) por[fam] = valor;
  return { ...b, autocompact: { ...b.autocompact, por_modelo: por } };
}

/** El campo en miles de tokens ("250" → 250 000). Vacío = sin valor y sin error; si no sirve, la clave del motivo. */
export function topeDeK(texto: string): { valor: number | null; error: string | null } {
  const s = texto.trim().replace(/\s*k$/i, "").replace(/[\s._']/g, "");
  if (!s) return { valor: null, error: null };
  if (!/^\d+$/.test(s)) return { valor: null, error: "ajustes.errRedNumero" };
  const k = Number(s);
  if (k < COMPACTAR_MIN_K || k > COMPACTAR_MAX_K) return { valor: null, error: "ajustes.errCompactarRango" };
  return { valor: k * 1000, error: null };
}

/** 300000 → "300" (para el campo y los chips). */
export const kDeTope = (tokens: number): string => String(Math.round(tokens / 1000));
