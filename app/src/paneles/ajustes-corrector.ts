// «Corrector ortográfico» (Ajustes > General): una preferencia de esta pantalla, prendida de fábrica. Sólo apaga el subrayado
// de las cajas de escribir (`spellCheck`); los diccionarios los arma la sesión (electron/corrector.ts). Vive en el navegador
// de quien mira, como las demás de la interfaz. Si el almacenamiento no anda, queda en memoria.
import { useSyncExternalStore } from "react";

const CLAVE = "trama.corrector";
let valor: boolean | null = null;
const oyentes = new Set<() => void>();

function leer(): boolean {
  if (valor !== null) return valor;
  try {
    valor = localStorage.getItem(CLAVE) !== "0";
  } catch {
    valor = true;
  }
  return valor;
}

export const corrector = (): boolean => leer();

export function cambiarCorrector(si: boolean) {
  valor = si;
  try {
    localStorage.setItem(CLAVE, si ? "1" : "0");
  } catch {
    /* sin almacenamiento: vale en esta sesión */
  }
  oyentes.forEach((o) => o());
}

export const alCambiarCorrector = (f: () => void): (() => void) => (oyentes.add(f), () => void oyentes.delete(f));

/** Para `spellCheck={...}` de una caja de escribir: se actualiza solo al cambiar el interruptor. */
export const useCorrector = (): boolean => useSyncExternalStore(alCambiarCorrector, corrector);
