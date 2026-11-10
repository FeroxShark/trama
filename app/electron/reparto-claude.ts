// Los modelos de Claude que esta cuenta tiene y que la tabla del reparto no conoce (Fable 5.2): entran en su grupo
// (Anthropic) con el cupo de la cuenta —el cupo es de la suscripción, no del modelo— y la inteligencia que midió
// Artificial Analysis (o la estimada, si AA no midió ese modelo), para que el dueño los vea y pueda apagarlos o
// prenderlos como los demás. NO cambia qué elige el reparto: Fable sigue sin entrar al reparto de los workers (eso lo
// decide `pa`, con el permiso del dueño). Puro (sin Node): lo usan el main (la tabla) y los fixtures (las capturas).
import type { ModeloClaudeCuenta } from "./claude-catalogo.ts";
import { viejaAAa } from "./calidad-migracion.ts";
import { EFFORTS_CALIDAD, type EffortCalidad } from "./efforts-calidad.ts";
import type { FilaTabla } from "./reparto-tabla.ts";

/** Lo mínimo de la caché de Artificial Analysis que hace falta: el slug del modelo y su índice de inteligencia. */
export type CacheAAMinima = { fetched: string; modelos: { slug: string; intelligence: number | null }[] };

/** Las familias de Claude que Trama conoce (las mismas que `excluir` acepta). */
const FAMILIAS_CLAUDE = ["fable", "opus", "sonnet", "haiku"];

/** La familia de un id de Claude ("claude-fable-5-2" → "fable"); "" si no es de una familia conocida (igual que la vista). */
export function familiaClaude(id: string): string {
  const p = /^claude-([a-z]+)/.exec(id.toLowerCase())?.[1] ?? "";
  return (FAMILIAS_CLAUDE as readonly string[]).includes(p) ? p : "";
}

/** La regla de `excluir` que saca a ese id (familia, id exacto, prefijo o patrón con `*`): la misma que la vista. */
export function reglaDeExcluir(excluir: readonly string[], id: string, familia: string): string | null {
  const m = id.toLowerCase();
  for (const p of excluir) {
    const q = p.trim().toLowerCase();
    if (!q) continue;
    if (q === familia || q === m || m.startsWith(`${q}-`) || (q.endsWith("*") && m.startsWith(q.slice(0, -1)))) return p;
  }
  return null;
}

/** La calidad de un effort que Artificial Analysis no midió: la del vecino más cercano (o el promedio de los dos vecinos). Igual que `calidadEnEffort` de la vista. */
function calidadEnEffort(mapa: Partial<Record<EffortCalidad, number>>, effort: EffortCalidad, base: number): number {
  const con = EFFORTS_CALIDAD.filter((e) => mapa[e] !== undefined);
  if (!con.length) return base;
  const v = mapa[effort];
  if (v !== undefined) return v;
  const i = EFFORTS_CALIDAD.indexOf(effort);
  const ant = con.filter((e) => EFFORTS_CALIDAD.indexOf(e) < i).pop();
  const sig = con.find((e) => EFFORTS_CALIDAD.indexOf(e) > i);
  if (ant && sig) {
    const [i0, i1] = [EFFORTS_CALIDAD.indexOf(ant), EFFORTS_CALIDAD.indexOf(sig)];
    return Math.round((mapa[ant]! + ((mapa[sig]! - mapa[ant]!) * (i - i0)) / (i1 - i0)) * 10) / 10;
  }
  return mapa[ant ?? sig!]!;
}

/** La inteligencia de fábrica de un modelo que nadie midió (la estimación de `reparto` por el nombre: 50 de la escala vieja). */
const CALIDAD_ESTIMADA = viejaAAa(50);

