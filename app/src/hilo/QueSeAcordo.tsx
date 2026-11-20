// «Qué se acordó»: lo que dejó un debate entre modelos, junto al plan y antes de ejecutarlo. Tres bloques (lo acordado, quién dijo qué, lo que
// sigue sin acuerdo) y las dos salidas: seguir planeando o aprobar y ejecutar. La lógica: `resumenDebate` (debate-logica.ts). Estilos: debate.css.
import { Check, TriangleAlert } from "lucide-react";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import type { ResumenDebate } from "./debate-logica";
import "./tarjeta-revision.css";
import "./debate.css";

export function QueSeAcordo({ r, ocupado, alSeguir, alAprobar }: { r: ResumenDebate; ocupado: boolean; alSeguir: () => void; alAprobar: () => void }) {
  useIdioma();
  return (
    <section className="dbt-acordo" aria-labelledby="dbt-acordo-t">
      <header className="dbt-acordo-cab">
        <h4 id="dbt-acordo-t" className="rv-t">
          {t("debate.acordo.titulo")}
        </h4>
        <p className="rv-s">{t("debate.acordo.sub", { modelos: r.nombres.join(", "), n: r.rondas })}</p>
      </header>
      <div className="dbt-acordo-cols">
        <div className="dbt-acordo-bloque" data-k="acordado">
          <h5 className="dbt-acordo-h">
            <Check size={13} strokeWidth={2.4} aria-hidden="true" />
            {t("debate.acordo.acordado")}
          </h5>
          {r.acordado.length ? (
            <ul>
              {r.acordado.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="dbt-acordo-nada">{t("debate.acordo.nadaAcordado")}</p>
          )}
        </div>
        <div className="dbt-acordo-bloque" data-k="quien">
          <h5 className="dbt-acordo-h">{t("debate.acordo.quien")}</h5>
          <dl>
            {r.quien.map((q) => (
              <div key={q.modelo}>
                <dt>
                  <span className="dbt-av" aria-hidden="true">
                    {q.inicial}
                  </span>
                  {q.nombre}
                </dt>
                <dd>{q.dijo}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="dbt-acordo-bloque" data-k="sin">
          <h5 className="dbt-acordo-h">
            <TriangleAlert size={13} strokeWidth={2.2} aria-hidden="true" />
            {t("debate.acordo.sin")}
          </h5>
          {r.sinAcuerdo.length ? (
            <ul>
              {r.sinAcuerdo.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="dbt-acordo-nada">{t("debate.acordo.nadaSin")}</p>
          )}
        </div>
      </div>
      <div className="dbt-acordo-b">
        <button type="button" className="btn2" disabled={ocupado} onClick={alSeguir}>
          {t("plan.seguir")}
        </button>
        <button type="button" className="prim" data-texto="" disabled={ocupado} onClick={alAprobar}>
          {t("debate.aprobarEjecutar")}
        </button>
      </div>
    </section>
  );
}
