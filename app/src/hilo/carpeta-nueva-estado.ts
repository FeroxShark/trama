// El almacén de la carpeta de un líder nuevo (ver carpeta-nueva.ts): el proyecto que mira la persona en la barra y el último que se usó.
import { useSyncExternalStore } from "react";
import { GENERAL } from "../datos/contrato";
import { MODO } from "../modo";
import { PERSONAL } from "./carpeta-nueva";

const CLAVE_ULTIMA = "trama:lider:carpeta";

let seleccion: string | null = null;
const oyentes = new Set<() => void>();

/** La barra avisa qué proyecto está mirando la persona (`GENERAL` y vacío no cuentan: no son un proyecto). */
export function ponerSeleccion(slug: string | null | undefined): void {
  if (!slug || slug === GENERAL || slug === seleccion) return;
  seleccion = slug;
  oyentes.forEach((f) => f());
}

export const useSeleccion = (): string | null =>
  useSyncExternalStore(
    (fn) => {
      oyentes.add(fn);
      return () => void oyentes.delete(fn);
    },
    () => seleccion,
  );

/** Lo último que se eligió al mandar un primer mensaje: una ruta, o `PERSONAL`. */
export function leerUltima(): string | null {
  if (MODO.datosFijos) return null;
  try {
    return localStorage.getItem(CLAVE_ULTIMA);
  } catch {
    return null;
  }
}

/** Anota lo elegido al mandar el primer mensaje (`""`: la personal, que sólo se recuerda si se la eligió a mano: `aMano`). */
export function guardarUltima(carpeta: string, aMano: boolean): void {
  if (MODO.datosFijos) return;
  try {
    if (carpeta.trim()) localStorage.setItem(CLAVE_ULTIMA, carpeta.trim());
    else if (aMano) localStorage.setItem(CLAVE_ULTIMA, PERSONAL);
  } catch {}
}
