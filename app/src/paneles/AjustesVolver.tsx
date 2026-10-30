// Ajustes > General > "Versión anterior" (Actualizar seguro): el botón "Volver a la versión anterior". Trama guarda la versión que andaba
// antes de actualizar (electron/version-anterior.ts); acá se vuelve a ella a pedido, con una confirmación que dice qué se corta.
// La fila no existe donde la ventana no maneja versiones (el navegador, el celular): `versionAnterior()` contesta null.
import { useEffect, useRef, useState } from "react";
import { fuente } from "../datos/fuente";
import { t } from "../i18n";
import type { FilaDato } from "./AjustesEditar";

type Paso = { paso: "quieta" } | { paso: "confirmar" } | { paso: "volviendo" } | { paso: "error"; texto: string };

export function VolverVersion({ Dato }: { Dato: FilaDato }) {
  const [info, setInfo] = useState<{ version: string | null } | null | undefined>(undefined);
  const [estado, setEstado] = useState<Paso>({ paso: "quieta" });
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    void fuente.versionAnterior().then((x) => vivo.current && setInfo(x));
    return () => void (vivo.current = false);
  }, []);
  if (!info) return null;
  const v = info.version;

  const volver = () => {
    setEstado({ paso: "volviendo" });
    void fuente.volverAVersionAnterior().then((r) => {
      if (!vivo.current) return;
      // Si salió bien Trama se reinicia: esta página se va sola.
      if (!r.ok) setEstado({ paso: "error", texto: t("ajustes.volverError", { m: r.error || "?" }) });
    });
  };

  return (
    <Dato nombre="ajustes.volverVersion" que="ajustes.volverVersionQue">
      <div className="pn-car-col">
        <div className="pn-car-estado" role="status" aria-live="polite" aria-atomic="true">
          {estado.paso === "volviendo" && v ? t("ajustes.volviendo", { v }) : v ? t("ajustes.volverGuardada", { v }) : t("ajustes.volverNinguna")}
        </div>
        {estado.paso === "confirmar" && v ? <div className="pn-nota">{t("ajustes.volverAviso")}</div> : null}
        {estado.paso === "error" ? (
          <div className="pn-error" role="alert">
            {estado.texto}
          </div>
        ) : null}
        <div className="pn-acciones-btns">
          {estado.paso === "confirmar" && v ? (
            <>
              <button type="button" className="btn2" onClick={volver}>
                {t("ajustes.volverConfirmar", { v })}
              </button>
              <button type="button" className="btn2" onClick={() => setEstado({ paso: "quieta" })}>
                {t("carcasa.cancelar")}
              </button>
            </>
          ) : (
            <button type="button" className="btn2" disabled={!v || estado.paso === "volviendo"} onClick={() => setEstado({ paso: "confirmar" })}>
              {t("ajustes.volverBtn")}
            </button>
          )}
        </div>
      </div>
    </Dato>
  );
}
