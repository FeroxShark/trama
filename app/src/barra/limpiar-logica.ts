// «Limpiar chats»: qué líderes entran en la lista del diálogo (Limpiar.tsx). Puro, lo prueba tests/limpiar-chats.test.ts.
// Entra el que lleva más de N días sin actividad y no tiene nada pendiente: sin responder, sin workers vivos, sin subagentes, sin cola,
// y que no esté abierto en una terminal (a ése no se le toca el proceso). Los que ya salieron (Murió, Cerrado) entran: son justo los que
// se quieren sacar de la vista. Archivar usa el mismo camino que el botón de cada fila (`settleLiderYa`), así que la conversación
// queda en disco y se puede retomar.
import type { Lider } from "../datos/contrato.ts";
import { activo, type Arbol, type Rama } from "./arbol.ts";

/** Los plazos que se pueden elegir, en días. */
export const DIAS_LIMPIAR = [1, 3, 7, 30] as const;
export type DiasLimpiar = (typeof DIAS_LIMPIAR)[number];
export const DIAS_DEFECTO: DiasLimpiar = 3;

const DIA_S = 86400;

/** Un líder de la barra con lo que la barra sabe y el líder solo no: su carpeta y si tiene workers vivos (trabajando, colgados o en cola). */
export type EntradaLimpiar = { lider: Lider; proyecto: string; conWorkers: boolean };

export type CandidatoLimpiar = {
  sid: string;
  nombre: string;
  proyecto: string;
  /** Epoch s de su última actividad (`Lider.actividad`). */
  actividad: number;
  /** Cómo está sin actividad: `murio` (se cayó), `cerrado` (sin proceso, cerrado) o `quieto` (con proceso, ocioso). */
  estado: "murio" | "cerrado" | "quieto";
};

export type OpcionesLimpiar = {
  dias: number;
  /** Epoch s de ahora. */
  ahora: number;
  /** Los líderes con algo en la cola de mensajes o en camino. */
  conCola: ReadonlySet<string>;
  /** Sólo los de esta carpeta (el menú de una carpeta); sin esto, todos. */
  proyecto?: string;
};

/** ¿Puede entrar este líder? Sólo el motivo de que no entre cuenta: por eso devuelve un booleano chato y no una razón. */
export function limpiable(e: EntradaLimpiar, o: OpcionesLimpiar): boolean {
  const l = e.lider;
  if (o.proyecto !== undefined && e.proyecto !== o.proyecto) return false;
  if (o.ahora - l.actividad <= o.dias * DIA_S) return false;
  if (l.ocupado || l.pide || e.conWorkers || (l.subagentes ?? 0) > 0) return false;
  if (o.conCola.has(l.id)) return false;
  // Uno de terminal con su proceso vivo está abierto en otro lado: no es nuestro para cerrar.
  if (l.origen === "terminal" && l.vivo) return false;
  return true;
}

/** Los candidatos, los más viejos primero. */
export function candidatosLimpiar(entradas: readonly EntradaLimpiar[], o: OpcionesLimpiar): CandidatoLimpiar[] {
  const vistos = new Set<string>();
  const r: CandidatoLimpiar[] = [];
  for (const e of entradas) {
    if (vistos.has(e.lider.id) || !limpiable(e, o)) continue;
    vistos.add(e.lider.id);
    const l = e.lider;
    r.push({ sid: l.id, nombre: l.nombre, proyecto: e.proyecto, actividad: l.actividad, estado: l.caido === "murio" ? "murio" : l.caido === "cerro" || !l.vivo ? "cerrado" : "quieto" });
  }
  return r.sort((a, b) => a.actividad - b.actividad || a.sid.localeCompare(b.sid));
}

/** Cuántos de los de la lista quedan marcados al archivar (los que no se destildaron). */
export const aArchivar = (c: readonly CandidatoLimpiar[], destildados: ReadonlySet<string>): string[] => c.filter((x) => !destildados.has(x.sid)).map((x) => x.sid);

/**
 * Los líderes que la barra tiene a la vista (las ramas de cada carpeta, los en espera, los dormidos y "Activas"), con su carpeta y si
 * tienen workers vivos. Los que la barra esconde (un Settle hecho, un filtro) no están: no hay nada que limpiar de ellos.
 */
export function entradasLimpiar(a: Pick<Arbol, "activas" | "carpetas" | "lideres">): EntradaLimpiar[] {
  const r: EntradaLimpiar[] = [];
  const poner = (rama: Rama, proyecto: string) => {
    if (!rama.lider) return;
    r.push({ lider: rama.lider, proyecto, conWorkers: [...rama.vivas, ...rama.viejas].some(activo) });
  };
  for (const rama of a.activas) if (rama.lider) poner(rama, a.lideres.get(rama.lider.id)?.proyecto ?? rama.lider.proyecto);
  for (const c of a.carpetas) for (const rama of [...c.ramas, ...c.espera, ...c.dormidos]) poner(rama, c.proyecto);
  return r;
}
