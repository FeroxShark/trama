// La búsqueda del selector de una sola lista (el de la carpeta de un líder nuevo, `Selector` con `buscar`): qué opciones quedan con lo
// escrito y a dónde va la selección con cada tecla. Sin JSX ni DOM: lo prueban los tests. Lo mismo que el selector en columnas
// (`selector-columnas.ts`): sin mayúsculas ni tildes, y cada palabra de la búsqueda tiene que aparecer.
import { llano } from "./selector-columnas.ts";

/** Lo mínimo que hace falta para filtrar una opción (el `Opcion` del selector lo cumple). */
export type Filtrable = {
  nombre: string;
  /** Lo que la búsqueda también mira: en el selector de carpetas, la ruta. */
  desc: string;
  /** Se ve siempre, aunque la búsqueda no la deje (la salida "Otra carpeta…"). */
  fija?: boolean;
};

/** Las opciones que quedan con la búsqueda, en su orden: las que tienen todas sus palabras en el nombre o la descripción. Las `fija` siempre quedan. Sin búsqueda, todas. */
export function filtrarLista<T extends Filtrable>(opciones: readonly T[], busqueda: string): T[] {
  const palabras = llano(busqueda).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [...opciones];
  return opciones.filter((o) => {
    if (o.fija) return true;
    const texto = llano(`${o.nombre} ${o.desc}`);
    return palabras.every((p) => texto.includes(p));
  });
}

/**
 * A qué opción queda resaltada con una flecha: `i` es la resaltada ahora (-1 si ninguna) y `n` cuántas se ven. Abajo y arriba recorren
 * la lista sin pasar de los extremos. Sin opciones, -1.
 */
export function moverResaltada(n: number, i: number, tecla: "ArrowDown" | "ArrowUp"): number {
  if (n <= 0) return -1;
  return tecla === "ArrowDown" ? Math.min(n - 1, i + 1) : Math.max(0, i - 1);
}
