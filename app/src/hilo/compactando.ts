// Quién está compactando su contexto (electron/compactando.ts, por
// src/datos/fuente.ts): se pide una sola vez, cuando alguien pregunta por
// primera vez, y después llega cada cambio. Cada fila y cada vista se suscriben
// sólo a su id: que otro empiece a compactar no las repinta.
import { useSyncExternalStore } from "react";
import type { Compactando } from "../../electron/compactando";
import { fuente } from "../datos/fuente";

let actual: Compactando = {};
let pedido = false;
const oyentes = new Set<() => void>();

function poner(c: Compactando) {
  actual = c;
  oyentes.forEach((f) => f());
}

function suscribir(fn: () => void) {
  if (!pedido) {
    pedido = true;
    // Si un cambio llega antes que la primera lectura, la lectura ya es vieja.
    let llego = false;
    fuente.alCambiarCompactando((c) => {
      llego = true;
      poner(c);
    });
    void fuente.compactando().then((c) => !llego && poner(c), () => {});
  }
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
}

/**
 * Desde cuándo compacta `id` (el de un run de `pa` o el de un líder; epoch en
 * segundos), o `null` si no está compactando. Con `null` no pregunta por nadie.
 */
export const useCompactando = (id: string | null): number | null =>
  useSyncExternalStore(suscribir, () => (id ? (actual[id] ?? null) : null));
