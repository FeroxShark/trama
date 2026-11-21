// Ajustes > Modelos > «Compactar con nota del modelo»: lógica pura sobre el `Borrador` (validación de porcentajes y actualización).
// Sin React ni puente: lo prueban tests/nota-compactar-main.test.ts.
import {
  NOTA_PCT_DEFECTO,
  NOTA_PCT_MAX,
  NOTA_PCT_MIN,
  NOTA_TAREA_PCT_DEFECTO,
  NOTA_TAREA_PCT_MAX,
  NOTA_TAREA_PCT_MIN,
} from "../../electron/modelos-tipos";
import type { Borrador } from "./modelos-borrador";

export { NOTA_PCT_DEFECTO, NOTA_PCT_MAX, NOTA_PCT_MIN, NOTA_TAREA_PCT_DEFECTO, NOTA_TAREA_PCT_MAX, NOTA_TAREA_PCT_MIN };

/** Parsea un porcentaje entero escrito en texto; `error: true` si no es entero válido dentro de `[min, max]`. */
export function pctNotaDe(texto: string, min: number, max: number): { valor: number | null; error: boolean } {
  const s = texto.trim();
  if (!/^\d{1,3}$/.test(s)) return { valor: null, error: true };
  const n = Number(s);
  if (n < min || n > max) return { valor: null, error: true };
  return { valor: n, error: false };
}

export const ponerNotaCompactar = (b: Borrador, activo: boolean): Borrador => ({ ...b, notaCompactar: activo });

export const ponerNotaCompactarPct = (b: Borrador, texto: string): Borrador => ({ ...b, notaCompactarPct: texto });

export const ponerNotaCompactarTarea = (b: Borrador, activo: boolean): Borrador => ({ ...b, notaCompactarTarea: activo });

export const ponerNotaCompactarTareaPct = (b: Borrador, texto: string): Borrador => ({ ...b, notaCompactarTareaPct: texto });
