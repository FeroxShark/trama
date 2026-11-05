// «Borrar proyecto…»: un diálogo propio de Trama (nunca `confirm()`) con el nombre del proyecto y dos niveles. Por defecto, Quitar de Trama (el registry
// lo marca `retirado`: sale de la barra y de los selectores, la carpeta no se toca). Aparte y apagado, «También mandar la carpeta a la papelera»: muestra
// la ruta, avisa si git tiene trabajo sin guardar y pide escribir el nombre exacto. Se niega, con el motivo, si hay líderes o workers vivos. Al terminar,
// el resultado ofrece «Deshacer» (si sólo se quitó). Las guardas de verdad viven en el main (electron/proyectos-borrar.ts). Estilo: .seg-* (seguir-dialogo.css).
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Trash2 } from "lucide-react";
import { fuenteProyectos, type ResultadoBorrar, type VistaBorrar } from "../datos/proyectos";
import { useFoco } from "../foco";
import { MODO } from "../modo";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { esVentana, mensaje } from "../puente";
import { Boton } from "../ui/componentes";
import { avisoGit, puedeConfirmar } from "./borrar-logica";
import "../hilo/seguir-dialogo.css";
import "./borrar-proyecto.css";

type Props = {
  slug: string;
  /** Cómo se ve el proyecto en la barra (su nombre para mostrar): el título hasta que llega la lectura del main. */
  nombre: string;
  alCerrar: () => void;
};

