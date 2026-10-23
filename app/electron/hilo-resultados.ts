// Los resultados de herramientas de un worker. `pa --hilo` no trae los `tool_result` (los descarta):
// se leen del mismo transcript que dice su respuesta, con la lectura incremental de un líder
// (`conv-cache.ts`), y se pegan a cada llamada. La pareja de un mensaje de `pa` es el del transcript
// con su misma hora (`ts`: la del primer renglón del mensaje del asistente, en los dos lados).
import { convDe } from "./conv-cache.ts";
import type { Det, EstadoConv } from "./lider-arma.ts";

/** A cada `herramientas_det` de la página de `pa` le suma su `id` y `resultado`, si el transcript los tiene. Puro. */
export function conResultados(r: any, est: EstadoConv): any {
  if (!r || !Array.isArray(r.mensajes)) return r;
  const porTs = new Map<string, Det[][]>();
  for (const m of est.todos) {
    if (m.rol !== "assistant" || !m.ts || !m.det.length) continue;
    const l = porTs.get(m.ts);
    if (l) l.push(m.det);
    else porTs.set(m.ts, [m.det]);
  }
  const mensajes = r.mensajes.map((m: any) => {
    const det: any[] | undefined = Array.isArray(m?.herramientas_det) ? m.herramientas_det : undefined;
    if (!det?.length || typeof m.ts !== "string") return m;
    const par = porTs.get(m.ts)?.find((d) => d.length === det.length && d.every((x, k) => x.nombre === det[k]?.nombre));
    if (!par) return m;
    return { ...m, herramientas_det: det.map((d, k) => ({ ...d, id: par[k].id, ...(par[k].resultado ? { resultado: par[k].resultado } : {}) })) };
  });
  return { ...r, mensajes };
}

/** La página de `pa --hilo` con los resultados de sus herramientas. Nunca falla: sin transcript, queda como vino. */
export async function conLosResultados(id: string, r: any): Promise<any> {
  if (typeof r?.transcript !== "string" || !Array.isArray(r.mensajes) || !r.mensajes.some((m: any) => m?.herramientas_det?.length)) return r;
  try {
    return conResultados(r, await convDe(`worker:${id}`, r.transcript));
  } catch {
    return r;
  }
}
