// Ajustes > Modelos > «Advisor»: por cada modelo de Anthropic, un interruptor y el asesor más fuerte al que consulta (`claude --advisor`).
// Trabaja sobre el borrador de AjustesModelos (ajustes-advisor.ts): nada se escribe hasta Guardar. Si el advisor no anda en esta máquina
// (una variable lo apaga, o el proveedor no es Anthropic) los interruptores quedan deshabilitados con el motivo en una línea.
import { Interruptor } from "../ui/componentes";
import { t } from "../i18n";
import type { MotivoAdvisor } from "../../electron/advisor";
import type { Borrador } from "./modelos-borrador";
import { asesorElegido, asesorInicial, asesoresOfrecidos, FAMILIAS_CON_ASESOR, ponerAsesor, type FamiliaAdvisor, type RolAdvisor } from "./ajustes-advisor";

const NOMBRE: Record<FamiliaAdvisor, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus", fable: "Fable" };

/** El motivo en una línea, o `null` si el advisor anda. */
export const textoMotivo = (m: MotivoAdvisor | null | undefined): string | null =>
  m ? t(m.tipo === "variable" ? "ajustes.mdlAdvisorVariable" : "ajustes.mdlAdvisorProveedor", { nombre: m.nombre }) : null;

function Fila({ fam, b, cambiar, apagado, rol }: { fam: FamiliaAdvisor; b: Borrador; cambiar: (b: Borrador) => void; apagado: boolean; rol: RolAdvisor }) {
  const ofrecidos = asesoresOfrecidos(b, fam);
  const elegido = asesorElegido(b, fam, rol);
  const inicial = asesorInicial(b, fam);
  const sin = ofrecidos.length === 0;
  return (
    <div className="mdl-advisor-fila" role="group" aria-label={t("ajustes.mdlAdvisorDe", { modelo: NOMBRE[fam] })}>
      <span className="mdl-advisor-nom">{NOMBRE[fam]}</span>
      <Interruptor
        activo={elegido !== null}
        disabled={apagado || (sin && elegido === null)}
        alCambiar={(v) => cambiar(ponerAsesor(b, fam, v ? inicial : null, rol))}
        aria-label={t("ajustes.mdlAdvisorDe", { modelo: NOMBRE[fam] })}
      />
      {elegido ? (
        <div className="pn-chips" role="group" aria-label={t("ajustes.mdlAdvisorAsesor", { modelo: NOMBRE[fam] })}>
          {ofrecidos.map((a) => (
            <button key={a} type="button" className="pn-chip-f" aria-pressed={elegido === a} disabled={apagado} onClick={() => cambiar(ponerAsesor(b, fam, a, rol))}>
              {NOMBRE[a]}
            </button>
          ))}
        </div>
      ) : sin ? (
        <span className="mdl-advisor-nota">{t("ajustes.mdlAdvisorNadaMasFuerte")}</span>
      ) : (
        <span className="mdl-advisor-nota">{t("ajustes.mdlAdvisorSin")}</span>
      )}
    </div>
  );
}

export function AdvisorFilas({ b, cambiar, motivo }: { b: Borrador; cambiar: (b: Borrador) => void; motivo?: MotivoAdvisor | null }) {
  const texto = textoMotivo(motivo);
  return (
    <div className="mdl-advisor">
      {texto ? (
        <div className="mdl-advisor-motivo" role="status">
          {texto}
        </div>
      ) : null}
      {(["lider", "orquestador"] as const).map((rol) => (
        <section className="mdl-advisor-grupo" key={rol} aria-label={t(rol === "lider" ? "ajustes.mdlAdvisorLider" : "ajustes.mdlAdvisorOrquestador")}>
          <h4>{t(rol === "lider" ? "ajustes.mdlAdvisorLider" : "ajustes.mdlAdvisorOrquestador")}</h4>
          {FAMILIAS_CON_ASESOR.map((f) => <Fila key={f} fam={f} b={b} cambiar={cambiar} apagado={!!motivo} rol={rol} />)}
        </section>
      ))}
      <p className="pn-alt mdl-advisor-nota">{t("ajustes.mdlAdvisorWorkers")}</p>
    </div>
  );
}
