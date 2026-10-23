// Lógica pura de Nueva tarea (sin JSX, para que `node --test` la importe):
// el filtro del combobox de proyectos y el esfuerzo recordado por modelo.

/** "Diseño Web" → "diseno web": sin acentos ni mayúsculas. */
export const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

type Proy = { nombre: string; slug: string };

/**
 * Los proyectos que coinciden con lo escrito (en el nombre del registry o en el
 * slug), los usados hace poco primero (`recientes`: slug → epoch del último
 * hilo) y después por nombre. Si lo escrito es el comienzo del nombre, gana.
 */
export function filtrarProyectos<P extends Proy>(proyectos: P[], q: string, recientes: Record<string, number> = {}): P[] {
  const b = plano(q.trim());
  const nombre = (p: P) => plano(p.nombre);
  const coinciden = b ? proyectos.filter((p) => nombre(p).includes(b) || plano(p.slug).includes(b)) : [...proyectos];
  const empieza = (p: P) => (b && (nombre(p).startsWith(b) || plano(p.slug).startsWith(b)) ? 0 : 1);
  return coinciden.sort(
    (x, y) =>
      empieza(x) - empieza(y) ||
      (recientes[y.slug] ?? 0) - (recientes[x.slug] ?? 0) ||
      nombre(x).localeCompare(nombre(y)),
  );
}

/** slug → `inicio` del hilo más nuevo de ese proyecto. */
export function recientesDe(hilos: { proyecto: string; inicio: number }[]) {
  const r: Record<string, number> = {};
  for (const h of hilos) if (h.inicio > (r[h.proyecto] ?? 0)) r[h.proyecto] = h.inicio;
  return r;
}

// El esfuerzo de un modelo (el último que el usuario eligió o el de la tabla): src/hilo/modelos.ts.
export { effortPara } from "./modelos";
