// Modelo y esfuerzo elegidos mientras el líder trabaja: nunca se bloquean los selectores. Lo elegido NO toca el turno en curso
// (se aplica al próximo mensaje que salga: el de la caja, o el de la cola al desencolarse). Esto dice cuándo hay algo pendiente
// y qué se le ofrece al elegir con un turno en curso. Sin React: lo prueba tests/pendiente.test.ts.
import { effortsDe, familiaDe } from "./modelos";

export type PendienteTurno = { modelo: boolean; effort: boolean };

const SIN: PendienteTurno = { modelo: false, effort: false };

/** Sigue al servidor sólo si la caja todavía muestra lo que decía antes. */
export const seguirServidor = (caja: string, anterior: string | null | undefined, nuevo: string): string =>
  caja === anterior ? nuevo : caja;

/** Modelo y esfuerzo de la caja (o los que dice el servidor). */
export type Seleccion = { modelo: string; effort: string };

/**
 * Cómo la caja sigue al servidor. `visto`: lo último que dijo. `propio`: lo elegido acá que el servidor todavía no dijo; mientras haya,
 * lo que llega del servidor puede ser el eco tardío de algo que la caja mandó antes y no se sigue. Sin esto, elegir A→B→A hacía que
 * el eco de B moviera la caja a B, la caja lo mandaba, el eco de A la volvía a A, y así sin fin (2026-11-24: 241 `set_model` en 9 s).
 */
export type Seguimiento = { visto: Seleccion | null; propio: Seleccion | null };

/** Un modelo sin niveles (Ollama, OpenCode) no tiene esfuerzo que comparar. */
const igual = (a: Seleccion | null, b: Seleccion | null): boolean =>
  !!a && !!b && a.modelo === b.modelo && (a.effort === b.effort || effortsDe(a.modelo).length === 0);

/**
 * La caja eligió `sel` acá. Si es lo que ya dice el servidor, no queda nada por confirmar: un eco tardío de algo anterior puede moverla
 * una vez (no se le devuelve, así que no hay vaivén) y el siguiente la deja donde está el servidor. Esperar confirmación de algo que el
 * servidor ya dice la dejaría sin seguirlo nunca más (un líder dormido no manda eco).
 */
export const elegidoAca = (s: Seguimiento, sel: Seleccion): Seguimiento => ({ ...s, propio: igual(sel, s.visto) ? null : sel });

/**
 * El servidor dice `nuevo`. Con algo propio sin confirmar, la caja no se mueve (y si `nuevo` es eso, queda confirmado). Sin nada propio,
 * sigue al servidor si todavía muestra lo que decía antes; el esfuerzo, sólo si además sigue en el mismo modelo.
 */
export function llegaServidor(caja: Seleccion, s: Seguimiento, nuevo: Seleccion): { caja: Seleccion; s: Seguimiento } {
  if (igual(nuevo, s.visto)) return { caja, s };
  if (s.propio) return { caja, s: { visto: nuevo, propio: igual(nuevo, s.propio) ? null : s.propio } };
  const antes = s.visto;
  const modelo = seguirServidor(caja.modelo, antes?.modelo, nuevo.modelo);
  const effort = caja.modelo === antes?.modelo ? seguirServidor(caja.effort, antes.effort, nuevo.effort) : caja.effort;
  return { caja: { modelo, effort }, s: { visto: nuevo, propio: null } };
}

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
 * Las opciones de modelo con un turno en curso: las del mismo motor se eligen (las toma el turno ya si se puede en vivo; si no, el próximo mensaje); las de otro motor
 * (Claude, Gemini, DeepSeek Harness, OpenCode) quedan a la vista pero apagadas, diciendo por qué: ese cambio sigue como siempre,
 * con su confirmación y con el líder en reposo.
 */
export function opcionesEnTurno<T extends { id: string; desc: string; deshabilitada?: boolean }>(opciones: T[], ocupado: boolean, modeloDelTurno: string | null | undefined, porque: string): T[] {
  if (!ocupado || !modeloDelTurno) return opciones;
  const fam = familiaDe(modeloDelTurno);
  return opciones.map((o) => (familiaDe(o.id) === fam ? o : { ...o, deshabilitada: true, desc: porque }));
}

type GuardadoCaja = { caja: Seleccion; s: Seguimiento };
const cajasGuardadas = new Map<string, GuardadoCaja>();

/**
 * Conserva el modelo o esfuerzo elegido por la persona para `sid` mientras el servidor todavía no lo aplicó: al salir a otro chat
 * (el componente se desmonta) y volver, no se pierde la selección pendiente (`próx.`).
 */
export function sincronizarCajaGuardada(sid: string | null | undefined, caja: Seleccion, s: Seguimiento) {
  if (!sid) return;
  if (s.propio) cajasGuardadas.set(sid, { caja, s });
  else cajasGuardadas.delete(sid);
}

/**
 * Selección inicial de la caja al montar un chat (`sid`) contra lo último que reporta el servidor: recupera una selección pendiente si
 * todavía no fue confirmada ni pisada por otra cosa.
 */
export function estadoInicialCaja(sid: string | null | undefined, servidor: Seleccion | null): { caja: Seleccion | null; s: Seguimiento } {
  const g = sid ? cajasGuardadas.get(sid) : undefined;
  if (!g) return { caja: servidor, s: { visto: servidor, propio: null } };
  if (!servidor) return { caja: g.caja, s: g.s };
  const r = llegaServidor(g.caja, g.s, servidor);
  sincronizarCajaGuardada(sid, r.caja, r.s);
  return r;
}

/** Para los tests. */
export function olvidarCajasGuardadas() {
  cajasGuardadas.clear();
}
