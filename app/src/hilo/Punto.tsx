// El punto de control de un turno del líder (#1787), debajo de su respuesta: "Tocó 3 archivos · +24 −5", que se abre a la lista de
// archivos (cada uno con su diff) y el botón «Volver a antes de este turno», con confirmación. Lo que guarda y restaura es el main
// (electron/puntos.ts); acá sólo se pide y se pinta. Estilo vidrio quieto: cápsulas calmas, el estado siempre con palabra.
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, FileDiff, Undo2 } from "lucide-react";
import type { ArchivoPunto, PuntoControl } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { MODO } from "../modo";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Filas } from "./Diff";
import { archivosAlVolver, parsearDif, sumaDe } from "./punto-logica";
import { extension } from "./worker-datos";
import "./worker-logica.css";
import "./punto.css";

/** Las capturas `lider-puntos`: la lista abierta con su primer diff (`abierto`) o el diálogo de volver atrás (`confirmar`). */
const CAPTURA = MODO.captura === "lider-puntos" ? MODO.variante : null;

const PALABRA = { A: "punto.nuevo", M: "punto.cambiado", D: "punto.borrado" } as const;

/** «+24 −5» con el signo a la vista y las palabras completas para el lector de pantalla. */
function Cuentas({ mas, menos }: { mas: number; menos: number }) {
  return (
    <span className="cp-cuentas" aria-label={t("punto.cuentas", { mas, menos })}>
      <span className="cp-mas" aria-hidden="true">+{mas}</span>
      <span className="cp-menos" aria-hidden="true">−{menos}</span>
    </span>
  );
}

type Vista = { cargando: true } | { error: string } | { filas: ReturnType<typeof parsearDif>; cortado: boolean };

/** Un archivo de la lista: al abrirlo pide su diff (una vez). */
function Archivo({ sid, punto, a, abrir }: { sid: string; punto: PuntoControl; a: ArchivoPunto; abrir: boolean }) {
  const [abierto, setAbierto] = useState(abrir);
  const [vista, setVista] = useState<Vista | null>(null);
  const pedido = useRef(false);
  useEffect(() => {
    if (!abierto || pedido.current) return;
    pedido.current = true;
    let vigente = true;
    setVista({ cargando: true });
    fuente
      .liderPuntoDif(sid, punto.id, a.ruta)
      .then((r) => vigente && setVista({ filas: parsearDif(r.texto), cortado: r.cortado }))
      .catch((e) => vigente && setVista({ error: String((e as Error)?.message ?? e) }));
    return () => {
      vigente = false;
    };
  }, [abierto, sid, punto.id, a.ruta]);
  const filas = vista && "filas" in vista ? vista : null;
  return (
    <li className="cp-archivo">
      <button type="button" className="cp-arch-b" aria-expanded={abierto} aria-label={t("punto.verArchivo", { ruta: a.ruta })} onClick={() => setAbierto((x) => !x)}>
        <ChevronRight size={11} strokeWidth={2} aria-hidden="true" />
        <span className="cp-ruta">{a.ruta}</span>
        <span className="cp-estado" data-e={a.estado}>{t(PALABRA[a.estado])}</span>
        <Cuentas mas={a.mas} menos={a.menos} />
      </button>
      {abierto ? (
        <div className="cp-dif">
          {vista && "cargando" in vista ? <div className="cp-nota" role="status">{t("punto.leyendo")}</div> : null}
          {vista && "error" in vista ? <div className="cp-nota cp-error" role="alert">{vista.error}</div> : null}
          {filas && filas.filas.length ? <Filas filas={filas.filas} lang={extension(a.ruta)} /> : null}
          {filas && !filas.filas.length ? <div className="cp-nota">{t("punto.sinVista")}</div> : null}
          {filas?.cortado ? <div className="cp-nota">{t("punto.cortado")}</div> : null}
        </div>
      ) : null}
    </li>
  );
}

