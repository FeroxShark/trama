// El tablero para el panel acoplable «Tablero»: una lectura que se pide sólo con el panel a la vista (`activo`) y se refresca cuando
// el CLI reescribe la vista (alguien cargó, movió, contestó o cerró algo). Sin panel no se lee ni se mira nada. Comparte la última
// lectura buena de `fuenteTablero` para pintar al toque al volver.
import { useCallback, useEffect, useRef, useState } from "react";
import { fuenteTablero } from "./fuenteTablero";
import type { Tablero } from "./tablero";

export type TableroVivo = {
  /** La última lectura buena; `null` hasta que llega la primera. */
  datos: Tablero | null;
  /** Por qué no se pudo leer (el mensaje del main), o `null`. */
  error: string | null;
  /** Vuelve a leer ya (después de contestar o cerrar un item). */
  releer: () => void;
};

export function useTableroVivo(activo: boolean): TableroVivo {
  const [datos, setDatos] = useState<Tablero | null>(() => fuenteTablero.guardado());
  const [error, setError] = useState<string | null>(null);
  const pedida = useRef(0);

  const releer = useCallback(() => {
    const n = ++pedida.current;
    fuenteTablero.leer().then(
      (t) => {
        if (n !== pedida.current) return;
        setDatos(t);
        setError(null);
      },
      (e: unknown) => {
        if (n !== pedida.current) return;
        // Se queda con la última lectura buena: sólo se avisa que no se pudo refrescar.
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, []);

  useEffect(() => {
    if (!activo) return;
    const soltar = fuenteTablero.alCambiar(releer);
    releer();
    return () => {
      soltar();
      pedida.current++;
    };
  }, [activo, releer]);

  return { datos, error, releer };
}
