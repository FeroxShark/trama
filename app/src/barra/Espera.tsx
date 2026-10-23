// La marca de "te espera" (electron/espera.ts): un punto y la palabra, en el acento de "Te necesita". Igual en la fila de la barra,
// en la cabecera de la conversación y en la lista del celular. Sin animación: es un estado, no algo que corre.
import { memo } from "react";
import type { EsperaLider } from "../datos/contrato";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";

export const ChipEspera = memo(function ChipEspera({ espera, className }: { espera: EsperaLider; className?: string }) {
  useIdioma();
  return (
    <span className={className ? `te-espera ${className}` : "te-espera"} data-espera={espera.motivo} data-tip={t(espera.motivo === "pide" ? "espera.pide" : "espera.listo")}>
      <i />
      {t("espera.chip")}
    </span>
  );
});
