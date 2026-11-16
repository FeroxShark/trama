// El estado de las revisiones de plan que ve la ventana, por líder: lo que manda el main con el evento `revision` y si el modal de
// progreso está abierto. Fuera de los componentes a propósito: el pedido de permiso (donde se elige al revisor) se desmonta cuando el
// plan se niega, y el progreso tiene que seguir visible en el chat. Lo lee `useRevision`.
import { useEffect, useReducer } from "react";
import { fuente } from "../datos/fuente";
import type { RevisionEstado } from "../datos/contrato";
import { MODO } from "../modo";

const estados = new Map<string, RevisionEstado>();
const modales = new Set<string>();
const leidos = new Set<string>();
const oyentes = new Set<() => void>();
let suscrito = false;
const avisar = () => oyentes.forEach((f) => f());

function asegurar() {
  if (suscrito) return;
  suscrito = true;
  fuente.alEventoLider((sid, e) => {
    if (e.tipo !== "revision") return;
    estados.set(sid, e.estado);
    avisar();
  });
}

/** Abre o cierra el modal de progreso de ese líder (cerrarlo no corta la revisión: sigue en el chat). */
export function modalRevision(sid: string, abierto: boolean) {
  if (abierto) modales.add(sid);
  else modales.delete(sid);
  avisar();
}

/** Saca de la vista la última revisión terminada de ese líder. */
export function limpiarRevision(sid: string) {
  estados.delete(sid);
  modales.delete(sid);
  void fuente.liderRevisionDescartar(sid);
  avisar();
}

/** Para los tests y las capturas: pone un estado como si hubiera llegado del main. */
export function ponerRevision(e: RevisionEstado) {
  estados.set(e.sid, e);
  avisar();
}

/** La revisión de ese líder (la que corre, o cómo terminó la última) y si su modal está abierto. */
export function useRevision(sid: string | null | undefined): { estado: RevisionEstado | null; modal: boolean } {
  const [, forzar] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!sid) return;
    asegurar();
    oyentes.add(forzar);
    if (!leidos.has(sid)) {
      leidos.add(sid);
      void fuente.liderRevisionDe(sid).then((e) => {
        if (e && !estados.has(sid)) {
          estados.set(sid, e);
          // La captura del modal en vivo nace con el modal abierto.
          if (MODO.captura === "lider-revision-vivo") modales.add(sid);
          avisar();
        }
      }, () => {});
    }
    return () => void oyentes.delete(forzar);
  }, [sid]);
  return { estado: sid ? (estados.get(sid) ?? null) : null, modal: sid ? modales.has(sid) : false };
}
