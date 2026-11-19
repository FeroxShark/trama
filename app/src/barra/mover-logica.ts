// Mover un líder a otra carpeta de la barra (arrastrando o desde su menú): qué se guarda. Puro: lo prueba `tests/mover-lider.test.ts`.
import { GENERAL } from "../datos/contrato.ts";

// La asignación del usuario (`nombres.proyectos`) gana sobre el `cwd` y el primer worker (`armarArbol`). Es de organización: la
// carpeta de trabajo del líder no cambia.

/**
 * Qué se guarda al mover un líder a `destino`. `natural` es la carpeta que le tocaría sin nada elegido a mano (la de su primer
 * worker, la fijada o la que nombra su primer mensaje). Mover a esa misma carpeta borra la asignación (`null`): vuelve a ser
 * automático y no queda una elección que ya no dice nada.
 */
export function asignacionAlMover(natural: string | null | undefined, destino: string): string | null {
  return natural != null && natural === destino ? null : destino;
}

/** Los líderes de una carpeta de la barra: el destino de un arrastre es otra carpeta, nunca la propia. */
export const esOtraCarpeta = (propia: string | null | undefined, destino: string | null | undefined): destino is string => !!destino && destino !== propia;

/**
 * Las carpetas que ofrece «Mover a proyecto…»: la del home (`general`) primero y el resto por nombre, sin repetidos (por slug y por
 * cómo se ve). Entran las del registro, las que están en la barra y la que ya tiene elegida a mano.
 */
export function carpetasParaMover(o: { registro: readonly string[]; enBarra: readonly string[]; ya: string | null; nombre: (slug: string) => string }): { p: string; texto: string }[] {
  const vistos = new Set<string>();
  const resto = [...new Set([...o.registro, ...o.enBarra, ...(o.ya ? [o.ya] : [])])]
    .filter((p) => p !== GENERAL)
    .map((p) => ({ p, texto: o.nombre(p) }))
    .filter(({ texto }) => !vistos.has(texto.toLowerCase()) && !!vistos.add(texto.toLowerCase()))
    .sort((a, b) => a.texto.localeCompare(b.texto, undefined, { sensitivity: "base", numeric: true }));
  return [{ p: GENERAL, texto: o.nombre(GENERAL) }, ...resto];
}
