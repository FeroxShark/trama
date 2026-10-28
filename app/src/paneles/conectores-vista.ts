// Ajustes > Conectores: lo que se hace con el inventario de Claude Code antes de dibujarlo (agrupar por tipo, ordenar, buscar). Puro: lo prueba
// tests/conectores-vista.test.ts.
import type { Conector, TipoConector } from "../../electron/conectores-claude";

export const TIPOS: readonly TipoConector[] = ["skill", "plugin", "mcp", "hook"];

const ORDEN_ORIGEN = { usuario: 0, proyecto: 1, plugin: 2, claudeai: 3 } as const;

const sinTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const carpeta = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

/** Cómo se llama el lugar de donde viene (para mostrarlo y para buscar): el plugin, o la carpeta del proyecto. */
export const deDonde = (c: Conector): string => (c.origen === "proyecto" && c.de && !c.de.includes("@") ? carpeta(c.de) : c.de);

/** Cada palabra de la búsqueda tiene que estar en el nombre, la descripción, el origen o el destino (sin tildes ni mayúsculas). */
export function filtrar(items: Conector[], consulta: string): Conector[] {
  const palabras = sinTildes(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return items;
  return items.filter((c) => {
    const pajar = sinTildes([c.nombre, c.descripcion, deDonde(c), c.origen, c.clase ?? "", c.destino ?? "", (c.variables ?? []).join(" ")].join(" "));
    return palabras.every((p) => pajar.includes(p));
  });
}

/** Los de un tipo, del usuario primero, después proyectos, plugins y claude.ai; por nombre dentro de cada origen. */
export function delTipo(items: Conector[], tipo: TipoConector): Conector[] {
  return items
    .filter((c) => c.tipo === tipo)
    .sort((a, b) => ORDEN_ORIGEN[a.origen] - ORDEN_ORIGEN[b.origen] || deDonde(a).localeCompare(deDonde(b)) || a.nombre.localeCompare(b.nombre));
}
