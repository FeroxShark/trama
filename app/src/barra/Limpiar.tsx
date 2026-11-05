// «Limpiar chats»: un diálogo propio de Trama (nunca `confirm()`) que lista los chats que hace días que nadie toca, todos marcados, para
// archivarlos de una vez. Se abre desde el menú de la barra (Recientes / A-Z) y desde el menú de cada carpeta (sólo los de ella). El
// plazo se elige (1, 3, 7 o 30 días). Qué entra lo decide `limpiar-logica.ts`; archivar usa el mismo camino que el botón de cada fila
// (`alArchivar` → `settleLiderYa`): cierra el proceso y la conversación queda en disco. Sin segundo clic por fila: se destildan los que
// se quieren conservar y un solo botón archiva el resto. Estilo: el diálogo de «Seguir con otro modelo» y los componentes de `src/ui/`.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brush, Check, Skull, Moon } from "lucide-react";
import { fuente } from "../datos/fuente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { pintorHace } from "../tiempo";
import { Boton, Chip } from "../ui/componentes";
import { aArchivar, candidatosLimpiar, DIAS_DEFECTO, DIAS_LIMPIAR, type CandidatoLimpiar, type EntradaLimpiar } from "./limpiar-logica";
import "../hilo/seguir-dialogo.css";
import "./limpiar.css";

type Props = {
  /** Los líderes a la vista de la barra (`entradasLimpiar`); se mira en vivo: lo que se archivó o cambió sale o entra. */
  entradas: readonly EntradaLimpiar[];
  /** Sólo los de esta carpeta (el menú de una carpeta). */
  proyecto?: string;
  /** Cómo se llama una carpeta en la barra. */
  nombreCarpeta: (proyecto: string) => string;
  /** Archivar estos (el mismo archivar que el botón de cada fila). */
  alArchivar: (sids: string[]) => void;
  alCerrar: () => void;
  /** Captura y pruebas: la hora de "ahora" y el plazo con que nace. */
  ahora?: number;
  diasInicial?: number;
};

const textoDias = (n: number) => (n === 1 ? t("limpiar.dia1") : t("limpiar.diasN", { n }));

