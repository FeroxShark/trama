// Plan y cupos > «Cierre ordenado»: cuando a una suscripción le queda poco cupo, cada trabajo de esa suscripción cierra ordenado (electron/cierre-cupo.ts).
// Trabaja sobre el borrador de AjustesModelos (nada se escribe hasta Guardar; Cancelar vuelve a lo guardado). El umbral se valida con `validarCierre`.
import { useEffect, useRef, useState } from "react";
import { MODO } from "../modo";
import { PauseCircle } from "lucide-react";
import { Interruptor } from "../ui/componentes";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import type { FilaDato } from "./AjustesEditar";
import type { Borrador } from "./modelos-borrador";
import { cierreDe, ponerCierre, UMBRAL_CIERRE_MAX, UMBRAL_CIERRE_MIN, umbralDeTexto } from "./cupos-cierre";

export function AjustesCierre({ Dato, b, cambiar }: { Dato: FilaDato; b: Borrador; cambiar: (b: Borrador) => void }) {
  useIdioma();
  const c = cierreDe(b);
  const [texto, setTexto] = useState(String(c.umbral));
  // Si de afuera cambia el valor (Cancelar, guardado), el campo lo sigue; mientras se escribe algo inválido no se pisa.
  useEffect(() => {
    if (umbralDeTexto(texto).valor !== c.umbral && umbralDeTexto(texto).error === null) setTexto(String(c.umbral));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.umbral]);
  const r = umbralDeTexto(texto);
  // Captura `ajustes-cierre`: el bloque a la vista.
  const raiz = useRef<HTMLElement>(null);
  useEffect(() => {
    if (MODO.captura === "ajustes-cierre") raiz.current?.scrollIntoView({ block: "center" });
  }, []);
  const poner = (x: string) => {
    setTexto(x);
    const u = umbralDeTexto(x);
    if (u.error === null) cambiar(ponerCierre(b, "umbral", u.valor ?? 5));
  };
  return (
    <section ref={raiz} className="pn-sec pn-edita cu-cierre" data-opc="ajustes.cierre">
      <h3 className="pn-h">{t("ajustes.cierre")}</h3>
      <div className="cu-av-q">{t("ajustes.cierreQue")}</div>
      <Dato nombre="ajustes.cierreActivo" que="ajustes.cierreActivoQue" icono={<PauseCircle size={16} strokeWidth={2} aria-hidden="true" />}>
        <div className="pn-sel">
          <Interruptor activo={c.activo} aria-label={t("ajustes.cierreActivo")} alCambiar={(v) => cambiar(ponerCierre(b, "activo", v))} />
        </div>
      </Dato>
      <Dato nombre="ajustes.cierreUmbral" que="ajustes.cierreUmbralQue">
        <div className="pn-sel">
          <div className="pn-campo-fila">
            <input
              id="aj-cierre-umbral"
              className="pn-campo pn-campo-num"
              type="number"
              inputMode="numeric"
              min={UMBRAL_CIERRE_MIN}
              max={UMBRAL_CIERRE_MAX}
              step={1}
              value={texto}
              disabled={!c.activo}
              aria-label={t("ajustes.cierreUmbral")}
              aria-invalid={!!r.error}
              aria-describedby={r.error ? "aj-cierre-umbral-e" : undefined}
              onChange={(e) => poner(e.target.value)}
            />
            <span>{t("ajustes.cierreUmbralPct")}</span>
          </div>
          {r.error ? (
            <p id="aj-cierre-umbral-e" className="pn-error" role="alert">
              {r.error === "ajustes.errCierreUmbral" ? t("ajustes.errCierreUmbral", { min: UMBRAL_CIERRE_MIN, max: UMBRAL_CIERRE_MAX }) : t("ajustes.errCierreForma")}
            </p>
          ) : null}
        </div>
      </Dato>
      <Dato nombre="ajustes.cierreRetomar" que="ajustes.cierreRetomarQue">
        <div className="pn-sel">
          <Interruptor activo={c.retomar_solo} disabled={!c.activo} aria-label={t("ajustes.cierreRetomar")} alCambiar={(v) => cambiar(ponerCierre(b, "retomar_solo", v))} />
        </div>
      </Dato>
    </section>
  );
}
