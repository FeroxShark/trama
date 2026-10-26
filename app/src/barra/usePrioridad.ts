// "Activas" y los proyectos que flotan (`Orden.prioridad`, `fotoCalor` en activas.ts) sin que nada salte: la foto de lo
// caliente se calcula sólo cuando cambia un estado (no por reloj), se aplica tras un respiro corto (`REPOSO_MS`, sin
// reiniciarlo con cada evento: el que trabaja de corrido no lo posterga para siempre) y no se aplica mientras el
// usuario mira la lista (`congelada`: el mouse encima, el foco adentro, un arrastre, un menú abierto); al soltarla se
// pone al día. El único reloj es uno solo, armado al próximo vencimiento de un caché vivo, porque ahí un líder se
// enfría sin que llegue nada.
import { useEffect, useRef, useState } from "react";
import type { Lider } from "../datos/contrato";
import { fotoCalor, igualFoto, proximoVencimiento, type Foto, type Trabajador } from "./activas";

export const REPOSO_MS = 300;
/** Pasado el vencimiento: el caché ya no está vivo para `rangoLider` (compara con `>`). */
const MARGEN_MS = 500;
const MAX_TIMER = 2 ** 31 - 1;

export function usePrioridad(activa: boolean, lideres: readonly Lider[], workers: readonly Trabajador[], congelada: boolean): Foto | undefined {
  const [prioridad, setPrioridad] = useState<Foto | undefined>(undefined);
  const actual = useRef<Foto | undefined>(undefined);
  const ultimos = useRef({ lideres, workers });
  ultimos.current = { lideres, workers };
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
      const nueva = fotoCalor(ultimos.current.lideres, ultimos.current.workers, Math.floor(Date.now() / 1000));
      if (igualFoto(actual.current, nueva)) return;
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
  }, [activa, congelada, lideres, workers, tic]);

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
