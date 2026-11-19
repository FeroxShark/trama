// «Historial de chats» (Historial.tsx): lista, filtros, búsqueda y agrupación. Puro, lo prueba tests/historial-logica.test.ts.
// Los chats los arma el main (electron/historial-chats.ts): los que Trama lanzó y ya no están en la barra, archivados o cerrados.
import type { ChatHistorial, type ComoSalio, type MotivoNoBorrado } from "../datos/contrato.ts";
import { OTRAS } from "./claude-code.ts";

export type FiltroHistorial = "todos" | ComoSalio;
export type AgruparHistorial = "proyecto" | "fecha";

export const FILTROS: readonly FiltroHistorial[] = ["todos", "archivado", "cerrado"];

/** La carpeta del historial a la que va un chat: su proyecto, la personal o «Otras carpetas». */
export const carpetaHistorial = (c: ChatHistorial): string => c.proyecto ?? OTRAS;

const llano = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Cuántos hay de cada filtro (el número de cada chip). Cuentan todos, no sólo los que deja ver la búsqueda. */
export function contarHistorial(chats: readonly ChatHistorial[]): Record<FiltroHistorial, number> {
  let a = 0;
  for (const c of chats) if (c.como === "archivado") a++;
  return { todos: chats.length, archivado: a, cerrado: chats.length - a };
}

/** Los que pasan el filtro y dicen todas las palabras de `q` en su nombre (`nombre`) o en el de su carpeta (`carpeta`), sin tildes ni mayúsculas. */
export function filtrarHistorial(
  chats: readonly ChatHistorial[],
  o: { q: string; filtro: FiltroHistorial; nombre: (c: ChatHistorial) => string; carpeta: (c: ChatHistorial) => string },
): ChatHistorial[] {
  const palabras = llano(o.q).split(/\s+/).filter(Boolean);
  return chats.filter((c) => {
    if (o.filtro !== "todos" && c.como !== o.filtro) return false;
    if (!palabras.length) return true;
    const texto = llano(`${o.nombre(c)} ${o.carpeta(c)}`);
    return palabras.every((p) => texto.includes(p));
  });
}

export type GrupoHistorial = { clave: string; chats: ChatHistorial[] };

/**
 * «Por proyecto»: un grupo por carpeta, la que salió más recientemente primero y «Otras carpetas» al final; adentro, lo más reciente primero.
 * «Por fecha»: un solo grupo (clave vacía) de lo más reciente a lo más viejo.
 */
export function agruparHistorial(chats: readonly ChatHistorial[], como: AgruparHistorial): GrupoHistorial[] {
  const orden = [...chats].sort((a, b) => b.cuando - a.cuando || a.sid.localeCompare(b.sid));
  if (como === "fecha") return orden.length ? [{ clave: "", chats: orden }] : [];
  const m = new Map<string, ChatHistorial[]>();
  for (const c of orden) {
    const k = carpetaHistorial(c);
    const l = m.get(k);
    if (l) l.push(c);
    else m.set(k, [c]);
  }
  const claves = [...m.keys()].sort((a, b) => (a === OTRAS ? 1 : b === OTRAS ? -1 : (m.get(b)![0]!.cuando - m.get(a)![0]!.cuando)));
  return claves.map((clave) => ({ clave, chats: m.get(clave)! }));
}

/** Los sid en el orden en que se ven (sin los de las carpetas plegadas): por donde andan las flechas. */
export const sidsVisibles = (grupos: readonly GrupoHistorial[], plegados: ReadonlySet<string>): string[] =>
  grupos.flatMap((g) => (g.clave && plegados.has(g.clave) ? [] : g.chats.map((c) => c.sid)));

/** El que sigue (+1) o el anterior (−1) sin dar la vuelta; sin ninguno marcado, el primero (o el último yendo hacia atrás). */
export function vecino(sids: readonly string[], actual: string | null, delta: 1 | -1): string | null {
  if (!sids.length) return null;
  const i = actual === null ? -1 : sids.indexOf(actual);
  if (i < 0) return delta === 1 ? sids[0]! : sids[sids.length - 1]!;
  return sids[Math.min(sids.length - 1, Math.max(0, i + delta))]!;
}

/** La clave de texto de por qué no se borró (`historial.noBorrado.*`). */
export const claveNoBorrado = (m: MotivoNoBorrado) => `historial.noBorrado.${m}` as const;
