// La tarjeta del cierre por cupo en el chat de un líder: «Cupo bajo: cerré en este punto». Mientras su turno sigue dice «Cerrando…»; al terminar, cuánto
// quedaba, cuándo vuelve el cupo, el resumen para retomar y el interruptor «Retomar solo cuando vuelva el cupo». Mismo molde que la del revisor
// (tarjeta-cierre.css); cada estado lleva ícono y palabra (nada depende sólo del color).
import { memo, useState } from "react";
import { FileText, PauseCircle, RotateCcw } from "lucide-react";
import type { CierreVisto } from "../../electron/cierre-chats";
import { Interruptor } from "../ui/componentes";
import { fuente } from "../datos/fuente";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { hora } from "./Hace";
import { ponerRetomar } from "./cierre-vivo";
import "./tarjeta-cierre.css";

const nombreSuscripcion = (s: string) => (s === "google" ? "Google" : s === "chatgpt" ? "ChatGPT" : "Claude");

export const TarjetaCierre = memo(function TarjetaCierre({ c }: { c: CierreVisto }) {
  useIdioma();
  const [noAbrio, setNoAbrio] = useState(false);
  const h = c.vuelve !== null ? hora(c.vuelve) : null;
  const vars = { pct: c.restante, h: h ?? "", s: nombreSuscripcion(c.proveedor) };
  const sub =
    c.fase === "cerrando"
      ? t(h ? "cierre.sub.cerrando" : "cierre.sub.cerrandoSinHora", vars)
      : c.fase === "cerrado"
        ? t(h ? "cierre.sub.cerrado" : "cierre.sub.cerradoSinHora", vars)
        : t(c.fase === "retomado" ? "cierre.sub.retomado" : "cierre.sub.volvio", vars);
  const Icono = c.fase === "retomado" || c.fase === "volvio" ? RotateCcw : PauseCircle;
  const puedeRetomar = c.fase === "cerrando" || c.fase === "cerrado";
  return (
    <section className="cq" data-fase={c.fase} aria-label={t("cierre.tarjeta")} role="status">
      <header className="cq-cab">
        <span className="cq-ico" aria-hidden="true">
          <Icono size={15} strokeWidth={2.2} />
        </span>
        <div className="cq-txt">
          <h4 className="cq-t">{t(`cierre.titulo.${c.fase}`)}</h4>
          <p className="cq-s">{sub}</p>
        </div>
      </header>
      <div className="cq-pie">
        <button
          type="button"
          className="cq-enlace"
          onClick={() => void fuente.archivoAbrir(c.relevo).then((ok) => setNoAbrio(!ok), () => setNoAbrio(true))}
          data-tip={c.relevo}
        >
          <FileText size={14} strokeWidth={2.2} aria-hidden="true" />
          {t("cierre.resumen")}
        </button>
        {puedeRetomar ? (
          <label className="cq-retomar">
            <Interruptor activo={c.retomar} alCambiar={(v) => ponerRetomar(c.sid, v)} aria-label={t(h ? "cierre.retomarHora" : "cierre.retomar", { h: h ?? "" })} />
            <span>{t(h ? "cierre.retomarHora" : "cierre.retomar", { h: h ?? "" })}</span>
          </label>
        ) : null}
      </div>
      {noAbrio ? <p className="cq-s" role="alert">{c.relevo}</p> : null}
    </section>
  );
});
