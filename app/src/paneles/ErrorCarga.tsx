// Cuando un panel no pudo cargar: el motivo en una línea (una frase simple si es de los errores
// conocidos de `pa`/`claude`, si no lo que dijo, tal cual; el texto entero va en el tooltip) y un
// Reintentar que vuelve a pedirlo. Sin esto el panel quedaba mudo, con el error y sin salida.
import { t, textoError, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";

export function ErrorCarga({ error, alReintentar }: { error: string; alReintentar: () => void }) {
  useIdioma();
  const crudo = textoMain(error);
  const frase = textoError(error);
  return (
    <div className="pn-aviso pn-falla" data-error="" role="alert">
      <span className="pn-falla-t" data-tip={frase !== crudo || crudo.length > 80 ? crudo : undefined}>
        {frase}
      </span>
      <button type="button" className="mini" onClick={alReintentar}>
        {t("panel.reintentar")}
      </button>
    </div>
  );
}
