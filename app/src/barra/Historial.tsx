// «Historial de chats»: una ventana (modal) con los chats que Trama lanzó y ya no están en la barra, archivados o cerrados. Se abre desde el menú de
// orden de la barra («Historial de chats…») o con Ctrl+H; se cierra con Esc, con la X o al abrir un chat. Buscador, filtros con su cantidad,
// «Por proyecto» o «Por fecha»; cada fila: nombre, modelo, si está archivado o cerrado y hace cuánto, «Abrir» y una papelera. La papelera pide
// confirmar en una burbuja pegada al botón y manda a la papelera del sistema SÓLO el transcript de ese chat (electron/historial-chats.ts).
// Teclado: flechas entre filas, Enter abre, Supr pide borrar, Esc cierra la burbuja y después la ventana. Maqueta: opcion-c. Lógica: historial-logica.ts.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Crown, History, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { fuente } from "../datos/fuente";
import type { ChatHistorial } from "../datos/contrato";
import { useFoco } from "../foco";
import { modeloDe, nombreModelo } from "../hilo/opciones";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { pintorHace } from "../tiempo";
import { OTRAS, carpetaCorta } from "./claude-code";
import { agruparHistorial, claveNoBorrado, contarHistorial, FILTROS, filtrarHistorial, sidsVisibles, vecino, type AgruparHistorial, type FiltroHistorial } from "./historial-logica";
import "../hilo/seguir-dialogo.css";
import "./historial-chats.css";

type Props = {
  /** Cómo se llama una carpeta en la barra (`OTRAS` incluida la maneja el componente). */
  nombreCarpeta: (proyecto: string) => string;
  /** El nombre a la vista de un chat (lo puesto a mano en Trama gana al del transcript). */
  tituloDe?: (c: ChatHistorial) => string;
  /** Retomar el chat como líder y abrirlo; devuelve por qué no se pudo (ya en criollo) o `null`. */
  alAbrir: (c: ChatHistorial) => Promise<string | null>;
  alCerrar: () => void;
  /** Captura y pruebas: la hora de «ahora» y el chat con la burbuja de borrar ya abierta. */
  ahora?: number;
  confirmarInicial?: string;
};

const modeloLindo = (m: string | null) => (m ? nombreModelo(modeloDe(m) ?? m) : null);

