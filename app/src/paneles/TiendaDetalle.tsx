// Ajustes > Conectores como tienda: el detalle de una tarjeta (un diálogo propio de Trama, nunca `confirm()`): la descripción entera, de quién es, qué trae,
// dónde vive y lo que se puede hacer (prender o apagar, quitar, instalar). Instalar una skill o agregar un conector SIEMPRE pasa por una confirmación que
// dice qué pasa (qué archivos y si traen scripts; a qué dominio van tus datos); un conector que es un paquete NO se instala: se muestra su comando y su
// enlace. Un plugin se instala con `claude plugin install` (electron/plugins-claude.ts). Cada estado se dice con ícono y palabra, no sólo con color.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ExternalLink, Loader, Plus, Terminal, Trash2, X } from "lucide-react";
import { fuentePaneles, type Conector, type Previa, type VistaServidorMcp } from "../datos/paneles";
import { useFoco } from "../foco";
import { t, textoMain } from "../i18n";
import { mensaje } from "../puente";
import { Boton, Interruptor } from "../ui/componentes";
import { Estado } from "./AjustesDsh";
import { tamanoCorto } from "./descubrir-vista";
import type { Tarjeta } from "./tienda-logica";
import { ICONO, textoFecha, textoInstalaciones, textoOrigen, textoPuesto, textoUso } from "./TiendaTarjetas";
import "../hilo/seguir-dialogo.css";

/** Lo que el detalle le pide al shell (que es el dueño de los datos). Cada una rechaza con el motivo, que el shell muestra. */
export type AccionesDetalle = {
  /** Hay algo en curso en el shell: los controles quedan quietos. */
  bloqueado: boolean;
  error: string | null;
  conmutar: (x: Tarjeta, v: boolean) => Promise<void>;
  instalarPlugin: (x: Tarjeta) => Promise<void>;
  quitarPlugin: (plugin: string, catalogo: string) => Promise<void>;
  quitarPropio: (nombre: string) => Promise<void>;
  editarPropio: (nombre: string) => void;
  /** Se instaló una skill o se agregó un conector: que el shell vuelva a leer lo suyo. */
  alInstalado: (r: string) => void;
};

type Abierto = { previa: Previa | null; error: string | null; instalando: boolean };

type Props = {
  x: Tarjeta;
  conector: Conector | null;
  propio: VistaServidorMcp | null;
  hoy: string | null;
  /** Abre ya la confirmación (se apretó el «+» de una skill o un conector). */
  confirmar: boolean;
  acciones: AccionesDetalle;
  alCerrar: () => void;
};

const TIPO = { skills: "tienda.tipo.skills", mcp: "tienda.tipo.mcp", plugins: "tienda.tipo.plugins", hooks: "tienda.tipo.hooks" } as const;

