// Ajustes > Modelos > «Memoria compartida»: un interruptor por motor (Gemini, ChatGPT, DeepSeek, OpenCode, locales) que dice si su líder recibe la
// memoria del dueño y la ficha del tablero (electron/contexto-local.ts). Trabaja sobre el borrador de Ajustes > Modelos: nada se escribe hasta Guardar.
// Se muestran los cinco motores siempre (saber cuáles están conectados no es simple y un interruptor de más no estorba). Cada estado va con palabra, no sólo con el interruptor.
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Interruptor } from "../ui/componentes";
import type { Borrador } from "./modelos-borrador";
import { MOTORES_MEMORIA, memoriaDe, ponerMemoria } from "./ajustes-memoria";

const NOMBRE = {
  gemini: "ajustes.mdlMemoriaGemini",
  codex: "ajustes.mdlMemoriaCodex",
  dsh: "ajustes.mdlMemoriaDsh",
  opencode: "ajustes.mdlMemoriaOpencode",
  local: "ajustes.mdlMemoriaLocal",
} as const;

export function AjustesMemoria({ b, cambiar }: { b: Borrador; cambiar: (b: Borrador) => void }) {
  useIdioma();
  return (
    <ul className="pn-disp mdl-destrabar mdl-memoria" aria-label={t("ajustes.mdlMemoria")}>
      {MOTORES_MEMORIA.map((m) => {
        const on = memoriaDe(b, m);
        const motor = t(NOMBRE[m]);
        return (
          <li key={m}>
            <span className="mdl-destrabar-nom">{motor}</span>
            <span className="mdl-memoria-est" data-on={on ? "" : undefined}>{on ? t("ajustes.mdlMemoriaSi") : t("ajustes.mdlMemoriaNo")}</span>
            <Interruptor activo={on} alCambiar={(v) => cambiar(ponerMemoria(b, m, v))} aria-label={t("ajustes.mdlMemoriaDe", { motor })} />
          </li>
        );
      })}
    </ul>
  );
}
