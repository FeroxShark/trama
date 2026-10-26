// Los temas de color (Ajustes > General). Lo puro: qué ids hay y cuál se pinta de verdad; los colores
// están en src/temas-colores.css (un bloque `[data-tema]` por tema) y aplicarlos a <html> lo hace tipografia.ts.
// "sistema" no es un tema con colores propios: sigue el claro/oscuro del sistema operativo.

export const TEMAS = ["sistema", "oscuro", "claro", "bosque", "atardecer", "grafito", "contraste"] as const;
export type Tema = (typeof TEMAS)[number];
export const TEMA_DEF: Tema = "oscuro";

/** El que se pinta (el que va en `data-tema`): "sistema" pasa a claro u oscuro. */
export type TemaPintado = Exclude<Tema, "sistema">;

export const esTema = (x: unknown): x is Tema => typeof x === "string" && (TEMAS as readonly string[]).includes(x);

export const resolverTema = (t: Tema, sistemaClaro: boolean): TemaPintado => (t === "sistema" ? (sistemaClaro ? "claro" : "oscuro") : t);

/** Dónde se espeja lo elegido para el script de index.html (el primer pintado, antes de que cargue nada). */
export const CLAVE_TEMA = "trama.tema";
