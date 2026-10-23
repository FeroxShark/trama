// Settle: dar por cerrado un worker terminado. Qué comando de `pa` le toca
// según quién lo lanzó. Sin imports: lo prueba `tests/settle.test.ts` (la
// misma regla, para el optimista del frontend, está en src/datos/contrato.ts).

export type Settle = "integrar" | "archivar";

/**
 * Lo que lanzó la app (o el usuario a mano) con rama sin integrar se integra
 * (`pa <proy> --integrar <id> --tests`). Lo que lanzó un líder (`origen`
 * "jefe") sólo se archiva: la rama es del líder, la integra él. Sin rama no
 * hay nada que integrar.
 */
export function comoSettle(h: { origen?: string | null; rama: string | null }): Settle {
  return h.rama && h.origen !== "jefe" ? "integrar" : "archivar";
}

/**
 * `pa <proy> --integrar <id>`, con `--tests` sólo si el proyecto tiene `tests` en el
 * registry: si no, `pa` sale 2 ("no tiene `tests` en el registry") y no integra.
 */
export function argvIntegrar(proyecto: string, id: string, tests: boolean): string[] {
  return tests ? [proyecto, "--integrar", id, "--tests"] : [proyecto, "--integrar", id];
}

/** Los argumentos de `pa` (el proyecto ya traducido al nombre del registry; `tests`: si tiene en el registry). */
export function argvSettle(h: { id: string; origen?: string | null; rama: string | null }, proyecto: string, tests = false): string[] {
  return comoSettle(h) === "integrar" ? argvIntegrar(proyecto, h.id, tests) : ["--archivar", h.id];
}
