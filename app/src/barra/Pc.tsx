// "PC apagada · Prender", "Prendiendo…", "PC prendida · Abrir": sólo en la trama del Dell, arriba del pie de la
// barra. Prender manda el paquete (Wake-on-LAN, `prender-pc` en el Dell); la PC contesta cuando ya inició sesión y
// trama está arriba, así que puede tardar. Abrir lleva a la trama de la PC en el navegador. En la PC no existe.
import { memo } from "react";
import { fuente } from "../datos/fuente";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { usePc } from "../pc";

export const Pc = memo(function Pc() {
  useIdioma();
  const pc = usePc();
  if (!pc) return null;
  const { estado, nombre } = pc;
  return (
    <div className="pcx" data-estado={estado}>
      <div className="pcx-f" role="status">
        <span className="pcx-p" aria-hidden="true" />
        <span className="pcx-t">{t(estado === "apagada" ? "pc.apagada" : estado === "prendiendo" ? "pc.prendiendo" : "pc.prendida", { nombre })}</span>
        {estado === "apagada" ? (
          <button type="button" className="btn2 pcx-b" data-prim data-tip={t("pc.prenderTip", { nombre })} onClick={() => fuente.prenderPc()}>
            {t("pc.prender")}
          </button>
        ) : estado === "prendida" ? (
          <a className="btn2 pcx-b" data-prim href={pc.url} target="_blank" rel="noopener noreferrer" data-tip={t("pc.abrirTip", { nombre })}>
            {t("pc.abrir")}
          </a>
        ) : null}
      </div>
      {estado === "apagada" && pc.error ? (
        <div className="pcx-e" role="alert" data-tip={textoMain(pc.error)}>
          {t("pc.fallo", { e: textoMain(pc.error) })}
        </div>
      ) : null}
    </div>
  );
});