/** Lo que Artificial Analysis midió de ese modelo, por esfuerzo (el slug lleva el effort: "claude-fable-5-2-low"; sin sufijo, el máximo). */
export function calidadDeAA(aa: CacheAAMinima | null, id: string): { por: Partial<Record<EffortCalidad, number>>; fecha: string | null } {
  const por: Partial<Record<EffortCalidad, number>> = {};
  if (!aa) return { por, fecha: null };
  const base = id.toLowerCase();
  for (const m of aa.modelos) {
    const s = (m.slug || "").toLowerCase();
    let e: EffortCalidad | null = null;
    if (s === base) e = "max";
    else for (const x of EFFORTS_CALIDAD) if (s === `${base}-${x}`) { e = x; break; }
    if (!e) continue;
    const v = m.intelligence;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const n = Math.max(0, Math.round(v * 10) / 10);
    if (por[e] === undefined || n > por[e]!) por[e] = n;
  }
  const fecha = /^\d{4}-\d{2}-\d{2}/.test(aa.fetched) ? aa.fetched.slice(0, 10) : null;
  return { por, fecha };
}

/**
 * Las filas de los modelos de Claude que la cuenta tiene y la tabla del reparto no conoce: una por modelo, en su grupo
 * (Anthropic), con el cupo de la cuenta y la inteligencia de Artificial Analysis (o la estimada). `excluir` es la lista
 * del archivo guardado: la fila sale apagada (`permitido: false`) si una regla la saca.
 */
export function sumarClaudeCuenta(filas: FilaTabla[], catalogo: ModeloClaudeCuenta[] | null, aa: CacheAAMinima | null, excluir: readonly string[] = []): FilaTabla[] {
  if (!catalogo?.length) return filas;
  const ya = new Set(filas.map((f) => f.id.toLowerCase()));
  // El cupo es de la suscripción: lo da la fila de Claude con más cupo libre (la misma que se queda con `filasUnicas`).
  const claude = filas.filter((f) => f.proveedor === "claude").sort((a, z) => (z.libre ?? -1) - (a.libre ?? -1))[0];
  const nuevos: FilaTabla[] = [];
  for (const m of catalogo) {
    const id = m.id.toLowerCase();
    if (!m.principal || ya.has(id)) continue;
    const familia = (m.familia || familiaClaude(id)).toLowerCase();
    if (!familia) continue;   // un modelo de Claude de una familia que Trama no conoce: no se ofrece
    const nombre = /^claude/i.test(m.nombre) ? m.nombre : `Claude ${m.nombre}`;
    const { por, fecha } = calidadDeAA(aa, m.id);
    const esfuerzos = m.efforts.length ? EFFORTS_CALIDAD.filter((e) => m.efforts.includes(e)) : [...EFFORTS_CALIDAD];
    const medidas: Partial<Record<EffortCalidad, number>> = {};
    for (const e of esfuerzos) if (por[e] !== undefined) medidas[e] = por[e];
    const hayMedida = Object.keys(medidas).length > 0;
    const estimados = esfuerzos.filter((e) => medidas[e] === undefined);
    const estimadas: Partial<Record<EffortCalidad, number>> = {};
    for (const e of estimados) estimadas[e] = calidadEnEffort(medidas, e, CALIDAD_ESTIMADA);
    const calidad = hayMedida ? calidadEnEffort({ ...medidas, ...estimadas }, "high", CALIDAD_ESTIMADA) : CALIDAD_ESTIMADA;
    const regla = reglaDeExcluir(excluir, id, familia);
    nuevos.push({
      id: m.id,
      nombre,
      proveedor: "claude",
      familia,
      familiaExcluir: familia,
      cuenta: claude?.cuenta ?? null,
      calidad,
      effortUsado: hayMedida ? "high" : null,
      calidadPorEffort: medidas,
      effortsEstimados: hayMedida ? estimados : [],
      calidadEstimadaPorEffort: hayMedida ? estimadas : {},
      estimada: !hayMedida,
      origen: hayMedida ? "artificial-analysis" : "estimada",
      aaFecha: hayMedida ? fecha : null,
      gratis: false,
      libre: claude?.libre ?? null,
      vuelve: claude?.vuelve ?? null,
      ventanas: claude?.ventanas ?? [],
      urgencia: claude?.urgencia ?? 0,
      permitido: regla === null,
      excluidoPor: regla,
      agotado: claude?.agotado ?? false,
    });
  }
  return nuevos.length ? [...filas, ...nuevos] : filas;
}
