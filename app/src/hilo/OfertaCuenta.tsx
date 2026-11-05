// Cuando la cuenta con que corre un chat llega al tope (ámbar desde 80 %, rojo sin cupo) y otra cuenta de Claude tiene lugar, el chat lo dice y ofrece
// pasar a esa. Sólo ofrece: el chat sigue con su cuenta hasta que la persona toca el botón (Trama no cambia de cuenta sola). Va pegada a la caja de escritura,
// con ícono y palabras (no sólo el color); el botón mide 44 px con dedo. La cuenta que se ofrece sale de `ofertaDeCambio` (barra/cupos-riel-logica.ts).
import { CircleX, TriangleAlert } from "lucide-react";
import { Boton } from "../ui/componentes";
import { t } from "../i18n";
import type { OfertaCambio } from "../barra/cupos-riel-logica";
import "./oferta-cuenta.css";

export function OfertaCuenta({ oferta, alPasar, deshabilitado }: { oferta: OfertaCambio; alPasar: () => void; deshabilitado?: boolean }) {
  const { actual, otra, nivel, ventana } = oferta;
  const v = ventana === "7d" ? actual.sem : actual.h5;
  const nombreVentana = ventana === "7d" ? t("oferta.cuenta.v7d") : t("oferta.cuenta.v5h");
  const titulo = nivel === "rojo" ? t("oferta.cuenta.sin", { cuenta: actual.nombre, ventana: nombreVentana }) : t("oferta.cuenta.poco", { cuenta: actual.nombre, ventana: nombreVentana, pct: Math.round(v.pct ?? 0) });
  const Icono = nivel === "rojo" ? CircleX : TriangleAlert;
  return (
    <div className="oferta-cuenta" data-nivel={nivel} role="status">
      <Icono size={16} strokeWidth={2} aria-hidden="true" />
      <p>
        <b>{titulo}</b> {t("oferta.cuenta.otra", { otra: otra.nombre })}
      </p>
      <Boton className="oferta-cuenta-pasar" disabled={deshabilitado} data-tip={deshabilitado ? t("oferta.cuenta.ocupado") : undefined} onClick={alPasar}>
        {t("oferta.cuenta.pasar", { otra: otra.nombre })}
      </Boton>
    </div>
  );
}
