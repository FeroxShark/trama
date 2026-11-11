// Qué cuenta una fila de medicion.tsv como dato y como acierto. Una sola función para `pa --rinde` (cli/pa/rinde.ts),
// `rindeDeModelos` (cli/reparto.ts) y las muestras de costo (cli/reparto-costo.ts).
// Una corrida de escritura: dato si integrada=0, o integrada=1 con retrabajo 0/1; ok si integrada=1 y retrabajo=0.
// Una corrida de LECTURA (`--leer`) no se integra, así que su dato es la columna `bien` (`pa --bien <id> si|no|parcial`):
// `si` → dato y ok; `no` o `parcial` → dato y no ok; sin `bien` → sin dato. El bash/python congelados las ignoran
// (no miran `bien`): divergencia a propósito, como en 0ac2fe6.

export interface DatoFila {
  /** ¿La fila aporta señal (se cuenta en la columna `dato`)? */
  dato: boolean;
  /** ¿Salió bien? (sólo tiene sentido con `dato`). */
  ok: boolean;
}

/** `dato` y `ok` de una fila; `leer` es `leer=1` de la fila. */
export function datoDeFila(f: { leer: boolean; integrada: string; retrabajo: string; bien?: string }): DatoFila {
  if (f.leer) {
    const b = (f.bien ?? "").trim().toLowerCase();
    if (b === "si") return { dato: true, ok: true };
    if (b === "no" || b === "parcial") return { dato: true, ok: false };
    return { dato: false, ok: false };
  }
  const i = f.integrada;
  const r = f.retrabajo;
  return { dato: i === "0" || (i === "1" && (r === "0" || r === "1")), ok: i === "1" && r === "0" };
}
