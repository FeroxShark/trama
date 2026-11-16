// Plan y cupos > «Cierre ordenado»: la parte que no es pantalla. Lo que se edita es `cierre` de modelos.json (activo, umbral, retomar_solo) sobre el
// borrador de Ajustes > Modelos; lo que coincide con lo de fábrica (`CIERRE_DEFECTO`) no se anota (el archivo queda corto). Lo prueba tests/cupos-cierre.test.ts.
import { CIERRE_DEFECTO, UMBRAL_CIERRE_MAX, UMBRAL_CIERRE_MIN, validarCierre, type AjustesCierre } from "../../electron/valida-ajustes";
import type { Borrador } from "./modelos-borrador";

export { UMBRAL_CIERRE_MAX, UMBRAL_CIERRE_MIN };

/** Lo que rige según el borrador: lo tocado encima de la fábrica. */
export const cierreDe = (b: Borrador): AjustesCierre => ({ ...CIERRE_DEFECTO, ...b.cierre });

/** El borrador con ese campo en `valor`; igual que la fábrica, el campo sale del archivo. */
export function ponerCierre<K extends keyof AjustesCierre>(b: Borrador, campo: K, valor: AjustesCierre[K]): Borrador {
  const cierre: Partial<AjustesCierre> = { ...b.cierre };
  if (valor === CIERRE_DEFECTO[campo]) delete cierre[campo];
  else cierre[campo] = valor;
  return { ...b, cierre };
}

/** El umbral escrito: vacío vuelve a la fábrica (`valor: null`, sin error); un texto que no vale trae la clave del motivo (la de `validarCierre`). */
export function umbralDeTexto(texto: string): { valor: number | null; error: string | null } {
  const s = texto.trim();
  if (!s) return { valor: null, error: null };
  const n = /^\d+$/.test(s) ? Number(s) : NaN;
  const motivo = validarCierre({ umbral: Number.isFinite(n) ? n : s });
  return motivo ? { valor: null, error: motivo } : { valor: n, error: null };
}
