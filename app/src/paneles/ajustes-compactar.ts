// Cuándo compacta Claude solo (`autoCompactWindow` de ~/.claude/settings.json): las opciones del selector de General.
// Puro (sin React): lo prueba tests/ajustes-borrador.test.ts. Se escribe con la misma lógica de la red de seguridad
// (`red_seguridad`, ajustes-editar.ts): un entero entre RED_MIN y RED_MAX; "sin tope" es el máximo que acepta Claude Code.
import { RED_MAX, RED_MIN } from "../../electron/valida-ajustes";

/** Atajos del campo numérico, en tokens (el campo en sí es en miles de tokens: RED_MIN_K..RED_MAX_K de a PASO_K). */
export const TOPES = [100_000, 150_000, 200_000, 300_000, RED_MAX] as const;
export const PRESETS_K = [100, 150, 200, 300] as const;
export const RED_MIN_K = RED_MIN / 1000;
export const RED_MAX_K = RED_MAX / 1000;
export const PASO_K = 10;

/**
 * El campo de miles de tokens ("250" → 250 000). Lo usan Ajustes y la Bienvenida: una sola regla y una sola clave guardada
 * (`red_seguridad` → `autoCompactWindow`). Vacío = `valor: null` sin error (nada que guardar); un texto que no sirve trae la clave del motivo.
 */
export function umbralDeK(texto: string): { valor: number | null; error: string | null } {
  const s = texto.trim().replace(/\s*k$/i, "").replace(/[\s._']/g, "");
  if (!s) return { valor: null, error: null };
  if (!/^\d+$/.test(s)) return { valor: null, error: "ajustes.errRedNumero" };
  const k = Number(s);
  if (k < RED_MIN_K || k > RED_MAX_K) return { valor: null, error: "ajustes.errUmbralRango" };
  return { valor: k * 1000, error: null };
}
/** 250000 → "250" (para el campo). Un valor a mano que no es de miles enteros se redondea para mostrar. */
export const kDe = (tokens: number): string => String(Math.round(tokens / 1000));
/** Con el settings sin `autoCompactWindow` el selector muestra este. */
export const TOPE_DEFECTO = 200_000;
export const SIN_TOPE = RED_MAX;

/** Lo que dice el selector para un borrador (`""` = sin definir en el archivo; un texto que no es número no pasa de acá). */
export const topeDe = (red: string): number => (red.trim() === "" ? TOPE_DEFECTO : Number(red));

/** Los topes de siempre y, si el archivo trae otro (un 350 000 a mano), ese también, en su lugar. */
export const topesCon = (actual: number): number[] => (Number.isFinite(actual) && !(TOPES as readonly number[]).includes(actual) ? [...TOPES, actual].sort((a, b) => a - b) : [...TOPES]);

/** 200000 → "200 000" (es, con espacio que no corta) o "200,000" (en). */
export const conMiles = (n: number, idioma: string): string => String(n).replace(/\B(?=(\d{3})+$)/g, idioma === "es" ? "\u00a0" : ",");

/** El borrador de la compactación es el texto del número guardado (`""` si no hay); `sucio` es que difiera, y `cambio` lo que se manda. */
export const redDesde = (guardado: number | null): string => (guardado === null ? "" : String(guardado));
export const redPara = (guardado: number | null, borrador: string): { cambio: { red_seguridad: number } | null; sucio: boolean } => {
  const sucio = borrador !== redDesde(guardado);
  return { cambio: sucio ? { red_seguridad: topeDe(borrador) } : null, sucio };
};
