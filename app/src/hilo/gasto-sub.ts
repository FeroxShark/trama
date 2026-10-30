// El gasto de los subagentes de un líder en la interfaz: se lee del main (`contexto:subagentes`) al abrir, al cambiar los subagentes
// de la sesión y cuando el líder termina de responder; lo comparten el panel de contexto y las burbujas de las llamadas Agent.
import { createContext, useEffect, useMemo, useSyncExternalStore } from "react";
import type { GastoSubagentes, SubagenteGasto } from "../../electron/subagentes-gasto";
import { useSubagentes } from "../barra/subagentes-logica";
import { fuenteContexto } from "../datos/contexto";
import { porLlamada } from "./gasto-sub-logica";

const datos = new Map<string, GastoSubagentes>();
const oyentes = new Map<string, Set<() => void>>();
const pidiendo = new Set<string>();

const avisar = (sid: string) => oyentes.get(sid)?.forEach((f) => f());

/** Vuelve a leer el gasto de la sesión (una a la vez por sesión). Un fallo deja lo que había. */
export function refrescarGasto(sid: string): void {
  if (pidiendo.has(sid)) return;
  pidiendo.add(sid);
  fuenteContexto.subagentes(sid).then(
    (g) => {
      pidiendo.delete(sid);
      // Sin cambios no se avisa: el panel no repinta por nada.
      if (JSON.stringify(datos.get(sid)) === JSON.stringify(g)) return;
      datos.set(sid, g);
      avisar(sid);
    },
    () => void pidiendo.delete(sid),
  );
}

const suscribir = (sid: string) => (fn: () => void) => {
  let s = oyentes.get(sid);
  if (!s) oyentes.set(sid, (s = new Set()));
  s.add(fn);
  return () => void s.delete(fn);
};

/**
 * El gasto de los subagentes de `sid` (`null`: todavía no llegó, o no hay sesión). Se relee al montar, con `clave` (el refresco del
 * panel, o el líder que dejó de responder) y poco después de que cambie algo de los subagentes de la sesión (nace uno, avanza, termina).
 */
export function useGastoSubagentes(sid: string | null, clave: unknown = 0): GastoSubagentes | null {
  const g = useSyncExternalStore(
    useMemo(() => (sid ? suscribir(sid) : () => () => {}), [sid]),
    () => (sid ? (datos.get(sid) ?? null) : null),
  );
  const vivos = useSubagentes(sid);
  const firma = vivos.map((u) => `${u.id}:${u.estado}:${u.tokens}`).join("|");
  useEffect(() => {
    if (!sid) return;
    const x = setTimeout(() => refrescarGasto(sid), 600);
    return () => clearTimeout(x);
  }, [sid, clave, firma]);
  return g;
}

/** Lo que reparte `Lider.tsx` a las llamadas de su conversación: qué gastó cada subagente y cómo abrir su desglose. */
export type ContextoGasto = { sid: string; porLlamada: ReadonlyMap<string, SubagenteGasto> };
export const GastoSubagentesCtx = createContext<ContextoGasto | null>(null);

export const contextoGasto = (sid: string | null, g: GastoSubagentes | null): ContextoGasto | null => (sid && g ? { sid, porLlamada: porLlamada(g) } : null);
