// Qué cuenta como "actividad" de un líder de la app, y cuáles se levantan al arrancar Trama. Puro: sin disco ni procesos.
// Levantar un `claude` (el `--resume` de `reanudarDormidos`, un statusline que recién arranca) escribe su sesión y su
// statusline con la hora de ese momento: si eso contara, todos los chats dirían "hace 4 h" tras cada reinicio y
// el orden Reciente mezclaría lo de hoy con lo de hace cuatro días.

/** Cuánto atrás tiene que estar el último turno de un dormido para que Trama no lo levante solo al arrancar. */
export const DORMIR_S = 24 * 3600;

export type ActividadApp = {
  /** Fin de su último turno (`Guardado.ultimo`, epoch s; 0: ninguno). */
  ultimo: number;
  /** Cuándo se creó la conversación (epoch s). */
  creado: number;
  /** Responde ahora o pide un permiso: lo que hace el proceso en este momento sí es actividad. */
  enCurso: boolean;
  /** Lo que dicen la sesión y el statusline del proceso (`updatedAt`, `ts`): sólo valen mientras `enCurso`. */
  delProceso: readonly number[];
};

/**
 * La actividad de un líder de la app: su último turno real (o su creación, si todavía no tuvo ninguno). Que se haya levantado el
 * proceso, con `--resume` o no, no la mueve. Mientras responde o pide un permiso, vale además lo que dice su proceso.
 */
export function actividadApp(a: ActividadApp): number {
  const base = Math.max(a.ultimo, a.creado, 0);
  return a.enCurso ? Math.max(base, ...a.delProceso.filter((n) => Number.isFinite(n))) : base;
}

export type Dormido = {
  ultimo: number;
  creado: number;
  /** Tiene workers de `pa` vivos (trabajando, colgados o en cola). */
  conWorkers: boolean;
  /** Tiene algo en la cola de mensajes (o en camino). */
  enCola: boolean;
};

/**
 * Si al arrancar Trama conviene volver a levantar a este líder dormido: sólo si tuvo un turno (o se creó) en las últimas 24 h, o
 * tiene workers vivos, o tiene algo en la cola. El resto queda sin proceso, con su caja: el próximo mensaje hace `--resume`.
 */
export function debeLevantarse(d: Dormido, ahoraS: number): boolean {
  if (d.conWorkers || d.enCola) return true;
  const ultimo = Math.max(d.ultimo, d.creado, 0);
  return ahoraS - ultimo < DORMIR_S;
}
