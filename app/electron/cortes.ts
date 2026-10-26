// Los cortes de un líder (`Guardado.cortes`, electron/lider-arma.ts) vistos desde los puentes de agy / dsh / opencode: cuando hay que abrir una
// sesión nueva y repetir lo hablado (`hablado()`), no se repite lo que se descartó al volver atrás. El transcript no se toca: sólo se lo lee
// sin esas líneas. Puro. lider.ts pasa los cortes por el entorno (`TRAMA_CORTES`).
// (Sin importar lider-arma.ts: los puentes corren como Node pelado y no cargan el resto del main.)
const SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type CorteLinea = { ts: number; uuid: string };

/** Los cortes de `TRAMA_CORTES` (JSON): lo que no tiene forma se descarta. */
export function cortesDeEntorno(v: string | undefined): CorteLinea[] {
  try {
    const j = JSON.parse(v || "[]");
    return Array.isArray(j) ? j.filter((c: any) => Number(c?.ts) > 0 && SID.test(String(c?.uuid))).map((c: any) => ({ ts: Number(c.ts), uuid: String(c.uuid) })) : [];
  } catch {
    return [];
  }
}

/**
 * Las líneas de un transcript sin lo que cada corte descartó: de cada uno, en orden, lo que viene después de la línea `uuid` y es anterior
 * al momento del corte. (Misma regla que `aplicarCortes` de relevo-motor.ts, sobre las líneas crudas.) Un `uuid` que no está se ignora.
 */
export function sinCortadas(lineas: string[], cortes: CorteLinea[]): string[] {
  if (!cortes.length) return lineas;
  let items = lineas.map((texto) => {
    let o: any = null;
    try {
      o = texto ? JSON.parse(texto) : null;
    } catch {
      /* línea rota */
    }
    const t = o?.timestamp ? Date.parse(o.timestamp) : NaN;
    return { texto, uuid: typeof o?.uuid === "string" ? (o.uuid as string) : null, ts: Number.isFinite(t) ? t : null };
  });
  for (const c of [...cortes].sort((a, b) => a.ts - b.ts)) {
    const k = items.findIndex((x) => x.uuid === c.uuid);
    if (k < 0) continue;
    let ultima = -Infinity;
    const horas = items.map((x) => (ultima = x.ts ?? ultima));
    items = items.filter((_, i) => i <= k || horas[i] >= c.ts);
  }
  return items.map((x) => x.texto);
}
