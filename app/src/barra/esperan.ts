// El número del pie: cuántos items esperan al usuario sin respuesta (tablero nuevo). Lo pide al main una vez
// y de nuevo cuando el CLI reescribe la vista; sin polling. Vacío (0) mientras no se sabe.
import { useEffect, useState } from "react";
import { fuenteTablero } from "../datos/fuenteTablero";

export function useEsperan(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    const leer = () =>
      void fuenteTablero.esperan().then(
        (x) => vivo && setN(x ?? 0),
        () => {},
      );
    leer();
    const suelta = fuenteTablero.alCambiar(leer);
    return () => {
      vivo = false;
      suelta();
    };
  }, []);
  return n;
}
