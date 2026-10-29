// Los precios que el usuario cambió en Ajustes > Modelos: sólo los modelos que tocó (lo demás son los públicos de precios.ts).
// Se guardan en el almacenamiento local de la ventana: son una estimación de esta máquina, no config de `pa` ni de reparto.
// Sin almacenamiento (un navegador sin localStorage, una ventana sin permiso) no se rompe nada: valen los públicos.
import { precioDeGuardado, type Precio, type Tabla } from "./precios.ts";

const CLAVE = "trama.precios.v1";

/** Lo guardado, validado modelo por modelo: lo que no sirve se descarta. */
export function leerCambios(): Tabla {
  try {
    const crudo = globalThis.localStorage?.getItem(CLAVE);
    if (!crudo) return {};
    const j: unknown = JSON.parse(crudo);
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const t: Tabla = {};
    for (const [modelo, v] of Object.entries(j)) {
      const p = precioDeGuardado(v);
      if (p) t[modelo] = p;
    }
    return t;
  } catch {
    return {};
  }
}

export function guardarCambios(t: Tabla): void {
  try {
    globalThis.localStorage?.setItem(CLAVE, JSON.stringify(t));
  } catch {
    // Sin almacenamiento: el cambio dura lo que la ventana. No es un error que se muestre.
  }
}

/** Un modelo editado o quitado (`null`: vuelve al público). Devuelve la tabla nueva y la guarda. */
export function cambiarPrecio(actual: Tabla, modelo: string, p: Precio | null): Tabla {
  const t = { ...actual };
  if (p === null) delete t[modelo];
  else t[modelo] = p;
  guardarCambios(t);
  return t;
}
