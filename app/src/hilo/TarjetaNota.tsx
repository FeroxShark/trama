// Tarjeta de nota para no perder al compactar (`[[nota-compactar]]…[[/nota-compactar]]`):
// mientras streamea muestra un estado vivo; cerrada aparece plegada en 1 línea (secciones y palabras)
// y se despliega al hacer clic o al pulsar «Ver la nota» desde el divisor de compactación.
import { useEffect, useState } from "react";
import { ChevronRight, LoaderCircle, ScrollText } from "lucide-react";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { suscribirAbrirNota, type NotaCompactar } from "./nota-compactar.ts";
import { Texto } from "./Texto";
import "./tarjeta-revision.css";
import "./tarjeta-nota.css";

function textoResumen(secciones: number, palabras: number): string {
  const pal = palabras === 1 ? t("nota.unaPalabra") : t("nota.palabras", { n: palabras });
  if (secciones <= 0) return pal;
  const sec = secciones === 1 ? t("nota.unaSeccion") : t("nota.secciones", { n: secciones });
  return `${sec} · ${pal}`;
}

export function TarjetaNota({ nota, turnoKey }: { nota: NotaCompactar; turnoKey: string }) {
  useIdioma();
  const [abierta, setAbierta] = useState(false);

  useEffect(() => {
    if (!nota.cerrada) return;
    return suscribirAbrirNota(turnoKey, () => setAbierta(true));
  }, [nota.cerrada, turnoKey]);

  const resumen = textoResumen(nota.secciones, nota.palabras);

  if (!nota.cerrada) {
    return (
      <section className="rv nota-comp nota-viva" data-nota={turnoKey} aria-label={t("nota.escribiendo")}>
        <header className="rv-cab">
          <span className="rv-ico" aria-hidden="true">
            <LoaderCircle className="gira" size={14} strokeWidth={2} />
          </span>
          <div className="rv-txt">
            <h4 className="rv-t">{t("nota.escribiendo")}</h4>
            {nota.palabras > 0 ? <p className="rv-s">{textoResumen(nota.secciones, nota.palabras)}</p> : null}
          </div>
        </header>
      </section>
    );
  }

  return (
    <details
      className="rv nota-comp"
      data-nota={turnoKey}
      open={abierta}
      onToggle={(e) => setAbierta(e.currentTarget.open)}
    >
      <summary className="rv-cab nota-cab">
        <span className="rv-ico" aria-hidden="true">
          <ScrollText size={14} strokeWidth={1.85} />
        </span>
        <div className="rv-txt">
          <h4 className="rv-t">{t("nota.titulo")}</h4>
          <p className="rv-s">{resumen}</p>
        </div>
        <ChevronRight className="nota-ch" size={13} strokeWidth={2} aria-hidden="true" />
      </summary>
      {abierta ? (
        <div className="nota-cuerpo">
          <Texto texto={nota.nota} />
        </div>
      ) : null}
    </details>
  );
}
