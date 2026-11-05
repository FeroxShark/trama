// La última limpieza del Tablero, guardada para poder deshacerla (LimpiarTablero.tsx): qué se cerró y de qué columna salió cada item.
// Vive en `localStorage` (sobrevive a cerrar el panel y a reiniciar la app) y caduca al día: pasado ese tiempo lo cerrado ya es parte
// del tablero. Una sola tanda: limpiar de nuevo reemplaza a la anterior. Lo cerrado sigue en `tirado` en el CLI; esto sólo recuerda cómo reabrirlo.
import { useSyncExternalStore } from "react";
import { tandaGuardada, type Tanda } from "./tablero-limpiar.ts";

const CLAVE = "trama:tablero:ultima-limpieza";
/** Cuánto se puede deshacer. */
export const CADUCA_MS = 24 * 3_600_000;

const oyentes = new Set<() => void>();
let visto: { crudo: string | null; tanda: Tanda | null } = { crudo: null, tanda: null };

function crudo(): string | null {
  if (typeof localStorage === "undefined") return visto.crudo;
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return visto.crudo;
  }
}

/** La tanda que se puede deshacer, o `null` (no hay, está rota o ya caducó). */
export function leerTanda(ahora = Date.now()): Tanda | null {
  const c = crudo();
  if (c !== visto.crudo) visto = { crudo: c, tanda: tandaGuardada(c) };
  const t = visto.tanda;
  return t && ahora - t.fecha < CADUCA_MS ? t : null;
}

/** Guarda la tanda (`null`: la olvida) y avisa a los que la miran. */
export function guardarTanda(t: Tanda | null) {
  const c = t && t.items.length ? JSON.stringify(t) : null;
  visto = { crudo: c, tanda: c ? t : null };
  if (typeof localStorage !== "undefined") {
    try {
      if (c) localStorage.setItem(CLAVE, c);
      else localStorage.removeItem(CLAVE);
    } catch {}
  }
  for (const f of oyentes) f();
}

const suscribir = (f: () => void) => {
  oyentes.add(f);
  return () => void oyentes.delete(f);
};

export const useTanda = (): Tanda | null => useSyncExternalStore(suscribir, () => leerTanda(), () => null);
