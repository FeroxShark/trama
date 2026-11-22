// Plan y cupos > «Aros del costado»: qué límites muestran los aros de la barra lateral. En automático son los dos más apretados de todas las suscripciones
// (barra/cupos-riel-logica.ts); apagado el automático, la persona fija de 1 a 3 de los límites que existen hoy. A diferencia del resto de Ajustes se aplica
// al momento (es de la interfaz, `localStorage` de la ventana; barra/cupos-aros.ts), sin Guardar. Al fijar se parte de lo que se ve, para que nada salte.
import { useEffect, useMemo, useRef } from "react";
import { CircleDot } from "lucide-react";
import type { Uso } from "../datos/contrato";
import { guardarAros, limitesDeUso, useAros } from "../barra/cupos-aros";
import { AROS_MAX, arosVisibles } from "../barra/cupos-riel-logica";
import { t } from "../i18n";
import { MODO } from "../modo";
import { useIdioma } from "../i18n/react";
import { Interruptor } from "../ui/componentes";
import type { FilaDato } from "./AjustesEditar";

export function AjustesAros({ Dato, uso }: { Dato: FilaDato; uso: Uso | null }) {
  useIdioma();
  const pref = useAros();
  const raiz = useRef<HTMLElement>(null);
  // Captura `ajustes-aros`: el bloque a la vista; con =elegir, el automático apagado y tres límites fijados (también en la barra).
  useEffect(() => {
    if (MODO.captura !== "ajustes-aros") return;
    raiz.current?.scrollIntoView({ block: "start" });
    if (MODO.variante === "elegir") guardarAros(["claude:claude:5h", "claude:modelo:Fable", "chatgpt::7d"]);
  }, []);
  const limites = useMemo(() => limitesDeUso(uso), [uso]);
  const auto = pref === "auto";
  // Lo que se ve ahora: de ahí parte la lista al apagar el automático.
  const fijados = auto ? [] : arosVisibles(limites, pref).map((l) => l.clave);
  const alAuto = (v: boolean) => guardarAros(v ? "auto" : arosVisibles(limites, "auto").map((l) => l.clave));
  const alElegir = (clave: string, puesto: boolean) => guardarAros(puesto ? [...fijados, clave] : fijados.filter((k) => k !== clave));
  const lleno = fijados.length >= AROS_MAX;
  return (
    <section ref={raiz} className="pn-sec pn-edita cu-aros" data-opc="ajustes.aros">
      <h3 className="pn-h">{t("ajustes.aros")}</h3>
      <Dato nombre="ajustes.arosAuto" que="ajustes.arosQue" icono={<CircleDot size={16} strokeWidth={2} aria-hidden="true" />}>
        <div className="pn-sel">
          <Interruptor activo={auto} aria-label={t("ajustes.arosAuto")} alCambiar={alAuto} />
        </div>
      </Dato>
      {auto ? null : limites.length ? (
        <fieldset className="cu-aros-lista">
          <legend>{t("ajustes.arosLista")}</legend>
          {limites.map((l) => {
            const puesto = fijados.includes(l.clave);
            // No se puede sacar el último ni sumar uno de más.
            const bloqueado = puesto ? fijados.length <= 1 : lleno;
            return (
              <label key={l.clave} className="cu-aros-op" data-puesto={puesto ? "" : undefined} data-bloqueado={bloqueado ? "" : undefined}>
                <input type="checkbox" checked={puesto} disabled={bloqueado} onChange={(e) => alElegir(l.clave, e.target.checked)} />
                <span className="cu-aros-n">{l.nombre}</span>
                <span className="cu-aros-p">{l.v.pct === null ? t("ajustes.arosSinDato") : t("ajustes.arosUsado", { pct: Math.round(l.v.pct) })}</span>
              </label>
            );
          })}
          {lleno ? <p className="cu-aros-nota">{t("ajustes.arosTope")}</p> : null}
        </fieldset>
      ) : (
        <p className="cu-aros-nota">{t("ajustes.arosVacio")}</p>
      )}
    </section>
  );
}
