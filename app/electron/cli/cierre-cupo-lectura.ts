// Lo que `pa` y `reparto` leen de la señal de cierre por cupo (`$PA_STATE/cierre-cupo.json`, ver motor/docs/protocolo-cierre-cupo.md):
// una suscripción bajo el umbral no se elige, y un `-m` forzado a ella se frena con «sin cupo: vuelve a las HH:MM». Sin archivo, nada se cierra.
// Sin Electron: sólo `node:fs` y lo puro de cierre-cupo.ts. Lo prueba tests/cierre-cupo-hook.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ARCHIVO_CIERRE, leerSenal, suscripcionDeModelo, type EntradaCierre, type Suscripcion } from "../cierre-cupo.ts";

/** Las entradas vigentes de la señal (las de una ventana que ya volvió no cuentan); `[]` sin archivo o roto. */
export function cierresVigentes(estadoPa: string, ahora = Math.floor(Date.now() / 1000)): EntradaCierre[] {
  let t: string | null = null;
  try {
    t = readFileSync(path.join(estadoPa, ARCHIVO_CIERRE), "utf8");
  } catch {
    return [];
  }
  return leerSenal(t).filter((e) => e.vuelve === null || e.vuelve > ahora);
}

/** El proveedor de un candidato de reparto (`openai` = ChatGPT) como suscripción. */
export const suscripcionDeProveedor = (p: unknown): Suscripcion | null => (p === "claude" ? "claude" : p === "google" ? "google" : p === "openai" || p === "chatgpt" ? "chatgpt" : null);

/**
 * La entrada que cierra esa suscripción (y esa cuenta, si se sabe cuál; sin cuenta vale cualquiera de la suscripción). Con varias
 * ventanas cerradas gana la que vuelve más tarde (`null`: no se sabe, la más tarde de todas).
 */
export function cierreDe(entradas: readonly EntradaCierre[], sus: Suscripcion | null, cuenta?: string | null): EntradaCierre | null {
  if (!sus) return null;
  const cs = entradas.filter((e) => e.proveedor === sus && (!cuenta || e.cuenta === cuenta || (cuenta === sus && e.cuenta === sus)));
  if (!cs.length) return null;
  return cs.reduce((a, b) => ((b.vuelve ?? Infinity) > (a.vuelve ?? Infinity) ? b : a));
}

/** Lo mismo para un modelo como lo escribe `pa -m`. */
export const cierreDeModelo = (entradas: readonly EntradaCierre[], modelo: string, cuenta?: string | null): EntradaCierre | null => cierreDe(entradas, suscripcionDeModelo(modelo), cuenta);

const dos = (n: number) => String(n).padStart(2, "0");
/** `HH:MM` local (con `dd/mm` si no es de hoy). */
export function horaCierre(vuelve: number, ahora = Date.now() / 1000): string {
  const d = new Date(vuelve * 1000);
  const hm = `${dos(d.getHours())}:${dos(d.getMinutes())}`;
  return d.toDateString() === new Date(ahora * 1000).toDateString() ? hm : `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${hm}`;
}

/** «sin cupo: vuelve a las HH:MM» (sin hora conocida: «…vuelve cuando se reinicie la ventana»). */
export const textoSinCupo = (e: Pick<EntradaCierre, "vuelve">, ahora?: number): string => (e.vuelve === null ? "sin cupo: vuelve cuando se reinicie la ventana" : `sin cupo: vuelve a las ${horaCierre(e.vuelve, ahora)}`);
