// Lo que gastó cada subagente de un líder, para pintarlo (panel de contexto, burbuja de la llamada Agent): cuentas puras sobre los datos que
// manda el main (electron/subagentes-gasto.ts). Lo prueba `tests/gasto-sub-logica.test.ts`.
import type { GastoSubagentes, SubagenteGasto } from "../../electron/subagentes-gasto";

/** El punto de color de cada estado (las clases de los workers: `trab`, `term`, `frenado`); la palabra va siempre al lado. */
export type TipoEstadoSub = "trab" | "term" | "frenado";
export const tipoEstadoSub = (e: SubagenteGasto["estado"]): TipoEstadoSub => (e === "corriendo" ? "trab" : e === "terminado" ? "term" : "frenado");

/** La palabra del estado (claves de i18n que ya usa la lista de subagentes de la barra). */
export const claveEstadoSub = (e: SubagenteGasto["estado"]) => `sub.${e}` as "sub.corriendo" | "sub.terminado" | "sub.error" | "sub.parado";

/** Las llamadas Agent de la conversación (`tool_use_id`) → lo que gastó el subagente que lanzaron. */
export function porLlamada(g: GastoSubagentes | null): ReadonlyMap<string, SubagenteGasto> {
  const m = new Map<string, SubagenteGasto>();
  for (const s of g?.subagentes ?? []) if (s.llamada) m.set(s.llamada, s);
  return m;
}

/** Cuánto de su ventana pesa su contexto final (0–100); `null` si no hizo ningún pedido todavía. */
export const pctContexto = (s: SubagenteGasto): number | null => (s.contexto && s.ventana > 0 ? Math.min(100, Math.round((s.contexto / s.ventana) * 100)) : null);

/** Los que corren van primero; el resto por hora de arranque, el más nuevo arriba. */
export const ordenSubs = (xs: readonly SubagenteGasto[]): SubagenteGasto[] =>
  [...xs].sort((a, b) => Number(b.estado === "corriendo") - Number(a.estado === "corriendo") || b.inicio - a.inicio || (a.id < b.id ? -1 : 1));