export function Historial({ nombreCarpeta, tituloDe, alAbrir, alCerrar, ahora, confirmarInicial }: Props) {
  useIdioma();
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [chats, setChats] = useState<ChatHistorial[] | null>(null);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<FiltroHistorial>("todos");
  const [agrupar, setAgrupar] = useState<AgruparHistorial>("proyecto");
  const [plegados, setPlegados] = useState<ReadonlySet<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(confirmarInicial ?? null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const s = ahora ?? Math.floor(Date.now() / 1000);

  useEffect(() => {
    let vivo = true;
    void fuente
      .historialChats()
      .then((c) => vivo && setChats(c))
      .catch(() => vivo && setChats([]));
    return () => void (vivo = false);
  }, []);

  const nombre = (c: ChatHistorial) => tituloDe?.(c) || c.titulo;
  const carpeta = (c: ChatHistorial) => (c.proyecto === null ? t("historial.otras") : nombreCarpeta(c.proyecto));
  const cuentas = useMemo(() => contarHistorial(chats ?? []), [chats]);
  const vistos = useMemo(() => filtrarHistorial(chats ?? [], { q, filtro, nombre, carpeta: (c) => carpeta(c) }), [chats, q, filtro]); // eslint-disable-line react-hooks/exhaustive-deps
  const grupos = useMemo(() => agruparHistorial(vistos, agrupar), [vistos, agrupar]);
  const visibles = useMemo(() => sidsVisibles(grupos, plegados), [grupos, plegados]);
  const marcado = sel !== null && visibles.includes(sel) ? sel : null;

  useFoco(raiz, { alCerrar: () => (confirmando ? setConfirmando(null) : alCerrar()), enfocar: "primero" });
  useEffect(() => {
    if (confirmando) raiz.current?.querySelector<HTMLElement>("[data-his-cancelar]")?.focus();
  }, [confirmando]);

  const enfocarFila = (sid: string | null) => {
    setSel(sid);
    if (sid) requestAnimationFrame(() => raiz.current?.querySelector<HTMLElement>(`[data-his-fila="${CSS.escape(sid)}"]`)?.focus());
  };

  const abrir = async (c: ChatHistorial) => {
    if (ocupado) return;
    if (!c.existe) return setAviso({ texto: t("barra.claudeNoCarpeta", { c: carpetaCorta(c.cwd) }), error: true });
    if (c.ajena) return setAviso({ texto: t("barra.claudeAjena"), error: true });
    setAviso(null);
    setOcupado(c.sid);
    const error = await alAbrir(c).catch(() => t("historial.noAbrio"));
    setOcupado(null);
    if (error) setAviso({ texto: error, error: true });
    else alCerrar();
  };

  const borrar = async (c: ChatHistorial) => {
    if (ocupado) return;
    setOcupado(c.sid);
    const r = await fuente.historialBorrar(c.sid);
    setOcupado(null);
    setConfirmando(null);
    if (r.ok) {
      setChats((l) => (l ?? []).filter((x) => x.sid !== c.sid));
      setAviso({ texto: t("historial.borrado", { nombre: nombre(c) }), error: false });
      enfocarFila(vecino(visibles, c.sid, 1) === c.sid ? vecino(visibles, c.sid, -1) : vecino(visibles, c.sid, 1));
    } else setAviso({ texto: t(claveNoBorrado(r.motivo), { nombre: nombre(c) }), error: true });
  };

  const tecla = (e: KeyboardEvent<HTMLElement>, c: ChatHistorial) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      enfocarFila(vecino(visibles, c.sid, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void abrir(c);
    } else if (e.key === "Delete") {
      e.preventDefault();
      setConfirmando(c.sid);
    }
  };
  // Desde el buscador, la flecha de abajo baja a la lista.
  const teclaBuscador = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && visibles.length) {
      e.preventDefault();
      enfocarFila(visibles[0]!);
    }
  };

  const plegar = (k: string) =>
    setPlegados((p) => {
      const n = new Set(p);
      if (!n.delete(k)) n.add(k);
      return n;
    });

  const fila = (c: ChatHistorial, conCarpeta: boolean) => {
    const hace = pintorHace(Math.floor(c.cuando / 1000))(s).texto;
    const m = modeloLindo(c.modelo);
    const nom = nombre(c);
    return (
      <li key={c.sid} className="his-item" data-confirmando={confirmando === c.sid ? "" : undefined}>
        <div
          className="his-fila"
          tabIndex={marcado === c.sid || (marcado === null && visibles[0] === c.sid) ? 0 : -1}
          data-his-fila={c.sid}
          data-como={c.como}
          aria-label={nom}
          onFocus={() => setSel(c.sid)}
          onKeyDown={(e) => tecla(e, c)}
        >
          <span className="his-corona" aria-hidden="true">
            <Crown size={15} strokeWidth={2} />
          </span>
          <span className="his-txt">
            <span className="his-nombre">{nom}</span>
            <span className="his-meta">
              {[m, t(c.como === "archivado" ? "historial.archivado" : "historial.cerrado", { hace }), conCarpeta ? carpeta(c) : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          <button type="button" className="his-abrir" disabled={ocupado !== null} aria-label={t("historial.abrirAria", { nombre: nom })} onClick={() => void abrir(c)}>
            {ocupado === c.sid && confirmando !== c.sid ? t("historial.abriendo") : t("historial.abrir")}
          </button>
          <button
            type="button"
            className="his-papelera"
            data-his-papelera={c.sid}
            aria-label={t("historial.borrarAria", { nombre: nom })}
            data-tip={t("historial.borrar")}
            aria-expanded={confirmando === c.sid}
            disabled={ocupado !== null}
            onClick={() => setConfirmando(c.sid)}
          >
            <Trash2 size={15} strokeWidth={2} />
          </button>
        </div>
        {confirmando === c.sid ? (
          <div className="his-conf" role="alertdialog" aria-labelledby={`${id}-ct`} aria-describedby={`${id}-cd`}>
            <p id={`${id}-ct`} className="his-conf-t">
              <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />
              {t("historial.confirmaTitulo", { nombre: nom })}
            </p>
            <p id={`${id}-cd`} className="his-conf-d">
              {t("historial.confirmaTexto")}
            </p>
            <div className="his-conf-b">
              <button
                type="button"
                className="his-cancelar"
                data-his-cancelar=""
                onClick={() => {
                  setConfirmando(null);
                  raiz.current?.querySelector<HTMLElement>(`[data-his-papelera="${CSS.escape(c.sid)}"]`)?.focus();
                }}
              >
                {t("historial.cancelar")}
              </button>
              <button type="button" className="his-borrar" disabled={ocupado !== null} onClick={() => void borrar(c)}>
                <Trash2 size={13} strokeWidth={2.2} aria-hidden="true" />
                {t("historial.borrar")}
              </button>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  const etiquetaFiltro = (f: FiltroHistorial) => t(f === "todos" ? "historial.todos" : f === "archivado" ? "historial.archivados" : "historial.cerrados");

  return createPortal(
    <div className="seg-fondo" data-historial onMouseDown={(e) => e.target === e.currentTarget && alCerrar()}>
      <div ref={raiz} className="seg his" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1}>
        <div className="his-cab">
          <History size={17} strokeWidth={2} aria-hidden="true" />
          <h3 id={`${id}-t`} className="his-titulo">
            {t("historial.titulo")}
          </h3>
          <button type="button" className="his-x" aria-label={t("historial.cerrarAria")} onClick={alCerrar}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <label className="seg-buscar his-buscar">
          <Search size={15} strokeWidth={2} aria-hidden="true" />
          <input type="search" value={q} placeholder={t("historial.buscar")} aria-label={t("historial.buscar")} onChange={(e) => setQ(e.target.value)} onKeyDown={teclaBuscador} />
        </label>
        <div className="his-herr">
          <div className="his-chips" role="radiogroup" aria-label={t("historial.filtroAria")}>
            {FILTROS.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={filtro === f} className="his-chip" onClick={() => setFiltro(f)}>
                {etiquetaFiltro(f)} <small>{cuentas[f]}</small>
              </button>
            ))}
          </div>
          <div className="his-seg" role="radiogroup" aria-label={t("historial.agruparAria")}>
            {(["proyecto", "fecha"] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={agrupar === a} className="his-seg-b" onClick={() => setAgrupar(a)}>
                {t(a === "proyecto" ? "historial.porProyecto" : "historial.porFecha")}
              </button>
            ))}
          </div>
        </div>
        <div className="his-lista" aria-label={t("historial.lista")}>
          {chats === null ? (
            <p className="seg-vacio" role="status">
              {t("historial.leyendo")}
            </p>
          ) : chats.length === 0 ? (
            <p className="seg-vacio" role="status">
              {t("historial.vacio")}
            </p>
          ) : vistos.length === 0 ? (
            <p className="seg-vacio" role="status">
              {t("historial.sinResultados")}
            </p>
          ) : (
            grupos.map((g) => (
              <section key={g.clave} className="his-grupo">
                {agrupar === "proyecto" ? (
                  <button type="button" className="his-gr" aria-expanded={!plegados.has(g.clave)} onClick={() => plegar(g.clave)}>
                    <ChevronDown size={14} strokeWidth={2} className="his-gr-chev" aria-hidden="true" />
                    <span className="his-punto" aria-hidden="true" />
                    <span className="his-gr-n">{g.clave === OTRAS ? t("historial.otras") : nombreCarpeta(g.clave)}</span>
                    <small>{g.chats.length}</small>
                  </button>
                ) : null}
                {agrupar === "fecha" || !plegados.has(g.clave) ? <ul className="his-ul">{g.chats.map((c) => fila(c, agrupar === "fecha"))}</ul> : null}
              </section>
            ))
          )}
        </div>
        <p className="his-aviso" role={aviso?.error ? "alert" : "status"} data-error={aviso?.error ? "" : undefined}>
          {aviso?.texto ?? ""}
        </p>
      </div>
    </div>,
    document.body,
  );
}