/** La confirmación de volver atrás: modal en un portal, el foco arranca en «Dejar como está» y queda atrapado entre los dos botones. */
function Confirmar({ n, error, ocupado, alSi, alNo }: { n: number; error: string | null; ocupado: boolean; alSi: () => void; alNo: () => void }) {
  const id = useId();
  const no = useRef<HTMLButtonElement>(null);
  const si = useRef<HTMLButtonElement>(null);
  useEffect(() => no.current?.focus(), []);
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return alNo();
    }
    if (e.key !== "Tab") return;
    e.preventDefault();
    const a = [no.current, si.current].filter(Boolean) as HTMLElement[];
    const i = a.indexOf(document.activeElement as HTMLElement);
    a[(i + (e.shiftKey ? a.length - 1 : 1)) % a.length]?.focus();
  };
  return createPortal(
    <div className="cambio-fondo" data-punto-dialogo onMouseDown={(e) => e.target === e.currentTarget && alNo()}>
      <div className="cambio" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onKeyDown={tecla}>
        <h3 id={`${id}-t`} className="cambio-t">
          <Undo2 size={16} strokeWidth={2} aria-hidden="true" />
          {t("punto.dlgTitulo")}
        </h3>
        <p id={`${id}-d`} className="cambio-d">
          {t("punto.dlgTexto", { n })}
        </p>
        {error ? <p className="cambio-d cp-error" role="alert">{t("punto.dlgFalla", { error })}</p> : null}
        <div className="cambio-b">
          <button ref={no} type="button" className="btn2 cambio-no" onClick={alNo}>
            {t("punto.dlgNo")}
          </button>
          <button ref={si} type="button" className="btn2 cambio-si" data-punto-si disabled={ocupado} onClick={alSi}>
            {t("punto.dlgSi")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type Props = {
  sid: string;
  punto: PuntoControl;
  /** Todos los de la conversación: al volver se restaura también lo de los turnos que siguieron. */
  puntos: readonly PuntoControl[];
  /** El líder está trabajando: no se puede volver atrás (el turno está tocando los archivos). */
  ocupado: boolean;
  /** Se volvió: la conversación relee los puntos. */
  alVolver: () => void;
};

export const PuntoTurno = memo(function PuntoTurno({ sid, punto, puntos, ocupado, alVolver }: Props) {
  useIdioma();
  const [abierto, setAbierto] = useState(CAPTURA === "abierto");
  const [confirmando, setConfirmando] = useState(CAPTURA === "confirmar");
  const [haciendo, setHaciendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mas, menos } = useMemo(() => sumaDe(punto.archivos), [punto.archivos]);
  const n = useMemo(() => archivosAlVolver(puntos, punto.id).length, [puntos, punto.id]);
  const volver = () => {
    setHaciendo(true);
    setError(null);
    fuente
      .liderPuntoVolver(sid, punto.id)
      .then(() => {
        setConfirmando(false);
        alVolver();
      })
      .catch((e) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setHaciendo(false));
  };
  const cuantos = punto.archivos.length;
  return (
    <div className="cp" data-punto>
      <div className="cp-fila">
        <button type="button" className="cp-resumen" aria-expanded={abierto} aria-label={t("punto.abrir")} onClick={() => setAbierto((x) => !x)}>
          <ChevronRight size={11} strokeWidth={2} aria-hidden="true" />
          <FileDiff size={12} strokeWidth={2} aria-hidden="true" />
          <span>{cuantos === 1 ? t("punto.resumen1") : t("punto.resumenN", { n: cuantos })}</span>
          <Cuentas mas={mas} menos={menos} />
        </button>
        {punto.vuelto ? (
          <span className="cp-nota-v" role="status">
            <Check size={11} strokeWidth={2.4} aria-hidden="true" />
            {t("punto.vuelto")}
          </span>
        ) : null}
        <button
          type="button"
          className="cp-volver"
          data-punto-volver
          disabled={ocupado}
          title={ocupado ? t("punto.volverEspera") : undefined}
          onClick={() => {
            setError(null);
            setConfirmando(true);
          }}
        >
          <Undo2 size={12} strokeWidth={2} aria-hidden="true" />
          {t("punto.volver")}
        </button>
      </div>
      {abierto ? (
        <ul className="cp-lista">
          {punto.archivos.map((a, i) => (
            <Archivo key={a.ruta} sid={sid} punto={punto} a={a} abrir={CAPTURA === "abierto" && i === 0} />
          ))}
        </ul>
      ) : null}
      {confirmando ? <Confirmar n={n} error={error} ocupado={haciendo || ocupado} alSi={volver} alNo={() => !haciendo && setConfirmando(false)} /> : null}
    </div>
  );
});
