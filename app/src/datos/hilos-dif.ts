// Aplicar la lista de hilos que manda el main por diferencias (electron/hilos-dif.ts).

/** Lo que cambió contra la lectura número `base` (espejo de `Dif` en electron/hilos-dif.ts). */
export type Dif = {
  base: number;
  total: number;
  agregados: { id: string }[];
  cambiados: { id: string }[];
  quitados: string[];
  orden?: string[];
  resto?: Record<string, unknown>;
};

export const esDif = (l: unknown): l is { n: number; dif: Dif } => typeof (l as { dif?: unknown })?.dif === "object" && (l as { dif: unknown }).dif !== null;

/**
 * Las filas con la diferencia aplicada, en el orden de `pa`. `hacer` arma la fila de un hilo que llegó; las que no
 * cambiaron conservan su objeto. `null`: no cierra con la lista que se tiene y hay que pedir la entera.
 */
export function aplicarDif<F>(filas: ReadonlyMap<string, F>, dif: Dif, hacer: (h: { id: string }) => F): Map<string, F> | null {
  const sale = new Map(filas);
  for (const id of dif.quitados) if (!sale.delete(id)) return null;
  for (const h of dif.cambiados) {
    if (!sale.has(h.id)) return null;
    sale.set(h.id, hacer(h));
  }
  for (const h of dif.agregados) {
    if (sale.has(h.id)) return null;
    sale.set(h.id, hacer(h));
  }
  if (sale.size !== dif.total) return null;
  if (!dif.orden) return sale;
  const ordenada = new Map<string, F>();
  for (const id of dif.orden) {
    const f = sale.get(id);
    if (f === undefined) return null;
    ordenada.set(id, f);
  }
  return ordenada.size === dif.total ? ordenada : null;
}
