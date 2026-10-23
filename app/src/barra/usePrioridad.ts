// El orden por prioridad de la barra (`Orden.prioridad`, `prioridadDe` en arbol.ts) sin que nada salte: los rangos se
// calculan sólo cuando cambia un estado (no por reloj), se aplican tras un respiro corto (`REPOSO_MS`, sin reiniciarlo
// con cada evento: el que trabaja de corrido no lo posterga para siempre) y no se aplican mientras el usuario mira la
// lista (`congelada`: el mouse encima, el foco adentro, un menú abierto); al soltarla se ponen al día. El único
// reloj es uno solo, armado al próximo vencimiento de un caché vivo, porque ahí cambia un rango sin que llegue nada.
import { useEffect, useRef, useState } from "react";
import type { Lider } from "../datos/contrato";
import { igualPrioridad, prioridadDe, proximoVencimiento, type Prioridad } from "./arbol";

export const REPOSO_MS = 300;
/** Pasado el vencimiento: el caché ya no está vivo para `rangoLider` (compara con `>`). */
const MARGEN_MS = 500;
const MAX_TIMER = 2 ** 31 - 1;

export function usePrioridad(activa: boolean, lideres: readonly Lider[], congelada: boolean): Prioridad | undefined {
  const [prioridad, setPrioridad] = useState<Prioridad | undefined>(undefined);
  const actual = useRef<Prioridad | undefined>(undefined);
  const ultimos = useRef(lideres);
  ultimos.current = lideres;
  const [tic, setTic] = useState(0);
  const pendiente = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!activa) {
      actual.current = undefined;
      setPrioridad(undefined);
    }
  }, [activa]);

  useEffect(() => {
    if (!activa || congelada) return;
    const aplicar = () => {
      pendiente.current = undefined;
      const nueva = prioridadDe(ultimos.current, Math.floor(Date.now() / 1000));
      if (igualPrioridad(actual.current, nueva)) return;
      actual.current = nueva;
      setPrioridad(nueva);
    };
    // La primera vez, ya (la barra no arranca desordenada); después, con el respiro.
    if (!actual.current) aplicar();
    else if (pendiente.current === undefined) pendiente.current = setTimeout(aplicar, REPOSO_MS);
    const ahora = Math.floor(Date.now() / 1000);
    const vence = proximoVencimiento(lideres, ahora);
    const reloj = vence === null ? undefined : setTimeout(() => setTic((n) => n + 1), Math.min((vence - ahora) * 1000 + MARGEN_MS, MAX_TIMER));
    return () => clearTimeout(reloj);
  }, [activa, congelada, lideres, tic]);

  // Al desmontar o apagarlo no queda nada pendiente.
  useEffect(
    () => () => {
      clearTimeout(pendiente.current);
      pendiente.current = undefined;
    },
    [],
  );
  useEffect(() => {
    if (!activa || congelada) {
      clearTimeout(pendiente.current);
      pendiente.current = undefined;
    }
  }, [activa, congelada]);

  return activa ? prioridad : undefined;
}
