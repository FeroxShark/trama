// El ritmo de una ventana semanal de cupo, como lo calcula `reparto` (motor/bin/reparto, "ritmo semanal"): usado / esperado, donde
// "esperado" es la fracción de la semana que ya pasó. Con reserva para el líder (perfil ahorro: 35 % de la semana de Claude), el uso se mide
// sobre lo que les toca a los workers. Puro (sin React ni reloj propio): la app no ve los días ausentes del plan (`pa --plan`), así que
// acá la semana corre pareja; `reparto --plan ver` es el que las tiene en cuenta.
import type { Perfil } from "../../electron/modelos-tipos";

export type NivelRitmo = "encima" | "debajo" | "al-ritmo";
export type Ritmo = { ratio: number; esperado: number; nivel: NivelRitmo; pct: number };

const SEMANA_S = 7 * 24 * 3600;
/** Igual que `RITMO_MIN_ESPERADO` de reparto: al empezar la semana no se divide por casi cero. */
const ESPERADO_MIN = 0.1;
/** Tolerancia de «al ritmo» (±10 %), la misma que usa reparto para decir encima / debajo. */
const BANDA = 0.1;

/**
 * `pct`: 0–100 usado; `vuelve`: epoch s del reinicio; `ahora`: epoch s; `reserva`: fracción 0–1 que se guarda para el líder.
 * `null` sin dato (sin uso o sin hora de reinicio): nunca se inventa un ritmo.
 */
export function ritmoSemanal(pct: number | null, vuelve: number | null, ahora: number, reserva = 0): Ritmo | null {
  if (pct === null || vuelve === null || !Number.isFinite(pct) || !Number.isFinite(vuelve)) return null;
  const transcurrido = Math.min(1, Math.max(0, (ahora - (vuelve - SEMANA_S)) / SEMANA_S));
  const esperado = Math.max(ESPERADO_MIN, transcurrido);
  const usado = Math.min(1, Math.max(0, pct / 100));
  const usadoW = reserva > 0 && reserva < 1 ? Math.min(1, usado / (1 - reserva)) : usado;
  const ratio = usadoW / esperado;
  const nivel: NivelRitmo = ratio > 1 + BANDA ? "encima" : ratio < 1 - BANDA ? "debajo" : "al-ritmo";
  return { ratio, esperado, nivel, pct: Math.round(Math.abs(ratio - 1) * 100) };
}

/** Lo que el perfil guarda de la semana de Claude (igual que `PERFILES` de reparto). */
export const reservaDePerfil = (p: Perfil | undefined): number => (p === "ahorro" ? 0.35 : 0);
