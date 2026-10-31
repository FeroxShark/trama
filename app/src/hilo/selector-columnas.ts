// La parte pura del selector en columnas (src/hilo/Selector.tsx): cómo se reparten las opciones en columnas por proveedor, el filtro de
// la búsqueda y a dónde va el foco con cada flecha. Sin JSX ni DOM: lo prueban los tests.

/** Lo mínimo que se le pide a una opción para repartirla (el `Opcion` del selector lo cumple). */
export type Repartible = {
  id: string;
  nombre: string;
  desc: string;
  /** Qué hay en el rótulo de la columna si la opción lo trae; sin esto, el `grupo`. */
  grupo?: string;
  /** La columna a la que va, si no es la de su `grupo` (dos grupos en una columna: los locales de GPU y los de Ollama). */
  col?: string;
  /** El título de la columna, si no es el `grupo`. */
  colNombre?: string;
  /** Para ordenar las columnas (menor, antes); sin esto, en el orden en que aparecen. */
  colOrden?: number;
};

export type Columna<T> = { clave: string; nombre: string; ops: T[] };
export type Reparto<T> = {
  /** Las opciones sin grupo ("Elegí uno…", "Como hoy"): una fila arriba, a todo lo ancho. */
  arriba: T[];
  columnas: Columna<T>[];
};

/** Reparte las opciones: las que traen grupo, en una columna por grupo; las demás, arriba. */
export function repartir<T extends Repartible>(opciones: readonly T[]): Reparto<T> {
  const arriba: T[] = [];
  const por = new Map<string, Columna<T> & { orden: number }>();
  for (const o of opciones) {
    const clave = o.col ?? o.grupo;
    if (!clave) {
      arriba.push(o);
      continue;
    }
    let c = por.get(clave);
    if (!c) {
      c = { clave, nombre: o.colNombre ?? o.grupo ?? clave, ops: [], orden: o.colOrden ?? Number.POSITIVE_INFINITY };
      por.set(clave, c);
    }
    c.orden = Math.min(c.orden, o.colOrden ?? Number.POSITIVE_INFINITY);
    c.ops.push(o);
  }
  // `sort` es estable: las que empatan (sin orden) quedan como aparecieron.
  const columnas = [...por.values()].sort((a, b) => a.orden - b.orden).map(({ clave, nombre, ops }) => ({ clave, nombre, ops }));
  return { arriba, columnas };
}

/** Sin mayúsculas ni tildes: "gemini" encuentra "Géminis". */
export const llano = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Las opciones que tienen todas las palabras de la búsqueda (en su nombre, su empresa o su descripción). Sin búsqueda, todas. */
export function filtrar<T extends Repartible>(opciones: readonly T[], busqueda: string): T[] {
  const palabras = llano(busqueda).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [...opciones];
  // Las que no tienen grupo ("Elegí uno…") no son un modelo: con una búsqueda no se muestran.
  return opciones.filter((o) => {
    if (!o.grupo && !o.col) return false;
    const texto = llano(`${o.nombre} ${o.grupo ?? ""} ${o.colNombre ?? ""} ${o.desc}`);
    return palabras.every((p) => texto.includes(p));
  });
}

/** Dónde está el foco: la sección (0 = la fila de arriba, 1… = las columnas) y la opción dentro de ella. */
export type Pos = { s: number; i: number };
export type Flecha = "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

/**
 * A dónde va el foco con una tecla. `largos[s]` es cuántas opciones elegibles tiene la sección `s` (la 0 es la fila de arriba: puede
 * estar vacía). Abajo y arriba recorren la columna y cruzan entre la fila de arriba y las columnas; izquierda y derecha pasan a la columna
 * de al lado (saltando las vacías) en la misma altura o la última si es más corta; Inicio y Fin van a la primera y a la última de la sección.
 * Donde no hay a dónde ir, se queda.
 */
export function mover(largos: readonly number[], p: Pos, tecla: Flecha): Pos {
  const largo = largos[p.s] ?? 0;
  switch (tecla) {
    case "ArrowDown": {
      if (p.i + 1 < largo) return { s: p.s, i: p.i + 1 };
      if (p.s === 0) {
        const s = largos.findIndex((n, k) => k > 0 && n > 0);
        if (s > 0) return { s, i: 0 };
      }
      return p;
    }
    case "ArrowUp": {
      if (p.i > 0) return { s: p.s, i: p.i - 1 };
      if (p.s > 0 && (largos[0] ?? 0) > 0) return { s: 0, i: largos[0]! - 1 };
      return p;
    }
    case "ArrowLeft":
    case "ArrowRight": {
      if (p.s === 0) return p;
      const paso = tecla === "ArrowLeft" ? -1 : 1;
      for (let s = p.s + paso; s > 0 && s < largos.length; s += paso) {
        if (largos[s]! > 0) return { s, i: Math.min(p.i, largos[s]! - 1) };
      }
      return p;
    }
    case "Home":
      return { s: p.s, i: 0 };
    case "End":
      return { s: p.s, i: Math.max(0, largo - 1) };
  }
}

/**
 * A dónde va el foco dentro de la fila de esfuerzo (el pie del menú del modelo, cuando la barra lo fusiona en el chip): `i` es la
 * opción con foco y `n` cuántas hay. Derecha y abajo avanzan sin pasar de la última; izquierda vuelve a la anterior; Inicio y Fin van a
 * los extremos. Arriba en la primera vuelve a la lista de modelos (`null`). Donde no hay a dónde ir, se queda.
 */
export function moverEsfuerzo(n: number, i: number, tecla: Flecha): number | null {
  switch (tecla) {
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(n - 1, i + 1);
    case "ArrowLeft":
      return Math.max(0, i - 1);
    case "ArrowUp":
      return i > 0 ? i - 1 : null;
    case "Home":
      return 0;
    case "End":
      return Math.max(0, n - 1);
  }
}
