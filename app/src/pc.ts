// La PC vista desde el Dell (electron/pc-estado.ts): su estado, uno solo para quien lo muestre (src/barra/Pc.tsx).
// Sin PC configurada (la PC misma) es null y no cuesta nada. No hay reloj: se vuelve a mirar al volver a la
// ventana, y mientras "Prendiendo…" el main avisa solo.
import { useSyncExternalStore } from "react";
import { fuente, type EstadoPc } from "./datos/fuente";

let estado: EstadoPc | null = null;
let armado = false;
const oyentes = new Set<() => void>();

function poner(e: EstadoPc | null) {
  if (JSON.stringify(e) === JSON.stringify(estado)) return;
  estado = e;
  oyentes.forEach((f) => f());
}

function oir(fn: () => void) {
  if (!armado) {
    armado = true;
    // Si el main avisa antes de que conteste la primera lectura, vale el aviso.
    let avisado = false;
    fuente.alCambiarPc((e) => {
      avisado = true;
      poner(e);
    });
    void fuente.pc().then((e) => !avisado && poner(e));
    // Volver a la ventana (o a la pestaña del celular): otra mirada, por si la PC se apagó o prendió sin trama de por medio.
    const volver = () => {
      if (estado && document.visibilityState === "visible") void fuente.pc().then(poner);
    };
    document.addEventListener("visibilitychange", volver);
    addEventListener("focus", volver);
  }
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
}

export const usePc = () => useSyncExternalStore(oir, () => estado);
