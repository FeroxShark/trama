// Trama en dos máquinas (docs/estado/maquinas.md): de cuál es cada líder y qué pasa con la otra. El ícono sale sólo
// si hay más de una máquina configurada (con una sola, nada cambia) y el aviso sólo si la otra no está del todo bien:
// "sin conexión" (sus filas no están) u "otra versión · sólo lectura" (se ven, pero nada se le manda).
import { memo } from "react";
import { Monitor, Server } from "lucide-react";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { conAviso, hayVarias, nombreMaquina, useMaquinas } from "../maquinas";

/** La máquina de esta trama es la PC; la otra, un servidor. */
const Icono = ({ id, size }: { id: string; size: number }) =>
  id === "pc" ? <Monitor size={size} strokeWidth={2} aria-hidden /> : <Server size={size} strokeWidth={2} aria-hidden />;

/** El ícono de la fila de un líder: de qué máquina es (`maquina`: la de la fila; sin venir, la de esta trama). */
export const IconoMaquina = memo(function IconoMaquina({ maquina }: { maquina: string | undefined }) {
  useIdioma();
  const m = useMaquinas();
  if (!hayVarias(m)) return null;
  const id = maquina ?? m.esta.id;
  const que = t("maquina.de", { maquina: nombreMaquina(m, maquina) });
  return (
    <span className="maq" role="img" aria-label={que} data-tip={que} data-maquina={id}>
      <Icono id={id} size={11} />
    </span>
  );
});

/** En la cabecera de lo abierto: el ícono con el nombre de su máquina. */
export const MaquinaMigas = memo(function MaquinaMigas({ maquina }: { maquina: string | undefined }) {
  useIdioma();
  const m = useMaquinas();
  if (!hayVarias(m)) return null;
  const id = maquina ?? m.esta.id;
  return (
    <span className="maq-m" data-maquina={id}>
      <Icono id={id} size={12} />
      {nombreMaquina(m, maquina)}
    </span>
  );
});

/** Arriba del pie de la barra, junto al cartel de la actualización: una línea por máquina que no está del todo bien. */
export const AvisoMaquinas = memo(function AvisoMaquinas() {
  useIdioma();
  const m = useMaquinas();
  const avisos = conAviso(m);
  if (avisos.length === 0) return null;
  return (
    <>
      {avisos.map((o) => {
        const lectura = o.estado === "soloLectura";
        return (
          <div key={o.id} className="maq-av" role="status" data-estado={lectura ? "lectura" : "caida"} data-maquina-aviso={o.id}>
            <span className="maq-av-p" aria-hidden />
            <span className="maq-av-t" data-tip={t(lectura ? "maquina.soloLecturaTip" : "maquina.sinConexionTip", { maquina: o.nombre })}>
              {t(lectura ? "maquina.soloLectura" : "maquina.sinConexion", { maquina: o.nombre })}
            </span>
          </div>
        );
      })}
    </>
  );
});
