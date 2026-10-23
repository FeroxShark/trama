// El cartel de la actualización de trama, arriba del pie de la barra: "Hay una actualización
// disponible" y Reiniciar. Trama no se reinicia sola: sale cuando el usuario lo toca. Si un reinicio
// cortaría algo (un líder respondiendo o esperando a sus workers, una integración) dice a quién
// espera, por su nombre, y espera; Cancelar deja de esperar. Si lo que espera lleva 20 min sin un
// evento, además ofrece "Reiniciar igual". Lo decide el main (electron/relanzar.ts); es el mismo
// en la ventana y en el celular. Fijo: no tapa la conversación, no se cierra, no pide el foco.
import { memo } from "react";
import { fuente } from "../datos/fuente";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { useReinicio } from "../reinicio";

/** Lo que espera, en palabras: "Espera a que termine ana-ab". Sin nombres (no se sabe quién) vale la cuenta de tareas. */
function esperaDe(r: { tareas: number; espera: string[]; integrando: boolean }): string {
  const [a, b] = r.espera;
  if (r.espera.length === 1) return t("reinicio.espera.uno", { a });
  if (r.espera.length === 2) return t("reinicio.espera.dos", { a, b });
  if (r.espera.length > 2) return t("reinicio.espera.varios", { a, b, n: r.espera.length - 2 });
  if (r.integrando) return t("reinicio.espera.integracion");
  return r.tareas === 1 ? t("reinicio.espera1") : t("reinicio.esperaN", { n: r.tareas });
}

export const Reinicio = memo(function Reinicio() {
  useIdioma();
  const r = useReinicio();
  if (!r.hay) return null;
  const espera = r.pedido && !r.saliendo;
  const colgado = espera && r.colgado;
  const texto = r.saliendo ? t("reinicio.saliendo") : r.pedido ? esperaDe(r) : t("reinicio.hay");
  return (
    <div className="rei" role="status" data-espera={espera ? "" : undefined} data-colgado={colgado ? "" : undefined}>
      <span className="avc-p" aria-hidden />
      <span className="rei-t" data-tip={r.pedido || r.saliendo ? undefined : t("reinicio.tip")}>
        {texto}
        {colgado ? <span className="rei-c">{t("reinicio.colgado")}</span> : null}
      </span>
      {r.saliendo ? null : r.pedido ? (
        <span className="rei-bs">
          {colgado ? (
            <button type="button" className="btn2 rei-b" data-prim data-tip={t("reinicio.igualTip")} onClick={() => fuente.pedirReinicio(true)}>
              {t("reinicio.igual")}
            </button>
          ) : null}
          <button type="button" className="btn2 rei-b" onClick={() => fuente.cancelarReinicio()}>
            {t("reinicio.cancelar")}
          </button>
        </span>
      ) : (
        <button type="button" className="btn2 rei-b" data-prim onClick={() => fuente.pedirReinicio()}>
          {t("reinicio.boton")}
        </button>
      )}
    </div>
  );
});
