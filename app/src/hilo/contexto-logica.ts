// La cuenta del anillo de contexto (B16, src/hilo/Contexto.tsx): cuánto pesa la
// conversación (los tokens de entrada del último turno) contra su umbral: el de
// autocompact (líder y worker). Puro: lo prueba
// `tests/contexto.test.ts`.
import type { Mensaje, RespuestaHilo, Tokens } from "../datos/contrato";
import type { Umbrales } from "../datos/fuente";
import { topeAutocompact } from "../../electron/autocompact-tope.ts";
import { cacheVencida, decidirCache, type EntradaCache } from "../../electron/cache-pregunta.ts";
import { sistemaDe } from "./sistema-logica.ts";

/** Lo que pesa la conversación: la entrada del último turno, cacheada o no. */
export const usados = (u: Tokens | null | undefined): number =>
  u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : 0;

/**
 * Indica si hubo una compactación después del último mensaje del asistente: en ese caso `pag.usage`
 * todavía arrastra el uso previo y no sirve para mostrar cuántos tokens releería un cambio de modelo.
 */
export function compactadoDespuesDeUltimoTurno(mensajes: readonly Mensaje[]): boolean {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m.compacto || sistemaDe(m)?.clase === "compacto") return true;
    if (m.rol === "assistant") return false;
  }
  return false;
}

/**
 * Tokens que estima releer al cambiar de modelo: si compactó después del último mensaje del asistente
 * (en los mensajes, `compactada` del transcript o un aviso vivo posterior), usa sólo el conteo post-compactación
 * vivo (`vivoUsage`) si existe, u omite el número (`0`) si todavía no hubo otro turno.
 */
export function tokensParaAviso({
  pagUsage,
  vivoUsage,
  compactada = false,
  mensajes = [],
}: {
  pagUsage: Tokens | null | undefined;
  vivoUsage: Tokens | null | undefined;
  compactada?: boolean;
  mensajes?: readonly Mensaje[];
}): number {
  if (compactada || compactadoDespuesDeUltimoTurno(mensajes)) return usados(vivoUsage);
  return usados(vivoUsage ?? pagUsage);
}

type TranscriptCache = Pick<RespuestaHilo, "total" | "usage" | "compactada" | "mensajes">;

/** Si la decisión depende del peso y todavía no llegó, espera el transcript antes de decidir. */
export function decidirCacheConTranscript(
  entrada: Omit<EntradaCache, "tokens">,
  pag: TranscriptCache | null,
  vivoUsage: Tokens | null,
  compactadaEnVivo: boolean,
  leer: () => Promise<TranscriptCache>,
) {
  const entradaViva = vivoUsage && (vivoUsage.input_tokens !== undefined ||
    vivoUsage.cache_read_input_tokens !== undefined || vivoUsage.cache_creation_input_tokens !== undefined) ? vivoUsage : null;
  const decidir = (p: TranscriptCache | null) => ({
    total: p?.total ?? 0,
    veredicto: decidirCache({
      ...entrada,
      tokens: tokensParaAviso({
        pagUsage: p?.usage,
        vivoUsage: entradaViva,
        compactada: compactadaEnVivo || p?.compactada,
        mensajes: p?.mensajes,
      }),
    }),
  });
  if (pag || entradaViva || entrada.local || entrada.cruza || entrada.pref === "seguir" || !cacheVencida(entrada)) return decidir(pag);
  return leer().then(decidir);
}

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

/**
 * Una sola lectura del contexto para el anillo y el panel (CTX-43): cuánto pesa lo usado contra el tope efectivo, nunca más que la ventana
 * física. `tope` es el de la corrida (worker), el de «Contexto antes de compactar» (líder) o el `autoCompactWindow` del settings, en ese orden;
 * sin ninguno vale la ventana. Un solo par de umbrales para el nivel (`nivel`: ámbar desde 70 %, rojo desde 90 %).
 */
export function lectura(usado: number, ventana: number, tope: number | null | undefined): Pick<Cuenta, "umbral" | "pct" | "nivel"> {
  const umbral = umbralDe(tope, ventana);
  const pct = umbral > 0 ? Math.max(0, Math.min(100, Math.round((usado / umbral) * 100))) : 0;
  return { umbral, pct, nivel: nivel(pct) };
}

export function cuenta(u: Tokens | null | undefined, umbral: number): Cuenta {
  const n = usados(u);
  return { usados: n, ...lectura(n, umbral, null), falta: Math.max(0, umbral - n) };
}
