// Un texto que no mueve nada al cambiar de idioma: el del idioma de ahora y,
// encima, invisible, el de los otros. Comparten la celda de una grilla, así que
// ocupa lo del más largo (ancho en línea, alto en bloque) a cualquier tamaño de
// letra, y el cambio ES ↔ EN no corre ni un píxel.
import type { ReactNode } from "react";
import { IDIOMAS, idioma, tDe, type ClaveSola } from "./index";
import { useIdioma } from "./react";

type Props = {
  /** Lo que se ve. */
  texto: ReactNode;
  /** Lo que se reserva sin verse (los otros idiomas, las otras opciones). */
  reserva: readonly ReactNode[];
  /** En bloque (párrafos que hacen renglones); si no, en línea (etiquetas, botones). */
  bloque?: boolean;
  className?: string;
};

export function Reserva({ texto, reserva, bloque, className }: Props) {
  const c = bloque ? "fijo fijo-b" : "fijo";
  return (
    <span className={className ? `${c} ${className}` : c}>
      <span>{texto}</span>
      {reserva.map((r, i) => (
        <span key={i} aria-hidden="true">
          {r}
        </span>
      ))}
    </span>
  );
}

/** Los textos de una clave en los idiomas que no son el de ahora. */
export const enOtros = (k: ClaveSola) => IDIOMAS.filter((i) => i !== idioma()).map((i) => tDe(i, k));

/** `t(k)` con el lugar del idioma más largo reservado. */
export function Fijo({ k, bloque, className }: { k: ClaveSola; bloque?: boolean; className?: string }) {
  const i = useIdioma();
  return <Reserva texto={tDe(i, k)} reserva={enOtros(k)} bloque={bloque} className={className} />;
}
