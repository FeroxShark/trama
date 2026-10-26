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

/** Las unidades ya traducidas (`tiempo.unidad*`) y lo que se dice cuando el reinicio ya pasó. */
export type Unidades = { d: string; h: string; min: string; s: string; ya: string };

const MIN = 60;
const HORA = 3600;
const DIA = 86400;

/**
 * Lo que falta para un reinicio, en dos unidades como mucho, la mayor primero: "59 s", "12 min", "4 h 23 min",
 * "1 d 0 h", "6 d 14 h". Los segundos sólo bajo el minuto; lo pasado dice `ya`. `en`: segundos hasta que el texto
 * cambia (el reloj repinta sólo entonces: a lo sumo una vez por minuto, y cada segundo en el último minuto).
 */
export function formatearFalta(r: number, u: Unidades): { texto: string; en: number } {
  if (r <= 0) return { texto: u.ya, en: Infinity };
  if (r < MIN) return { texto: `${Math.max(1, Math.floor(r))} ${u.s}`, en: r - Math.floor(r) || 1 };
  if (r < HORA) return { texto: `${Math.floor(r / MIN)} ${u.min}`, en: r % MIN || MIN };
  if (r < DIA) return { texto: `${Math.floor(r / HORA)} ${u.h} ${Math.floor((r % HORA) / MIN)} ${u.min}`, en: r % MIN || MIN };
  return { texto: `${Math.floor(r / DIA)} ${u.d} ${Math.floor((r % DIA) / HORA)} ${u.h}`, en: r % HORA || HORA };
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
