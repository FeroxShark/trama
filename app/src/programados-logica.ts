// Lo puro de programar y posponer en la ventana: qué conversaciones se esconden de la barra, qué texto lleva la pastilla del pie y
// cómo se lee la hora que escribió la persona. Lo prueba tests/programados-logica.test.ts.
import type { Estado, Programado, Pospuesto } from "../electron/programados.ts";
import { resolverCuando } from "../electron/programados-hora.ts";

/** Las conversaciones sin las pospuestas (la misma lista si no hay ninguna: no rearma el árbol). */
export function sinPospuestas<T extends { id: string }>(lideres: T[], pospuestos: readonly Pospuesto[]): T[] {
  if (!pospuestos.length) return lideres;
  const ocultas = new Set(pospuestos.map((p) => p.sid));
  return lideres.some((l) => ocultas.has(l.id)) ? lideres.filter((l) => !ocultas.has(l.id)) : lideres;
}

/** Los programados de una conversación, del que sale primero al último. */
export const deLider = (e: Estado, sid: string): Programado[] => e.mensajes.filter((m) => m.sid === sid);

/** Lo que dice la hora escrita: `{ cuando }` si se entiende (y es futura), `{ error }` si no, `null` si no escribió nada. */
export function leerHora(texto: string, ahora: number): { cuando: number } | { error: true } | null {
  if (!texto.trim()) return null;
  const c = resolverCuando(texto, ahora);
  return c === null ? { error: true } : { cuando: c };
}

/** El texto de un mensaje programado en una línea corta para la lista. */
export function resumen(texto: string, max = 90): string {
  const una = texto.replace(/\s+/g, " ").trim();
  return una.length > max ? `${una.slice(0, max - 1)}…` : una;
}

/** Cuántos hay de cada cosa, para la pastilla del pie. */
export const cuentas = (e: Estado) => ({ mensajes: e.mensajes.length, pospuestos: e.pospuestos.length });
