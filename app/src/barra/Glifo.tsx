// El estado de una fila de la barra en un glifo de 16 px: siempre acompañado por una palabra cuando pide atención (nunca sólo el color).
// Los trazos son los de la maqueta (maquetas/rediseno-0.4/barra-densa-b.html), para que todas las filas pesen igual.
import type { Tipo } from "./piezas";

export type TipoGlifo = "termino" | "falla" | "pide" | "falta" | "cola" | "frenado" | "cerrado" | "murio";

/**
 * El glifo de un worker quieto según el tipo de su fila; sin tipo (lo cerrado), la raya. Lo que corre o se trabó no tiene glifo: lleva el punto
 * que se mueve (`Punto`). La palomita (`termino`) es sólo de un worker que terminó, nunca de un líder (CONVENCIONES.md).
 */
export const glifoDe = (t: Exclude<Tipo, "trab" | "trabado"> | undefined): TipoGlifo =>
  t === "term" ? "termino" : t === "fallo" ? "falla" : t === "nec" ? "pide" : t === "falta" ? "falta" : t === "cola" ? "cola" : t === "frenado" ? "frenado" : "cerrado";

const TRAZOS: Record<TipoGlifo, { d?: string; ancho?: number; circulo?: boolean }> = {
  termino: { d: "M5 12.5l4.5 4.5L19 7.5", ancho: 2.4 },
  falla: { d: "M6 6l12 12M18 6L6 18", ancho: 2.6 },
  murio: { d: "M6 6l12 12M18 6L6 18", ancho: 2.6 },
  pide: { d: "M9 9.2a3 3 0 1 1 4.3 2.7c-.9.5-1.3 1.1-1.3 2M12 17.6v.1", ancho: 2.6 },
  falta: { d: "M12 11v5.2M12 7.7v.1", ancho: 2.6, circulo: true },
  cola: { d: "M12 7.5V12l3 2", ancho: 2.2, circulo: true },
  frenado: { d: "M8.5 6v12M15.5 6v12", ancho: 3 },
  cerrado: { d: "M7 12h10", ancho: 2.6 },
};

/** `palabra`: lo que el glifo dice a un lector de pantalla si no hay palabra a la vista; sin ella, decora. */
export function Glifo({ g, palabra }: { g: TipoGlifo; palabra?: string }) {
  const x = TRAZOS[g];
  return (
    <span className="g" data-g={g} {...(palabra ? { role: "img", "aria-label": palabra } : { "aria-hidden": true })}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={x.ancho} strokeLinecap="round" strokeLinejoin="round">
        {x.circulo ? <circle cx="12" cy="12" r="8.5" /> : null}
        <path d={x.d} />
      </svg>
    </span>
  );
}
