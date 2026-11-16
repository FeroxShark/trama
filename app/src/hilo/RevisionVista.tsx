// «Revisar con otro modelo» en vivo: el modal de progreso (tiempo, pasos del revisor, el texto a medida que sale, Cancelar) y la tarjeta
// «Revisando con X · 1 m 20 s» que queda en el chat con el modal cerrado. Los dos leen el mismo estado (`revision-vivo.ts`, que viene del
// main). Cada fase se dice con ícono y palabra. Estilos: revision-progreso.css, sobre los del diálogo de `SeguirCon` y la tarjeta del revisor.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, CircleAlert, Eye, Loader, ScanSearch, Search, X } from "lucide-react";
import { fuente } from "../datos/fuente";
import type { RevisionEstado } from "../datos/contrato";
import { useFoco } from "../foco";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Boton } from "../ui/componentes";
import { Texto } from "./Texto";
import { clavePaso, duracionRevision, revisionViva, tiempoCorrido } from "./revision-logica";
import { limpiarRevision, modalRevision, useRevision } from "./revision-vivo";
import "./seguir-dialogo.css";
import "./revision-progreso.css";

/** Un segundo por tic mientras la revisión sigue: el reloj del título. */
function useAhora(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    setAhora(Date.now());
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activo]);
  return ahora;
}

/** El título según la fase: «Revisando con X · 1 m 20 s», «Entregando…», «Revisión entregada a tu líder»… */
function titulo(e: RevisionEstado, ahora: number): string {
  if (e.fase === "corriendo") return t("revision.corriendoTiempo", { modelo: e.nombre, tiempo: tiempoCorrido(duracionRevision(e, ahora)) });
  if (e.fase === "entregando") return t("revision.entregando");
  if (e.fase === "hecha") return t("revision.hecha");
  if (e.fase === "cancelada") return t("revision.cancelada");
  return t("revision.fallo");
}

function IconoFase({ fase }: { fase: RevisionEstado["fase"] }) {
  if (fase === "hecha") return <Check size={15} strokeWidth={2.4} aria-hidden="true" />;
  if (fase === "fallo" || fase === "cancelada") return <CircleAlert size={15} strokeWidth={2.2} aria-hidden="true" />;
  return <ScanSearch size={15} strokeWidth={2.2} aria-hidden="true" />;
}

/** Los pasos del revisor y, debajo, el texto de la revisión a medida que sale. */
function Cuerpo({ e, compacto = false }: { e: RevisionEstado; compacto?: boolean }) {
  const pasos = compacto ? e.pasos.slice(-1) : e.pasos;
  return (
    <>
      {pasos.length ? (
        <ol className="rvv-pasos" aria-label={t("revision.pasos")}>
          {pasos.map((p, i) => (
            <li key={`${i}-${p.k}-${p.v}`} data-ultimo={i === pasos.length - 1 && e.fase === "corriendo" ? "" : undefined}>
              {p.k === "buscar" ? <Search size={12} strokeWidth={2.2} aria-hidden="true" /> : <Eye size={12} strokeWidth={2.2} aria-hidden="true" />}
              <span>{t(clavePaso(p), { v: p.v })}</span>
            </li>
          ))}
        </ol>
      ) : e.fase === "corriendo" ? (
        <p className="rvv-espera" role="status">
          <Loader size={12} strokeWidth={2.2} aria-hidden="true" />
          {t("revision.revisando")}
        </p>
      ) : null}
      {!compacto && e.texto && e.fase === "corriendo" ? (
        <div className="rvv-texto el" tabIndex={0} role="region" aria-label={t("revision.vivo")}>
          <Texto texto={e.texto} vivo />
        </div>
      ) : null}
    </>
  );
}

