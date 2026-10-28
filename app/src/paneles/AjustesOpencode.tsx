// Ajustes > OpenCode: lo que hace falta para usar OpenCode en trama. El programa `opencode` (instalado, versión, sesión, modelos, «Actualizar
// modelos») y la clave de API de OpenCode (la de los modelos de pago a través de dsh). El plan (Gratis / Go / Go Plus) es parte de la cuenta,
// como el de Claude o Google: está en Plan y cupos (AjustesCupos.tsx), con su uso. Todo se aplica al toque, sin la barra de Guardar; guardar la
// clave es sólo de la PC (por la tailnet el main rechaza). Cada estado se dice con ícono y palabra, no sólo con color.
import { useEffect, useRef, useState } from "react";
import { VERSION } from "../datos/contrato";
import { fuentePaneles, type EstadoDsh, type EstadoOpencodeUi, type NombreClave, type Prueba } from "../datos/paneles";
import { t, textoMain } from "../i18n";
import { Fijo } from "../i18n/Fijo";
import { mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { Cat } from "./AjustesNav";
import { CampoClave, Estado, Resultado, type Probando } from "./AjustesDsh";
import type { FilaDato } from "./AjustesEditar";
import { Comando } from "./AjustesLocales";
import { PanelCargando } from "./PanelCargando";
import { EVENTO_PLAN_OPENCODE } from "./AjustesCupos";
import { AjustesNvidia } from "./AjustesNvidia";

export function AjustesOpencode({ Dato }: { Dato: FilaDato }) {
  const [e, setE] = useState<EstadoOpencodeUi | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  // La clave de OpenCode (la que usa dsh) vive en el estado de dsh: acá sólo se ve si hay una y se guarda / borra / prueba.
  const [dsh, setDsh] = useState<EstadoDsh | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [errClave, setErrClave] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<Probando>(null);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    const leer = () => void fuentePaneles.estadoOpencode().then((r) => vivo.current && setE(r), (x) => vivo.current && setErr(mensaje(x)));
    leer();
    void fuentePaneles.estadoDsh().then((r) => vivo.current && r.version === VERSION && setDsh(r), () => {});
    // Cambió el plan en Plan y cupos: los modelos que se ofrecen (los de Go) cambian con él.
    window.addEventListener(EVENTO_PLAN_OPENCODE, leer);
    return () => {
      vivo.current = false;
      window.removeEventListener(EVENTO_PLAN_OPENCODE, leer);
    };
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
              ) : null}
            </>
          ) : err ? null : (
            <PanelCargando />
          )}
        </Dato>
        {/* El texto largo y el comando van debajo de su fila, no en la columna del control. */}
        {e ? (
          <div className="oc-notas">
            {e.instalado ? null : (
              <>
                <p className="ol-nota">{t("ajustes.ocInstalarPie")}</p>
                <Comando texto={e.comando} etiqueta={t("ajustes.ocPrograma")} />
              </>
            )}
            {e.instalado && !e.consola ? <p className="ol-nota">{t("ajustes.ocLoginPie")}</p> : null}
            {e.instalado ? <p className="ol-nota">{t("ajustes.ocUsar")}</p> : null}
            <p className="ol-nota">{t("ajustes.ocPlanEnCupos", { plan: t(e.plan === "go" ? "ajustes.ocPlanGo" : e.plan === "go-plus" ? "ajustes.ocPlanGoPlus" : "ajustes.ocPlanGratis") })}</p>
          </div>
        ) : null}
        {err ? <div className="pn-error dsh-err" role="alert">{textoMain(err)}</div> : null}

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
              </div>
            </>
          ) : (
            <PanelCargando />
          )}
        </Dato>
        {dsh ? (
          <div className="oc-notas">
            <Resultado p={prueba} />
            <p className="ol-nota">{t("ajustes.dshClaveNota")}</p>
          </div>
        ) : null}
        {errClave ? <div className="pn-error dsh-err" role="alert">{textoMain(errClave)}</div> : null}
      </section>
      <AjustesNvidia Dato={Dato} />
    </Cat>
  );
}
