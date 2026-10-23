// La salud de una integración (B25): roja si causó problemas. Puro, con
// extensión en los imports: lo prueba `node --test` (tests/salud.test.ts). Los
// datos los junta el main (electron/salud.ts).
import type { EstadoSalud } from "../../electron/salud.ts";

export type { Chequeo, EstadoSalud, FilaIntegrada } from "../../electron/salud.ts";

/** Por qué está roja: se revirtió, la corrida quedó `bien=no` o los tests de main dieron rojo después. */
export type Motivo = "revertida" | "bien_no" | "tests";

export type Salud =
  | { rojo: false; verificando: boolean }
  | { rojo: true; motivo: Motivo; rc: number | null; cola: string | null };

/**
 * La salud de la integración `id` (con el estado que dice `pa --hilos`). Gana
 * lo más grave: revertida, después tests rojos, después `bien=no`.
 */
export function salud(id: string, estado: string, s: EstadoSalud | null): Salud {
  const fila = s?.integradas[id];
  const ch = s?.chequeos[id];
  if (estado === "revertido" || fila?.accion === "revertida")
    return { rojo: true, motivo: "revertida", rc: ch && ch.rc !== 0 ? ch.rc : null, cola: ch && ch.rc !== 0 ? ch.cola || null : null };
  if (ch && ch.rc !== 0) return { rojo: true, motivo: "tests", rc: ch.rc, cola: ch.cola || null };
  if (s?.bienNo.includes(id)) return { rojo: true, motivo: "bien_no", rc: null, cola: null };
  return { rojo: false, verificando: !!s?.corriendo.includes(id) };
}

/** La integró "Integrar solo lo seguro": lo dice `integradas.tsv` (auto=1) o el recuerdo de la app (auto.json). */
export const fueSola = (id: string, s: EstadoSalud | null, solas: ReadonlySet<string>) => solas.has(id) || !!s?.integradas[id]?.auto;
