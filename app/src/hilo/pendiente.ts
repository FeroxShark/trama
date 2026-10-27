// Modelo y esfuerzo elegidos mientras el líder trabaja: nunca se bloquean los selectores. Lo elegido NO toca el turno en curso
// (se aplica al próximo mensaje que salga: el de la caja, o el de la cola al desencolarse). Esto dice cuándo hay algo pendiente
// y qué se le ofrece al elegir con un turno en curso. Sin React: lo prueba tests/pendiente.test.ts.
import { effortsDe, familiaDe } from "./modelos";

export type PendienteTurno = { modelo: boolean; effort: boolean };

const SIN: PendienteTurno = { modelo: false, effort: false };

/**
 * Lo elegido en la caja que todavía no usa el turno en curso. `turno`: el modelo y el esfuerzo con que corre (los del líder);
 * sin turno en curso no hay nada pendiente (el próximo mensaje sale con lo elegido y ya).
 */
export function pendienteDe(x: { ocupado: boolean; modelo: string; effort: string; turno: { modelo: string | undefined; effort: string | null | undefined } | null }): PendienteTurno {
  if (!x.ocupado || !x.turno?.modelo) return SIN;
  const modelo = x.modelo !== x.turno.modelo;
  // Un modelo sin niveles (Ollama, OpenCode) no tiene esfuerzo que comparar; con otro modelo elegido el esfuerzo ya va con él.
  const effort = !modelo && effortsDe(x.modelo).length > 0 && !!x.turno.effort && x.effort !== x.turno.effort;
  return { modelo, effort };
}

/**
 * Las opciones de modelo con un turno en curso: las del mismo motor se eligen (se aplican al próximo mensaje); las de otro motor
 * (Claude, Gemini, DeepSeek Harness, OpenCode) quedan a la vista pero apagadas, diciendo por qué: ese cambio sigue como siempre,
 * con su confirmación y con el líder en reposo.
 */
export function opcionesEnTurno<T extends { id: string; desc: string; deshabilitada?: boolean }>(opciones: T[], ocupado: boolean, modeloDelTurno: string | null | undefined, porque: string): T[] {
  if (!ocupado || !modeloDelTurno) return opciones;
  const fam = familiaDe(modeloDelTurno);
  return opciones.map((o) => (familiaDe(o.id) === fam ? o : { ...o, deshabilitada: true, desc: porque }));
}
