// El celular: Trama por el navegador, unos 400 px de ancho y con el dedo. Dos preguntas
// distintas: si la ventana es angosta (se ve una cosa a la vez, la lista o lo abierto) y si se
// maneja con el dedo (no hay hover ni atajos). El CSS de las dos está al final de src/index.css.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/** La misma consulta que el bloque angosto de src/index.css (35rem de media query: 560 px, sea cual sea la letra). */
const ANGOSTO = "(max-width: 35rem)";
const DEDO = "(pointer: coarse)";

const consulta = (q: string) => (typeof matchMedia === "function" ? matchMedia(q) : null);
const angosto = consulta(ANGOSTO);
const dedo = consulta(DEDO);

export const esAngosto = () => angosto?.matches ?? false;
/** Con el dedo: sin hover, sin atajos, y enfocar un campo abre el teclado en pantalla. */
export const esTactil = () => dedo?.matches ?? false;

const suscribir = (fn: () => void) => {
  angosto?.addEventListener("change", fn);
  return () => angosto?.removeEventListener("change", fn);
};

export function useAngosto() {
  return useSyncExternalStore(suscribir, esAngosto, () => false);
}

/**
 * El ancho intermedio: entre el celular y el escritorio holgado (67rem = 1072 px; misma consulta que el bloque de
 * src/paneles/contexto-panel.css). Con la barra y el panel de contexto a la vez, la conversación quedaría de menos de 450 px.
 */
const MEDIO = "(max-width: 67rem)";
const medio = consulta(MEDIO);
export const esMedio = () => medio?.matches ?? false;
const suscribirMedio = (fn: () => void) => {
  medio?.addEventListener("change", fn);
  return () => medio?.removeEventListener("change", fn);
};
export function useMedio() {
  return useSyncExternalStore(suscribirMedio, () => medio?.matches ?? false, () => false);
}

const MARCA = "abierto";

/**
 * El "atrás" del celular (el gesto o el botón de Android): con algo abierto hay una entrada de más
 * en el historial, y volver la gasta en vez de irse de Trama. Devuelve el volver del botón de la app,
 * que va por el mismo camino.
 */
export function useAtras(abierto: boolean, volver: () => void) {
  useEffect(() => {
    if (!abierto) return;
    if (history.state?.trama !== MARCA) history.pushState({ trama: MARCA }, "");
    // Si después del atrás seguimos en la entrada propia, el atrás era de algo abierto encima (el visor): no se vuelve.
    const alVolver = () => {
      if (history.state?.trama !== MARCA) volver();
    };
    addEventListener("popstate", alVolver);
    return () => removeEventListener("popstate", alVolver);
  }, [abierto, volver]);
  return useCallback(() => (history.state?.trama === MARCA ? history.back() : volver()), [volver]);
}

const MARCA_VISOR = "visor";

/**
 * El visor (una foto o un archivo a pantalla completa) lleva su propia entrada en el historial, encima de la del chat:
 * el atrás del celular (gesto o botón) lo cierra a él y deja el chat como estaba, en vez de irse de Trama.
 * Devuelve el cerrar de la app (botón, Esc, tocar afuera), que va por el mismo camino.
 */
export function useAtrasVisor(cerrar: () => void) {
  const ref = useRef(cerrar);
  ref.current = cerrar;
  useEffect(() => {
    // Una sola entrada aunque el efecto corra dos veces (StrictMode en desarrollo).
    if (history.state?.trama !== MARCA_VISOR) history.pushState({ trama: MARCA_VISOR }, "");
    const alVolver = () => {
      if (history.state?.trama !== MARCA_VISOR) ref.current();
    };
    addEventListener("popstate", alVolver);
    return () => removeEventListener("popstate", alVolver);
  }, []);
  return useCallback(() => (history.state?.trama === MARCA_VISOR ? history.back() : ref.current()), []);
}
