import { useEffect, useState } from "react";
import { t } from "./i18n";
import { useIdioma } from "./i18n/react";
import { MODO } from "./modo";
import { main } from "./puente";

/**
 * Por la tailnet (el celular): se cayó la conexión con la PC y el puente la está reintentando
 * (electron/remoto-cliente.ts). Vuelve sola; al volver, la página se pone al día o se recarga.
 * En la ventana de la PC aparece sólo si es cliente del motor (electron/ventana-cliente.ts) y el motor se
 * fue (se reinicia, lo mataron): vuelve sola, igual.
 */
export function Conexion() {
  useIdioma();
  const [caida, setCaida] = useState(MODO.captura === "conexion");
  useEffect(() => main?.conexion?.alCambiar((ok) => setCaida(ok === false)), []);
  return (
    <div className="cx" data-caida={caida || undefined} role="status" aria-hidden={!caida}>
      {t(MODO.cliente ? "remoto.reconectandoMotor" : "remoto.reconectando")}
    </div>
  );
}
