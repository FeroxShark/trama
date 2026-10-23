// "Leyendo la conversación…": lo que se ve mientras se lee el transcript de un worker o de un líder,
// en vez de una conversación vacía que parece que no hay nada. Quieto: sin animación que cueste CPU.
import { useIdioma } from "../i18n/react";
import { t as tr } from "../i18n";

export function Leyendo() {
  useIdioma();
  return (
    <div className="conv-leyendo" role="status">
      {tr("vista.leyendo")}
    </div>
  );
}
