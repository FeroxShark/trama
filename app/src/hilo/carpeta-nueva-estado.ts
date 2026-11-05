// El pedido de una carpeta para el próximo líder nuevo (ver carpeta-nueva.ts): "Nueva tarea aquí" en un proyecto de la barra o una tarea del
// tablero. Se usa una vez: la caja lo toma como si la persona hubiera elegido esa carpeta a mano. Sin pedido, la caja arranca en "Auto".
import { useSyncExternalStore } from "react";
import { GENERAL } from "../datos/contrato";

let pedida: string | null = null;
const oyentes = new Set<() => void>();

/** Pide que el próximo líder nuevo arranque en el proyecto `slug` (`null`, `GENERAL` y vacío: ninguno, vale "Auto"). */
export function pedirCarpeta(slug: string | null | undefined): void {
  const nueva = slug && slug !== GENERAL ? slug : null;
  if (nueva === pedida) return;
  pedida = nueva;
  oyentes.forEach((f) => f());
}

export const usePedida = (): string | null =>
  useSyncExternalStore(
    (fn) => {
      oyentes.add(fn);
      return () => void oyentes.delete(fn);
    },
    () => pedida,
  );
