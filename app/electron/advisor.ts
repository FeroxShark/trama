// Advisor de Claude Code: un modelo más chico ejecuta y consulta a uno más fuerte (`claude --advisor <modelo>`). Un modelo más chico con un
// asesor más fuerte rinde parecido al asesor y gasta mucho menos. La elección vive en `advisor` de `~/.config/trama/modelos.json`:
//   "advisor": { "sonnet": "opus", "opus": "fable" }     (familia del modelo principal → familia del asesor)
// Sin la clave (o sin la familia) no hay asesor. Lo lee Trama al abrir un líder (lider.ts) y, más adelante, `pa` para sus workers.
// Puro (sin electron ni disco): lo prueba tests/advisor.test.ts.

/** De la más débil a la más fuerte: `claude` exige que el asesor sea al menos tan capaz como el modelo principal. */
export const FAMILIAS_ADVISOR = ["haiku", "sonnet", "opus", "fable"] as const;
export type FamiliaAdvisor = (typeof FAMILIAS_ADVISOR)[number];
/** `advisor` de modelos.json: familia del principal → familia del asesor. */
export type AdvisorConfig = Partial<Record<FamiliaAdvisor, FamiliaAdvisor>>;

export const esFamiliaAdvisor = (x: unknown): x is FamiliaAdvisor => typeof x === "string" && (FAMILIAS_ADVISOR as readonly string[]).includes(x);

/** La familia de un id o alias de Claude ("claude-opus-5-5[1m]" → "opus", "sonnet" → "sonnet"); `null` si no es de Claude. */
export function familiaAdvisor(modelo: string | undefined | null): FamiliaAdvisor | null {
  const m = /^(?:claude-)?(haiku|sonnet|opus|fable)(?![a-z])/.exec((modelo ?? "").trim().toLowerCase());
  return m ? (m[1] as FamiliaAdvisor) : null;
}

/** Los asesores que `claude` acepta para un principal: las familias más fuertes (la misma no aporta nada). De la más cercana a la más fuerte. */
export const asesoresPara = (base: FamiliaAdvisor): FamiliaAdvisor[] => FAMILIAS_ADVISOR.slice(FAMILIAS_ADVISOR.indexOf(base) + 1);

export const parValido = (base: unknown, asesor: unknown): boolean => esFamiliaAdvisor(base) && esFamiliaAdvisor(asesor) && asesoresPara(base).includes(asesor);

/** El asesor que corresponde a un modelo principal (alias para `--advisor`), o `null`: sin elección o con un par que `claude` rechazaría. */
export function asesorDe(modelo: string | undefined | null, conf: AdvisorConfig | undefined | null): FamiliaAdvisor | null {
  const base = familiaAdvisor(modelo);
  const a = base ? conf?.[base] : undefined;
  return base && a && parValido(base, a) ? a : null;
}

/** Por qué el advisor no anda en esta máquina: la variable (o el proveedor) que lo apaga. */
export type MotivoAdvisor = { tipo: "variable" | "proveedor"; nombre: string };

const VERDADERO = /^(1|true|yes|on)$/i;
const verdadera = (v: string | undefined) => v !== undefined && VERDADERO.test(v.trim());

/** Lo que apaga el servidor de advisor de Claude Code (probado con 2.1.325): estas tres variables. */
const APAGAN = ["DISABLE_TELEMETRY", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CLAUDE_CODE_DISABLE_ADVISOR_TOOL"] as const;
/** Sólo anda contra la API de Anthropic: otro proveedor (Bedrock, Vertex, Foundry) o una dirección que no es la suya lo deja afuera. */
const PROVEEDORES = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"] as const;

/**
 * ¿Anda el advisor con este entorno? `env` es el que verá el líder (el de la app ya pasado por `entornoLider`, más el bloque `env` de
 * `~/.claude/settings.json`). `null`: anda. Si no, la primera cosa que lo apaga, para decirla en una línea.
 */
export function motivoAdvisor(env: Record<string, string | undefined>): MotivoAdvisor | null {
  for (const n of APAGAN) if (verdadera(env[n])) return { tipo: "variable", nombre: n };
  for (const n of PROVEEDORES) if (verdadera(env[n])) return { tipo: "proveedor", nombre: n };
  const url = (env.ANTHROPIC_BASE_URL ?? "").trim();
  if (url) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      /* una dirección rota tampoco es la de Anthropic */
    }
    if (host !== "api.anthropic.com") return { tipo: "proveedor", nombre: "ANTHROPIC_BASE_URL" };
  }
  return null;
}

/** El bloque `env` de un `settings.json` (texto); vacío si no hay o no se entiende. Sólo valores de texto, números o booleanos. */
export function envDeSettings(texto: string | null | undefined): Record<string, string> {
  if (!texto) return {};
  try {
    const e = (JSON.parse(texto) as { env?: unknown }).env;
    if (!e || typeof e !== "object" || Array.isArray(e)) return {};
    return Object.fromEntries(Object.entries(e).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)).map(([k, v]) => [k, String(v)]));
  } catch {
    return {};
  }
}
