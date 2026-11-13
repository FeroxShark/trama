// Qué familia de modelo corresponde a un id o nombre (para la marca de forma y color del chip de la barra).
export type Familia = "opus" | "sonnet" | "haiku" | "fable" | "otro";

const FAMILIAS: Exclude<Familia, "otro">[] = ["opus", "sonnet", "haiku", "fable"];

const PATRONES: readonly [Exclude<Familia, "otro">, RegExp][] = FAMILIAS.map((f) => [
  f,
  new RegExp(`(?:^|[^a-z])${f}(?:[^a-z]|$)`),
]);

/**
 * Devuelve la familia del modelo según su id o nombre entero, sin distinguir mayúsculas
 * («claude-opus-5-5», «Opus 5.5», «agy:claude-sonnet-5-5» → «opus»/«sonnet»; una inicial suelta como «O» → «otro»).
 */
export function familiaDe(modelo: string | null | undefined): Familia {
  const m = modelo?.trim().toLowerCase();
  if (!m) return "otro";
  return PATRONES.find(([, re]) => re.test(m))?.[0] ?? "otro";
}
