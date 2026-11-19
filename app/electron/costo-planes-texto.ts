// Costo por suscripción (Ajustes > Modelos): qué parte del precio de API paga quien tiene un plan, con los datos públicos de Priors
// (`GET https://mypriors.com/api/plan-prices`). Lo puro, que comparte la ventana: validar la respuesta, emparejar los ids de Trama con
// los de Priors, el `ratio` de un modelo con un plan y el plan de Claude a partir de los dos campos que se leen del credentials.
// Sin imports de Node. Lo de red, caché y archivos está en costo-planes.ts. Lo cubre tests/costo-planes.test.ts.

export const URL_PRIORS = "https://mypriors.com";
export const RUTA_PRIORS = "/api/plan-prices";

/** Un plan de un modelo: la parte del precio de API que paga el suscriptor y qué tan firme es el dato (`preliminary`, `assumed`, `low`…). */
export type RatioPlan = { ratio: number; confianza: string | null };
export type ModeloPriors = { id: string; lab: string; aa: string[]; planes: Record<string, RatioPlan> };
export type LabPriors = { id: string; nombre: string; planes: string[] };
/** Lo que se guarda en la caché y viaja a la ventana: sólo lo que se usa (sin notas, créditos ni enlaces de la fuente). */
export type DatosPriors = { fecha: string; labs: LabPriors[]; modelos: ModeloPriors[] };

/** Lo que la ventana recibe: los datos (o `null`), el plan de Claude detectado y si hay `agy` (Google). */
export type VistaPlanes = { datos: DatosPriors | null; claude: string | null; agy: boolean };

/** Proveedor de Trama (`FilaTabla.proveedor`, clave de `planes` en modelos.json) → lab de Priors. */
export const LAB_DE_PROVEEDOR: Record<string, string> = { claude: "anthropic", google: "google", openai: "openai" };
export const PROVEEDORES_PLAN = Object.keys(LAB_DE_PROVEEDOR);
/** Con `agy` y sin elección, Google se toma con este plan. */
export const PLAN_GOOGLE_DEFECTO = "Google AI Pro";

const MAX_TEXTO = 120;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const texto = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, MAX_TEXTO) : "");
const ratioValido = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
/** Una confianza corta (`preliminary`, `assumed`, `medium`); las largas («estimated from…») se dicen como `estimated`. */
const confianzaDe = (v: unknown): string | null => {
  const s = texto(v);
  if (!s) return null;
  return /^[a-z]{1,20}$/.test(s) ? s : s.toLowerCase().startsWith("estimated") ? "estimated" : null;
};

/** La respuesta de Priors → lo que se usa; `null` si no tiene la forma esperada (sin labs o sin modelos con algún ratio). */
export function validarPriors(raw: unknown): DatosPriors | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.labs) || !Array.isArray(o.models)) return null;
  const labs: LabPriors[] = [];
  for (const l of o.labs.slice(0, 200)) {
    const x = obj(l);
    const id = texto(x?.id);
    if (!x || !id || !Array.isArray(x.plans)) continue;
    const planes = [...new Set(x.plans.map((p) => texto(obj(p)?.plan)).filter(Boolean))].slice(0, 100);
    labs.push({ id, nombre: texto(x.name) || id, planes });
  }
  const modelos: ModeloPriors[] = [];
  for (const m of o.models.slice(0, 2000)) {
    const x = obj(m);
    const id = texto(x?.id);
    const lab = texto(x?.lab);
    if (!x || !id || !lab) continue;
    const aa = Array.isArray(x.aa) ? x.aa.map(texto).filter(Boolean).slice(0, 50) : [];
    const planes: Record<string, RatioPlan> = {};
    const ps = obj(x.plans);
    if (ps)
      for (const [plan, v] of Object.entries(ps)) {
        const d = obj(v);
        const nombre = texto(plan);
        if (!d || !nombre || !ratioValido(d.ratio)) continue;
        planes[nombre] = { ratio: d.ratio, confianza: obj(d.preliminary) ? "preliminary" : confianzaDe(d.confidence) };
      }
    // El plan de referencia del modelo (`plan`, `ratio`, `confidence`): a veces trae una aclaración entre paréntesis («… (assumed same as Flash)»).
    const ref = texto(x.plan);
    if (ref && ratioValido(x.ratio)) {
      const base = ref.replace(/\s*\(.*\)\s*$/, "").trim();
      const supuesto = base !== ref && /assumed/i.test(ref);
      if (!planes[base]) planes[base] = { ratio: x.ratio, confianza: supuesto ? "assumed" : confianzaDe(x.confidence) };
    }
    if (Object.keys(planes).length) modelos.push({ id, lab, aa, planes });
  }
  if (!labs.length || !modelos.length) return null;
  return { fecha: texto(o.generatedAt) || texto(o.date), labs, modelos };
}

