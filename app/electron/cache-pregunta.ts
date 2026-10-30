// ¿Preguntar antes de mandar? Con la caché de prompt vencida, seguir la misma sesión obliga al motor a releer TODO el contexto
// (agy: 98-135 mil tokens, ~10 % de la cuota de 5 h); empezar una sesión nueva con el relevo compacto (relevo-motor.ts) pesa ~26 mil.
// Si el contexto es grande, la persona elige. Puro (sin archivos ni React): lo prueba `tests/cache-pregunta.test.ts`.
import { motorDeCache } from "./cache.ts";

/** Lo que se hace con el primer mensaje tras vencer la caché. */
export type EleccionCache = "seguir" | "resumen";
/** Lo que la persona dejó guardado (Ajustes): `preguntar` es no haber recordado nada. */
export type PrefCache = "preguntar" | EleccionCache;

export const esPrefCache = (x: unknown): x is PrefCache => x === "preguntar" || x === "seguir" || x === "resumen";

/** Debajo de este contexto (tokens) releer no vale una pregunta. */
export const UMBRAL_TOKENS = 40_000;
/** Cuánto vive la caché de cada motor si no se sabe (s): Claude escribe con 5 min salvo que el pedido diga 1 h; agy no dice nada, se asume lo mismo. */
export const TTL_DEFECTO_S = { claude: 300, gemini: 300 } as const;
/** Lo que pesa empezar con el relevo: el prompt de sistema y las herramientas (~16 mil) más el relevo mismo (TOPE_RELEVO de 40 mil caracteres ≈ 10 mil). */
export const TOKENS_RESUMEN = 26_000;
/** Cuántos tokens releídos gastan un punto de la cuota de 5 h: lo medido con agy (≈ 115 mil tokens, ~10 %). Una aproximación, no una medida. */
export const TOKENS_POR_PUNTO = 11_500;

export type EntradaCache = {
  /** El modelo del líder (el motor de la caché que vale es el suyo). */
  modelo: string;
  /** Modelo local (llama-server): no hay caché de prompt que venza. */
  local: boolean;
  /** Se está cambiando de motor: ese cambio ya va con relevo, no hay qué preguntar. */
  cruza: boolean;
  /** Epoch s en que vence la caché, si se sabe (Claude). */
  vence: number | null;
  ttl: number | null;
  /** Epoch s de su última actividad (0: ninguna). */
  actividad: number;
  /** Lo que pesa el contexto hoy (entrada + caché leído + escrito del último turno). */
  tokens: number;
  pref: PrefCache;
  ahoraMs: number;
};

export type VeredictoCache = {
  /** `enviar`: sigue como siempre. `preguntar`: se muestra la elección. `resumen`: la persona ya recordó empezar con resumen. */
  accion: "enviar" | "preguntar" | "resumen";
  tokensSeguir: number;
  tokensResumen: number;
  /** % aproximado de la cuota de 5 h que gasta cada camino, redondeado y nunca 0 si se gasta algo. */
  pctSeguir: number;
  pctResumen: number;
};

/** ¿Venció su caché? Sin ningún dato (nunca habló) no se sabe: no vencida. */
export function cacheVencida(e: Pick<EntradaCache, "modelo" | "vence" | "ttl" | "actividad" | "ahoraMs">): boolean {
  const motor = motorDeCache(e.modelo);
  if (motor !== "claude" && motor !== "gemini") return false;
  const venceS = e.vence ?? (e.actividad > 0 ? e.actividad + (e.ttl ?? TTL_DEFECTO_S[motor]) : null);
  return venceS !== null && e.ahoraMs / 1000 >= venceS;
}

const puntos = (tokens: number) => (tokens > 0 ? Math.max(1, Math.round(tokens / TOKENS_POR_PUNTO)) : 0);

export function decidirCache(e: EntradaCache): VeredictoCache {
  const tokensSeguir = e.tokens;
  const tokensResumen = Math.min(e.tokens, TOKENS_RESUMEN);
  const base = { tokensSeguir, tokensResumen, pctSeguir: puntos(tokensSeguir), pctResumen: puntos(tokensResumen) };
  const motor = motorDeCache(e.modelo);
  const aplica = !e.local && !e.cruza && (motor === "claude" || motor === "gemini");
  if (!aplica || e.tokens < UMBRAL_TOKENS || !cacheVencida(e)) return { ...base, accion: "enviar" };
  return { ...base, accion: e.pref === "seguir" ? "enviar" : e.pref === "resumen" ? "resumen" : "preguntar" };
}
