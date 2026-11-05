// El perfil de reparto (`perfil` de ~/.config/trama/modelos.json) visto desde fuera de Ajustes: la barra de cupos lo muestra y lo cambia
// sin pasar por la barra de Guardar. Guarda por el mismo camino que Ajustes (`guardarModelos` → `validarConfig`/`unir`), pero tocando
// SÓLO el perfil: lo guardado se relee en el momento y se escribe tal cual con la clave nueva, así que nada que Ajustes tenga a medio
// editar (ni lo que haya en el archivo) se pierde. `reparto` lee el archivo en cada lanzamiento: vale para los workers nuevos.
import type { Perfil } from "../../electron/modelos-tipos";
import { PERFILES } from "../../electron/modelos-tipos";
import type { FuentePaneles } from "./paneles";

/** Lo único que se necesita de la fuente de Ajustes (en los tests, el main real contra una carpeta temporal). */
export type FuenteModelos = Pick<FuentePaneles, "modelos" | "guardarModelos">;

export { PERFILES };
export type { Perfil };

/** El aviso (en `window`, con `detail: Perfil`) con que Ajustes y la barra de cupos se cuentan que el perfil guardado cambió. */
export const EVENTO_PERFIL = "trama:perfil-reparto";

/** Sin la clave en el archivo vale `equilibrado`. */
export const perfilDe = (c: { perfil?: Perfil } | null | undefined): Perfil => c?.perfil ?? "equilibrado";

export const avisarPerfil = (p: Perfil) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<Perfil>(EVENTO_PERFIL, { detail: p }));
};

/** El perfil guardado hoy. Rechaza si el archivo no se puede leer. */
export async function leerPerfil(f: FuenteModelos): Promise<Perfil> {
  return perfilDe((await f.modelos()).config);
}

/**
 * Guarda `perfil` y devuelve el que quedó escrito. Rechaza con el motivo (el del main: un JSON roto, otra versión) sin escribir nada.
 * Si ya era ese perfil no escribe.
 */
export async function guardarPerfil(perfil: Perfil, f: FuenteModelos): Promise<Perfil> {
  const hoy = await f.modelos();
  if (perfilDe(hoy.config) === perfil) return perfil;
  const { perfil: _antes, ...resto } = hoy.config;
  const nuevo = await f.guardarModelos({ ...resto, ...(perfil === "equilibrado" ? {} : { perfil }) });
  const quedo = perfilDe(nuevo.config);
  avisarPerfil(quedo);
  return quedo;
}
