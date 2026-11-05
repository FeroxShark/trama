// «Abrir ese item en el tablero» desde una tarjeta del chat (src/hilo/DejadoTablero.tsx): la barra abre el panel del tablero y éste, ya con
// los datos leídos, muestra el item (su proyecto, abierto, con el item a la vista). Un pedido de una sola vez, sin estado de más.
import type { ItemId } from "../datos/tablero";

export type PedidoItem = { id: ItemId };

let pedido: PedidoItem | null = null;
const oyentes = new Set<() => void>();

export function pedirItem(p: PedidoItem): void {
  pedido = p;
  oyentes.forEach((f) => f());
}
/** Lo pedido, una sola vez (lo borra). */
export function tomarPedido(): PedidoItem | null {
  const p = pedido;
  pedido = null;
  return p;
}
export const hayPedido = (): boolean => pedido !== null;
/** Avisa cuando hay un pedido nuevo (la barra abre el panel; el panel, si ya está abierto, lo aplica). */
export function alPedirItem(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}
