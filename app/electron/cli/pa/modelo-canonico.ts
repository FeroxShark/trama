// Un solo nombre por modelo al LEER las mediciones (medicion.tsv no se reescribe).
// Lo usan `pa --rinde` (cli/pa/rinde.ts), `rindeDeModelos` (cli/reparto.ts) y las muestras de costo (cli/reparto-costo.ts):
// sin esto `sonnet` y `claude-sonnet-5-5` eran dos filas, `agy:claude-sonnet-5-5-high` llevaba el effort en el nombre y
// `settings`, `-` y "" eran tres efforts distintos, así que el reparto tardaba más en juntar las corridas que pide por fila.
// El bash (`motor/bin/pa`) y el python (`motor/bin/reparto`) están congelados y siguen agrupando crudo: divergencia a propósito.

/** Los alias cortos de Claude → el id completo de la familia vigente (los de `FAMILIAS` en cli/reparto.ts). */
export const ALIAS_CLAUDE: Record<string, string> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
  fable: "claude-fable-5-2",
};

const SUFIJO_EFFORT = /^(.+)-(low|medium|high|xhigh|max)$/;

/** ¿El arnés lleva el effort pegado al nombre? agy (`agy:…` y los `gemini-…` sueltos), codex y dsh. */
const effortEnElNombre = (m: string) => m.startsWith("agy:") || m.startsWith("gemini-") || m.startsWith("codex:") || m.startsWith("dsh:");

/** El effort sin anotar: "", "-" y `settings` (el de los ajustes de claude) son lo mismo. */
export function effortCanonico(e: string | null | undefined): string {
  const t = (e ?? "").trim().toLowerCase();
  return t === "-" || t === "settings" ? "" : t;
}

/**
 * El nombre único de una corrida: el alias corto pasa al id completo, el effort pegado al nombre (agy/codex/dsh) pasa a la
 * columna effort (el prefijo del motor se conserva: otro arnés es otro rendimiento) y el effort sin anotar queda "".
 */
export function canonico(modelo: string | null | undefined, effort?: string | null): { modelo: string; effort: string } {
  let m = (modelo ?? "").trim().toLowerCase();
  let e = effortCanonico(effort);
  m = ALIAS_CLAUDE[m] ?? m;
  if (effortEnElNombre(m)) {
    const x = SUFIJO_EFFORT.exec(m);
    if (x) {
      m = x[1]!;
      // el del nombre es el que de verdad se lanzó (agy y codex no leen la columna)
      e = x[2]!;
    }
  }
  return { modelo: m, effort: e };
}

/** La cuenta que no distingue nada: la de siempre de cada proveedor (`opencode` sale del prefijo del modelo, no hace falta el `@opencode`). */
const CUENTAS_POR_DEFECTO = new Set(["claude", "google", "chatgpt", "opencode"]);

/** La cuenta tal como se agrupa: "" si es la de siempre. */
export function cuentaCanonica(cuenta: string | null | undefined): string {
  const c = (cuenta ?? "").trim();
  return CUENTAS_POR_DEFECTO.has(c.toLowerCase()) ? "" : c;
}
