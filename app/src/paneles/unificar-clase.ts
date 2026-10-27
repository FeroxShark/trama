// "Unificar todos" de Ajustes > Proyectos: qué planes se pueden aplicar directo y cuáles no. Puro, para probarlo sin React.
//   mecanico  nada se mezcla: un solo archivo con contenido pasa a AGENTS.md, CLAUDE.md y GEMINI.md son iguales, sólo falta el
//             stub/import o lo de CLAUDE.md / GEMINI.md ya está dentro de AGENTS.md. Se aplica con aplicarUnificar (backup + huella).
//   fusion    hay más de un archivo con información distinta (crea "ambos" o anexa): pegarlos uno abajo del otro deja reglas repetidas o
//             contradictorias, así que no se hace en masa; se revisa en el panel de Unificar de esa tarjeta.
//   nada      ya está unificado o no hay de dónde sacar instrucciones.
import type { PlanMd } from "../datos/proyectos";

export type ClasePlan = "mecanico" | "fusion" | "nada";

export function clasePlan(plan: Pick<PlanMd, "acciones" | "nada">): ClasePlan {
  if (plan.nada || plan.acciones.length === 0) return "nada";
  const mezcla = plan.acciones.some((a) => a.que === "anexa" || (a.que === "crea" && a.de === "ambos"));
  return mezcla ? "fusion" : "mecanico";
}