/** El id de Trama sin prefijo de motor (`agy:`, `codex:`) ni esfuerzo pegado (`-high`). */
export const idBase = (id: string): string => id.replace(/^[a-z]+:/, "").replace(/-(low|medium|high|xhigh|max)$/, "").toLowerCase();
/** `claude-opus-5-5` → `claude-opus-5.5` (los ids de Priors llevan punto en la versión). */
export const conPunto = (id: string): string => id.replace(/(\d)-(?=\d)/g, "$1.");

/** El modelo de Priors que corresponde a un id de Trama (por id, por la versión con punto o por los slugs de AA); `null` si ninguno. */
export function modeloPriors(datos: DatosPriors, idTrama: string): ModeloPriors | null {
  const b = idBase(idTrama);
  if (!b) return null;
  return datos.modelos.find((m) => m.id === b) ?? datos.modelos.find((m) => m.id === conPunto(b)) ?? datos.modelos.find((m) => m.aa.includes(b)) ?? null;
}

/** El id de Priors de un id de Trama (para los tests y el tooltip); `null` si no matchea. */
export const idPriors = (datos: DatosPriors, idTrama: string): string | null => modeloPriors(datos, idTrama)?.id ?? null;

/** Los planes que se ofrecen para un proveedor de Trama (los de su lab en Priors). */
export const planesDe = (datos: DatosPriors | null, proveedor: string): string[] => datos?.labs.find((l) => l.id === LAB_DE_PROVEEDOR[proveedor])?.planes ?? [];

/**
 * El plan de Claude con los dos campos de `claudeAiOauth` (nada más del archivo): `pro` → Claude Pro; `max` con tier `*_max_5x` → Claude Max 5x;
 * `max` con `*_max_20x` → Claude Ultra. Lo demás, `null` (se usa la estimación).
 */
export function planDeClaude(tipo: unknown, tier: unknown): string | null {
  const t = typeof tipo === "string" ? tipo.toLowerCase() : "";
  const r = typeof tier === "string" ? tier.toLowerCase() : "";
  if (t === "pro") return "Claude Pro";
  if (t === "max" && /_max_5x$/.test(r)) return "Claude Max 5x";
  if (t === "max" && /_max_20x$/.test(r)) return "Claude Ultra";
  return null;
}

/** El plan con el que se calcula un proveedor: el elegido en Ajustes; si no, el detectado de Claude o, con `agy`, Google AI Pro. */
export function planEfectivo(proveedor: string, elegidos: Record<string, string>, vista: Pick<VistaPlanes, "claude" | "agy"> | null): string | null {
  const e = elegidos[proveedor];
  if (e) return e;
  if (proveedor === "claude") return vista?.claude ?? null;
  if (proveedor === "google" && vista?.agy) return PLAN_GOOGLE_DEFECTO;
  return null;
}

/** Contexto para calcular costos con plan: los datos de Priors y el plan de cada proveedor. */
export type ContextoPlanes = { datos: DatosPriors | null; planes: Record<string, string> };

export function contextoPlanes(vista: VistaPlanes | null, elegidos: Record<string, string>): ContextoPlanes {
  const planes: Record<string, string> = {};
  for (const p of PROVEEDORES_PLAN) {
    const x = planEfectivo(p, elegidos, vista);
    if (x) planes[p] = x;
  }
  return { datos: vista?.datos ?? null, planes };
}

/** El ratio de una fila (id + proveedor) con el plan de su proveedor; `null` sin datos, sin plan o si el modelo no lo tiene (p. ej. un Claude por Google). */
export function ratioDeFila(ctx: ContextoPlanes | null | undefined, f: { id: string; proveedor: string }): (RatioPlan & { plan: string }) | null {
  if (!ctx?.datos) return null;
  const plan = ctx.planes[f.proveedor];
  if (!plan) return null;
  const m = modeloPriors(ctx.datos, f.id);
  if (!m || m.lab !== LAB_DE_PROVEEDOR[f.proveedor]) return null;
  const r = m.planes[plan];
  return r ? { ...r, plan } : null;
}

/** «Claude Max 5x» → «Max 5x», «Google AI Pro» → «AI Pro»: el nombre del plan sin la marca. */
export const planCorto = (plan: string): string => plan.replace(/^(Claude|Google|ChatGPT)\s+/, "") || plan;
