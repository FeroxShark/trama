// El foco de lo que flota (modales, popovers, el detalle del tablero): al abrirse se lleva el foco
// adentro, Tab no se sale mientras está abierto (`atrapar`), Esc lo cierra antes de que la barra se
// entere, y al cerrarse el foco vuelve a lo que lo abrió.
import { useEffect, useRef, type RefObject } from "react";

/** Lo que se puede enfocar con Tab. */
const ENFOCABLE = 'a[href], button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"])';

const visible = (el: HTMLElement) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0;

export function enfocables(raiz: HTMLElement): HTMLElement[] {
  return [...raiz.querySelectorAll<HTMLElement>(ENFOCABLE)].filter(visible);
}

/** El primero (o la raíz misma, que lleva `tabIndex={-1}`); no le roba el foco a algo que ya lo tiene adentro. */
export function enfocarAdentro(raiz: HTMLElement) {
  if (raiz.contains(document.activeElement) && document.activeElement !== raiz) return;
  (enfocables(raiz)[0] ?? raiz).focus({ preventScroll: true });
}

type Opciones = {
  /** Falso: de momento no hace nada (para lo que está montado siempre y sólo a veces se abre). */
  activo?: boolean;
  /** Cerrar (Esc). Sin esto, Esc no es de acá (lo maneja quien está más arriba). */
  alCerrar?: () => void;
  /** Tab da la vuelta adentro. Falso: un panel que se puede abandonar con Tab (sólo se enfoca y se devuelve el foco). */
  atrapar?: boolean;
  /** Esc en lo que coincide con este selector es de eso (un campo, una lista), no del cierre. */
  ignorar?: string;
  /** Al abrir, a dónde va el foco: al primer control (default), a la raíz misma (`tabIndex={-1}`) o a ninguno (lo hace quien lo abre). */
  enfocar?: "primero" | "raiz" | false;
  /** A dónde vuelve el foco; por defecto, a lo que lo tenía al abrir. */
  devolver?: () => HTMLElement | null | undefined;
};

export function useFoco(raiz: RefObject<HTMLElement | null>, o: Opciones) {
  const opc = useRef(o);
  opc.current = o;
  const activo = o.activo ?? true;
  useEffect(() => {
    if (!activo) return;
    const previo = document.activeElement as HTMLElement | null;
    const el = raiz.current;
    const donde = opc.current.enfocar ?? "primero";
    if (el && donde === "primero") enfocarAdentro(el);
    else if (el && donde === "raiz") el.focus({ preventScroll: true });
    const tecla = (e: KeyboardEvent) => {
      const r = raiz.current;
      if (!r) return;
      const { alCerrar, atrapar = true, ignorar } = opc.current;
      if (e.key === "Escape") {
        if (!alCerrar) return;
        if (ignorar && (e.target as HTMLElement).closest?.(ignorar)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        alCerrar();
        return;
      }
      if (e.key !== "Tab" || !atrapar) return;
      const lista = enfocables(r);
      if (!lista.length) {
        e.preventDefault();
        r.focus({ preventScroll: true });
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const aca = document.activeElement as HTMLElement | null;
      if (!aca || !r.contains(aca) || aca === r) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus();
      } else if (e.shiftKey && aca === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && aca === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    addEventListener("keydown", tecla, true);
    return () => {
      removeEventListener("keydown", tecla, true);
      // Sólo si el foco no se fue a otro lado a propósito (un clic en otra cosa).
      const ahora = document.activeElement;
      const destino = opc.current.devolver?.() ?? previo;
      if (destino?.isConnected && (!ahora || ahora === document.body || el?.contains(ahora) || !ahora.isConnected)) destino.focus({ preventScroll: true });
    };
  }, [raiz, activo]);
}
