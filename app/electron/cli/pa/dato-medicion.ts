// Qué cuenta una fila de medicion.tsv como dato y como acierto. Una sola función para `pa --rinde` (cli/pa/rinde.ts),
// `rindeDeModelos` (cli/reparto.ts) y las muestras de costo (cli/reparto-costo.ts).
// Una corrida de escritura: dato si integrada=0, o integrada=1 con retrabajo 0/1; ok si integrada=1 y retrabajo=0.
// Si no tiene dato de integración (integrada vacía) y la corrida falló (`is_error=true`): dato y no ok (una corrida que
// se rompe es una señal; antes no contaba y un modelo que fallaba 11 de 14 seguía eligiéndose).
// Una corrida de LECTURA (`--leer`) no se integra. Manda la columna `bien` (`pa --bien <id> si|no|parcial`):
// `si` → dato y ok; `no` o `parcial` → dato y no ok. Sin `bien` cuenta `is_error`: `true` → dato y no ok; `false` → dato y ok
// (terminar sin error es la señal por defecto); vacío (la corrida murió o la mataron y no dejó resultado) → sin dato.
// `is_error` vacío nunca suma dato por sí solo. El bash/python congelados no miran `bien` ni `is_error`:
// divergencia a propósito, como en 0ac2fe6.

export interface DatoFila {
  /** ¿La fila aporta señal (se cuenta en la columna `dato`)? */
  dato: boolean;
  /** ¿Salió bien? (sólo tiene sentido con `dato`). */
  ok: boolean;
}

/** `dato` y `ok` de una fila; `leer` es `leer=1` de la fila. */
export function datoDeFila(f: { leer: boolean; integrada: string; retrabajo: string; bien?: string; is_error?: string }): DatoFila {
  const err = (f.is_error ?? "").trim().toLowerCase();
  if (f.leer) {
    const b = (f.bien ?? "").trim().toLowerCase();
    if (b === "si") return { dato: true, ok: true };
    if (b === "no" || b === "parcial") return { dato: true, ok: false };
    if (err === "true") return { dato: true, ok: false };
    if (err === "false") return { dato: true, ok: true };
    return { dato: false, ok: false };
  }
  const i = f.integrada;
  const r = f.retrabajo;
  if (i === "" && err === "true") return { dato: true, ok: false };
  return { dato: i === "0" || (i === "1" && (r === "0" || r === "1")), ok: i === "1" && r === "0" };
}
