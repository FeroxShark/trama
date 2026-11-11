// El costo REAL de cada modelo: lo que se midió en las corridas (medicion.tsv) en vez de los pesos fijos de la tabla.
// Todo puro: entra el texto de medicion.tsv y salen las muestras por tipo × modelo × effort de los últimos 60 días.
// Lo usa electron/cli/reparto.ts (el reparto de TypeScript); el python de motor/bin/reparto queda como está.
import { canonico, effortCanonico } from "./pa/modelo-canonico.ts";

/** Los días que se mira para atrás (la misma ventana que `pa --rinde`). */
export const DIAS_COSTO = 60;
/** Corridas con costo para creer el costo medio. */
export const MIN_N_COSTO = 5;
/** Corridas con dato (integrada/retrabajo) para creer el US$ por éxito. */
export const MIN_N_EXITO = 10;

/** Los pesos corregidos por lo medido (relativos a Opus): lo que se usa cuando un modelo no tiene medida. */
export const PESOS: Record<string, number> = {
  opus: 1.0, argon: 0.6, sonnet: 0.29, "gpt-oss": 0.15, haiku: 0.054, flash: 0.2, astra: 1.0, sol: 0.6, luna: 0.08,
};

/** El peso corregido de una familia (Opus = 1); 0,3 si no se conoce (como el reparto). */
export const pesoDe = (familia: string | null | undefined): number => (familia && familia in PESOS ? PESOS[familia]! : 0.3);

/** El effort de una corrida: "-", "settings" y "" son lo mismo (no lo anotó). */
export function normalizarEffort(e: string): string {
  return effortCanonico(e);
}

/** Un número tal como lo toma awk de un campo: null si el campo no parece un número. */
const numero = (s: string): number | null => (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim()) ? Number(s) : null);

export interface Fila {
  /** El día de la corrida (YYYY-MM-DD): para la ventana de los 60 días. */
  fecha: string;
  modelo: string;
  /** El esfuerzo de la corrida ("" si no lo anotó). */
  effort: string;
  /** ¿La corrida fue de sólo lectura (`--leer`)? */
  leer: boolean;
  tipo: string;
  integrada: string;
  retrabajo: string;
  /** El costo en US$ (null si la corrida no lo anotó). */
  costo: number | null;
}

/** Las filas de medicion.tsv: lee por nombre de columna (las filas de antes de `tipo` son más cortas y salen sin tipo). */
export function leerMedicion(texto: string): Fila[] {
  const lineas = texto.split("\n");
  const cols: Record<string, number> = {};
  (lineas[0] ?? "").split("\t").forEach((k, i) => (cols[k.trim()] = i));
  const salida: Fila[] = [];
  for (const l of lineas.slice(1)) {
    if (l === "") continue;
    const c = l.split("\t");
    const v = (n: string) => (n in cols && cols[n]! < c.length ? c[cols[n]!]! : "");
    const fecha = v("fecha").trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(fecha)) continue;
    // un solo nombre por modelo: el alias corto, el effort pegado al nombre y settings/-/"" se unifican al leer
    const can = canonico(v("modelo"), v("effort"));
    salida.push({
      fecha: fecha.slice(0, 10),
      modelo: can.modelo,
      effort: can.effort,
      leer: v("leer").trim() === "1",
      tipo: v("tipo").trim(),
      integrada: v("integrada").trim(),
      retrabajo: v("retrabajo").trim(),
      costo: numero(v("costo_usd")),
    });
  }
  return salida;
}

export interface Muestra {
  /** Corridas con costo anotado. */
  n: number;
  /** La suma de esos costos (US$). */
  usd: number;
  /** Corridas integradas sin retrabajo. */
  ok: number;
  /** Corridas con dato (integrada=0, o integrada=1 con retrabajo 0/1). */
  dato: number;
}

/** ¿La corrida tiene dato de integración (como lo cuenta `pa --rinde`)? */
const conDato = (integrada: string, retrabajo: string): boolean => integrada === "0" || (integrada === "1" && (retrabajo === "0" || retrabajo === "1"));

/** La muestra de un tipo × modelo × effort: las corridas desde `desde` (YYYY-MM-DD). */
export function muestra(filas: Fila[], q: { tipo: string; modelo: string; effort?: string | null }, desde: string): Muestra {
  // la consulta pasa por el mismo nombre que las filas (un candidato `agy:…-high` busca `agy:…` con effort high)
  const can = canonico(q.modelo, q.effort);
  const modelo = can.modelo;
  const effort = q.effort || can.effort ? can.effort : null;
  const m: Muestra = { n: 0, usd: 0, ok: 0, dato: 0 };
  for (const f of filas) {
    if (f.fecha < desde) continue;
    if (f.tipo !== q.tipo) continue;
    if (f.modelo.toLowerCase() !== modelo) continue;
    if (effort !== null && f.effort !== effort) continue;
    // una corrida de sólo lectura no cuenta, salvo en las tareas de lectura
    if (f.leer && q.tipo !== "lectura") continue;
    if (f.costo !== null) {
      m.n++;
      m.usd += f.costo;
    }
    if (conDato(f.integrada, f.retrabajo)) {
      m.dato++;
      if (f.integrada === "1" && f.retrabajo === "0") m.ok++;
    }
  }
  return m;
}

/** La muestra de un modelo (cualquier tipo y esfuerzo): sirve para el ancla (Opus = 1). */
export function muestraModelo(filas: Fila[], modelos: string[], desde: string): Muestra {
  const ids = new Set(modelos.map((x) => canonico(x).modelo));
  const m: Muestra = { n: 0, usd: 0, ok: 0, dato: 0 };
  for (const f of filas) {
    if (f.fecha < desde) continue;
    if (!ids.has(f.modelo.toLowerCase())) continue;
    if (f.costo !== null) {
      m.n++;
      m.usd += f.costo;
    }
    if (conDato(f.integrada, f.retrabajo)) {
      m.dato++;
      if (f.integrada === "1" && f.retrabajo === "0") m.ok++;
    }
  }
  return m;
}

/** La muestra de un tipo con los modelos dados (cualquier esfuerzo): el ancla de ese tipo. */
export function muestraTipo(filas: Fila[], tipo: string, modelos: string[], desde: string): Muestra {
  const ids = new Set(modelos.map((x) => canonico(x).modelo));
  const m: Muestra = { n: 0, usd: 0, ok: 0, dato: 0 };
  for (const f of filas) {
    if (f.fecha < desde) continue;
    if (f.tipo !== tipo) continue;
    if (!ids.has(f.modelo.toLowerCase())) continue;
    if (f.costo !== null) {
      m.n++;
      m.usd += f.costo;
    }
    if (conDato(f.integrada, f.retrabajo)) {
      m.dato++;
      if (f.integrada === "1" && f.retrabajo === "0") m.ok++;
    }
  }
  return m;
}

/** El costo medio por corrida (US$): null si no hay suficientes corridas. */
export function costoMedio(m: Muestra): number | null {
  return m.n >= MIN_N_COSTO ? m.usd / m.n : null;
}

/** La tasa de acierto (integradas sin retrabajo sobre las que tienen dato): null si no hay dato. */
export function tasaOk(m: Muestra): number | null {
  return m.dato > 0 ? m.ok / m.dato : null;
}

/** El US$ por éxito (costo medio ÷ tasa de acierto): null si no hay dato suficiente. */
export function usdPorExito(m: Muestra): number | null {
  const c = costoMedio(m);
  const t = tasaOk(m);
  if (c === null || t === null || m.dato < MIN_N_EXITO || t <= 0) return null;
  return c / t;
}
