// La sección "Activas" de la barra y qué proyectos flotan: lo que está "caliente" para el usuario, sin que tenga
// que ir a buscarlo entre las carpetas. Puro: lo prueba `tests/barra-orden.test.ts`.
//
// Un líder está caliente (en este orden de prioridad, `Calor`) si:
//   0  te necesita: pide un permiso o una pregunta, o terminó su turno y no lo viste (`Lider.pide` / `espera`);
//   1  corre un turno ahora (`ocupado`);
//   2  tiene workers vivos (trabajando, trabados o en cola) o subagentes corriendo;
//   3  tiene el caché caliente (`cache_vence` en el futuro: lo que el numerito no marca "Uncached").
// Uno sin proceso (`caido`) nunca lo está. Mientras está caliente vive sólo en "Activas" (no se repite en su
// proyecto); al enfriarse vuelve a su lugar de siempre, el que le dio el usuario arrastrando (`orden.ts`).
// Un proyecto con algo caliente (un líder o workers vivos) flota arriba de los fríos; entre sí, y los fríos
// entre sí, conservan el orden del usuario.
//
// Nada salta bajo el mouse: lo caliente se calcula en una "foto" (`Foto`) que quien arma la barra congela
// mientras el usuario la mira (`congelada`) y que se pone al día al soltarla (`usePrioridad.ts`).
import type { Lider } from "../datos/contrato.ts";

export type Calor = 0 | 1 | 2 | 3;

/** Cuánto y desde cuándo: `a` es la actividad del líder en el momento de la foto (desempata dentro de un calor). */
export type Rango = { c: Calor; a: number };

/** Lo caliente en un momento: los líderes (con su calor) y los proyectos con workers vivos sin líder caliente. */
export type Foto = { lideres: ReadonlyMap<string, Rango>; carpetas: ReadonlySet<string> };

export const FOTO0: Foto = { lideres: new Map(), carpetas: new Set() };

/** Lo que hace falta saber de un worker para decidir si su proyecto flota. */
export type Trabajador = { jefe_id: string | null; proyecto: string; vivo: boolean };

type DeLider = Pick<Lider, "id" | "espera" | "pide" | "ocupado" | "cache_vence" | "caido" | "actividad" | "subagentes">;

/** Un worker que sigue en marcha: trabaja, está trabado o espera en la cola. */
export const workerVivo = (h: { estado: string; en_cola?: boolean }): boolean => h.estado === "trabajando" || h.estado === "colgado" || !!h.en_cola;

/** El calor de un líder, o `null` si está frío. `trabajan`: cuántos workers suyos están vivos. */
export function calorLider(l: Omit<DeLider, "id" | "actividad">, trabajan: number, ahora: number): Calor | null {
  if (l.caido) return null;
  if (l.espera || l.pide) return 0;
  if (l.ocupado) return 1;
  if (trabajan > 0 || (l.subagentes ?? 0) > 0) return 2;
  if (l.cache_vence != null && l.cache_vence > ahora) return 3;
  return null;
}

/** La foto de lo caliente: cada líder con su calor y los proyectos con workers vivos que no cuelgan de un líder caliente. */
export function fotoCalor(lideres: readonly DeLider[], workers: readonly Trabajador[], ahora: number): Foto {
  const vivos = new Map<string, number>();
  for (const w of workers) if (w.vivo && w.jefe_id) vivos.set(w.jefe_id, (vivos.get(w.jefe_id) ?? 0) + 1);
  const calientes = new Map<string, Rango>();
  for (const l of lideres) {
    const c = calorLider(l, vivos.get(l.id) ?? 0, ahora);
    if (c !== null) calientes.set(l.id, { c, a: l.actividad });
  }
  const carpetas = new Set<string>();
  for (const w of workers) if (w.vivo && !(w.jefe_id && calientes.has(w.jefe_id))) carpetas.add(w.proyecto);
  return { lideres: calientes, carpetas };
}

export function igualFoto(a: Foto | undefined, b: Foto | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.lideres.size !== b.lideres.size || a.carpetas.size !== b.carpetas.size) return false;
  for (const [id, x] of a.lideres) {
    const y = b.lideres.get(id);
    if (!y || y.c !== x.c || y.a !== x.a) return false;
  }
  for (const p of a.carpetas) if (!b.carpetas.has(p)) return false;
  return true;
}

/** Cuándo (epoch s) vence el primer caché que hoy está vivo: ahí hay que volver a mirar. `null`: ninguno. */
export function proximoVencimiento(lideres: readonly Pick<Lider, "cache_vence" | "caido">[], ahora: number): number | null {
  let min: number | null = null;
  for (const l of lideres) if (!l.caido && l.cache_vence != null && l.cache_vence > ahora && (min === null || l.cache_vence < min)) min = l.cache_vence;
  return min;
}

/** El orden dentro de "Activas": por calor, después el de actividad más reciente, y a igual, un orden estable por id. */
export const compararActivas = (foto: Foto) => (a: { id: string }, b: { id: string }) => {
  const x = foto.lideres.get(a.id);
  const y = foto.lideres.get(b.id);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return x.c - y.c || y.a - x.a || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};

/**
 * Parte los líderes de una carpeta (ya en el orden del usuario) en los calientes, que van a "Activas", y los fríos,
 * que se quedan en su lugar de siempre. Sin foto, todos son fríos.
 */
export function repartir<T extends { id: string }>(lideres: readonly T[], foto: Foto | undefined): { activas: T[]; frias: T[] } {
  const activas: T[] = [];
  const frias: T[] = [];
  for (const l of lideres) (foto?.lideres.has(l.id) ? activas : frias).push(l);
  return { activas: activas.sort(compararActivas(foto ?? FOTO0)), frias };
}

/**
 * Los proyectos con los calientes arriba, cada grupo en el orden que traían (el del usuario). `fijo`: lo que va
 * siempre primero (el home, donde vive Nuevo líder). No toca la lista que recibe.
 */
export function flotar<T>(items: readonly T[], caliente: (x: T) => boolean, fijo: (x: T) => boolean = () => false): T[] {
  return [...items.filter(fijo), ...items.filter((x) => !fijo(x) && caliente(x)), ...items.filter((x) => !fijo(x) && !caliente(x))];
}

/**
 * ¿Hay que dejar el orden como está? Mientras el usuario mira la lista (mouse encima, foco adentro), arrastra o
 * tiene un menú abierto, nada cambia de lugar; al soltarla se aplica lo que pasó (`usePrioridad`).
 */
export const diferir = (m: { mouse?: boolean; foco?: boolean; arrastre?: boolean; menu?: boolean }): boolean => !!(m.mouse || m.foco || m.arrastre || m.menu);
