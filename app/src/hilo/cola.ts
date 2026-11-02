// La cola de mensajes de un líder, vista desde acá: lo que el usuario manda mientras el líder está a
// mitad de un turno espera en el main (electron/cola.ts, guardada en disco) y sale solo cuando
// queda libre. Esto es su espejo: lo que hay en cada cola y, si lo último no pudo salir, por
// qué. Lo llenan los avisos del main (src/hilo/vivo.ts); la vista se suscribe por líder.
import type { AvisoCola, Encolado } from "../../electron/cola";

export type { AvisoCola, Encolado };

const VACIA: readonly Encolado[] = [];

/** Lo de un líder: lo que espera, lo que ya salió y espera entrar (`camino`), y por qué no salió el primero (y de cuál es). */
export type EstadoCola = { lista: readonly Encolado[]; camino: readonly Encolado[]; error: string | null; errorId: number | null };
const NADA: EstadoCola = { lista: VACIA, camino: VACIA, error: null, errorId: null };

export function crearEspejo() {
  const colas = new Map<string, EstadoCola>();
  const oyentes = new Map<string, Set<() => void>>();

  return {
    /** Todo junto: el mismo objeto mientras no cambie (para `useSyncExternalStore`). */
    estado: (sid: string): EstadoCola => colas.get(sid) ?? NADA,
    /** El mismo arreglo mientras no cambie (para `useSyncExternalStore`). */
    lista: (sid: string) => colas.get(sid)?.lista ?? VACIA,
    /** Por qué no salió el primero (ya como texto del main), o `null`. */
    error: (sid: string) => colas.get(sid)?.error ?? null,
    poner(a: Pick<AvisoCola, "sid" | "lista" | "error" | "camino" | "errorId">) {
      const camino = a.camino?.length ? a.camino : VACIA;
      if (a.lista.length || camino.length) colas.set(a.sid, { lista: a.lista, camino, error: a.error, errorId: a.error ? (a.errorId ?? a.lista[0]?.id ?? null) : null });
      else if (!colas.delete(a.sid)) return;
      oyentes.get(a.sid)?.forEach((f) => f());
    },
    suscribir(sid: string, fn: () => void) {
      let s = oyentes.get(sid);
      if (!s) oyentes.set(sid, (s = new Set()));
      s.add(fn);
      return () => void s.delete(fn);
    },
  };
}
