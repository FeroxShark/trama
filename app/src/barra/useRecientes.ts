// La foto de la actividad (`fotoRecientes`) para ordenar "Recientes" sin que nada salte: se calcula al primer dato y,
// después, tras un respiro corto (`REPOSO_MS`) de cuando cambió algo; no se aplica mientras el usuario mira la lista
// (`congelada`: mouse encima, foco adentro, un arrastre, un menú) y al soltarla se pone al día.
import { useEffect, useRef, useState } from "react";
import type { ConvClaudeCode, Hilo, Lider } from "../datos/contrato";
import { fotoRecientes, igualRecientes, type Recientes } from "./recientes";
import { REPOSO_MS } from "./usePrioridad";

export function useRecientes(activa: boolean, lideres: readonly Lider[], hilos: readonly Hilo[], convs: readonly ConvClaudeCode[], congelada: boolean): Recientes | undefined {
  const [foto, setFoto] = useState<Recientes | undefined>(undefined);
  const actual = useRef<Recientes | undefined>(undefined);

  useEffect(() => {
    if (!activa) {
      actual.current = undefined;
      setFoto(undefined);
      return;
    }
    if (congelada) return;
    const aplicar = () => {
      const nueva = fotoRecientes(lideres, hilos, convs);
      if (igualRecientes(actual.current, nueva)) return;
      actual.current = nueva;
      setFoto(nueva);
    };
    // La primera vez, ya (la barra no arranca desordenada); después, con el respiro.
    if (!actual.current) {
      aplicar();
      return;
    }
    const espera = setTimeout(aplicar, REPOSO_MS);
    return () => clearTimeout(espera);
  }, [activa, congelada, lideres, hilos, convs]);

  return activa ? foto : undefined;
}
