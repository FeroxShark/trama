// «Advisor» de Ajustes > Modelos: por cada modelo de Anthropic, un asesor más fuerte (`claude --advisor`). Se guarda en `advisor` de
// modelos.json (familia → familia, ver electron/advisor.ts) y trabaja sobre el borrador de AjustesModelos: nada se escribe hasta Guardar.
// Puro (sin React): lo prueba tests/advisor.test.ts.
import { asesoresPara, FAMILIAS_ADVISOR, type AdvisorConfig, type FamiliaAdvisor } from "../../electron/advisor";
import { TABLA } from "../hilo/modelos";
import type { Borrador } from "./modelos-borrador";

export { asesoresPara };
export type { FamiliaAdvisor };

/** Los modelos que muestra el panel: todos menos el más fuerte (Fable no tiene a quién consultar). */
export const FAMILIAS_CON_ASESOR = FAMILIAS_ADVISOR.slice(0, -1) as readonly FamiliaAdvisor[];

/** Los ids de Claude de última generación de una familia (los que ofrece Ajustes; las generaciones anteriores no cuentan). */
const idsDe = (fam: FamiliaAdvisor) => TABLA.filter((m) => m.empresa === "anthropic" && !m.anterior && m.id.startsWith(`claude-${fam}`)).map((m) => m.id);

/** La misma cuenta que `reparto` para `excluir`: la familia, el id exacto, el id sin sufijo o un prefijo con `*`. */
const sacaA = (p: string, fam: FamiliaAdvisor, id: string) => p === fam || p === id || id.startsWith(`${p}-`) || (p.endsWith("*") && id.startsWith(p.slice(0, -1)));

/** ¿Está habilitada esa familia en Ajustes? Sí si alguno de sus modelos no está sacado de `excluir`; un modelo apagado no se ofrece como asesor. */
export const familiaHabilitada = (b: Borrador, fam: FamiliaAdvisor): boolean => idsDe(fam).some((id) => !b.excluir.some((p) => sacaA(p, fam, id)));

/** Los asesores que se pueden elegir para esa familia: los más fuertes, y sólo los habilitados. */
export const asesoresOfrecidos = (b: Borrador, base: FamiliaAdvisor): FamiliaAdvisor[] => asesoresPara(base).filter((a) => familiaHabilitada(b, a));

/** El asesor guardado para esa familia, o `null`. Uno que ya no es válido o quedó apagado no se muestra como elegido (se ve «sin asesor»). */
export const asesorElegido = (b: Borrador, base: FamiliaAdvisor): FamiliaAdvisor | null => {
  const a = b.advisor[base];
  return a && asesoresOfrecidos(b, base).includes(a) ? a : null;
};

/** Prender el interruptor: el asesor más cercano que se ofrece (el más barato que sirve). `null`: nada para ofrecer. */
export const asesorInicial = (b: Borrador, base: FamiliaAdvisor): FamiliaAdvisor | null => asesoresOfrecidos(b, base)[0] ?? null;

/** Pone (o saca, con `null`) el asesor de una familia; sin entradas la clave `advisor` no se escribe. */
export function ponerAsesor(b: Borrador, base: FamiliaAdvisor, asesor: FamiliaAdvisor | null): Borrador {
  const ad: AdvisorConfig = { ...b.advisor };
  if (asesor) ad[base] = asesor;
  else delete ad[base];
  return { ...b, advisor: ad };
}
