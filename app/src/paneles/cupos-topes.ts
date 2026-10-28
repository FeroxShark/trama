// Plan y cupos > Avanzado > «Dónde pa deja de usar cada proveedor»: la parte que no es pantalla. Cada tope es el % USADO de una ventana desde el
// que `reparto` (pa) no elige a ese proveedor para los workers. Claude se guarda como `reserva`; Google, ChatGPT y cada grupo de Google, como
// `topes_uso`; el de código de Google (ventana de 5 h), como `agy_min_libre_5h`. Sin React ni textos: los dice AjustesCupos.tsx.
import { GOOGLE_CODIGO_FABRICA, TOPE_FABRICA, topeEfectivo, type Borrador } from "./modelos-borrador";

/** Lo que se puede cambiar: `claude:5h`, `claude:7d`, `openai`, `google` (todo Google), `google:<grupo>` y `google:codigo` (código en 5 h). */
export type IdTope = string;

/** Lo más bajo y lo más alto que acepta el deslizador (el archivo acepta de 1 a 100). */
export const TOPE_MIN = 10;
export const TOPE_MAX = 100;

const esClaude = (id: IdTope) => id === "claude:5h" || id === "claude:7d";
const padre = (id: IdTope) => (id.startsWith("google:") && id !== "google:codigo" ? "google" : null);

/** De dónde sale el valor de fábrica: el 97 % de `reparto` (libre < 3 %) para todos; el de código de Google es aparte. */
export const fabricaDe = (id: IdTope): number => (id === "google:codigo" ? GOOGLE_CODIGO_FABRICA : TOPE_FABRICA);

/** El valor que rige ahora para ese tope, con lo que el borrador cambió encima de la fábrica. */
export function topeDe(b: Borrador, id: IdTope): number {
  if (esClaude(id)) return b.guardar ? topeEfectivo(b, id === "claude:5h" ? "5h" : "7d") : TOPE_FABRICA;
  if (id === "google:codigo") return b.codigoGoogle ?? GOOGLE_CODIGO_FABRICA;
  const p = padre(id);
  return b.topes[id] ?? (p ? b.topes[p] : undefined) ?? TOPE_FABRICA;
}

/** ¿Es distinto del de fábrica? (Lo que se muestra con «Volver a de fábrica».) */
export const cambiado = (b: Borrador, id: IdTope): boolean => topeDe(b, id) !== fabricaDe(id);

/** El borrador con ese tope en `v` (entero acotado). Igual que el que ya rige: no escribe nada. */
export function poner(b: Borrador, id: IdTope, v: number): Borrador {
  const n = Math.min(TOPE_MAX, Math.max(TOPE_MIN, Math.round(v)));
  if (esClaude(id)) {
    // Los dos topes de Claude van juntos en `reserva`: si todo queda en fábrica no se guarda nada.
    const t = { "5h": topeDe(b, "claude:5h"), "7d": topeDe(b, "claude:7d") };
    t[id === "claude:5h" ? "5h" : "7d"] = n;
    if (t["5h"] === TOPE_FABRICA && t["7d"] === TOPE_FABRICA) return { ...b, guardar: false, tope5: "", tope7: "" };
    return { ...b, guardar: true, tope5: String(t["5h"]), tope7: String(t["7d"]) };
  }
  if (id === "google:codigo") return { ...b, codigoGoogle: n === GOOGLE_CODIGO_FABRICA ? null : n };
  const p = padre(id);
  const topes = { ...b.topes };
  // Igual al que ya le toca (el del proveedor o el de fábrica): la entrada sobra.
  if (n === (p ? (b.topes[p] ?? TOPE_FABRICA) : TOPE_FABRICA)) delete topes[id];
  else topes[id] = n;
  return { ...b, topes };
}

/** Vuelve ese tope al de fábrica. */
export function restaurar(b: Borrador, id: IdTope): Borrador {
  if (id === "google:codigo") return { ...b, codigoGoogle: null };
  if (esClaude(id)) return poner(b, id, TOPE_FABRICA);
  const topes = { ...b.topes };
  const p = padre(id);
  // Un grupo de Google con el proveedor entero cambiado hereda ese valor: para volver a fábrica hay que decirlo.
  if (p && b.topes[p] !== undefined && b.topes[p] !== TOPE_FABRICA) topes[id] = TOPE_FABRICA;
  else delete topes[id];
  return { ...b, topes };
}
