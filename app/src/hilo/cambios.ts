// "Algo de lo que hay que recordar cambió" (un borrador, un adjunto, el scroll de una conversación, lo abierto):
// quien guarda en disco (src/volver.ts) se registra acá y programa su escritura demorada. Aparte de
// borradores.ts, adjuntos.ts y scrollGuardado.ts para que ninguno de ellos importe a volver.ts (que los importa).
let oyente: (() => void) | null = null;

export function alHaberCambios(fn: () => void) {
  oyente = fn;
  return () => {
    if (oyente === fn) oyente = null;
  };
}

export const huboCambio = () => oyente?.();
