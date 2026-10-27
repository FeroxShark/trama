// Ajustes > OpenCode: lo que hace falta para usar OpenCode en trama. El programa `opencode` (instalado, versión, sesión, modelos, «Actualizar
// modelos»), el plan (Gratis / Go / Go Plus; Gratis es como siempre y Go está APAGADO hasta elegirlo) y la clave de API de OpenCode (la de los
// modelos de pago a través de dsh). Todo se aplica al toque, sin la barra de Guardar; elegir el plan y guardar la clave son sólo de la PC
// (por la tailnet el main rechaza). Cada estado se dice con ícono y palabra, no sólo con color.
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { VERSION } from "../datos/contrato";
import { pedirModelos } from "../datos/modelos-config";
import { fuentePaneles, type EstadoDsh, type EstadoOpencodeUi, type NombreClave, type Prueba } from "../datos/paneles";
import { aplicarModelos } from "../hilo/opciones";
import { t, textoMain, type ClaveSola } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { Cat } from "./AjustesNav";
import { CampoClave, Estado, Resultado, type Probando } from "./AjustesDsh";
import type { FilaDato } from "./AjustesEditar";
import { Comando } from "./AjustesLocales";
import { PanelCargando } from "./PanelCargando";

type Plan = "gratis" | "go" | "go-plus";
const PLANES: readonly { id: Plan; nombre: ClaveSola }[] = [
  { id: "gratis", nombre: "ajustes.ocPlanGratis" },
  { id: "go", nombre: "ajustes.ocPlanGo" },
  { id: "go-plus", nombre: "ajustes.ocPlanGoPlus" },
];

/** El evento (en `window`) con que Ajustes > Plan y cupos se entera de que cambió el plan de OpenCode. */
export const EVENTO_PLAN_OPENCODE = "trama:opencode-plan";

