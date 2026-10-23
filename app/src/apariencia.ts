// Tamaño de letra y fuentes, la parte que toca el resto de la app (lo puro está
// en tipografia.ts): guardar lo elegido, los atajos de teclado y avisarle a la
// lista virtualizada que sus filas cambiaron de alto.
import { olvidarAlto } from "./barra/ventana";
import { fuente } from "./datos/fuente";
import { alCambiarApariencia, apariencia, atajoLetra, cambiarApariencia, LETRA_DEF, pasoLetra, type Apariencia } from "./tipografia";

/** Se aplica al toque y, si cambió algo, va a preferencias.json. */
export function elegirApariencia(cambio: Partial<Apariencia>) {
  const dif = cambiarApariencia(cambio);
  if (dif) fuente.guardarApariencia(dif);
}

alCambiarApariencia(olvidarAlto);

// Ctrl+= / Ctrl+- / Ctrl+0, desde cualquier lado (también escribiendo). El
// preventDefault es lo que frena el zoom propio de Chromium: acá agrandar es
// cambiar la letra, no la escala de la página.
addEventListener(
  "keydown",
  (e) => {
    const d = atajoLetra(e);
    if (d === null) return;
    e.preventDefault();
    elegirApariencia({ letra: d === 0 ? LETRA_DEF : pasoLetra(apariencia().letra, d) });
  },
  true,
);