/** Lleva a la tarjeta de la revisión que llegó al chat (la última). */
function verTarjeta() {
  const l = document.querySelectorAll(".rv");
  l[l.length - 1]?.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** Los botones de cada fase (los mismos en el modal y en la tarjeta del chat). */
function Acciones({ sid, e, modal }: { sid: string; e: RevisionEstado; modal: boolean }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reintentar = () => {
    setOcupado(true);
    setError(null);
    fuente.liderRevisionReintentar(sid).then(() => setOcupado(false), (x) => (setOcupado(false), setError(String((x as Error).message))));
  };
  return (
    <>
      {error ? <div className="caja-error" role="alert">{textoMain(error)}</div> : null}
      <div className="rvv-acciones">
        {e.fase === "corriendo" ? (
          <Boton className="rvv-cancelar" onClick={() => void fuente.liderRevisionCancelar(sid)}>
            <X size={13} strokeWidth={2.4} aria-hidden="true" />
            {t("revision.cancelar")}
          </Boton>
        ) : null}
        {e.fase === "fallo" && e.reintentable ? (
          <Boton primario disabled={ocupado} onClick={reintentar}>
            {t("revision.reintentar")}
          </Boton>
        ) : null}
        {e.fase === "hecha" ? (
          <Boton
            primario
            onClick={() => {
              modalRevision(sid, false);
              verTarjeta();
            }}
          >
            {t("revision.verTarjeta")}
          </Boton>
        ) : null}
        {revisionViva(e) ? (
          modal ? (
            <Boton onClick={() => modalRevision(sid, false)}>{t("revision.segundoPlano")}</Boton>
          ) : (
            <Boton onClick={() => modalRevision(sid, true)}>{t("revision.ver")}</Boton>
          )
        ) : (
          <Boton onClick={() => limpiarRevision(sid)}>{t("revision.cerrar")}</Boton>
        )}
      </div>
    </>
  );
}

function Modal({ sid, e }: { sid: string; e: RevisionEstado }) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const ahora = useAhora(e.fase === "corriendo");
  useFoco(raiz, { alCerrar: () => modalRevision(sid, false), enfocar: "primero" });
  return createPortal(
    <div className="seg-fondo" data-seguir onMouseDown={(x) => x.target === x.currentTarget && modalRevision(sid, false)}>
      <div ref={raiz} className="seg rvv-modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1} data-fase={e.fase}>
        <div className="seg-cab">
          <span className="seg-ico" aria-hidden="true">
            <IconoFase fase={e.fase} />
          </span>
          <div className="seg-txt">
            <h3 id={`${id}-t`} className="seg-t" role="status">
              {titulo(e, ahora)}
            </h3>
            <p className="seg-d">{e.fase === "fallo" && e.error ? textoMain(e.error) : e.fase === "cancelada" ? t("revision.canceladaDesc") : t("revision.desc")}</p>
          </div>
        </div>
        <Cuerpo e={e} />
        <Acciones sid={sid} e={e} modal />
      </div>
    </div>,
    document.body,
  );
}

/** La revisión de un líder: el modal si está abierto y, siempre, la tarjeta del chat encima de la caja. */
export function RevisionVista({ sid }: { sid: string }) {
  useIdioma();
  const { estado: e, modal } = useRevision(sid);
  const ahora = useAhora(e?.fase === "corriendo");
  if (!e) return null;
  return (
    <>
      {modal ? <Modal sid={sid} e={e} /> : null}
      {!modal ? (
        <section className="rv rvv" data-fase={e.fase} aria-label={titulo(e, ahora)}>
          <header className="rv-cab">
            <span className="rv-ico" aria-hidden="true">
              <IconoFase fase={e.fase} />
            </span>
            <div className="rv-txt">
              <h4 className="rv-t" role="status">
                {titulo(e, ahora)}
              </h4>
              {e.fase === "fallo" && e.error ? <p className="rv-s">{textoMain(e.error)}</p> : null}
            </div>
          </header>
          {revisionViva(e) ? <Cuerpo e={e} compacto /> : null}
          <Acciones sid={sid} e={e} modal={false} />
        </section>
      ) : null}
    </>
  );
}
