// Textos que la app le manda a un líder para las acciones de orquestación (sin JSX: lo prueba tests/orquestacion-ui.test.ts).
// Los prompts son para el agente: van en español, como los del analista de Ramas.

/** AGENTS.md: la plantilla de `pa <proy> --agents-md` y qué hacer con ella. */
export function promptAgentsMd(proyecto: string, ruta: string | null, plantilla: string): string {
  return [
    `Creá el AGENTS.md del proyecto ${proyecto}${ruta ? ` en ${ruta}/AGENTS.md` : ""}.`,
    "Llená esta plantilla con lo que VERIFICASTE: corré de verdad los comandos de build y de tests, leé el código y los scripts, y no inventes nada. Corto y concreto; sacá lo que no aplique.",
    "Guardalo en la raíz del proyecto. No toques otros archivos.",
    "",
    plantilla.trim(),
  ].join("\n");
}

/** Podar lecciones: la instrucción que da `pa <proy> --lecciones-podar` es el prompt entero. */
export const promptPodar = (instruccion: string): string => instruccion.trim();

/** ¿Cuántas líneas y caracteres tiene el texto de las lecciones? (lo mismo que cuenta `pa`) */
export function medidaLecciones(texto: string): { lineas: number; cars: number; pasa: boolean } {
  const lineas = texto === "" ? 0 : texto.split("\n").length - (texto.endsWith("\n") ? 1 : 0);
  const cars = [...texto].length;
  return { lineas, cars, pasa: lineas > 30 || cars > 3000 };
}
