// Los íconos de acción de una pastilla del trabajo o de una fila de llamada (mapa en ./accion-tipo.ts). Decorativos: la palabra
// del resumen o el nombre de la herramienta ya dicen lo mismo, y el estado (listo, error, corriendo) va aparte con su palabra.
import type { Uso } from "./herramientas";
import { iconoAccion, tiposDe, tipoAccion, type TipoAccion } from "./accion-tipo";

export function IconoAccion({ tipo, size = 12 }: { tipo: TipoAccion; size?: number }) {
  const I = iconoAccion(tipo);
  return <I className="acc-i" size={size} strokeWidth={2} aria-hidden="true" data-accion={tipo} />;
}

/** Hasta tres tipos presentes en las llamadas de una pastilla. */
export function IconosAccion({ usos }: { usos: Pick<Uso, "nombre" | "det">[] }) {
  const tipos = tiposDe(usos);
  if (!tipos.length) return null;
  return (
    <span className="acc-g" aria-hidden="true">
      {tipos.map((k) => (
        <IconoAccion key={k} tipo={k} />
      ))}
    </span>
  );
}

/** El ícono de una sola llamada. */
export const IconoLlamada = ({ u }: { u: Pick<Uso, "nombre" | "det"> }) => <IconoAccion tipo={tipoAccion(u)} />;
