// La lista de `pa --hilos` hacia la ventana (y el celular) por diferencias: pesa ~800 kB con ~780 hilos y casi
// nada cambia entre una lectura y la siguiente. El main manda sólo lo que cambió (agregados, cambiados, quitados
// por id) contra la lectura anterior; la lista entera va al conectar, tras un error, cada tanto como red, y
// cuando una diferencia pesaría casi lo mismo. Quien recibe una diferencia con otra base (se perdió una) pide la
// entera (`hilos:completa`). Aplicarla: `src/datos/hilos-dif.ts`.
import type { Lectura } from "./pa.js";

export type Hilo = { id: string } & Record<string, unknown>;

/** Lo que cambió contra la lectura número `base`. */
export type Dif = {
  base: number;
  /** Cuántos hilos tiene que haber al aplicarla (red contra una lista que se desvió). */
  total: number;
  agregados: Hilo[];
  cambiados: Hilo[];
  quitados: string[];
  /** Los ids en su orden, sólo si aplicar lo anterior no lo deja como `pa` lo dio. */
  orden?: string[];
  /** Lo que `pa` trae además de `hilos` (`version`…), sólo si cambió. */
  resto?: Record<string, unknown>;
};

export type Envio = Lectura | { n: number; dif: Dif };

/** Una entera cada tantas diferencias, aunque todo cierre: lo que se desvió no dura. */
export const CADA_ENTERA = 30;
/** Si la diferencia pesa más que esta parte de la entera, va la entera. */
const PARTE_MAX = 0.5;

type Previa = { l: { n: number; datos: unknown }; ids: string[]; json: Map<string, string>; resto: string; bytes: number };

const esHilo = (h: unknown): h is Hilo => typeof (h as Hilo)?.id === "string";

/** Lo de `datos` que no es la lista. */
function restoDe(d: Record<string, unknown>): Record<string, unknown> {
  const { hilos: _, ...resto } = d;
  return resto;
}

export function crearEmisor(cadaEntera = CADA_ENTERA) {
  let previa: Previa | null = null;
  let difs = 0;

  /** Lo que se guarda de una lectura buena para compararla con la que sigue; null si no se puede por diferencias. */
  function armar(l: { n: number; datos: unknown }): Previa | null {
    const d = l.datos as Record<string, unknown> | null;
    if (!d || d.version !== 1 || !Array.isArray(d.hilos)) return null;
    const json = new Map<string, string>();
    let bytes = 0;
    for (const h of d.hilos) {
      if (!esHilo(h) || json.has(h.id)) return null;
      const s = JSON.stringify(h);
      json.set(h.id, s);
      bytes += s.length;
    }
    return { l, ids: [...json.keys()], json, resto: JSON.stringify(restoDe(d)), bytes };
  }

  return {
    /** Lo que se le manda a quien mira por esta lectura: la entera o la diferencia con la anterior. */
    siguiente(l: Lectura): Envio {
      if (!("datos" in l)) {
        previa = null;
        return l;
      }
      const antes = previa;
      const ahora = (previa = armar(l));
      if (!antes || !ahora || difs >= cadaEntera) {
        difs = 0;
        return l;
      }
      const d = l.datos as { hilos: Hilo[] };
      const agregados: Hilo[] = [];
      const cambiados: Hilo[] = [];
      for (const h of d.hilos) {
        const s = ahora.json.get(h.id)!;
        const v = antes.json.get(h.id);
        if (v === undefined) agregados.push(h);
        else if (v !== s) cambiados.push(h);
      }
      const quitados = antes.ids.filter((id) => !ahora.json.has(id));
      // Aplicada: lo que sigue de antes en su lugar y los agregados al final.
      const aplicado = [...antes.ids.filter((id) => ahora.json.has(id)), ...agregados.map((h) => h.id)];
      const dif: Dif = { base: antes.l.n, total: ahora.ids.length, agregados, cambiados, quitados };
      if (aplicado.some((id, i) => id !== ahora.ids[i])) dif.orden = ahora.ids;
      if (ahora.resto !== antes.resto) dif.resto = restoDe(l.datos as Record<string, unknown>);
      const peso = JSON.stringify(dif).length;
      if (peso > ahora.bytes * PARTE_MAX) {
        difs = 0;
        return l;
      }
      difs++;
      return { n: l.n, dif };
    },
    /** La última lista entera buena (para quien perdió el hilo de las diferencias), o null. */
    completa: (): Lectura | null => previa?.l ?? null,
  };
}

/**
 * Del otro lado: la lista con la diferencia aplicada (lo que hace `src/datos/hilos-dif.ts` en la vista). Lo usa
 * quien junta la lista de otra máquina (maquinas.ts). `null`: no cierra y hay que pedir la entera (`hilos:completa`).
 */
export function aplicarDif(lista: readonly Hilo[], dif: Dif): Hilo[] | null {
  const sale = new Map(lista.map((h) => [h.id, h]));
  for (const id of dif.quitados) if (!sale.delete(id)) return null;
  for (const h of dif.cambiados) {
    if (!esHilo(h) || !sale.has(h.id)) return null;
    sale.set(h.id, h);
  }
  for (const h of dif.agregados) {
    if (!esHilo(h) || sale.has(h.id)) return null;
    sale.set(h.id, h);
  }
  if (sale.size !== dif.total) return null;
  if (!dif.orden) return [...sale.values()];
  const ordenada: Hilo[] = [];
  for (const id of dif.orden) {
    const h = sale.get(id);
    if (!h) return null;
    ordenada.push(h);
  }
  return ordenada.length === dif.total ? ordenada : null;
}
