// El esqueleto de un panel de Ajustes mientras carga su estado: una tarjeta con filas de barras que brillan. Aparece recién a los
// 150 ms (si el estado llega antes, no se ve nada: sin parpadeo) y reserva el alto de una tarjeta de verdad.
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";

const DEMORA_MS = 150;
const FILAS = [
  ["38%", "62%", "5.5rem"],
  ["30%", "50%", "7rem"],
  ["44%", "68%", "4rem"],
] as const;

/** `enLinea`: el esqueleto de un pedazo lento dentro de un panel que ya está a la vista (sin tarjeta propia: el panel ya la tiene). */
export function PanelCargando({ enLinea = false }: { enLinea?: boolean }) {
  useIdioma();
  const [ver, setVer] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setVer(true), DEMORA_MS);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <section className={enLinea ? "pn-cargando pn-cargando-linea" : "pn-sec pn-cargando"} role="status" aria-busy="true" data-visible={ver || undefined}>
      <span className="oculto">{t("ajustes.cargando")}</span>
      {ver && (
        <div className="pn-cargando-filas" aria-hidden>
          <div className="pn-cargando-h pn-cargando-barra" />
          {FILAS.map(([a, b, c], i) => (
            <div className="pn-cargando-fila" key={i}>
              <div className="pn-cargando-txt">
                <div className="pn-cargando-barra" style={{ width: a }} />
                <div className="pn-cargando-barra" data-fina style={{ width: b }} />
              </div>
              <div className="pn-cargando-barra" data-ctl style={{ width: c }} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
