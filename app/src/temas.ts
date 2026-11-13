// Los temas de color (Ajustes > General). Lo puro: qué ids hay y cuál se pinta de verdad; los colores
// están en src/temas-colores.css (un bloque `[data-tema]` por tema) y aplicarlos a <html> lo hace tipografia.ts.
// "sistema" no es un tema con colores propios: sigue el claro/oscuro del sistema operativo.

export const TEMAS = ["sistema", "grafito", "tinta", "carbon", "shell", "catppuccin", "tokyo", "gruvbox", "nord", "rosepine", "dracula", "claro", "contraste"] as const;
export type Tema = (typeof TEMAS)[number];
export const TEMA_DEF: Tema = "grafito";

/** Los ids que hubo antes (piel de vidrio): una preferencia guardada con uno de ellos pasa a grafito. */
export const TEMAS_VIEJOS: readonly string[] = ["oscuro", "bosque", "atardecer"];

/** El que se pinta (el que va en `data-tema`): "sistema" pasa a claro o grafito. */
export type TemaPintado = Exclude<Tema, "sistema">;

export const esTema = (x: unknown): x is Tema => typeof x === "string" && (TEMAS as readonly string[]).includes(x);

export const resolverTema = (t: Tema, sistemaClaro: boolean): TemaPintado => (t === "sistema" ? (sistemaClaro ? "claro" : "grafito") : t);

/** Dónde se espeja lo elegido para el script de index.html (el primer pintado, antes de que cargue nada). */
export const CLAVE_TEMA = "trama.tema";
