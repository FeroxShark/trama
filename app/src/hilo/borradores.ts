// Lo que el usuario dejó escrito en cada caja (por id de hilo, o BORRADOR_LIDER para el líder nuevo), y el error
// de `pa` si el envío falló: sobrevive a cambiar de hilo y a que la vista se
// desmonte mientras `pa` contesta. En memoria; los guarda en disco la ventana (demorado, src/volver.ts →
// electron/borradores.ts) y los devuelve en cualquier arranque; la recarga de la página en el celular los
// devuelve por su sessionStorage.
import { huboCambio } from "./cambios";

export type Borrador = { texto: string; error: string | null; extra?: Record<string, string> };

const borradores = new Map<string, Borrador>();

export const leerBorrador = (clave: string): Borrador => borradores.get(clave) ?? { texto: "", error: null };

export function ponerBorrador(clave: string, b: Partial<Borrador>) {
  const n = { ...leerBorrador(clave), ...b };
  if (!n.texto && !n.error && !Object.values(n.extra ?? {}).some(Boolean)) borradores.delete(clave);
  else borradores.set(clave, n);
  huboCambio();
}

/** Lo escrito sin mandar en todas las cajas, para volver tras un reinicio (src/volver.ts). Sin los errores: son de un envío que ya pasó. */
export const fotoBorradores = (): [string, { texto: string; extra?: Record<string, string> }][] =>
  [...borradores].filter(([, b]) => b.texto || Object.values(b.extra ?? {}).some(Boolean)).map(([k, b]) => [k, b.extra ? { texto: b.texto, extra: b.extra } : { texto: b.texto }]);

export const soltarBorrador = (clave: string) => {
  if (borradores.delete(clave)) huboCambio();
};

/** Dónde tenía el cursor en cada caja al irse (sólo en memoria): al volver no queda al inicio del texto. */
const cursores = new Map<string, number>();
export const guardarCursor = (clave: string, pos: number) => void cursores.set(clave, pos);
/** Dónde ponerlo: donde estaba si sigue cabiendo en el texto; si no, al final. */
export const cursorDe = (clave: string, largo: number) => Math.min(cursores.get(clave) ?? largo, largo);

const oyentes = new Map<string, Set<() => void>>();

/** Avisa cuando alguien de afuera llena el borrador (la caja montada lo vuelve a leer). */
export function escucharBorrador(clave: string, fn: () => void) {
  const s = oyentes.get(clave) ?? new Set();
  oyentes.set(clave, s.add(fn));
  return () => void s.delete(fn);
}

/** Llena un borrador desde afuera (p. ej. el asistente de Ramas) y avisa a la caja que lo muestra. */
export function llenarBorrador(clave: string, texto: string) {
  ponerBorrador(clave, { texto, error: null });
  for (const f of oyentes.get(clave) ?? []) f();
}

/**
 * Pone lo de la vez anterior, si la caja todavía no tiene nada escrito (llegó tarde: El usuario ya pudo empezar a
 * escribir), y avisa a la caja si está montada.
 */
export function restaurarBorrador(clave: string, texto: string, extra?: Record<string, string>) {
  const b = leerBorrador(clave);
  if (b.texto || Object.values(b.extra ?? {}).some(Boolean)) return;
  ponerBorrador(clave, extra ? { texto, extra } : { texto });
  for (const f of oyentes.get(clave) ?? []) f();
}
