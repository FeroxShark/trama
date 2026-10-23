// AskUserQuestion de un líder de la app: las preguntas que llegan en el
// `can_use_tool` y la respuesta que vuelve. Como la terminal de Claude Code: se
// contesta `allow` con `updatedInput = { ...input, answers }`, donde `answers`
// es pregunta → lo elegido (varias en multiSelect: las etiquetas unidas con
// ", "; "Otro": el texto libre). El CLI arma el tool_result ("The user
// answered: …"). Puro: lo prueba `tests/preguntas.test.ts`.

export type Opcion = { label: string; description: string };
export type Pregunta = { question: string; header: string; options: Opcion[]; multiSelect: boolean };

export const HERRAMIENTA_PREGUNTAS = "AskUserQuestion";

const texto = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x : null);

/**
 * Las preguntas del input de AskUserQuestion (1 a 4, cada una con al menos una
 * opción con `label`, sin repetir). Algo raro → `null`: la app muestra el pedido común (Permitir / Negar).
 */
export function preguntasDe(input: unknown): Pregunta[] | null {
  const qs = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs) || !qs.length || qs.length > 4) return null;
  const out: Pregunta[] = [];
  for (const q of qs) {
    const question = texto(q?.question);
    if (!question || !Array.isArray(q.options) || !q.options.length) return null;
    const options: Opcion[] = [];
    for (const o of q.options) {
      const label = texto(o?.label);
      if (!label || options.some((x) => x.label === label)) return null;
      options.push({ label, description: typeof o.description === "string" ? o.description : "" });
    }
    if (out.some((x) => x.question === question)) return null;
    out.push({ question, header: texto(q.header) ?? "", options, multiSelect: q.multiSelect === true });
  }
  return out;
}

/**
 * Lo que manda la vista, limpio: sólo las preguntas que se hicieron, cada una
 * con texto. Falta alguna → `null` (no se contesta a medias).
 */
export function respuestasValidas(preguntas: readonly Pregunta[], r: unknown): Record<string, string> | null {
  if (!r || typeof r !== "object") return null;
  const out: Record<string, string> = {};
  for (const q of preguntas) {
    const v = (r as Record<string, unknown>)[q.question];
    if (typeof v !== "string" || !v.trim()) return null;
    out[q.question] = v.trim();
  }
  return out;
}

/** El `updatedInput` del `allow`: el input tal cual más `answers`. */
export const inputRespondido = (input: unknown, answers: Record<string, string>) => ({
  ...(input && typeof input === "object" ? input : {}),
  answers,
});
