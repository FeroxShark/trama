// Lee y cambia el plan del día de `pa` (`plan.json`: ahorrar / normal / gastar), reutilizando las funciones del CLI
// (`app/electron/cli/reparto.ts`) sin lanzar ningún subproceso y conservando intactos los días de ausencia vigentes.
import { errorT } from "./errores.ts";
import { planGrabar, planLeer, rutaPlan } from "./cli/reparto.ts";

export const MODOS_PLAN_DIA = ["ahorrar", "normal", "gastar"] as const;
export type ModoPlanDia = (typeof MODOS_PLAN_DIA)[number];

export interface EstadoPlanDia {
  modo: ModoPlanDia;
  /** Fechas AAAA-MM-DD de ausencia vigentes (>= hoy), en orden; nunca se tocan al cambiar el plan del día. */
  ausente: string[];
}

export const esModoPlanDia = (x: unknown): x is ModoPlanDia => x === "ahorrar" || x === "normal" || x === "gastar";

/** Lee el plan vigente de `plan.json` (sin archivo o con archivo roto devuelve `normal` y `ausente: []`). */
export function leerPlanDia(opts?: { now?: Date; ruta?: string }): EstadoPlanDia {
  const now = opts?.now ?? new Date();
  const ruta = opts?.ruta ?? rutaPlan();
  const plan = planLeer(now, ruta);
  const modo: ModoPlanDia = plan.hoy === "ahorrar" || plan.hoy === "gastar" ? plan.hoy : "normal";
  return { modo, ausente: plan.ausente };
}

/**
 * Fija el plan del día (`ahorrar` / `normal` / `gastar`). «normal» borra el plan del día (y borra `plan.json` si no hay
 * días de ausencia vigentes; si los hay, los conserva intactos). Rechaza si el modo no es válido.
 */
export function fijarPlanDia(modo: unknown, opts?: { now?: Date; ruta?: string }): EstadoPlanDia {
  if (!esModoPlanDia(modo)) throw errorT("main.planDiaInvalido");
  const now = opts?.now ?? new Date();
  const ruta = opts?.ruta ?? rutaPlan();
  const plan = planLeer(now, ruta);
  plan.hoy = modo === "normal" ? null : modo;
  planGrabar(plan, now, ruta);
  return leerPlanDia({ now, ruta });
}
