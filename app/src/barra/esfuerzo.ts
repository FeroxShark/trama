// El esfuerzo de un worker para el chip de la fila: de dónde sale, en qué escala cae y cuántas barritas llena.
// Sin JSX: lo prueban los tests (tests/esfuerzo.test.ts).
import { effortsDe, partirGeminiId } from "../hilo/modelos.ts";

export type EsfuerzoFila = {
  /** El nivel, en minúscula ("high"). */
  nivel: string;
  /** La escala del motor de ese modelo, de menor a mayor: el último nivel es el lleno. */
  niveles: readonly string[];
  /** Cuántos niveles llena (1 = el primero; `off` no llena ninguno). */
  lleno: number;
};

/** Un valor del campo `effort` listo para comparar; "-", vacío o nada = no se sabe. */
const limpio = (e: string | null | undefined): string | null => {
  const v = e?.trim().toLowerCase();
  return v && v !== "-" ? v : null;
};

/**
 * El nivel de un worker: el que trae el id del modelo (Gemini/agy: `gemini-3.8-flash-high`; OpenCode con la variante pegada al final) o,
 * si no, el campo `effort` (Claude). El id manda: es lo que de verdad se lanzó. `null` si no se sabe.
 */
export function nivelDe(modelo: string | null | undefined, effort: string | null | undefined): string | null {
  const id = modelo?.trim().toLowerCase().replace(/\[.*\]$/, "") ?? "";
  const g = partirGeminiId(id)[1];
  if (g) return g;
  const op = /^opencode:.+-(minimal|low|medium|high|xhigh|max)$/.exec(id)?.[1];
  return op ?? limpio(effort);
}

/**
 * El esfuerzo a dibujar, o `null` si no se conoce o no es un nivel de la escala de ese modelo (no se inventa nada).
 * Cada motor usa su lista (Claude: low…max; Gemini: low, medium, high; OpenCode: la de su variante); el último nivel de la lista es el lleno.
 */
export function esfuerzoDe(modelo: string | null | undefined, effort: string | null | undefined): EsfuerzoFila | null {
  const nivel = nivelDe(modelo, effort);
  if (!nivel) return null;
  // `off` (los locales) apaga el razonamiento: no es una barrita, es ninguna llena.
  const niveles = effortsDe(modelo).filter((n) => n !== "off");
  const i = niveles.indexOf(nivel);
  if (niveles.length < 2 || (i < 0 && nivel !== "off")) return null;
  return { nivel, niveles, lleno: i + 1 };
}
