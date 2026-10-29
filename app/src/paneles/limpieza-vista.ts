// Ajustes > Proyectos > Limpieza: lo puro de la vista (cuántas cosas dice el plan, el tamaño legible y los días que se ofrecen). Sin React.
import type { PlanLimpieza } from "../datos/limpieza";

/** Los días de antigüedad que se ofrecen (todos válidos para `pa --limpiar --dias`, 1 a 365). El default es el 7. */
export const DIAS_OFRECIDOS = [3, 7, 14, 30] as const;

/** Un tamaño con una cifra útil: 1,2 GB, 640 MB, 12 KB. `coma`: separador decimal del idioma. */
export function tamano(bytes: number, coma = ","): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let n = Math.max(0, bytes);
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  const s = i === 0 || n >= 10 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString().replace(".", coma);
  return `${s} ${u[i]}`;
}

/** Cuántas cosas quita el plan (puestos, ramas y carpetas de build). */
export const cuantas = (p: PlanLimpieza) => p.worktrees.length + p.ramas.length + p.builds.length;
