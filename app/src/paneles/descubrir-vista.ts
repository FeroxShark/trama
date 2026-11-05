// Ajustes > Conectores > Descubrir: lo que se hace con el catálogo antes de dibujarlo (filtrar por tipo, buscar, ordenar por fecha, decir
// el estado de cada uno). Puro: lo prueba tests/descubrir-vista.test.ts. La fecha que falta es «sin dato» y va siempre al final.
import type { ItemMcp, ItemSkill } from "../../electron/descubrir";

export type ItemDescubrir = ItemSkill | ItemMcp;
export type FiltroTipo = "todo" | "skill" | "mcp";
export type OrdenDescubrir = "reciente" | "nombre";
export const TIPOS_DESCUBRIR: readonly FiltroTipo[] = ["todo", "skill", "mcp"];
export const ORDENES_DESCUBRIR: readonly OrdenDescubrir[] = ["reciente", "nombre"];

/** Cuántos se ven de entrada (el registro MCP trae cientos). */
export const VISIBLES_DESCUBRIR = 12;

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Cómo se llama en la lista: el título del registro si lo trae, si no su nombre. */
export const nombreVisible = (i: ItemDescubrir): string => (i.tipo === "mcp" ? i.titulo ?? i.nombre : i.nombre);

export const delTipo = (items: ItemDescubrir[], tipo: FiltroTipo): ItemDescubrir[] => (tipo === "todo" ? items : items.filter((i) => i.tipo === tipo));

/** Cada palabra tiene que estar en el nombre, la descripción o el origen (sin tildes ni mayúsculas). */
export function buscarDescubrir(items: ItemDescubrir[], consulta: string): ItemDescubrir[] {
  const palabras = sinTildes(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return items;
  return items.filter((i) => {
    const pajar = sinTildes(`${i.nombre} ${i.tipo === "mcp" ? i.titulo ?? "" : ""} ${i.descripcion ?? ""} ${i.origen}`);
    return palabras.every((p) => pajar.includes(p));
  });
}

/** Más recientes primero (lo sin fecha al final, por nombre) o por nombre. No toca la lista que recibe. */
export function ordenarDescubrir(items: ItemDescubrir[], orden: OrdenDescubrir): ItemDescubrir[] {
  const porNombre = (a: ItemDescubrir, b: ItemDescubrir) => nombreVisible(a).localeCompare(nombreVisible(b)) || a.id.localeCompare(b.id);
  return [...items].sort((a, b) => {
    if (orden === "nombre") return porNombre(a, b);
    const fa = a.fecha ? Date.parse(a.fecha) : NaN;
    const fb = b.fecha ? Date.parse(b.fecha) : NaN;
    if (Number.isNaN(fa) !== Number.isNaN(fb)) return Number.isNaN(fa) ? 1 : -1;
    return (Number.isNaN(fa) ? 0 : fb - fa) || porNombre(a, b);
  });
}

/** «5 nov 2026» o `null` si la fecha falta o no es una fecha (el que llama pone «sin dato»). */
export function fechaCorta(iso: string | null, locale: string): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }).replace(/\./g, "").replace(/ de /g, " ");
}

/** «12 KB»: tamaños de archivos para la confirmación. */
export function tamanoCorto(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Qué se puede hacer con un item: instalar una skill, agregar un remoto https, ver el comando de un paquete, o nada (remoto sin https y sin paquete). */
export type Accion = "skill" | "remoto" | "paquete" | "ninguna";
export const accionDe = (i: ItemDescubrir): Accion => (i.tipo === "skill" ? "skill" : i.remoto?.seguro ? "remoto" : i.paquete ? "paquete" : "ninguna");

/** ¿Ya está? (la skill en `~/.claude/skills`, el remoto en los conectores propios) */
export const yaEsta = (i: ItemDescubrir): boolean => (i.tipo === "skill" ? i.instalado : i.agregado);
