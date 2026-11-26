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
/** De quién es el tope: los workers (`autocompact`, lo lee `pa`) o los líderes que arranca Trama (`autocompact_lider`). */
export type Rol = "workers" | "lideres" | "orquestador";

/** La config que vale para ese rol: los líderes sin la suya usan la de los workers. */
const confDe = (b: Borrador, rol: Rol) =>
  rol === "lideres" ? (b.autocompactLider ?? b.autocompact) : rol === "orquestador" ? (b.autocompactOrquestador ?? b.autocompact) : b.autocompact;

/** El tope que vale para una familia según el borrador (lo mismo que resuelve `pa`, sin `PA_AUTOCOMPACT`). */
export function topeEfectivo(b: Borrador, fam: Familia, rol: Rol = "workers"): TopeCompactar {
  const a = confDe(b, rol);
  if (fam in a.por_modelo) return a.por_modelo[fam] ?? null;
  if (a.defecto !== null) return a.defecto;
  return fam === "haiku" ? AUTOCOMPACT_HAIKU : null;
}

/** La familia no tiene entrada propia: vale lo predeterminado. */
export const esPredeterminado = (b: Borrador, fam: Familia, rol: Rol = "workers"): boolean => !(fam in confDe(b, rol).por_modelo);

/** Los líderes con su propio tope (`true`: arranca de una copia del de los workers) o iguales a los workers (`false`: la clave sale). */
export const separarLideres = (b: Borrador, propio: boolean): Borrador =>
  propio ? { ...b, autocompactLider: b.autocompactLider ?? { defecto: b.autocompact.defecto, por_modelo: { ...b.autocompact.por_modelo } } } : { ...b, autocompactLider: null };

/** El orquestador con sus propios topes, o vuelto al preset de contexto. */
export const separarOrquestador = (b: Borrador, propio: boolean): Borrador =>
  propio ? { ...b, autocompactOrquestador: b.autocompactOrquestador ?? { defecto: b.autocompact.defecto, por_modelo: { ...b.autocompact.por_modelo } } } : { ...b, autocompactOrquestador: null };

/**
 * Pone el tope de una familia. Lo que coincide con lo que valdría sin la entrada no se anota (el archivo queda corto); nativo en una
 * familia que de otro modo no lo sería (Haiku, o con un `defecto` numérico) se anota como `null`.
 */
export function ponerTope(b: Borrador, fam: Familia, valor: TopeCompactar, rol: Rol = "workers"): Borrador {
  const base = rol === "lideres" ? separarLideres(b, true) : rol === "orquestador" ? separarOrquestador(b, true) : b;
  const a = rol === "lideres" ? base.autocompactLider! : rol === "orquestador" ? base.autocompactOrquestador! : base.autocompact;
  const por = { ...a.por_modelo };
  delete por[fam];
  const con = (x: typeof a): Borrador =>
    rol === "lideres" ? { ...base, autocompactLider: x } : rol === "orquestador" ? { ...base, autocompactOrquestador: x } : { ...base, autocompact: x };
  if (topeEfectivo(con({ ...a, por_modelo: por }), fam, rol) !== valor) por[fam] = valor;
  return con({ ...a, por_modelo: por });
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
