// Plan y cupos, la parte que no es pantalla: qué ventanas pasaron el tope que el usuario quiere guardar para sus sesiones, y
// los topes que `reparto` (pa) aplica a Google. Sin React ni textos: los dice AjustesCupos.tsx.
import type { Uso } from "../datos/contrato";
import { cruces, type Borrador } from "./modelos-borrador";

/** `reparto` descarta una ventana con menos del 3 % libre ("llena"): desde el 97 % usado. */
export const GOOGLE_LLENA = 97;
/** Para trabajo de código (`codigo-*`, `frontend`, `debug`, `diseno`) descarta un grupo de agy con menos del 30 % libre en 5 h: desde el 70 % usado. */
export const GOOGLE_CODIGO = 70;

export type AvisoTope = {
  /** La suscripción: hoy sólo Claude tiene reserva, pero el aviso nombra a quien sea. */
  quien: "claude";
  ventana: "5h" | "7d";
  pct: number;
  tope: number;
  /** Cuándo vuelve (epoch s); `null`: no se sabe. */
  vuelve: number | null;
};

/** Las ventanas de Claude que ya pasaron el tope del borrador (con el interruptor apagado, o sin dato, no hay ninguna). */
export function avisosTope(b: Borrador, uso: Uso | null): AvisoTope[] {
  if (!uso || !("five_hour" in uso)) return [];
  return cruces(b, uso).map((c) => ({
    quien: "claude",
    ventana: c.ventana,
    pct: c.pct,
    tope: c.tope,
    vuelve: (c.ventana === "5h" ? uso.five_hour : uso.seven_day)?.resets_at ?? null,
  }));
}
