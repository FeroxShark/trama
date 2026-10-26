// La vista de Ramas, lo puro: cuántas ramas tiene cada veredicto del analista,
// el filtro por veredicto y el resumen de arriba. Con extensión en los imports:
// lo prueba `node --test` (tests/ramas-vista.test.ts).
import type { Juicio, Veredicto } from "../datos/analista.ts";
import { VEREDICTOS } from "../datos/analista.ts";

/** Lo que filtran los chips: un veredicto, las que no tienen (todavía) o todas. */
export type FiltroRama = Veredicto | "sin" | "todas";

/** Cuántas ramas tiene cada veredicto; `sin` son las que el analista no juzgó. */
export function cuentas(ids: readonly string[], juicios: ReadonlyMap<string, Juicio>): Record<Veredicto | "sin", number> {
  const c = { integrar: 0, descartar: 0, retomar: 0, revisar: 0, sin: 0 };
  for (const id of ids) {
    const j = juicios.get(id);
    if (j) c[j.veredicto]++;
    else c.sin++;
  }
  return c;
}

/** ¿Pasa la rama el filtro de los chips? */
export const pasa = (id: string, juicios: ReadonlyMap<string, Juicio>, f: FiltroRama): boolean => {
  if (f === "todas") return true;
  const j = juicios.get(id);
  return f === "sin" ? !j : j?.veredicto === f;
};

/** Los veredictos que tienen ramas, en el orden de los chips (integrar primero). */
export const conCuenta = (c: Record<Veredicto | "sin", number>): Veredicto[] => VEREDICTOS.filter((v) => c[v] > 0);

/** Un filtro que se quedó sin ramas (se resolvieron todas) vuelve a "todas". */
export const filtroVigente = (f: FiltroRama, c: Record<Veredicto | "sin", number>): FiltroRama => (f === "todas" || c[f] > 0 ? f : "todas");
