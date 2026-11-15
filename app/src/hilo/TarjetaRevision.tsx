// La revisión de un plan hecha por otro modelo, como tarjeta en el chat (el mensaje que recibió el líder, con su marca: ver
// electron/revision-plan-texto.ts). Cada sección lleva ícono y palabra (nada depende sólo del color); el plan mejorado va plegado.
import { memo } from "react";
import { Check, Lightbulb, ScanSearch, TriangleAlert } from "lucide-react";
import type { RevisionVista } from "../../electron/revision-plan-texto";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Texto } from "./Texto";
import "./tarjeta-revision.css";

export const TarjetaRevision = memo(function TarjetaRevision({ r }: { r: RevisionVista }) {
  useIdioma();
  const secciones = [
    { k: "bien", ico: <Check size={13} strokeWidth={2.4} />, texto: r.bien },
    { k: "riesgos", ico: <TriangleAlert size={13} strokeWidth={2.2} />, texto: r.riesgos },
    { k: "mejoras", ico: <Lightbulb size={13} strokeWidth={2.2} />, texto: r.mejoras },
  ] as const;
  return (
    <section className="rv" aria-label={t("revision.tarjeta", { modelo: r.nombre })}>
      <header className="rv-cab">
        <span className="rv-ico" aria-hidden="true">
          <ScanSearch size={15} strokeWidth={2.2} />
        </span>
        <div className="rv-txt">
          <h4 className="rv-t">{t("revision.tarjeta", { modelo: r.nombre })}</h4>
          <p className="rv-s">{t("revision.subtitulo")}</p>
        </div>
      </header>
      {r.libre ? (
        <div className="rv-sec">
          <h5 className="rv-h">{t("revision.libre")}</h5>
          <Texto texto={r.libre} />
        </div>
      ) : (
        <>
          {secciones.map((s) => (
            <div key={s.k} className="rv-sec" data-k={s.k}>
              <h5 className="rv-h">
                {s.ico}
                {t(`revision.${s.k}`)}
              </h5>
              {s.texto ? <Texto texto={s.texto} /> : <p className="rv-nada">{t("revision.nada")}</p>}
            </div>
          ))}
          {r.plan ? (
            <details className="rv-plan">
              <summary>{t("revision.plan")}</summary>
              <Texto texto={r.plan} />
            </details>
          ) : null}
        </>
      )}
    </section>
  );
});
