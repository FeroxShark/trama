// Qué modelos del selector están sin cupo, sin React (lo prueba tests/agotados.test.ts). El uso gratis de OpenCode es UNO solo para todos sus
// modelos gratis (`*-free` y `big-pickle`): cuando se acaba, se acabó para todos; los de pago de OpenCode (tu clave) no se tocan.
// El main anota la marca (electron/opencode-agotado.ts) y la suma al `Uso` como la suscripción `opencode`, grupo `opencode-free`.
import type { Uso } from "../datos/contrato";
import type { Opcion } from "./Selector";

/** ¿Es un modelo gratis de OpenCode? (igual que `esGratis` de electron/opencode.ts; recibe `opencode:opencode/xxx`.) */
export const esGratisOpencode = (id: string): boolean => id.startsWith("opencode:") && (/-free$/.test(id) || id === "opencode:opencode/big-pickle");

/** Hasta cuándo (epoch s) está agotado el uso gratis de OpenCode según el `Uso`, o `null` si no lo está. */
export function opencodeAgotadoDe(uso: Uso | null | undefined, ahoraS = Date.now() / 1000): number | null {
  if (!uso || !("suscripciones" in uso)) return null;
  const g = uso.suscripciones?.find((s) => s.id === "opencode")?.grupos?.find((x) => x.id === "opencode-free");
  return g?.agotado !== undefined && g.agotado > ahoraS ? g.agotado : null;
}

/** Las opciones con `agotada` en los gratis de OpenCode si `hastaS` rige; la misma lista si no hay nada que marcar. */
export function marcarAgotadas<T extends Opcion>(opciones: T[], hastaS: number | null, ahoraS = Date.now() / 1000): T[] {
  if (hastaS === null || hastaS <= ahoraS) return opciones;
  return opciones.map((o) => (esGratisOpencode(o.id) ? { ...o, agotada: true } : o));
}

/** La pestaña (proveedor) con que abre el selector al «Cambiar de modelo»: la del primer modelo que no es de OpenCode gratis. */
export function proveedorLibre(opciones: readonly Opcion[]): string | null {
  const o = opciones.find((x) => !esGratisOpencode(x.id) && !x.agotada && !x.deshabilitada);
  return o ? (o.col ?? o.grupo ?? null) : null;
}

/** El aviso de error de un turno es el de «se acabó el uso gratis de OpenCode» (el texto codificado del main, `main.opencodeSinCupo`). */
export const esAvisoSinCupoOpencode = (texto: string): boolean => texto.includes("i18n:main.opencodeSinCupo");

/** El evento (en `window`) con que el aviso pide abrir el selector de modelo del chat. */
export const EVENTO_CAMBIAR_MODELO = "trama:cambiar-modelo";