export function Limpiar({ entradas, proyecto, nombreCarpeta, alArchivar, alCerrar, ahora, diasInicial = DIAS_DEFECTO }: Props) {
  useIdioma();
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [dias, setDias] = useState<number>(diasInicial);
  const [destildados, setDestildados] = useState<ReadonlySet<string>>(new Set());
  // Los que tienen mensajes en la cola viven en el main: se lee una vez al abrir. Hasta entonces no se puede archivar (por las dudas).
  const [conCola, setConCola] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let vivo = true;
    void fuente
      .liderColas()
      .then((cs) => vivo && setConCola(new Set(cs.filter((a) => a.lista.length > 0 || (a.camino?.length ?? 0) > 0).map((a) => a.sid))))
      .catch(() => vivo && setConCola(new Set()));
    return () => void (vivo = false);
  }, []);
  const s = ahora ?? Math.floor(Date.now() / 1000);
  const lista = useMemo(
    () => (conCola ? candidatosLimpiar(entradas, { dias, ahora: s, conCola, ...(proyecto !== undefined ? { proyecto } : {}) }) : []),
    [entradas, dias, s, conCola, proyecto],
  );
  const marcados = aArchivar(lista, destildados);
  useFoco(raiz, { alCerrar, enfocar: "primero" });

  const alternar = (sid: string) =>
    setDestildados((d) => {
      const n = new Set(d);
      if (!n.delete(sid)) n.add(sid);
      return n;
    });
  const todosMarcados = marcados.length === lista.length;
  const alternarTodos = () => setDestildados(todosMarcados ? new Set(lista.map((x) => x.sid)) : new Set());
  const archivar = () => {
    if (!marcados.length) return;
    alArchivar(marcados);
    alCerrar();
  };
  const titulo = proyecto !== undefined ? t("limpiar.tituloCarpeta", { carpeta: nombreCarpeta(proyecto) }) : t("limpiar.titulo");

  return createPortal(
    <div className="seg-fondo" data-limpiar onMouseDown={(e) => e.target === e.currentTarget && alCerrar()}>
      <div ref={raiz} className="seg lim" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} tabIndex={-1}>
        <div className="seg-cab">
          <span className="seg-ico" aria-hidden="true">
            <Brush size={16} strokeWidth={2.2} />
          </span>
          <div className="seg-txt">
            <h3 id={`${id}-t`} className="seg-t">
              {titulo}
            </h3>
            <p id={`${id}-d`} className="seg-d">
              {t("limpiar.desc")}
            </p>
          </div>
        </div>
        <div className="lim-plazo">
          <span id={`${id}-p`} className="lim-plazo-t">
            {t("limpiar.plazo")}
          </span>
          <div className="lim-seg" role="radiogroup" aria-labelledby={`${id}-p`}>
            {DIAS_LIMPIAR.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={dias === d} className="lim-seg-b" onClick={() => setDias(d)}>
                {dias === d ? <Check size={12} aria-hidden="true" /> : null}
                {textoDias(d)}
              </button>
            ))}
          </div>
        </div>
        {conCola === null ? (
          <p className="seg-vacio" role="status">
            {t("limpiar.leyendo")}
          </p>
        ) : lista.length === 0 ? (
          <p className="seg-vacio" role="status">
            {t("limpiar.vacio", { plazo: textoDias(dias) })}
          </p>
        ) : (
          <>
            <div className="lim-barra">
              <span role="status" aria-live="polite">
                {t("limpiar.marcados", { n: marcados.length, total: lista.length })}
              </span>
              <button type="button" className="lim-todos" onClick={alternarTodos}>
                {t(todosMarcados ? "limpiar.desmarcarTodos" : "limpiar.marcarTodos")}
              </button>
            </div>
            <ul className="lim-lista" aria-label={t("limpiar.lista")}>
              {lista.map((c) => (
                <Fila key={c.sid} c={c} marcado={!destildados.has(c.sid)} alAlternar={alternar} nombreCarpeta={nombreCarpeta} ahora={s} />
              ))}
            </ul>
          </>
        )}
        <p className="lim-nota">{t("limpiar.nota")}</p>
        <div className="seg-pie lim-pie">
          <Boton className="seg-cancelar" onClick={alCerrar}>
            {t("limpiar.cancelar")}
          </Boton>
          <Boton primario className="lim-archivar" disabled={!marcados.length} onClick={archivar}>
            {t("limpiar.archivar", { n: marcados.length })}
          </Boton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Fila({ c, marcado, alAlternar, nombreCarpeta, ahora }: { c: CandidatoLimpiar; marcado: boolean; alAlternar: (sid: string) => void; nombreCarpeta: (p: string) => string; ahora: number }) {
  const nombre = c.nombre || t("lider.sesionJefe");
  const hace = pintorHace(c.actividad)(ahora).texto;
  return (
    <li className="lim-fila" data-marcado={marcado ? "" : undefined} data-limpiar-fila={c.sid}>
      <label className="lim-label">
        <input type="checkbox" className="lim-chk" checked={marcado} onChange={() => alAlternar(c.sid)} />
        <span className="lim-txt">
          <span className="lim-nombre" title={nombre}>
            {nombre}
          </span>
          <span className="lim-meta">
            {nombreCarpeta(c.proyecto)} · {hace}
          </span>
        </span>
        {c.estado === "murio" ? (
          <Chip tono="critico">
            <Skull size={11} strokeWidth={2.4} aria-hidden="true" /> {t("estado.fallo")}
          </Chip>
        ) : c.estado === "cerrado" ? (
          <Chip>
            <Moon size={11} strokeWidth={2.4} aria-hidden="true" /> {t("lider.cerrado")}
          </Chip>
        ) : (
          <Chip>{t("limpiar.estadoQuieto")}</Chip>
        )}
      </label>
    </li>
  );
}
