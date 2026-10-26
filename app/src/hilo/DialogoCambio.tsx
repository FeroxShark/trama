// Confirmación de seguir la conversación con un modelo de OTRO motor: un diálogo modal en un portal a <body>, encima del selector (que
// sigue abierto debajo) y antes de que el chip cambie. El foco queda atrapado entre sus dos botones; Esc, el fondo o "Mantener" = no cambia.
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft } from "lucide-react";
import { t } from "../i18n";

export type DatosCambio = { modelo: string; motor: string; actual: string; motorActual: string };

export function DialogoCambio({ datos, alSi, alNo }: { datos: DatosCambio; alSi: () => void; alNo: () => void }) {
  const id = useId();
  const no = useRef<HTMLButtonElement>(null);
  const si = useRef<HTMLButtonElement>(null);
  // El foco arranca en "Mantener": Enter por costumbre no cambia nada.
  useEffect(() => no.current?.focus(), []);
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return alNo();
    }
    if (e.key !== "Tab") return;
    e.preventDefault();
    const a = [no.current, si.current].filter(Boolean) as HTMLElement[];
    const i = a.indexOf(document.activeElement as HTMLElement);
    a[(i + (e.shiftKey ? a.length - 1 : 1)) % a.length]?.focus();
  };
  return createPortal(
    <div className="cambio-fondo" data-cambio onMouseDown={(e) => e.target === e.currentTarget && alNo()}>
      <div className="cambio" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onKeyDown={tecla}>
        <h3 id={`${id}-t`} className="cambio-t">
          <ArrowRightLeft size={16} strokeWidth={2} aria-hidden="true" />
          {t("lider.cruceTitulo", { modelo: datos.modelo })}
        </h3>
        <p id={`${id}-d`} className="cambio-d">
          {t("lider.cruceTexto", { motor: datos.motor, motorActual: datos.motorActual })}
        </p>
        <div className="cambio-b">
          <button ref={no} type="button" className="btn2 cambio-no" data-cruce-no onClick={alNo}>
            {t("lider.cruceNo", { actual: datos.actual })}
          </button>
          <button ref={si} type="button" className="btn2 cambio-si" data-cruce-si onClick={alSi}>
            {t("lider.cruceSi")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
