import { t } from "../i18n";
import { Interruptor } from "../ui/componentes";
import { EleccionSel } from "./AjustesModelos";
import {
  elegirEffortOrquestador,
  elegirModeloOrquestador,
  ponerOrquestacionActiva,
  ponerPresetContextoOrq,
  ponerRevisionPrevia,
  type Borrador,
  type Modelo,
} from "./modelos-borrador";

/** Controles del modo líder liviano + orquestador, compartiendo el selector del líder. */
export function AjustesOrquestador({ b, cambiar, modelos }: { b: Borrador; cambiar: (b: Borrador) => void; modelos: Modelo[] }) {
  const o = b.orquestacion;
  const presets = ["ahorro", "equilibrado", "profundo", "manual"] as const;
  return (
    <div className="mdl-orquestador">
      <div className="mdl-orquestador-fila">
        <span>{t("ajustes.mdlOrquestadorActivo")}</span>
        <Interruptor activo={o.activo} alCambiar={(v) => cambiar(ponerOrquestacionActiva(b, v))} aria-label={t("ajustes.mdlOrquestadorActivo")} />
      </div>
      <EleccionSel etiqueta={t("ajustes.mdlOrquestadorModelo")} modelos={modelos} valor={o.modelo} comoHoy alModelo={(id) => cambiar(elegirModeloOrquestador(b, id))} alEffort={(e) => cambiar(elegirEffortOrquestador(b, e))} />
      <div className="mdl-orquestador-fila">
        <span>{t("ajustes.mdlRevisionPrevia")}</span>
        <Interruptor activo={o.revisionPrevia} alCambiar={(v) => cambiar(ponerRevisionPrevia(b, v))} aria-label={t("ajustes.mdlRevisionPrevia")} />
      </div>
      <div className="pn-chips" role="group" aria-label={t("ajustes.mdlPresetContexto")}>
        {presets.map((p) => <button key={p} type="button" className="pn-chip-f" aria-pressed={o.presetContexto === p} onClick={() => cambiar(ponerPresetContextoOrq(b, p))}>{t(`ajustes.mdlPreset${p[0]!.toUpperCase()}${p.slice(1)}` as never)}</button>)}
      </div>
    </div>
  );
}