export function AjustesOpencode({ Dato }: { Dato: FilaDato }) {
  const [e, setE] = useState<EstadoOpencodeUi | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errPlan, setErrPlan] = useState<string | null>(null);
  // La clave de OpenCode (la que usa dsh) vive en el estado de dsh: acá sólo se ve si hay una y se guarda / borra / prueba.
  const [dsh, setDsh] = useState<EstadoDsh | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [errClave, setErrClave] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<Probando>(null);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    void fuentePaneles.estadoOpencode().then((r) => vivo.current && setE(r), (x) => vivo.current && setErr(mensaje(x)));
    void fuentePaneles.estadoDsh().then((r) => vivo.current && r.version === VERSION && setDsh(r), () => {});
    return () => void (vivo.current = false);
  }, []);

  const actualizar = async () => {
    setActualizando(true);
    setErr(null);
    try {
      const r = await fuentePaneles.actualizarOpencode();
      if (vivo.current) setE(r);
    } catch (x) {
      if (vivo.current) setErr(mensaje(x));
    } finally {
      if (vivo.current) setActualizando(false);
    }
  };

  const elegirPlan = async (plan: Plan) => {
    if (guardando || plan === e?.plan) return;
    setGuardando(true);
    setErrPlan(null);
    try {
      await fuentePaneles.guardarPlanOpencode(plan);
      window.dispatchEvent(new Event(EVENTO_PLAN_OPENCODE));
      // Los modelos que se ofrecen cambian con el plan: el estado de acá y los selectores se piden de nuevo.
      const r = await fuentePaneles.estadoOpencode();
      if (vivo.current) setE(r);
      void pedirModelos(5000).then((m) => m && aplicarModelos(m));
    } catch (x) {
      if (vivo.current) setErrPlan(mensaje(x));
    } finally {
      if (vivo.current) setGuardando(false);
    }
  };

  const guardarClave = async (nombre: NombreClave, valor: string | null): Promise<boolean> => {
    setOcupado(true);
    setErrClave(null);
    try {
      const r = await fuentePaneles.claveDsh(nombre, valor);
      if (vivo.current && r.version === VERSION) setDsh(r);
      setPrueba(null); // la prueba de antes era con la key de antes
      return true;
    } catch (x) {
      if (vivo.current) setErrClave(mensaje(x));
      return false;
    } finally {
      if (vivo.current) setOcupado(false);
    }
  };
  const probar = async () => {
    setPrueba("probando");
    const r = await fuentePaneles.probarDsh("opencode").catch((x): Prueba => ({ ok: false, motivo: mensaje(x) }));
    if (vivo.current) setPrueba(r);
  };

  return (
    <Cat id="opencode">
      <section className="pn-sec pn-edita" data-opencode-seccion>
        <Dato nombre="ajustes.ocPrograma" que="ajustes.ocProgramaQue">
          {e ? (
            <>
              <div className="dsh-fila" data-opencode>
                {e.instalado ? <Estado ok texto={e.versionOpencode ? t("ajustes.ocInstaladoV", { v: e.versionOpencode }) : t("ajustes.ocInstalado")} /> : <Estado ok={false} texto={t("ajustes.ocNoInstalado")} />}
                {e.instalado ? (
                  e.logueado === null ? (
                    <Estado ok={false} texto={t("ajustes.ocLoginDesconocido")} />
                  ) : (
                    <Estado ok={e.logueado} texto={e.consola ? t("ajustes.ocConectado") : e.logueado ? t("ajustes.ocConectadoOtro") : t("ajustes.ocSinConectar")} />
                  )
                ) : null}
              </div>
              {e.instalado ? (
                <div className="dsh-fila">
                  <span className="mdl-estado" role="status">{t("ajustes.ocModelos", { n: e.modelos, g: e.gratis })}</span>
                  <Boton onClick={() => void actualizar()} disabled={actualizando}>
                    {actualizando ? t("ajustes.ocActualizando") : <Fijo k="ajustes.ocActualizar" />}
                  </Boton>
                </div>
              ) : (
                <>
                  <p className="ol-nota">{t("ajustes.ocInstalarPie")}</p>
                  <Comando texto={e.comando} etiqueta={t("ajustes.ocPrograma")} />
                </>
              )}
              {e.instalado && !e.consola ? <p className="ol-nota">{t("ajustes.ocLoginPie")}</p> : null}
              {e.instalado ? <p className="ol-nota">{t("ajustes.ocUsar")}</p> : null}
            </>
          ) : err ? null : (
            <PanelCargando />
          )}
          {err ? <div className="pn-error dsh-err" role="alert">{textoMain(err)}</div> : null}
        </Dato>

        <Dato nombre="ajustes.ocPlan" que="ajustes.ocPlanQue">
          {e ? (
            <>
              {/* Un grupo de opciones con el elegido marcado con tilde y negrita además del color. */}
              <div className="pn-letra oc-plan" role="radiogroup" aria-label={t("ajustes.ocPlanGrupo")} data-plan={e.plan}>
                {PLANES.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={p.id === e.plan} data-plan-id={p.id} disabled={guardando} onClick={() => void elegirPlan(p.id)}>
                    {p.id === e.plan ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : null}
                    {t(p.nombre)}
                  </button>
                ))}
                {guardando ? <span className="mdl-estado" role="status">{t("ajustes.ocPlanGuardando")}</span> : null}
              </div>
              <p className="ol-nota">{e.plan === "gratis" ? t("ajustes.ocPlanNotaGratis") : t("ajustes.ocPlanNotaGo", { n: e.go })}</p>
              <p className="ol-nota">{t("ajustes.ocPlanTopes")}</p>
            </>
          ) : err ? null : (
            <PanelCargando />
          )}
          {errPlan ? <div className="pn-error dsh-err" role="alert">{textoMain(errPlan)}</div> : null}
        </Dato>

        <Dato nombre="ajustes.dshOpencode" que="ajustes.dshOpencodeQue">
          {dsh ? (
            <>
              <CampoClave
                nombre="OPENCODE_API_KEY"
                que={t("ajustes.dshOpencode")}
                hay={dsh.claves.OPENCODE_API_KEY}
                ocupado={ocupado}
                alGuardar={(v) => guardarClave("OPENCODE_API_KEY", v)}
                alBorrar={() => void guardarClave("OPENCODE_API_KEY", null)}
              />
              <div className="dsh-fila">
                <Boton aria-label={t("ajustes.dshProbarDe", { que: t("ajustes.dshOpencode") })} onClick={() => void probar()} disabled={prueba === "probando"}>
                  {prueba === "probando" ? t("ajustes.dshProbando") : <Fijo k="ajustes.dshProbar" />}
                </Boton>
                <Resultado p={prueba} />
              </div>
              <p className="ol-nota">{t("ajustes.dshClaveNota")}</p>
            </>
          ) : (
            <PanelCargando />
          )}
          {errClave ? <div className="pn-error dsh-err" role="alert">{textoMain(errClave)}</div> : null}
        </Dato>
      </section>
    </Cat>
  );
}
