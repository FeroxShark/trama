// El nombre del dueño de la máquina en el renderer (el main lo resuelve: electron/dueno.ts; se pide en ./dueno-pedir.ts).
// Puro, sin puente: lo importan los prompts que prueba `node --test`. Sin respuesta queda "el usuario". Nunca un literal en un prompt o un texto.
let nombre: string | null = null;

/** Lo que mandó el main, validado. */
export function nombreValido(x: unknown): string | null {
  return typeof x === "string" && x.trim() ? x.trim().slice(0, 40) : null;
}

export function ponerDueno(n: string | null): void {
  nombre = n;
}

/** "<nombre>" / "el usuario": para dentro de una frase. */
export const dueno = (): string => nombre ?? "el usuario";
/** Igual, para empezar una frase: "<nombre>" / "El usuario". */
export const Dueno = (): string => {
  const d = dueno();
  return d.charAt(0).toUpperCase() + d.slice(1);
};
/** "a <nombre>" / "al usuario". */
export const aDueno = (): string => (nombre ? `a ${nombre}` : "al usuario");
/** "de <nombre>" / "del usuario". */
export const deDueno = (): string => (nombre ? `de ${nombre}` : "del usuario");
