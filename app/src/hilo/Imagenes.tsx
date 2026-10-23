// Las imágenes de un mensaje del usuario a un líder (B26): miniaturas en su globo
// (y en la caja, con × para sacarlas); un clic abre la imagen grande sobre la
// vista (un clic, Esc o su botón la cierran; mientras llega dice que está cargando). Un archivo que no es imagen es un chip con su
// nombre (en la caja, con ×; en el globo, sacado de la línea con su ruta).
import { memo, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ArchivoAdjunto } from "../../electron/adjunto";
import type { Imagen } from "../../electron/imagenes";
import { useFoco } from "../foco";
import { MODO } from "../modo";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { esArchivo, urlDe, type Adjunto } from "./adjuntos";

const ABRIR = { type: "spring", stiffness: 520, damping: 40 } as const;

/** La captura `lider-imagenes` con `HILOS_VARIANTE=visor`: el visor abierto y la imagen sin llegar, para ver el "Cargando…". */
const VISOR_CARGANDO = MODO.captura === "lider-imagenes" && MODO.variante === "visor";

/** Qué se ve en el visor mientras la imagen no está: nada que se mueva, una línea quieta. */
type Carga = "cargando" | "lista" | "falla";

function Visor({ img, alCerrar }: { img: Imagen; alCerrar: () => void }) {
  const quieto = useReducedMotion();
  useIdioma();
  const [carga, setCarga] = useState<Carga>("cargando");
  const foto = useRef<HTMLImageElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  useFoco(caja, { alCerrar });
  // Una imagen que ya estaba en el caché del navegador no avisa con `load` si llegó antes de enganchar el aviso.
  useLayoutEffect(() => {
    const f = foto.current;
    if (!VISOR_CARGANDO && f?.complete) setCarga(f.naturalWidth > 0 ? "lista" : "falla");
  }, []);
  return createPortal(
    <motion.div
      ref={caja}
      className="visor"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={t("adjunto.imagen")}
      aria-busy={carga === "cargando"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: quieto ? 0 : 0.14 }}
      onClick={alCerrar}
    >
      {carga !== "lista" ? (
        <div className="visor-estado" role="status" data-falla={carga === "falla" ? "" : undefined}>
          {t(carga === "falla" ? "adjunto.noAbre" : "adjunto.cargando")}
        </div>
      ) : null}
      <motion.img
        ref={foto}
        src={VISOR_CARGANDO ? undefined : urlDe(img)}
        alt={t("adjunto.imagen")}
        data-lista={carga === "lista" ? "" : undefined}
        onLoad={() => setCarga("lista")}
        onError={() => setCarga("falla")}
        initial={quieto ? false : { scale: 0.96 }}
        animate={{ scale: 1 }}
        transition={ABRIR}
      />
      <button
        type="button"
        className="visor-x"
        data-cerrar-visor
        aria-label={t("adjunto.cerrar")}
        data-tip={t("adjunto.cerrar")}
        onClick={(e) => {
          e.stopPropagation();
          alCerrar();
        }}
      >
        <X size={16} strokeWidth={2.2} />
      </button>
    </motion.div>,
    document.body,
  );
}

/** Un archivo adjunto: su nombre (la ruta, en el tooltip). */
const Chip = ({ nombre }: { nombre: string }) => (
  <span className="chip-nombre">
    <FileText size={12} strokeWidth={2} />
    <span>{nombre}</span>
  </span>
);

const SIN_ARCHIVOS: readonly ArchivoAdjunto[] = [];

/** Las miniaturas de un mensaje mandado (un clic, grande) y sus archivos. */
export const Miniaturas = memo(function Miniaturas({ imagenes, archivos = SIN_ARCHIVOS }: { imagenes: readonly Imagen[]; archivos?: readonly ArchivoAdjunto[] }) {
  useIdioma();
  const [abierta, setAbierta] = useState<number | null>(VISOR_CARGANDO ? 0 : null);
  return (
    <div className="minis">
      {imagenes.map((img, k) => (
        <button key={k} type="button" className="miniatura" aria-label={t("adjunto.ver")} data-tip={t("adjunto.ver")} onClick={() => setAbierta(k)}>
          <img src={urlDe(img)} alt="" loading="lazy" decoding="async" />
        </button>
      ))}
      {archivos.map((a, k) => (
        <div key={"a" + k} className="miniatura chip-archivo" data-tip={a.ruta}>
          <Chip nombre={a.nombre} />
        </div>
      ))}
      {abierta !== null && imagenes[abierta] ? <Visor img={imagenes[abierta]} alCerrar={() => setAbierta(null)} /> : null}
    </div>
  );
});

/** Las que esperan en la caja: con × para sacarlas. */
export const Adjuntos = memo(function Adjuntos({ lista, alQuitar }: { lista: readonly Adjunto[]; alQuitar: (id: number) => void }) {
  useIdioma();
  const [abierta, setAbierta] = useState<Imagen | null>(null);
  return (
    <div className="minis adjuntos">
      {lista.map((a) => (
        <div key={a.id} className={esArchivo(a) ? "miniatura chip-archivo" : "miniatura"} data-tip={esArchivo(a) ? a.ruta : undefined}>
          {esArchivo(a) ? (
            <Chip nombre={a.nombre} />
          ) : (
            <button type="button" className="mini-ver" aria-label={t("adjunto.ver")} onMouseDown={(e) => e.preventDefault()} onClick={() => setAbierta(a)}>
              <img src={urlDe(a)} alt="" decoding="async" />
            </button>
          )}
          <button
            type="button"
            className="mini-x"
            aria-label={t("adjunto.quitar")}
            data-tip={t("adjunto.quitar")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => alQuitar(a.id)}
          >
            <X size={10} strokeWidth={2.6} />
          </button>
        </div>
      ))}
      {abierta ? <Visor img={abierta} alCerrar={() => setAbierta(null)} /> : null}
    </div>
  );
});
