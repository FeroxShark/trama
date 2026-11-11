// Con la caché vencida y un contexto grande, el primer mensaje espera a que la persona elija: seguir la misma sesión (relee todo) o empezar con
// un resumen. Un diálogo modal en un portal a <body>, del mismo estilo que DialogoCambio. El foco arranca en la opción más barata, salvo que
// esa abra otra conversación (Claude): ahí arranca en «Seguir la misma sesión», así un Enter de más no saca a nadie de su chat. Esc, el fondo o
// «Ahora no» = no se manda nada y el mensaje sigue en la caja.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Snowflake } from "lucide-react";
import { t } from "../i18n";
import type { EleccionCache, VeredictoCache } from "../../electron/cache-pregunta";

export type DatosCache = { veredicto: VeredictoCache; /** Claude abre una conversación nueva; agy sigue en la misma. */ nueva: boolean };

const mil = (n: number) => Math.max(1, Math.round(n / 1000));

export function DialogoCache({ datos, alElegir, alCancelar }: { datos: DatosCache; alElegir: (e: EleccionCache, recordar: boolean) => void; alCancelar: () => void }) {
  const id = useId();
  const [recordar, setRecordar] = useState(false);
  const resumen = useRef<HTMLButtonElement>(null);
  const seguir = useRef<HTMLButtonElement>(null);
  const check = useRef<HTMLInputElement>(null);
  const ahoraNo = useRef<HTMLButtonElement>(null);
  const { veredicto: v } = datos;
  const primera = datos.nueva ? seguir : resumen;
  useEffect(() => primera.current?.focus(), []);
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return alCancelar();
    }
    if (e.key !== "Tab") return;
    e.preventDefault();
    const a = (datos.nueva ? [seguir.current, resumen.current, check.current, ahoraNo.current] : [resumen.current, seguir.current, check.current, ahoraNo.current]).filter(Boolean) as HTMLElement[];
    const i = a.indexOf(document.activeElement as HTMLElement);
    a[(i + (e.shiftKey ? a.length - 1 : 1)) % a.length]?.focus();
  };
  const opResumen = (
    <button ref={resumen} type="button" className={datos.nueva ? "cache-op" : "cache-op cache-op-prim"} data-cache-resumen onClick={() => alElegir("resumen", recordar)}>
      <span className="cache-op-t">{t("cache.resumen")}</span>
      <span className="cache-op-d">{t("cache.resumenDet", { k: mil(v.tokensResumen) })}</span>
      {datos.nueva ? <span className="cache-op-d">{t("cache.resumenClaude")}</span> : null}
    </button>
  );
  const opSeguir = (
    <button ref={seguir} type="button" className={datos.nueva ? "cache-op cache-op-prim" : "cache-op"} data-cache-seguir onClick={() => alElegir("seguir", recordar)}>
      <span className="cache-op-t">{t("cache.seguir")}</span>
      <span className="cache-op-d">{t("cache.seguirDet", { k: mil(v.tokensSeguir) })}</span>
    </button>
  );
  return createPortal(
    <div className="cambio-fondo" data-cache onMouseDown={(e) => e.target === e.currentTarget && alCancelar()}>
      <div className="cambio cache-dialogo" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onKeyDown={tecla}>
        <h3 id={`${id}-t`} className="cambio-t">
          <Snowflake size={16} strokeWidth={2} aria-hidden="true" />
          {t("cache.titulo")}
        </h3>
        <p id={`${id}-d`} className="cambio-d">
          {t("cache.texto")}
        </p>
        <div className="cache-opciones">
          {datos.nueva ? opSeguir : opResumen}
          {datos.nueva ? opResumen : opSeguir}
        </div>
        <label className="cache-recordar">
          <input ref={check} type="checkbox" data-cache-recordar checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
          {t("cache.recordar")}
        </label>
        <div className="cambio-b">
          <button ref={ahoraNo} type="button" className="btn2" data-cache-no onClick={alCancelar}>
            {t("cache.ahoraNo")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
