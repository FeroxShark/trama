// Los íconos de acción de una pastilla del trabajo o de una fila de llamada (mapa en ./accion-tipo.ts). Decorativos: la palabra
// del resumen o el nombre de la herramienta ya dicen lo mismo, y el estado (listo, error, corriendo) va aparte con su palabra.
import type { Uso } from "./herramientas";
import type { LucideIcon } from "lucide-react";
import { claseAccion, iconoAccion, TIPO_DE_CLAVE, tiposDe, tipoAccion, type TipoAccion } from "./accion-tipo";

export function IconoAccion({ tipo, size = 12 }: { tipo: TipoAccion; size?: number }) {
  const I = iconoAccion(tipo);
  return <I className="acc-i" size={size} strokeWidth={1.9} aria-hidden="true" data-accion={tipo} data-clase={claseAccion(tipo)} />;
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

/**
 * El ícono de una clave propia de la tarjeta de actividad o del recorrido del worker (`leer`, `correr`, `delegar`…): las que son una
 * herramienta salen del mismo mapa y el mismo color que en el chat; las que no (`pensar`, `texto`, `permiso`) traen su dibujo en `propios`, en gris.
 */
export function IconoClave({ clave, propios, className, size = 12 }: { clave: string; propios: Record<string, LucideIcon>; className: string; size?: number }) {
  const tipo = TIPO_DE_CLAVE[clave];
  const I = tipo ? iconoAccion(tipo) : (propios[clave] ?? iconoAccion("otra"));
  return <I className={className} size={size} strokeWidth={1.9} aria-hidden="true" data-clase={tipo ? claseAccion(tipo) : "neutro"} />;
}
