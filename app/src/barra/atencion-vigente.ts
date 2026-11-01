// Lo que pide atención en la lista (un worker que falló o espera una decisión) sólo cuenta mientras la pide de verdad. Un
// fallo ya relanzado, integrado, descartado o visto no sigue en el chip "N falló" ni en el ícono rojo de su líder; una
// decisión ya contestada no sigue en "N esperan". Puro: lo prueba `tests/atencion-vigente.test.ts`.
import { cerrado } from "../datos/contrato.ts";
import { fin, frenado, type Item } from "./arbol.ts";

/** Cuándo abrió el usuario cada worker (`leidos.json`, id → epoch s). Abrir un fallo lo deja visto. */
export type Leidos = Readonly<Record<string, number>>;

/**
 * Los ids de los workers que pidieron atención (falló sin que `pa --parar` lo frenara, o esperan una decisión) y ya no la piden:
 *  (a) su rama ya se integró o se descartó (otro worker de esa misma rama lo dice con su estado);
 *  (b) un worker posterior lo reemplaza: un `--seguir`/`--actualizar` del mismo id (`sigue_de`) o uno relanzado sobre la misma
 *      rama. En una decisión, esa corrida nueva es la que la contestó;
 *  (c) el usuario ya lo vio. Sólo cuenta para un fallo: abrir una decisión no la contesta.
 * `items`: los workers con el estado que muestra la barra (`estadoVisto`, con lo optimista ya puesto).
 */
export function resueltosDe(items: readonly Item[], leidos: Leidos): Set<string> {
  // Índices por rama y por `sigue_de`: que la lista crezca no vuelve esto cuadrático.
  const porRama = new Map<string, Item[]>();
  const porOrigen = new Map<string, Item[]>();
  const agregar = (m: Map<string, Item[]>, k: string, it: Item) => m.set(k, [...(m.get(k) ?? []), it]);
  for (const it of items) {
    if (it.h.rama) agregar(porRama, it.h.rama, it);
    if (it.h.sigue_de) agregar(porOrigen, it.h.sigue_de, it);
  }
  const out = new Set<string>();
  for (const it of items) {
    const { h } = it;
    const fallo = it.estado === "murio" && !frenado(it);
    if (!fallo && it.estado !== "decision") continue;
    const deSuRama = h.rama ? (porRama.get(h.rama) ?? []) : [];
    const despues = (x: Item) => x.h.id !== h.id && x.h.inicio > h.inicio;
    const integrada = deSuRama.some((x) => cerrado(x.estado));
    const reemplazada = (porOrigen.get(h.id) ?? []).some(despues) || deSuRama.some(despues);
    const vista = fallo && (leidos[h.id] ?? 0) >= fin(h);
    if (integrada || reemplazada || vista) out.add(h.id);
  }
  return out;
}
