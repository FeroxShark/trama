// El plan (Pro / Max) de cada cuenta de Claude. La de siempre lo guarda `pa --plan` (Ajustes > Plan y cupos, campo «Plan de la cuenta de siempre»
// y su renglón en la tarjeta); cada cuenta agregada, el suyo (`cuentas plan ID pro|max`). Los workers usan el de la cuenta en uso.
import type { PerfilCuenta, PlanCuentaClaude } from "../datos/cuentas";

/** El evento (en `window`) con que el campo del plan y el renglón de la cuenta de siempre se avisan que cambió el plan de ésta. `detail`: el plan nuevo. */
export const EVENTO_PLAN_CLAUDE = "trama:plan-claude";

export const esPlanClaude = (x: unknown): x is PlanCuentaClaude => x === "pro" || x === "max";

/**
 * El plan de una cuenta de Claude y de dónde sale: el suyo si lo eligió (`propio`), si no el de la de siempre (`pa --plan`). `null`: no se sabe
 * ni el de la de siempre (sin `pa`). La de siempre es siempre «propio».
 */
export function planDeCuenta(p: PerfilCuenta, planDeSiempre: string | null): { plan: PlanCuentaClaude | null; propio: boolean } {
  if (p.defecto) return { plan: esPlanClaude(planDeSiempre) ? planDeSiempre : null, propio: true };
  if (p.planClaude) return { plan: p.planClaude, propio: true };
  return { plan: esPlanClaude(planDeSiempre) ? planDeSiempre : null, propio: false };
}
