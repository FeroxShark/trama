// La cola de mensajes de un líder, vista desde acá: lo que el usuario manda mientras el líder está a
// mitad de un turno espera en el main (electron/cola.ts, guardada en disco) y sale solo cuando
// queda libre. Esto es su espejo: lo que hay en cada cola y, si lo último no pudo salir, por
// qué. Lo llenan los avisos del main (src/hilo/vivo.ts); la vista se suscribe por líder.
import type { AvisoCola, Encolado } from "../../electron/cola";

export type { AvisoCola, Encolado };

const VACIA: readonly Encolado[] = [];

export function crearEspejo() {
  const colas = new Map<string, { lista: readonly Encolado[]; error: string | null }>();
  const oyentes = new Map<string, Set<() => void>>();

  return {
    /** El mismo arreglo mientras no cambie (para `useSyncExternalStore`). */
    lista: (sid: string) => colas.get(sid)?.lista ?? VACIA,
    /** Por qué no salió el primero (ya como texto del main), o `null`. */
    error: (sid: string) => colas.get(sid)?.error ?? null,
    poner(a: Pick<AvisoCola, "sid" | "lista" | "error">) {
      if (a.lista.length) colas.set(a.sid, { lista: a.lista, error: a.error });
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
