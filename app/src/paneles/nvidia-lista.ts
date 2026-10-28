// La lista de modelos de NVIDIA NIM de Ajustes (AjustesNvidia.tsx), sin React: la prueba tests/nvidia-lista.test.ts.
import type { EstadoNim } from "../datos/paneles";

export const URL_NVIDIA = "https://build.nvidia.com";
/** La misma forma que acepta `reparto` y `guardarModelosNim`: organizacion/modelo. */
export const ID_NIM = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;

/** Los ids que se muestran: el base, los prendidos y lo que se agregó en esta sesión (apagar uno no lo hace desaparecer de golpe). Sin repetidos. */
export const listaNim = (e: Pick<EstadoNim, "base" | "modelos">, vistos: readonly string[]): string[] => [...new Set([e.base, ...e.modelos, ...vistos])];
