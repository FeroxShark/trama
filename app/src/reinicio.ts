// Hay un build de trama más nuevo que el que corre (electron/relanzar.ts): el estado del cartel, uno
// solo para quien lo muestre (src/barra/Reinicio.tsx) y para el puntito del botón que trae la barra.
import { useSyncExternalStore } from "react";
import { fuente, type Reinicio } from "./datos/fuente";

let estado: Reinicio = { hay: false, pedido: false, tareas: 0, saliendo: false, espera: [], integrando: false, colgado: false };
let armado = false;
const oyentes = new Set<() => void>();

function poner(r: Reinicio) {
  estado = r;
  oyentes.forEach((f) => f());
}

function oir(fn: () => void) {
  if (!armado) {
    armado = true;
    // Si el main avisa antes de que conteste la primera lectura, vale el aviso.
    let avisado = false;
    fuente.alCambiarReinicio((r) => {
      avisado = true;
      poner(r);
    });
    void fuente.reinicio().then((r) => !avisado && poner(r));
  }
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
}

export const useReinicio = () => useSyncExternalStore(oir, () => estado);
