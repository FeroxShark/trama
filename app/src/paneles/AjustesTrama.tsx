// Ajustes > General: la versión de Trama que corre y "Buscar actualizaciones" (consulta ya a GitHub, sin esperar el reloj de 30 min).
// Si hay una nueva, la barra la avisa sola (el evento `trama:version`); acá sólo se muestra el resultado de esa consulta.
import { useState } from "react";
import { version as VERSION_TRAMA } from "../../package.json";
import { fuente, type BuscadaTrama } from "../datos/fuente";
import { t } from "../i18n";

type Estado = { paso: "quieta" } | { paso: "buscando" } | { paso: "resultado"; r: BuscadaTrama };

function textoBusqueda(e: Estado): string {
  if (e.paso === "quieta") return "";
  if (e.paso === "buscando") return t("ajustes.tramaBuscando");
  if (!e.r.ultima) return t("ajustes.tramaNoSe");
  return e.r.nueva ? t("ajustes.tramaNueva", { v: e.r.ultima }) : t("ajustes.tramaAlDia");
}

export function TramaVersion() {
  const [estado, setEstado] = useState<Estado>({ paso: "quieta" });
  const buscar = () => {
    setEstado({ paso: "buscando" });
    void fuente.buscarTrama().then(
      (r) => setEstado({ paso: "resultado", r }),
      () => setEstado({ paso: "resultado", r: { ultima: null, nueva: false } }),
    );
  };
  return (
    <div className="pn-acciones-btns">
      <span className="pn-estado">{VERSION_TRAMA}</span>
      <button type="button" className="btn2" disabled={estado.paso === "buscando"} onClick={buscar}>
        {t("ajustes.tramaBuscar")}
      </button>
      <span className="pn-car-estado" role="status" aria-live="polite" aria-atomic="true">
        {textoBusqueda(estado)}
      </span>
    </div>
  );
}
