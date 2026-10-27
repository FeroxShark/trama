import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Selector, type Opcion } from "../hilo/Selector";
import { t } from "../i18n";

/** Grupo de ajustes estilo lista agrupada de macOS: título de sección y tarjeta con bordes suaves. */
export function GrupoAjustes({
  titulo,
  subtitulo,
  children,
  className,
  ref,
}: {
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  children: ReactNode;
  className?: string;
  ref?: React.Ref<HTMLElement>;
}) {
  return (
    <section ref={ref} className={`aj-grupo ${className ?? ""}`.trim()}>
      {titulo || subtitulo ? (
        <div className="aj-grupo-cab">
          {titulo ? <h3 className="aj-grupo-tit">{titulo}</h3> : null}
          {subtitulo ? <p className="aj-grupo-sub">{subtitulo}</p> : null}
        </div>
      ) : null}
      <div className="aj-grupo-card">{children}</div>
    </section>
  );
}

/**
 * Fila de ajuste de un renglón: ícono opcional, título corto, subtítulo opcional de ayuda, botón (i) para
 * desplegar el detalle largo, y el control a la derecha. Soporta `data-opc` para que el buscador de
 * ajustes la encuentre y la resalte.
 */
export function FilaAjuste({
  opc,
  icono,
  titulo,
  ayuda,
  detalle,
  alerta,
  control,
  children,
  className,
}: {
  opc?: string;
  icono?: ReactNode;
  titulo: ReactNode;
  ayuda?: ReactNode;
  detalle?: ReactNode;
  alerta?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const ctrl = control;

  return (
    <div className={`aj-fila ${className ?? ""}`.trim()} data-opc={opc}>
      <div className="aj-fila-cuerpo">
        {icono ? <span className="aj-fila-ico" aria-hidden="true">{icono}</span> : null}
        <div className="aj-fila-txt">
          <div className="aj-fila-tit-fila">
            <span className="aj-fila-tit">{titulo}</span>
            {detalle ? (
              <button
                type="button"
                className="aj-info-btn"
                aria-expanded={abierto}
                aria-label={t("ajustes.infoAria")}
                title={t("ajustes.infoAria")}
                onClick={() => setAbierto((v) => !v)}
              >
                <Info size={13} strokeWidth={2.2} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {ayuda ? <div className="aj-fila-ayuda">{ayuda}</div> : null}
        </div>
        {ctrl ? <div className="aj-fila-ctrl">{ctrl}</div> : null}
      </div>
      {abierto && detalle ? (
        <div className="aj-fila-detalle" role="region" aria-label={typeof titulo === "string" ? titulo : undefined}>
          {detalle}
        </div>
      ) : null}
      {children ? <div className="aj-fila-pie">{children}</div> : null}
      {alerta ? <div className="aj-fila-alerta">{alerta}</div> : null}
    </div>
  );
}

/**
 * Selector desplegable para Ajustes: sus opciones se leen enteras, con ícono, nombre
 * y frase corta sin puntos suspensivos.
 */
export function AjusteSelector(props: Parameters<typeof Selector>[0]) {
  return <Selector {...props} enteras />;
}

export type { Opcion };
