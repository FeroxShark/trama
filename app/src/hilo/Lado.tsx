// El botón de la izquierda de las migas (vista de hilo y paneles): muestra u oculta la barra.
// En el celular (src/angosto.ts) no hay barra al lado: es la flecha que vuelve a la lista.
import { ArrowLeft, PanelLeft } from "lucide-react";
import { useAngosto } from "../angosto";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";

/** `etq`: lo que dice en el escritorio (mostrar u ocultar la barra). */
export function Lado({ etq, alAlternar }: { etq: string; alAlternar: () => void }) {
  useIdioma();
  const angosto = useAngosto();
  const dice = angosto ? t("comun.aLista") : etq;
  return (
    <button type="button" className="lado" data-desliza aria-label={dice} data-tip={dice} onClick={alAlternar}>
      {angosto ? <ArrowLeft size={18} strokeWidth={1.8} /> : <PanelLeft size={16} strokeWidth={1.8} />}
    </button>
  );
}
