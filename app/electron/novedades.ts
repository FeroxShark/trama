import { readFile } from "node:fs/promises";
import { guardarNovedadesVista, novedadesVista, idiomaGuardado } from "./preferencias.js";
import { versionInstalada } from "./actualizacion-trama.js";
import { combinarCambios } from "./novedades-cambios.js";

export const RUTAS_CAMBIOS = [new URL("../dist/CHANGELOG.md", import.meta.url), new URL("../../CHANGELOG.md", import.meta.url)];
export const RUTAS_CAMBIOS_EN = [new URL("../dist/CHANGELOG.en.md", import.meta.url), new URL("../../CHANGELOG.en.md", import.meta.url)];

export type Novedades = {
  texto: string;
  actual: string | null;
  vista: string | null;
};

async function leerPrimero(rutas: readonly URL[]): Promise<string> {
  for (const r of rutas) {
    try {
      return await readFile(r, "utf8");
    } catch {
    }
  }
  return "";
}

export async function leerCambios(idiomaORutas?: string | readonly URL[], rutasExtra?: readonly URL[]): Promise<string> {
  if (Array.isArray(idiomaORutas)) {
    return leerPrimero(idiomaORutas);
  }
  const idioma = typeof idiomaORutas === "string" ? idiomaORutas : (idiomaGuardado() ?? "es");
  const rutasEs = rutasExtra ?? RUTAS_CAMBIOS;
  const textoEs = await leerPrimero(rutasEs);
  if (idioma !== "en") return textoEs;
  const textoEn = await leerPrimero(RUTAS_CAMBIOS_EN);
  return combinarCambios(textoEn, textoEs);
}

export async function leerNovedades(idioma?: string): Promise<Novedades> {
  const actual = versionInstalada();
  const [texto, vista] = await Promise.all([leerCambios(idioma), novedadesVista(actual)]);
  return { texto, actual, vista };
}

export const cerrarNovedades = (version: unknown) => guardarNovedadesVista(version);
