// Qué tiene para decir una fila del uso del plan (5 h / Semana), sin React: el porcentaje, la hora en
// que se reinicia o que no se sabe, y "sin dato" sólo cuando no hay ni porcentaje. Un porcentaje nunca
// se muestra como "sin dato". Puro: lo prueba `tests/uso-fila.test.ts`; la regla está en docs/piezas.md (Cabecera).
import type { Ventana } from "../datos/contrato";

export type Fila =
  | { cuando: "sinDato"; pct: null; hasta: null }
  /** Hay porcentaje y no se sabe cuándo se reinicia: el número va solo. */
  | { cuando: "sinHora"; pct: number; hasta: null }
  | { cuando: "hora"; pct: number; hasta: number };

export function filaDe(v: Ventana | null | undefined): Fila {
  if (!v) return { cuando: "sinDato", pct: null, hasta: null };
  const pct = Math.max(0, Math.min(100, Math.round(v.pct)));
  return typeof v.resets_at === "number" ? { cuando: "hora", pct, hasta: v.resets_at } : { cuando: "sinHora", pct, hasta: null };
}

/** Extrae día y mes de una fecha ISO corta (`YYYY-MM-DD`) para mostrar `hasta 2/11`. */
export function formatearHasta(iso: string | undefined): { d: number; m: number } | null {
  if (!iso) return null;
  const m = new RegExp("^(\\d{4})-(\\d{2})-(\\d{2})").exec(iso.trim());
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (!dia || !mes || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return { d: dia, m: mes };
}
