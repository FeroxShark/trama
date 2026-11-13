// La cuenta del anillo de contexto (B16, src/hilo/Contexto.tsx): cuánto pesa la
// conversación (los tokens de entrada del último turno) contra su umbral: el de
// autocompact (líder y worker). Puro: lo prueba
// `tests/contexto.test.ts`.
import type { Tokens } from "../datos/contrato";
import type { Umbrales } from "../datos/fuente";
import { topeAutocompact } from "../../electron/autocompact-tope.ts";

/** Lo que pesa la conversación: la entrada del último turno, cacheada o no. */
export const usados = (u: Tokens | null | undefined): number =>
  u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0;

/**
 * La ventana del modelo cuando el stream no la dijo (`modelUsage.contextWindow`):
 * 200 mil en Haiku, 1 millón en los demás (Opus, Sonnet, Fable).
 */
export const ventanaDe = (modelo: string | null | undefined): number => (/haiku/i.test(modelo ?? "") ? 200_000 : 1_000_000);

/**
 * La ventana que dijo el stream para este modelo. Las claves de `modelUsage`
 * son ids que pueden traer fecha o sufijo ("claude-opus-5-5[1m]"); los
 * subagentes (otro modelo) no cuentan.
 */
export function ventanaDicha(ventanas: Record<string, number> | null | undefined, modelo: string | null | undefined): number | null {
  if (!ventanas || !modelo) return null;
  const limpio = (s: string) => s.replace(/\[.*$/, "");
  const m = limpio(modelo);
  for (const [k, v] of Object.entries(ventanas)) {
    const c = limpio(k);
    if (v > 0 && (c === m || c.startsWith(m) || m.startsWith(c))) return v;
  }
  return null;
}

/**
 * El umbral efectivo: el dado (`autoCompactWindow` de
 * `~/.claude/settings.json`) si está, nunca más que la ventana; si no, la
 * ventana del modelo.
 */
export const umbralDe = (autoCompact: number | null | undefined, ventana: number): number =>
  autoCompact && autoCompact > 0 ? Math.min(autoCompact, ventana) : ventana;

/**
 * El umbral del anillo de un líder de Claude: su tope de «Contexto antes de compactar» (por familia, modelos.json; `PA_AUTOCOMPACT` pisa)
 * si lo hay, nunca más que la ventana; sin tope (nativo) vale lo de `umbralDe` (`autoCompactWindow` o la ventana). Un modelo que no es de Claude no lo lleva.
 */
export function umbralDeLider(modelo: string | null | undefined, tope: Umbrales["tope"], autoCompact: number | null | undefined, ventana: number): number {
  const t = modelo && tope && /^claude-/i.test(modelo) ? topeAutocompact(modelo, tope.conf, tope.env) : null;
  return t ? Math.min(t, ventana) : umbralDe(autoCompact, ventana);
}

export type Nivel = "normal" | "ambar" | "rojo";

/** Ámbar desde 70 %, rojo desde 90 %. */
export const nivel = (pct: number): Nivel => (pct >= 90 ? "rojo" : pct >= 70 ? "ambar" : "normal");

export type Cuenta = {
  usados: number;
  umbral: number;
  /** 0–100, entero. */
  pct: number;
  /** Lo que falta para el umbral (que compacte solo). */
  falta: number;
  nivel: Nivel;
};

export function cuenta(u: Tokens | null | undefined, umbral: number): Cuenta {
  const n = usados(u);
  const pct = umbral > 0 ? Math.max(0, Math.min(100, Math.round((n / umbral) * 100))) : 0;
  return { usados: n, umbral, pct, falta: Math.max(0, umbral - n), nivel: nivel(pct) };
}
