// La línea de debajo de la lista del selector de modelo: qué trae el motor del proveedor abierto (skills, MCP, subagentes, imágenes).
// Los datos salen de la tabla de motor-capacidades.ts; acá sólo se pinta, con el sí o el no en palabras (no sólo con el color).
import { t, type ClaveSola } from "../i18n";
import { capacidadesDe, motorDeEmpresa, type Capacidad } from "./motor-capacidades.ts";

const ETIQUETA: Record<Capacidad, ClaveSola> = { skills: "cap.skills", mcp: "cap.mcp", subagentes: "cap.subagentes", imagenes: "cap.imagenes" };

/** «Trae: skills sí · MCP no · subagentes sí · imágenes sí», para la columna (empresa) que está abierta; nada si no es una conocida. */
export function MotorCapacidades({ empresa }: { empresa: string | null }) {
  const motor = motorDeEmpresa(empresa);
  if (!motor) return null;
  return (
    <p className="mc-caps">
      <span className="mc-caps-t">{t("cap.trae")}</span>
      {capacidadesDe(motor).map(([c, si]) => (
        <span key={c} className="mc-cap" data-si={si ? "" : undefined}>
          {t(ETIQUETA[c])} {t(si ? "cap.si" : "cap.no")}
        </span>
      ))}
    </p>
  );
}
