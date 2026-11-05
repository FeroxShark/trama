// El tablero para las tarjetas «Te dejé esto en el tablero» del chat: UNA lectura compartida por todas las que hay en pantalla (no una por
// tarjeta), que se pide al aparecer la primera y se refresca cuando el CLI reescribe la vista; sin ninguna tarjeta no se lee ni se mira nada.
import { useSyncExternalStore } from "react";
import { fuenteTablero } from "../datos/fuenteTablero";
import type { Tablero } from "../datos/tablero";

let datos: Tablero | null = null;
let pedida = 0;
let soltar: (() => void) | null = null;
const oyentes = new Set<() => void>();

function leer() {
  const n = ++pedida;
  fuenteTablero.leer().then(
    (t) => {
      if (n !== pedida) return;
      datos = t;
      oyentes.forEach((f) => f());
    },
    () => {
      // Sin tablero legible las tarjetas se quedan con lo que sabían (el título de la llamada): no es un error para el chat.
    },
  );
}

function suscribir(f: () => void) {
  oyentes.add(f);
  if (oyentes.size === 1) {
    datos ??= fuenteTablero.guardado();
    soltar = fuenteTablero.alCambiar(leer);
    leer();
  }
  return () => {
    oyentes.delete(f);
    if (!oyentes.size) {
      soltar?.();
      soltar = null;
    }
  };
}

/** El tablero leído (o el último que se leyó); `null` hasta que llega. Cada tarjeta que lo usa lo mantiene al día. */
export const useTableroDejado = (): Tablero | null => useSyncExternalStore(suscribir, () => datos);
