// Lo que la persona dejó dicho para el primer mensaje con la caché vencida (`preferencias.json`, electron/cache-pregunta.ts): se lee una vez
// por arranque y se mantiene al día acá; la caja del líder (Lider.tsx) y Ajustes comparten esta copia.
import { fuente } from "../datos/fuente";
import type { PrefCache } from "../../electron/cache-pregunta";

let valor: PrefCache = "preguntar";
let leido = false;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

export const cacheEleccion = (): PrefCache => {
  if (!leido) {
    leido = true;
    void fuente.cacheVencida().then((v) => {
      if (v !== valor) {
        valor = v;
        avisar();
      }
    });
  }
  return valor;
};

export const alCambiarCacheEleccion = (f: () => void): (() => void) => {
  oyentes.add(f);
  return () => void oyentes.delete(f);
};

/** Recordar (o dejar de recordar, con `preguntar`) la elección: al toque y a preferencias.json. */
export function cambiarCacheEleccion(v: PrefCache) {
  leido = true;
  if (v !== valor) {
    valor = v;
    avisar();
  }
  fuente.guardarCacheVencida(v);
}
