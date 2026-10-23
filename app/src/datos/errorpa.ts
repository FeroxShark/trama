// Un error de `pa` que se acuerda de su código de salida: el 80 (choque con main) cambia lo que ofrece la fila de Ramas.

/** `pa` sale con esto cuando `--integrar` choca con main (propone `--actualizar`). */
export const RC_CONFLICTO = 80;

/** Un error de `pa` que se acuerda de su código de salida. */
export class ErrorPa extends Error {
  rc: number;
  constructor(mensaje: string, rc: number) {
    super(mensaje);
    this.rc = rc;
  }
}

export const rcDe = (e: unknown): number | null => (e instanceof Error && "rc" in e && typeof e.rc === "number" ? e.rc : null);
