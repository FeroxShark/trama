// El orden que el usuario le da a la barra arrastrando (`Nombres.orden`, en nombres.json): las
// carpetas entre sí y los líderes dentro de cada carpeta. Lo que está en la lista va primero,
// en ese orden; lo que nunca se movió sigue después con el orden de siempre (`ordenCarpetas`,
// `ordenLideres`), así uno nuevo entra al final. Puro: lo prueba `tests/orden.test.ts`.
import type { Orden } from "../datos/contrato.ts";

export const ORDEN0: Orden = { carpetas: [], lideres: {} };

/**
 * Compara por la lista puesta a mano: lo listado primero y en su orden; el resto después,
 * con `defecto`. Una lista vacía (o ninguna) deja el orden de siempre.
 */
export function porManual<T>(manual: readonly string[] | undefined, clave: (x: T) => string, defecto: (a: T, b: T) => number): (a: T, b: T) => number {
  if (!manual?.length) return defecto;
  const lugar = new Map(manual.map((id, i) => [id, i]));
  return (a, b) => {
    const x = lugar.get(clave(a));
    const y = lugar.get(clave(b));
    if (x !== undefined && y !== undefined) return x - y;
    if (x !== undefined || y !== undefined) return x !== undefined ? -1 : 1;
    return defecto(a, b);
  };
}

/**
 * `ids` con `id` puesto al lado de `junto`: antes o después. `ids` es la lista entera en el
 * orden que se ve (también lo plegado), así lo que no se movió no se corre. Sin cambio (o
 * con algo que no está), `null`.
 */
export function moverJunto(ids: readonly string[], id: string, junto: string, antes: boolean): string[] | null {
  if (id === junto || !ids.includes(id) || !ids.includes(junto)) return null;
  const out = ids.filter((x) => x !== id);
  out.splice(out.indexOf(junto) + (antes ? 0 : 1), 0, id);
  return out.every((x, i) => x === ids[i]) ? null : out;
}

/**
 * El orden tras soltar `id` al lado de `junto` (antes o después): en las carpetas (`carpeta`
 * null) o entre los líderes de una. `visibles` es lo que hay ahora, en el orden en que se ve;
 * lo guardado que hoy no se ve (un líder archivado, una carpeta vacía) conserva su lugar. La
 * lista queda entera: lo que estaba sin mover pasa a tener el lugar que tenía. Sin cambio, `null`.
 */
export function reordenar(orden: Orden, carpeta: string | null, visibles: readonly string[], id: string, junto: string, antes: boolean): Orden | null {
  const guardada = carpeta === null ? orden.carpetas : (orden.lideres[carpeta] ?? []);
  const lista = moverJunto([...new Set([...guardada, ...visibles])], id, junto, antes);
  if (!lista) return null;
  return carpeta === null ? { ...orden, carpetas: lista } : { ...orden, lideres: { ...orden.lideres, [carpeta]: lista } };
}

/**
 * Un lugar arriba (`-1`) o abajo (`1`) de `id`, para el menú: junto a su vecino entre `vista` (lo
 * que se ve junto a él, en orden; default `visibles`, la lista entera), por el mismo `reordenar`
 * que al soltar. En el primero subir y en el último bajar no hacen nada: `null`.
 */
export function reordenarPaso(orden: Orden, carpeta: string | null, visibles: readonly string[], id: string, dir: -1 | 1, vista: readonly string[] = visibles): Orden | null {
  const i = vista.indexOf(id);
  const vecino = i < 0 ? undefined : vista[i + dir];
  return vecino === undefined ? null : reordenar(orden, carpeta, visibles, id, vecino, dir < 0);
}

/** ¿Hay algo puesto a mano? Si no, el orden ya es el de siempre y "Orden por defecto" no tiene qué hacer. */
export const hayOrdenManual = (orden: Orden | undefined): boolean => !!orden && (orden.carpetas.length > 0 || Object.values(orden.lideres).some((l) => l.length > 0));

/**
 * Sin lo que ya no existe: los líderes que se fueron (y las carpetas que quedaron sin ninguno
 * listado) y las carpetas que no son de nadie. `null` = no se sabe todavía qué existe: eso no se
 * toca. Devuelve el mismo objeto si no sobraba nada.
 */
export function podar(orden: Orden, existe: { lideres: ReadonlySet<string> | null; carpetas: ReadonlySet<string> | null }): Orden {
  let cambio = false;
  let carpetas = orden.carpetas;
  if (existe.carpetas) {
    const c = existe.carpetas;
    carpetas = orden.carpetas.filter((p) => c.has(p));
    cambio ||= carpetas.length !== orden.carpetas.length;
  }
  let lideres = orden.lideres;
  if (existe.lideres) {
    const l = existe.lideres;
    lideres = {};
    for (const [p, ids] of Object.entries(orden.lideres)) {
      const quedan = ids.filter((id) => l.has(id));
      if (quedan.length) lideres[p] = quedan.length === ids.length ? ids : quedan;
      cambio ||= quedan.length !== ids.length;
    }
  }
  return cambio ? { ...orden, carpetas, lideres } : orden;
}

/** Lo que llega del disco o del main, sin confiar: listas de textos sin repetir; lo raro se descarta. */
export function ordenDe(x: unknown): Orden {
  const lista = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === "string" && s !== ""))] : []);
  const o = x && typeof x === "object" && !Array.isArray(x) ? (x as { carpetas?: unknown; lideres?: unknown; prioridad?: unknown }) : {};
  const lideres: Record<string, string[]> = {};
  if (o.lideres && typeof o.lideres === "object" && !Array.isArray(o.lideres))
    for (const [p, v] of Object.entries(o.lideres)) {
      const ids = lista(v);
      if (ids.length) lideres[p] = ids;
    }
  return { carpetas: lista(o.carpetas), lideres, ...(typeof o.prioridad === "boolean" ? { prioridad: o.prioridad } : {}) };
}

/** El orden por prioridad está prendido de fábrica: sólo `false` (Orden fijo, desde el menú) lo apaga. */
export const prioridadPrendida = (orden: Orden | undefined): boolean => orden?.prioridad !== false;