export function BorrarProyecto({ slug, nombre, alCerrar }: Props) {
  useIdioma();
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState<VistaBorrar | null>(null);
  const [errorVista, setErrorVista] = useState<string | null>(null);
  const [papelera, setPapelera] = useState(MODO.captura === "borrar-proyecto" && MODO.variante === "papelera");
  const [escrito, setEscrito] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoBorrar["papelera"] | "quitado" | null>(null);
  // Mandar la carpeta a la papelera es sólo de la PC (la ventana de Trama): el celular sólo puede quitar.
  const hayPapelera = esVentana();

  useEffect(() => {
    let vivo = true;
    fuenteProyectos.borrarVista(slug).then(
      (v) => vivo && setVista(v),
      (e) => vivo && setErrorVista(mensaje(e)),
    );
    return () => void (vivo = false);
  }, [slug]);

  const nombreVisto = vista?.nombre ?? nombre;
  useFoco(raiz, { alCerrar: ocupado ? undefined : alCerrar, enfocar: "primero" });

  const puede = puedeConfirmar({ vista, papelera, escrito, ocupado });
  const confirmar = async () => {
    if (!vista || !puede) return;
    setOcupado(true);
    setError(null);
    try {
      if (papelera) setResultado((await fuenteProyectos.papelera(slug, escrito)).papelera);
      else {
        await fuenteProyectos.quitar(slug);
        setResultado("quitado");
      }
    } catch (e) {
      setError(mensaje(e));
    } finally {
      setOcupado(false);
    }
  };
  const deshacer = async () => {
    setOcupado(true);
    setError(null);
    try {
      await fuenteProyectos.reactivar(slug);
      alCerrar();
    } catch (e) {
      setError(t("bp.errorDeshacer", { e: textoMain(mensaje(e)) }));
      setOcupado(false);
    }
  };

  const git = vista && papelera && !vista.papeleraNegada ? avisoGit(vista.git) : null;
  return createPortal(
    <div className="seg-fondo" data-borrar-proyecto onMouseDown={(e) => e.target === e.currentTarget && !ocupado && alCerrar()}>
      <div ref={raiz} className="seg bp" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} tabIndex={-1}>
        <div className="seg-cab">
          <span className="seg-ico bp-ico" aria-hidden="true">
            <Trash2 size={16} strokeWidth={2.2} />
          </span>
          <div className="seg-txt">
            <h3 id={`${id}-t`} className="seg-t">
              {resultado ? t("bp.hecho", { p: nombreVisto }) : t("bp.titulo", { p: nombreVisto })}
            </h3>
            <p id={`${id}-d`} className="seg-d">
              {resultado ? t(resultado === "ok" ? "bp.papeleraOk" : resultado === "sin" ? "bp.papeleraSin" : resultado === "fallo" ? "bp.papeleraFallo" : "bp.quitarDesc") : t("bp.desc")}
            </p>
          </div>
        </div>

        {resultado ? null : (
          <>
            {errorVista ? (
              <p className="caja-error" role="alert">
                {t("bp.errorLeer", { e: textoMain(errorVista) })}
              </p>
            ) : !vista ? (
              <p className="seg-vacio" role="status">
                {t("bp.leyendo")}
              </p>
            ) : (
              <div className="bp-cuerpo">
                <div className="bp-nivel">
                  <span className="bp-nivel-t">
                    <Check size={13} strokeWidth={2.4} aria-hidden="true" /> {t("bp.quitarTitulo")}
                  </span>
                  <span className="bp-nivel-d">{t("bp.quitarDesc")}</span>
                </div>
                {vista.negado ? (
                  <p className="bp-negado" role="alert">
                    <AlertTriangle size={14} strokeWidth={2.2} aria-hidden="true" /> <span>{textoMain(vista.negado)}</span>
                  </p>
                ) : null}
                {hayPapelera ? (
                  <div className="bp-papelera" data-activa={papelera ? "" : undefined}>
                    <label className="bp-chk-fila">
                      <input
                        type="checkbox"
                        className="bp-chk"
                        checked={papelera}
                        disabled={!!vista.papeleraNegada || ocupado}
                        onChange={(e) => setPapelera(e.target.checked)}
                      />
                      <span className="bp-nivel-t">{t("bp.papelera")}</span>
                    </label>
                    <span className="bp-nivel-d">{vista.papeleraNegada ? textoMain(vista.papeleraNegada) : t("bp.papeleraDesc")}</span>
                    {papelera && !vista.papeleraNegada ? (
                      <>
                        <p className="bp-ruta">
                          <span className="bp-ruta-t">{t("bp.ruta")}</span>
                          <code title={vista.ruta}>{vista.ruta}</code>
                        </p>
                        {git ? (
                          <p className="bp-git" data-sucio={git.tipo === "sucio" ? "" : undefined} role={git.tipo === "sucio" ? "alert" : "status"}>
                            {git.tipo === "norepo" ? (
                              t("bp.gitNoRepo")
                            ) : git.tipo === "limpio" ? (
                              t("bp.gitLimpio")
                            ) : (
                              <>
                                <span className="bp-git-t">
                                  <AlertTriangle size={13} strokeWidth={2.4} aria-hidden="true" /> {t("bp.gitAviso")}
                                </span>
                                {git.sinCommitear > 0 ? <span>{t("bp.gitCambios", { n: git.sinCommitear })}</span> : null}
                                {git.sinEmpujar > 0 ? <span>{t("bp.gitSinEmpujar", { n: git.sinEmpujar })}</span> : null}
                              </>
                            )}
                          </p>
                        ) : null}
                        <label className="bp-escribir" htmlFor={`${id}-n`}>
                          {t("bp.escribir", { p: vista.nombre })}
                        </label>
                        <input
                          id={`${id}-n`}
                          className="bp-campo"
                          value={escrito}
                          placeholder={vista.nombre}
                          aria-label={t("bp.escribirAria")}
                          spellCheck={false}
                          autoComplete="off"
                          disabled={ocupado}
                          onChange={(e) => setEscrito(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && void confirmar()}
                        />
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}

        {error ? (
          <p className="caja-error" role="alert">
            {textoMain(error)}
          </p>
        ) : null}
        <div className="seg-pie bp-pie">
          {resultado ? (
            <>
              {resultado !== "ok" ? (
                <Boton className="seg-cancelar" disabled={ocupado} onClick={() => void deshacer()}>
                  {ocupado ? t("bp.reactivando") : t("bp.deshacer")}
                </Boton>
              ) : null}
              <Boton primario className="bp-listo" onClick={alCerrar}>
                {t("bp.listo")}
              </Boton>
            </>
          ) : (
            <>
              <Boton className="seg-cancelar" disabled={ocupado} onClick={alCerrar}>
                {t("bp.cancelar")}
              </Boton>
              <Boton primario className="bp-confirmar" data-peligro={papelera ? "" : undefined} disabled={!puede} onClick={() => void confirmar()}>
                {ocupado ? t("bp.trabajando") : t(papelera ? "bp.quitarYPapelera" : "bp.quitar")}
              </Boton>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
