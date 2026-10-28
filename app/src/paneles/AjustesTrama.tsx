// Ajustes > Actualizaciones fuera de Windows (Linux, el celular): la versión de Trama y "Buscar actualizaciones" (consulta ya a GitHub,
// sin esperar el reloj). Es la misma forma que la de Windows (AjustesCarcasa.tsx), pero sin "Quitar restos". Si hay una nueva, la barra
// la avisa sola con su Actualizar (el evento `trama:version`); acá sólo se muestra el resultado de esa consulta.
import { useState } from "react";
import { version as VERSION_TRAMA } from "../../package.json";
import { fuente, type BuscadaTrama } from "../datos/fuente";
import { MODO } from "../modo";
import { t } from "../i18n";
import type { FilaDato } from "./AjustesEditar";

type Estado = { paso: "quieta" } | { paso: "buscando" } | { paso: "resultado"; r: BuscadaTrama };

// Las capturas (`HILOS_VARIANTE=trama-al-dia|trama-nueva`) arrancan con el resultado ya puesto: el botón no hace falta.
const estadoInicial = (): Estado => {
  if (MODO.captura !== "ajustes") return { paso: "quieta" };
  if (MODO.variante === "trama-al-dia") return { paso: "resultado", r: { ultima: VERSION_TRAMA, nueva: false } };
  if (MODO.variante === "trama-nueva") return { paso: "resultado", r: { ultima: "0.2.16", nueva: true } };
  return { paso: "quieta" };
};

function textoBusqueda(e: Estado): string {
  if (e.paso === "quieta") return "";
  if (e.paso === "buscando") return t("carcasa.buscando");
  if (!e.r.ultima) return t("ajustes.tramaNoSe");
  return e.r.nueva ? t("ajustes.tramaNueva", { v: e.r.ultima }) : t("carcasa.alDia", { v: VERSION_TRAMA });
}

export function TramaActualizaciones({ Dato }: { Dato: FilaDato }) {
  const [estado, setEstado] = useState<Estado>(estadoInicial);
  const buscar = () => {
    setEstado({ paso: "buscando" });
    void fuente.buscarTrama().then(
      (r) => setEstado({ paso: "resultado", r }),
      () => setEstado({ paso: "resultado", r: { ultima: null, nueva: false } }),
    );
  };
  return (
    <section className="pn-sec pn-edita">
      <div className="pn-estado">{t("carcasa.version", { v: VERSION_TRAMA })}</div>

      <Dato nombre="carcasa.act" que="ajustes.tramaActQue">
        <div className="pn-car-col">
          <div className="pn-acciones-btns">
            <button type="button" className="btn2" disabled={estado.paso === "buscando"} onClick={buscar}>
              {t("carcasa.buscar")}
            </button>
          </div>
          <div className="pn-car-estado" role="status" aria-live="polite" aria-atomic="true">
            {textoBusqueda(estado)}
          </div>
        </div>
      </Dato>
    </section>
  );
}
