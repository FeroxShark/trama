// El refresco automático del panel de contexto: el desglose se vuelve a pedir cada REFRESCO_MS mientras el panel se ve (la pestaña o la
// ventana visible; oculta o minimizada, se para). Puro, sin React: lo prueba `tests/contexto-refresco.test.ts` con un reloj falso. El
// main ya guarda lo que no cambió (electron/contexto-panel.ts), así que pedir seguido no relee ni le pregunta al líder si el transcript
// no se movió.

/** Cada cuánto se vuelve a pedir el desglose mientras el panel se ve. */
export const REFRESCO_MS = 3000;

export type Reloj = {
  setInterval(f: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
};

/**
 * Un reloj que llama `alTick` cada `cada` ms sólo mientras `ver(true)`: `ver(false)` lo para (panel oculto o ventana minimizada) y
 * `ver(true)` lo arranca de nuevo. `parar()` lo apaga del todo. Llamar `ver(true)` dos veces no duplica el reloj.
 */
export function crearRefresco(o: { cada?: number; alTick: () => void; reloj?: Reloj }) {
  const reloj: Reloj = o.reloj ?? { setInterval: (f, ms) => setInterval(f, ms), clearInterval: (id) => clearInterval(id as number) };
  const cada = o.cada ?? REFRESCO_MS;
  let id: unknown = null;
  const ver = (visible: boolean) => {
    if (visible && id === null) id = reloj.setInterval(o.alTick, cada);
    else if (!visible && id !== null) {
      reloj.clearInterval(id);
      id = null;
    }
  };
  return { ver, parar: () => ver(false), activo: () => id !== null };
}

/**
 * Si dos desgloses dicen lo mismo. El panel conserva el objeto anterior cuando el refresco trae lo que ya había: así no vuelve a pintar
 * (ni a animar el mapa) ni cambia la selección.
 */
export const mismoDesglose = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
