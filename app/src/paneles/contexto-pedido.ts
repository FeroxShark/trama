// Un pedido a la ventana de "abrí el desglose de este subagente en el panel de contexto" (el enlace de la burbuja de la llamada Agent en la
// conversación del líder). Lo escucha Barra.tsx (abre el panel si estaba cerrado) y PanelContexto.tsx (despliega al subagente y lo consume).
import { useSyncExternalStore } from "react";

export type PedidoSub = { sid: string; id: string; n: number };

let actual: PedidoSub | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

export function pedirSubagenteEnPanel(sid: string, id: string): void {
  actual = { sid, id, n: (actual?.n ?? 0) + 1 };
  avisar();
}

/** Ya se atendió: el panel que se abra más tarde no vuelve a desplegarlo. */
export function consumirPedidoSub(n: number): void {
  if (actual?.n !== n) return;
  actual = null;
  avisar();
}

const suscribir = (fn: () => void) => {
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
};

export const usePedidoSub = (): PedidoSub | null => useSyncExternalStore(suscribir, () => actual);
