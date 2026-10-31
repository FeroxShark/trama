// Qué modelos del selector están sin cupo, sin React (lo prueba tests/agotados.test.ts). El cupo de cada modelo sale de
// src/hilo/cupo-modelos.ts (el mismo `Uso` que la tarjeta); acá queda lo que el aviso de error y el «Cambiar de modelo» necesitan.
// El uso gratis de OpenCode es UNO solo para todos sus modelos gratis: cuando se acaba, se acabó para todos; los de pago de OpenCode
// (tu clave) no se tocan. El main anota la marca (electron/opencode-agotado.ts) y la suma al `Uso` como la suscripción `opencode`.
import type { Uso } from "../datos/contrato.ts";
import type { Opcion } from "./Selector";
import type { EstadoCupo } from "./cupo-modelos.ts";

/** ¿Es un modelo gratis de OpenCode? (igual que `esGratis` de electron/opencode.ts; recibe `opencode:xxx`.) */
export const esGratisOpencode = (id: string): boolean => id.startsWith("opencode:") && (/-free$/.test(id) || id === "opencode:opencode/big-pickle");

/** Los modelos de OpenCode Go agotados según el `Uso`: su id (`opencode:opencode-go/<modelo>`, en minúsculas) → hasta cuándo (epoch s). */
export function goAgotadosHasta(uso: Uso | null | undefined, ahoraS = Date.now() / 1000): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (!uso || !("suscripciones" in uso)) return out;
  for (const g of uso.suscripciones?.find((s) => s.id === "opencode")?.grupos ?? []) if (/^opencode:opencode-go\//.test(g.id) && g.agotado !== undefined && g.agotado > ahoraS) out.set(g.id.toLowerCase(), g.agotado);
  return out;
}

/** La pestaña (proveedor) con que abre el selector al «Cambiar de modelo»: la del primer modelo que no es de OpenCode gratis ni está sin cupo. */
export function proveedorLibre(opciones: readonly Opcion[], cupos: ReadonlyMap<string, EstadoCupo>): string | null {
  const o = opciones.find((x) => !esGratisOpencode(x.id) && !cupos.get(x.id)?.sin && !x.deshabilitada);
  return o ? (o.col ?? o.grupo ?? null) : null;
}

/** El aviso de error de un turno es el de «se acabó el uso gratis de OpenCode» o «se acabó el cupo de este modelo de Go» (el texto codificado del main, `main.opencodeSinCupo` / `main.opencodeGoSinCupo`). */
export const esAvisoSinCupoOpencode = (texto: string): boolean => texto.includes("i18n:main.opencodeSinCupo") || texto.includes("i18n:main.opencodeGoSinCupo");

/** El evento (en `window`) con que el aviso pide abrir el selector de modelo del chat. */
export const EVENTO_CAMBIAR_MODELO = "trama:cambiar-modelo";