function Dato({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Previsualizacion({ x, a }: { x: Tarjeta; a: Abierto }) {
  const p = a.previa;
  if (!p) {
    return (
      <p className="ds-texto" role="status">
        {a.error ? textoMain(a.error) : (
          <>
            <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> {t("descubrir.previa")}
          </>
        )}
      </p>
    );
  }
  if (p.tipo === "skill") {
    return (
      <div className="ds-confirma" data-confirma-descubrir={x.clave}>
        <strong className="ds-confirma-tit">{t("descubrir.confirmaSkill", { n: p.nombre })}</strong>
        <p className="ds-texto">{t("descubrir.confirmaSkillQue", { a: p.archivos.length, tam: tamanoCorto(p.total), d: p.destino })}</p>
        {p.scripts.length ? (
          <p className="ds-texto ds-alerta" role="alert" data-scripts-descubrir>
            <AlertTriangle size={14} strokeWidth={2.2} aria-hidden /> <span>{t("descubrir.confirmaScripts", { l: p.scripts.join(", ") })}</span>
          </p>
        ) : (
          <p className="ds-texto">{t("descubrir.confirmaSinScripts")}</p>
        )}
        <details className="ds-archivos">
          <summary>{t("descubrir.archivosDe", { n: p.archivos.length })}</summary>
          <ul>
            {p.archivos.map((f) => (
              <li key={f.ruta}>
                <code>{f.ruta}</code> <span className="cn-origen">{tamanoCorto(f.tam)}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  }
  return (
    <div className="ds-confirma" data-confirma-descubrir={x.clave}>
      <strong className="ds-confirma-tit">{t("descubrir.confirmaMcp", { n: x.nombre })}</strong>
      <p className="ds-texto">{t("descubrir.confirmaMcpQue", { u: p.url, d: p.dominio })}</p>
      <p className="ds-texto">{p.cabeceras.length ? t("descubrir.confirmaMcpCab", { c: p.cabeceras.join(", ") }) : t("descubrir.confirmaMcpSin")}</p>
    </div>
  );
}

export function DetalleTienda({ x, conector, propio, hoy, confirmar, acciones, alCerrar }: Props) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const vivo = useRef(true);
  const [abierto, setAbierto] = useState<Abierto | null>(null);
  const [quitando, setQuitando] = useState(false);
  const Icono = ICONO[x.pestana];
  const descubrir = x.vista === "descubrir";
  const esDescubrible = descubrir && (x.pestana === "skills" || x.pestana === "mcp");
  const ocupado = acciones.bloqueado || abierto?.instalando === true;
  useFoco(raiz, { alCerrar: ocupado ? undefined : alCerrar, enfocar: "primero" });
  useEffect(() => {
    vivo.current = true;
    return () => void (vivo.current = false);
  }, []);

  const verPrevia = () => {
    if (x.fuente.tipo !== "descubrir") return;
    const idItem = x.fuente.id;
    setAbierto({ previa: null, error: null, instalando: false });
    void fuentePaneles.previaDescubrir(idItem).then(
      (previa) => vivo.current && setAbierto((a) => (a ? { ...a, previa, error: null } : a)),
      (e) => vivo.current && setAbierto((a) => (a ? { ...a, error: mensaje(e) } : a)),
    );
  };
  // El «+» de la tarjeta abre el detalle ya con la previa: instalar siempre se ve antes de hacerse.
  useEffect(() => {
    if (confirmar && esDescubrible && x.accion !== "comando" && x.accion !== "ninguna" && !x.puesto) verPrevia();
  }, []);

  const instalarConfirmado = async () => {
    if (!abierto?.previa || x.fuente.tipo !== "descubrir") return;
    const { previa } = abierto;
    setAbierto({ ...abierto, instalando: true, error: null });
    try {
      const r = await fuentePaneles.instalarDescubrir(x.fuente.id, previa.tipo === "skill" ? previa.huella : undefined);
      if (!vivo.current) return;
      acciones.alInstalado(r.tipo === "skill" ? t("descubrir.okSkill", { n: r.nombre, c: r.carpeta, a: r.archivos }) : t("descubrir.okMcp", { n: r.nombre }));
      alCerrar();
    } catch (e) {
      if (vivo.current) setAbierto((a) => (a ? { ...a, instalando: false, error: mensaje(e) } : a));
    }
  };

  const puedeQuitarPlugin = x.pestana === "plugins" && ((descubrir && x.puesto && x.fuente.tipo === "plugin") || (!descubrir && conector?.origen === "usuario" && !!conector.de));
  const quitarPlugin = () => {
    if (x.fuente.tipo === "plugin") return acciones.quitarPlugin(x.fuente.plugin, x.fuente.catalogo);
    if (conector) return acciones.quitarPlugin(conector.nombre, conector.de);
    return Promise.resolve();
  };

  return createPortal(
    <div className="seg-fondo" data-detalle-tienda onMouseDown={(e) => e.target === e.currentTarget && !ocupado && alCerrar()}>
      <div ref={raiz} className="seg ti-det" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1} data-tarjeta-detalle={x.clave}>
        <div className="seg-cab">
          <span className="seg-ico" aria-hidden>
            <Icono size={16} strokeWidth={2.2} />
          </span>
          <div className="seg-txt">
            <h3 id={`${id}-t`} className="seg-t">{x.nombre}</h3>
            <p className="seg-d">{t(TIPO[x.pestana])} · {textoOrigen(x.origen)}</p>
          </div>
          <Boton className="ti-x" onClick={alCerrar} disabled={ocupado} aria-label={t("descubrir.cerrar")} title={t("descubrir.cerrar")}>
            <X size={16} strokeWidth={2.2} aria-hidden />
          </Boton>
        </div>

        <div className="ti-det-cuerpo">
          <p className="ti-det-desc" data-sin={x.descripcion ? undefined : ""}>{x.descripcion ?? t("tienda.sinDesc")}</p>

          <dl className="ti-meta">
            <Dato k={t("tienda.meta.de")}>{textoOrigen(x.origen)}</Dato>
            {x.categoria ? <Dato k={t("plugins.categoria")}>{x.categoria}</Dato> : null}
            {!descubrir ? <Dato k={t("tienda.meta.uso")}>{textoUso(x, hoy)}</Dato> : null}
            {descubrir && x.pestana === "plugins" ? <Dato k={t("tienda.meta.gente")}>{textoInstalaciones(x.instalaciones)}</Dato> : null}
            {x.pestana === "plugins" || (descubrir && x.pestana === "mcp") ? <Dato k={t("tienda.meta.fecha")}>{textoFecha(x.fecha)}</Dato> : null}
            {descubrir && x.pestana === "skills" ? (
              <Dato k={t("tienda.meta.archivos")}>
                {t("descubrir.archivos", { n: x.archivos ?? 0 })}
                {x.scripts ? (
                  <span className="ds-marca" data-aviso>
                    {" "}<AlertTriangle size={13} strokeWidth={2.2} aria-hidden /> {t("descubrir.scripts")}
                  </span>
                ) : null}
              </Dato>
            ) : null}
            {x.trae ? (
              <Dato k={t("tienda.meta.trae")}>
                {x.trae.skills + x.trae.mcp + x.trae.hooks === 0 ? t("tienda.traeNada") : t("tienda.trae", { s: x.trae.skills, m: x.trae.mcp, h: x.trae.hooks })}
              </Dato>
            ) : null}
            {x.donde ? <Dato k={t("tienda.meta.donde")}><code className="cn-destino">{x.donde}</code></Dato> : null}
            {x.destino && x.destino !== x.donde ? <Dato k={t(x.pestana === "hooks" ? "tienda.meta.comando" : "tienda.meta.destino")}><code className="cn-destino">{x.destino}</code></Dato> : null}
            {propio?.variables.length ? (
              <Dato k={t("tienda.meta.vars")}>
                <span className="mcp-vars-estado">
                  {propio.variables.map((v) => (
                    <Estado key={`${v.tipo}:${v.nombre}`} ok={v.hay} texto={`${v.nombre}: ${t(v.hay ? "conectores.guardada" : "conectores.faltaValor")}`} />
                  ))}
                </span>
              </Dato>
            ) : null}
            {x.enlace ? (
              <Dato k={t("tienda.meta.mas")}>
                <a className="ti-enlace" href={x.enlace} target="_blank" rel="noopener noreferrer">
                  {t("descubrir.verMas")} <ExternalLink size={13} strokeWidth={2} aria-hidden />
                </a>
              </Dato>
            ) : null}
          </dl>

          {!descubrir ? (
            <div className="ti-det-estado">
              <Estado ok={x.activo !== false} texto={t(x.activo === false ? "conectores.off" : "conectores.on")} />
              {x.conmutable && x.activo !== null && conector ? (
                <Interruptor activo={x.activo} disabled={ocupado} aria-label={t(x.activo ? "conectores.apagar" : "conectores.prender", { n: x.nombre })} alCambiar={(v) => void acciones.conmutar(x, v).catch(() => {})} />
              ) : (
                <span className="ol-nota">{t(propio ? "tienda.nota.propio" : "tienda.nota.fijo")}</span>
              )}
            </div>
          ) : x.puesto ? (
            <div className="ti-det-estado">
              <Estado ok texto={textoPuesto(x)} />
            </div>
          ) : null}

          {x.accion === "comando" && x.fuente.tipo === "descubrir" ? (
            <div className="ds-confirma" data-comando-detalle>
              <strong className="ds-confirma-tit">{t("descubrir.paqueteTit")}</strong>
              <p className="ds-texto">{t("descubrir.paqueteQue")}</p>
              <span className="cn-origen">{t("descubrir.comando")}</span>
              <code className="ds-comando" data-comando-descubrir>{x.donde}</code>
            </div>
          ) : null}
          {x.accion === "ninguna" && descubrir ? <p className="ol-nota">{t("descubrir.sinForma")}</p> : null}

          {abierto ? <Previsualizacion x={x} a={abierto} /> : null}
          {abierto?.error && abierto.previa ? <div className="pn-error dsh-err" role="alert">{textoMain(abierto.error)}</div> : null}
          {acciones.error ? <div className="pn-error dsh-err" role="alert">{textoMain(acciones.error)}</div> : null}
          {quitando ? (
            <p className="ds-texto ds-alerta" role="alert">
              <AlertTriangle size={14} strokeWidth={2.2} aria-hidden /> <span>{t(x.pestana === "plugins" ? "tienda.quitarPlugin" : "tienda.quitarPropio", { n: x.nombre })}</span>
            </p>
          ) : null}
        </div>

        <div className="ds-acciones ti-det-pie">
          {esDescubrible && !x.puesto && x.accion !== "comando" && x.accion !== "ninguna" ? (
            abierto?.previa ? (
              <Boton primario onClick={() => void instalarConfirmado()} disabled={ocupado}>
                {abierto.instalando ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : <Plus size={14} strokeWidth={2.2} aria-hidden />} <span>{abierto.instalando ? t(x.pestana === "skills" ? "descubrir.instalando" : "descubrir.agregando") : t(x.pestana === "skills" ? "descubrir.instalar" : "descubrir.agregar")}</span>
              </Boton>
            ) : !abierto ? (
              <Boton primario onClick={verPrevia} disabled={ocupado}>
                <Plus size={14} strokeWidth={2.2} aria-hidden /> <span>{t(x.pestana === "skills" ? "descubrir.instalar" : "descubrir.agregar")}</span>
              </Boton>
            ) : null
          ) : null}
          {descubrir && x.pestana === "plugins" && !x.puesto ? (
            <Boton primario onClick={() => void acciones.instalarPlugin(x).catch(() => {})} disabled={ocupado}>
              {acciones.bloqueado ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : <Plus size={14} strokeWidth={2.2} aria-hidden />} <span>{acciones.bloqueado ? t("plugins.instalando") : t("plugins.instalar")}</span>
            </Boton>
          ) : null}
          {x.accion === "comando" && x.enlace ? (
            <a className="ui-btn mdl-enlace" href={x.enlace} target="_blank" rel="noopener noreferrer">
              <Terminal size={14} strokeWidth={2} aria-hidden /> <span>{t("descubrir.verPaquete")}</span>
            </a>
          ) : null}
          {propio && !quitando ? (
            <Boton onClick={() => acciones.editarPropio(propio.nombre)} disabled={ocupado}>
              {t("conectores.editar")}
            </Boton>
          ) : null}
          {(propio || puedeQuitarPlugin) && !quitando ? (
            <Boton onClick={() => setQuitando(true)} disabled={ocupado} aria-label={t("conectores.quitarDe", { n: x.nombre })}>
              <Trash2 size={14} strokeWidth={2} aria-hidden /> <span>{t("conectores.quitar")}</span>
            </Boton>
          ) : null}
          {quitando ? (
            <>
              <Boton
                primario
                disabled={ocupado}
                onClick={() => void (propio ? acciones.quitarPropio(propio.nombre) : quitarPlugin()).then(() => vivo.current && alCerrar()).catch(() => vivo.current && setQuitando(false))}
              >
                {acciones.bloqueado ? <Loader size={14} strokeWidth={2} aria-hidden className="pl-gira" /> : <Trash2 size={14} strokeWidth={2} aria-hidden />} <span>{t("tienda.siQuitar")}</span>
              </Boton>
              <Boton onClick={() => setQuitando(false)} disabled={ocupado}>{t("ajustes.cancelar")}</Boton>
            </>
          ) : (
            <Boton onClick={alCerrar} disabled={ocupado}>{t("descubrir.cerrar")}</Boton>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
