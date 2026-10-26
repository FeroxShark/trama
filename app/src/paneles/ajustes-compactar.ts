// Cuándo compacta Claude solo (`autoCompactWindow` de ~/.claude/settings.json): las opciones del selector de General.
// Puro (sin React): lo prueba tests/ajustes-borrador.test.ts. Se escribe con la misma lógica de la red de seguridad
// (`red_seguridad`, ajustes-editar.ts): un entero entre RED_MIN y RED_MAX; "sin tope" es el máximo que acepta Claude Code.
import { RED_MAX } from "../../electron/valida-ajustes";

/** Lo que Trama ofrece, en tokens. */
export const TOPES = [100_000, 150_000, 200_000, 300_000, RED_MAX] as const;
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
