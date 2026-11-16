// El estado de los debates de plan que ve la ventana, por líder: lo que manda el main con el evento `debate:turno`. Fuera de los
// componentes a propósito: el pedido de permiso (donde se arma el debate) se desmonta cuando el plan se niega, y el debate tiene que
// seguir visible en el chat. Lo lee `useDebate`. Igual que revision-vivo.ts.
import { useEffect, useReducer } from "react";
import { fuente } from "../datos/fuente";
import type { EstadoDebate } from "../../electron/debate-texto";

const estados = new Map<string, EstadoDebate>();
const leidos = new Set<string>();
const oyentes = new Set<() => void>();
let suscrito = false;
const avisar = () => oyentes.forEach((f) => f());

function asegurar() {
  if (suscrito) return;
  suscrito = true;
  fuente.alDebate((e) => {
    estados.set(e.estado.sid, e.estado);
    avisar();
  });
}

/** Saca de la vista el último debate terminado de ese líder. */
export function limpiarDebate(sid: string) {
  estados.delete(sid);
  void fuente.debateDescartar(sid);
  avisar();
}

/** Un debate que arrancó (lo devuelve `liderDebatirPlan`): se ve sin esperar al primer evento. */
export function ponerDebate(e: EstadoDebate) {
  estados.set(e.sid, e);
  avisar();
}

/** El debate de ese líder (el que corre, o cómo terminó el último). */
export function useDebate(sid: string | null | undefined): EstadoDebate | null {
  const [, forzar] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!sid) return;
    asegurar();
    oyentes.add(forzar);
    if (!leidos.has(sid)) {
      leidos.add(sid);
      void fuente.debateDe(sid).then((e) => {
        if (e && !estados.has(sid)) {
          estados.set(sid, e);
          avisar();
        }
      }, () => {});
    }
    return () => void oyentes.delete(forzar);
  }, [sid]);
  return sid ? (estados.get(sid) ?? null) : null;
}
