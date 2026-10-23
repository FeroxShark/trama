// Por dónde el guion de medición maneja la barra: las mismas funciones que
// disparan el mouse y el teclado, sin eventos sintéticos.

export type Control = {
  /** Proyectos, en el orden de la lista. */
  grupos(): string[];
  /** Ids que hoy se pueden cerrar, en el orden de la lista. */
  cerrables(): string[];
  cerrar(id: string): void;
  alternar(grupo: string): void;
};

export const control: { actual: Control | null } = { actual: null };
