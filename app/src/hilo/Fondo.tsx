// La pastilla arriba de la caja de escribir: lo que el líder dejó corriendo de fondo. Así se distingue "terminó" de "terminó su turno y
// espera algo". Tocándola, la lista con cada tarea y hace cuánto corre. No ocupa nada si no hay ninguna.
import { memo, useEffect, useMemo, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import type { Mensaje } from "../datos/contrato";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { duracion } from "../tiempo";
import { tareasDeFondo, type TareaFondo } from "./fondo-logica";
import "./fondo.css";

const MIRAR_MS = 15_000;

const hace = (x: TareaFondo, ahora: number) => (x.desde === null ? null : duracion(Math.max(0, Math.round((ahora - x.desde) / 1000))));

export const Fondo = memo(function Fondo({ mensajes }: { mensajes: readonly Mensaje[] }) {
  useIdioma();
  const tareas = useMemo(() => tareasDeFondo(mensajes), [mensajes]);
  const [abierta, setAbierta] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const hay = tareas.length > 0;
  useEffect(() => {
    if (!hay) return;
    setAhora(Date.now());
    const iv = setInterval(() => setAhora(Date.now()), MIRAR_MS);
    return () => clearInterval(iv);
  }, [hay]);
  if (!hay) return null;
  const primera = tareas[0];
  const tiempo = hace(primera, ahora);
  return (
    <div className="bgt">
      <button type="button" className="bgt-p" aria-expanded={abierta} onClick={() => setAbierta((x) => !x)}>
        <LoaderCircle className="bgt-gira" size={13} strokeWidth={2} aria-hidden="true" />
        <span className="bgt-n">{t("fondo.cuantas", { n: tareas.length })}</span>
        <span className="bgt-que">{primera.que}</span>
        {tiempo ? <span className="bgt-t">{tiempo}</span> : null}
        <ChevronDown className="bgt-v" size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      {abierta ? (
        <ul className="bgt-l">
          {tareas.map((x) => (
            <li key={x.id}>
              <span className="bgt-que">{x.que}</span>
              <span className="bgt-t">{hace(x, ahora)}</span>
              {x.comando && x.comando !== x.que ? <code>{x.comando}</code> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
