// Lógica pura del paso previo de las acciones de Ramas que lanzan algo (sin JSX, para que `node --test` la importe):
// con qué modelo y esfuerzo arranca cada acción y cómo se arma lo que sale.
import { effortPara } from "../hilo/elegir";

/** Lo que el usuario puede elegir en el paso: el modelo, el esfuerzo y un texto opcional. */
export type Eleccion = { modelo: string; effort: string; texto: string };

/** Los id de modelo con que se llama a `pa -m` (el de la lista de los líderes es el de la API; `pa` usa los suyos). */
export const HAIKU_PA = "claude-haiku-5-5";

/** Una tarea mecánica (rebasear, resolver un choque de merge): Haiku al máximo que rinde, como el default de `pa --tipo mecanico`. */
export const ACTUALIZAR = { modelo: HAIKU_PA, effort: "xhigh", tipo: "mecanico" } as const;

/**
 * El esfuerzo con que arranca un modelo de worker: el de `pa` para Haiku (xhigh), y para el resto el último
 * que el usuario eligió o el de la tabla de routing.
 */
export function esfuerzoWorker(modelo: string, prefs: Record<string, string>): string {
  return modelo === HAIKU_PA ? (prefs[modelo] ?? "xhigh") : effortPara(modelo, prefs);
}

/** El primer mensaje de un líder con lo que el usuario le sumó, en un párrafo aparte. */
export function conTexto(prompt: string, extra: string): string {
  const e = extra.trim();
  return e ? `${prompt}\n\n${e}` : prompt;
}
