// Las novedades de cada versión, del lado del motor: el CHANGELOG.md que viaja con el build y la última versión que se cerró con
// «Listo» (preferencias.json). La interfaz (ventana y celular) lo pide por `novedades:leer` y lo interpreta con
// `novedades-cambios.ts`; acá no se parsea nada. El archivo sale del build: `vite.config.ts` lo copia a `dist/CHANGELOG.md`, y `dist/`
// viaja entero al AppImage (electron-builder `files`), al payload del .exe nativo (`app/dist`) y a la instalación de escritorio de
// Linux. En un checkout sin build (dev) se lee el de la raíz del repo.
import { readFile } from "node:fs/promises";
import { guardarNovedadesVista, novedadesVista } from "./preferencias.js";
import { versionInstalada } from "./actualizacion-trama.js";

/** Dónde puede estar el CHANGELOG respecto de este archivo (electron/ y dist-electron/ están a la misma profundidad). */
export const RUTAS_CAMBIOS = [new URL("../dist/CHANGELOG.md", import.meta.url), new URL("../../CHANGELOG.md", import.meta.url)];

export type Novedades = {
  /** El CHANGELOG.md entero (vacío si no se encontró: la interfaz no muestra nada). */
  texto: string;
  /** La versión de Trama que corre (null si no se pudo saber). */
  actual: string | null;
  /** La última versión cuyas novedades se cerraron; null: ya usaba Trama antes de las novedades. */
  vista: string | null;
};

/** El primer CHANGELOG que exista, o "". */
export async function leerCambios(rutas: readonly URL[] = RUTAS_CAMBIOS): Promise<string> {
  for (const r of rutas) {
    try {
      return await readFile(r, "utf8");
    } catch {
      /* el siguiente */
    }
  }
  return "";
}

export async function leerNovedades(): Promise<Novedades> {
  const actual = versionInstalada();
  const [texto, vista] = await Promise.all([leerCambios(), novedadesVista(actual)]);
  return { texto, actual, vista };
}

export const cerrarNovedades = (version: unknown) => guardarNovedadesVista(version);
