// El respaldo de la cola (`cola.json`): si el archivo no se puede leer (o es de otra versión, que esta no entiende), antes de seguir con la
// cola vacía se copia a `cola.json.bak-<fecha>` (la cola nunca se pierde: lo que estaba queda en el respaldo, por si hace falta).
// Node puro (sin `electron`): lo prueba tests/cola-archivo.test.ts.
import { copyFile, stat } from "node:fs/promises";

/** Por qué se respalda: el archivo no se pudo leer, o es de otra versión. */
export type MotivoRespaldo = "ilegible" | "version";

/** La fecha del respaldo: legible y sin dos puntos (un nombre de archivo en Windows no los lleva). */
export const selloDeRespaldo = (ahora: Date = new Date()): string => ahora.toISOString().replace(/[:.]/g, "-");

/** El nombre del respaldo de `archivo`: `<archivo>.bak-<fecha>`. */
export const nombreDeRespaldo = (archivo: string, ahora: Date = new Date()): string => `${archivo}.bak-${selloDeRespaldo(ahora)}`;

/** El resultado de respaldar: dónde quedó la copia, o por qué no quedó. */
export type Respaldo = { ok: true; motivo: MotivoRespaldo; archivo: string } | { ok: false; motivo: MotivoRespaldo; porque: "noHabia" | "noSePudo" };

/**
 * Copia el archivo de la cola a su respaldo. Si no estaba (nunca hubo cola), no hay nada que respaldar. Si la copia falla, se dice: la cola
 * sigue (vacía), pero lo que había se puede perder.
 */
export async function respaldarCola(
  archivo: string,
  motivo: MotivoRespaldo,
  deps: { copiar?: (de: string, a: string) => Promise<void>; ahora?: Date } = {},
): Promise<Respaldo> {
  const hay = await stat(archivo).then(
    () => true,
    () => false,
  );
  if (!hay) return { ok: false, motivo, porque: "noHabia" };
  const destino = nombreDeRespaldo(archivo, deps.ahora);
  try {
    await (deps.copiar ?? copyFile)(archivo, destino);
  } catch {
    return { ok: false, motivo, porque: "noSePudo" };
  }
  return { ok: true, motivo, archivo: destino };
}
