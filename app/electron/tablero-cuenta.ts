// Cuántos items esperan al usuario: el número del botón del Tablero en el pie de la barra. Cuenta sólo las
// PREGUNTAS de `espera-dueno` sin respuesta. Las pruebas (Anda / No anda) no cuentan: el pie no las anuncia.
// Pura y sin imports: la usan el main (electron/tablero.ts, sobre `vista.json` crudo) y la interfaz
// (src/datos/fuenteTablero.ts, sobre el tablero ya validado). Lo prueba tests/pie-esperan.test.ts.

/**
 * Pregunta o prueba, con la misma regla que el CLI (electron/cli/tablero.ts `tipoDe`) y que `validar`
 * (src/datos/tablero.ts): `tipo` si viene; si no, prueba sólo si trae qué probar.
 */
export function esPregunta(it: { tipo?: unknown; prueba?: unknown }): boolean {
  if (it.tipo === "pregunta") return true;
  if (it.tipo === "prueba") return false;
  return typeof it.prueba !== "string" || it.prueba.trim() === "";
}

/** Cuántas preguntas sin respuesta hay en una lista de `espera-dueno` (cualquier cosa que no sea lista, cuenta 0). */
export function preguntasEsperan(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.filter((i) => i && typeof i === "object" && !(i as { respuesta?: unknown }).respuesta && esPregunta(i as { tipo?: unknown; prueba?: unknown })).length;
}
