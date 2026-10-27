// Migración de la inteligencia de modelos.json: de la escala vieja 0–100 a unidades reales de Artificial Analysis (AA).
//
// Antes, `reparto` calibraba el puntaje de AA a 0–100 (Haiku 5.5 → 60, Sonnet 5.5 → 88, Opus 5.5 → 100, línea quebrada entre esos puntos y con la
// pendiente del tramo más cercano afuera). Ahora no hay calibración: `calidad` es el índice de INTELIGENCIA general de AA (coding y agentic son sólo datos extra). Los números que el
// dueño escribió en `calidad`, `calidad_effort` y `minimo_por_tipo` (numérico) son de la escala vieja; se pasan a AA al leerlos con la INVERSA de aquella
// calibración. Las anclas son fijas (valores típicos del índice de inteligencia de AA de esos tres modelos en su mejor esfuerzo: Haiku 5.5 max ~43, Opus 5.5 max ~58; Sonnet 5.5 ~51 es una extrapolación de su high 46,8) para que el pasaje sea el mismo acá y en
// motor/bin/reparto (`vieja_a_aa`, `AA_REF_VIEJA`). Un modelos.json con `"calidad_unidades": "aa"` ya está en unidades de AA y no se toca;
// la app lo escribe al guardar. Puro: lo prueba tests/calidad-migracion.test.ts.

/** (escala vieja, unidades de AA) de Haiku 5.5, Sonnet 5.5 y Opus 5.5. Igual a AA_REF_VIEJA de motor/bin/reparto. */
export const AA_REF_VIEJA: readonly (readonly [number, number])[] = [[60, 43], [88, 51], [100, 58]];

/** El marcador que dice que los números de `calidad` ya son de AA. */
export const UNIDADES_AA = "aa";

/** Una inteligencia de la escala vieja → unidades de AA (un decimal, nunca negativa). */
export function viejaAAa(q: number): number {
  const p = AA_REF_VIEJA;
  const i = q <= p[1][0] ? 0 : 1;
  const [x0, y0] = p[i];
  const [x1, y1] = p[i + 1];
  return Math.round(Math.max(0, y0 + ((y1 - y0) * (q - x0)) / (x1 - x0)) * 10) / 10;
}

/** ¿El archivo ya guarda unidades de AA? */
export const esUnidadesAA = (j: Record<string, unknown>): boolean => j.calidad_unidades === UNIDADES_AA;

/** Lo que hay que pasar por `viejaAAa` si el archivo no es de AA; en AA queda igual. */
export const migrarValor = (v: number, j: Record<string, unknown>): number => (esUnidadesAA(j) ? v : viejaAAa(v));
