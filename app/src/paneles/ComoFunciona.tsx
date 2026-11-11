// «Cómo funciona»: la explicación larga de un panel de Ajustes, plegada detrás de un botón (mismo gesto que «Cómo funcionan estos límites» de
// Plan y cupos). Se toca para abrir; el texto sólo se monta abierto, así que el buscador de Ajustes no depende de él (busca por las claves de `ITEMS`).
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";

export function ComoFunciona({ children, className }: { children: ReactNode; className?: string }) {
  useIdioma();
  const [abierta, setAbierta] = useState(false);
  const id = useId();
  return (
    <div className={className ? `pn-como ${className}` : "pn-como"} data-como-funciona data-abierta={abierta ? "" : undefined}>
      <button type="button" className="pn-como-b" aria-expanded={abierta} aria-controls={id} onClick={() => setAbierta((a) => !a)}>
        <Info size={13} strokeWidth={2} aria-hidden="true" />
        <span>{t("pn.comoFunciona")}</span>
        <ChevronDown className="pn-como-f" size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {abierta ? (
        <div id={id} className="pn-como-t">
          {children}
        </div>
      ) : null}
    </div>
  );
}
