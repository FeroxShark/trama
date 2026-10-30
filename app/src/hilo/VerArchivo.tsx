// Los archivos que una herramienta lee, escribe o edita (la actividad de un worker, de un subagente o de un líder): un botón
// con la miniatura (si es una imagen) que abre el archivo en el visor, el mismo de las imágenes de un mensaje (./Imagenes.tsx).
// Imagen, PDF, audio y video se ven con el navegador; el texto y el código, con su numeración y resaltado (./Diff.tsx); el markdown,
// renderizado. Lo que no se puede mostrar se abre con la app del sistema; lo que ya no está (el worktree de un worker se borra al
// integrar) dice "Archivo ya no disponible". Los bytes los lee el main por `archivo:ver` (electron/archivo-ver.ts), nunca `file://`.
import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, FileAudio, FileText, FileVideo, ImageIcon, SquareArrowOutUpRight, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { abribleConSistema, extensionDe, type ArchivoDeHerramienta, type ArchivoVisto } from "../../electron/archivo-ruta";
import { nombreDe } from "../../electron/imagen-ruta";
import { fuente } from "../datos/fuente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { esVentana } from "../puente";
import { Filas } from "./Diff";
import { Visor } from "./Imagenes";
import { Texto } from "./Texto";
import { filasLeidas } from "./worker-datos";

/** Los ya leídos, para que volver a abrir (o repintar la línea) no los pida otra vez: pocos y chicos, un PDF pesa megas. */
const LEIDOS_MAX = 10;
const PESO_CACHE = 3_000_000;
const leidos = new Map<string, ArchivoVisto>();

const peso = (v: ArchivoVisto) => ("datos" in v ? v.datos.length : v.texto.length);

function pedir(ruta: string): Promise<ArchivoVisto | null> {
  const ya = leidos.get(ruta);
  if (ya) return Promise.resolve(ya);
  return fuente.archivoVisto(ruta).then(
    (v) => {
      if (v && peso(v) <= PESO_CACHE) {
        if (leidos.size >= LEIDOS_MAX) leidos.delete(leidos.keys().next().value!);
        leidos.set(ruta, v);
      }
      return v;
    },
    () => null,
  );
}

/** El archivo de `ruta` (`undefined` mientras se lee; `null` si ya no está), sólo cuando `activo`. */
function useArchivoVisto(ruta: string, activo: boolean): ArchivoVisto | null | undefined {
  const [v, setV] = useState<ArchivoVisto | null | undefined>(() => leidos.get(ruta));
  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    setV(leidos.get(ruta));
    void pedir(ruta).then((x) => vigente && setV(x));
    return () => {
      vigente = false;
    };
  }, [ruta, activo]);
  return v;
}

/** Verdadero cuando el elemento entra en pantalla (la miniatura no se pide antes). Sin IntersectionObserver, de entrada. */
function useVisible(el: React.RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const e = el.current;
    if (visible || !e) return;
    const o = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && (setVisible(true), o.disconnect()), { rootMargin: "120px" });
    o.observe(e);
    return () => o.disconnect();
  }, [el, visible]);
  return visible;
}

/** Los bytes en base64 como una URL del navegador (un PDF en un iframe o un video no andan con una data: URL); se suelta al cerrar. */
function useUrlDe(v: ArchivoVisto | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!v || !("datos" in v)) return void setUrl(null);
    const bin = atob(v.datos);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    const u = URL.createObjectURL(new Blob([b], { type: v.mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [v]);
  return url;
}

const ICONO = { imagen: ImageIcon, pdf: FileText, markdown: FileText, texto: FileText, audio: FileAudio, video: FileVideo, otro: SquareArrowOutUpRight } as const;

/** Una vista del archivo sobre todo lo demás: un clic afuera, Esc o su botón la cierran. */
function Hoja({ a, v, alCerrar }: { a: ArchivoDeHerramienta; v: ArchivoVisto | null | undefined; alCerrar: () => void }) {
  const quieto = useReducedMotion();
  useIdioma();
  const caja = useRef<HTMLDivElement>(null);
  useFoco(caja, { alCerrar });
  const url = useUrlDe(v);
  const nombre = nombreDe(a.ruta);
  const [fallo, setFallo] = useState(false);
  const Ico = ICONO[a.tipo];
  const sistema = esVentana() && abribleConSistema(a.ruta);
  let cuerpo;
  if (v === undefined)
    cuerpo = (
      <div className="visor-estado" role="status">
        {t("archivo.cargando")}
      </div>
    );
  else if (v === null)
    cuerpo = (
      <div className="visor-estado" role="status" data-falla="">
        {t("archivo.noDisponible", { nombre })}
      </div>
    );
  else if (v.tipo === "pdf") cuerpo = url ? <iframe className="arch-pdf" src={url} title={nombre} /> : null;
  else if (v.tipo === "audio") cuerpo = url ? <audio className="arch-audio" src={url} controls autoPlay={false} /> : null;
  else if (v.tipo === "video") cuerpo = url ? <video className="arch-video" src={url} controls /> : null;
  else if (v.tipo === "markdown") cuerpo = <div className="arch-md"><Texto texto={v.texto} /></div>;
  else if (v.tipo === "texto")
    cuerpo = (
      <div className="arch-texto">
        <Filas filas={filasLeidas(v.texto, 1)} lang={extensionDe(a.ruta)} />
        {v.recortado ? <div className="wk-nota">{t("archivo.recortado", { n: Math.round(v.texto.length / 1024) })}</div> : null}
      </div>
    );
  else cuerpo = null;
  return createPortal(
    <motion.div
      ref={caja}
      className="visor"
      data-archivo=""
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={nombre}
      aria-busy={v === undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: quieto ? 0 : 0.14 }}
      onClick={alCerrar}
    >
      <div className="arch-hoja" onClick={(e) => e.stopPropagation()}>
        <div className="arch-h">
          <Ico size={14} strokeWidth={1.8} aria-hidden="true" />
          <span className="arch-nombre" data-tip={a.ruta}>
            {nombre}
          </span>
          {sistema && v ? (
            <button
              type="button"
              className="arch-sis"
              data-fallo={fallo ? "" : undefined}
              aria-label={t("archivo.abrirSistema", { nombre })}
              data-tip={fallo ? t("archivo.noAbrio") : t("archivo.sistema")}
              onClick={() => void fuente.archivoAbrir(a.ruta).then((ok) => setFallo(!ok))}
            >
              <SquareArrowOutUpRight size={13} strokeWidth={1.9} aria-hidden="true" />
              <span>{fallo ? t("archivo.noAbrio") : t("archivo.sistema")}</span>
            </button>
          ) : null}
        </div>
        <div className="arch-c">{cuerpo}</div>
      </div>
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

/** El archivo abierto: una imagen, en el visor de las imágenes; lo demás, en la hoja. Lo que no se muestra, con la app del sistema. */
function VerArchivo({ a, alCerrar }: { a: ArchivoDeHerramienta; alCerrar: () => void }) {
  const v = useArchivoVisto(a.ruta, true);
  if (v?.tipo === "imagen") return <Visor img={{ tipo: v.mime, datos: v.datos }} alCerrar={alCerrar} />;
  return <Hoja a={a} v={v} alCerrar={alCerrar} />;
}

/** Una imagen chica en la línea: se pide cuando entra en pantalla y sólo si pesa poco. */
function Miniatura({ ruta, lado }: { ruta: string; lado: "chica" | "grande" }) {
  const el = useRef<HTMLSpanElement>(null);
  const visible = useVisible(el);
  const v = useArchivoVisto(ruta, visible);
  const src = v?.tipo === "imagen" && v.datos.length <= PESO_CACHE ? `data:${v.mime};base64,${v.datos}` : null;
  return (
    <span ref={el} className="arch-mini" data-lado={lado} data-estado={!visible || v === undefined ? "cargando" : src ? "lista" : "falta"}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}
    </span>
  );
}

/**
 * El botón de un archivo de la actividad: abre el visor (o la app del sistema, si el visor no lo muestra). `miniatura`: una
 * imagen chica en la línea; `etiqueta`: el nombre del archivo escrito al lado. Una ruta relativa no se puede ubicar: no hay botón.
 */
export const EnlaceArchivo = memo(function EnlaceArchivo({ a, miniatura = true, etiqueta = false }: { a: ArchivoDeHerramienta; miniatura?: boolean; etiqueta?: boolean }) {
  useIdioma();
  const [abierto, setAbierto] = useState(false);
  const [fallo, setFallo] = useState(false);
  if (!a.absoluta) return null;
  const nombre = nombreDe(a.ruta);
  const otro = a.tipo === "otro";
  // Sin visor y sin app del sistema (el navegador del celular) no hay nada que hacer con un .docx.
  if (otro && !(esVentana() && abribleConSistema(a.ruta))) return null;
  const Ico = a.tipo === "imagen" ? ImageIcon : otro ? SquareArrowOutUpRight : Eye;
  const dice = fallo ? t("archivo.noAbrio") : t(otro ? "archivo.abrirSistema" : "archivo.ver", { nombre });
  return (
    <>
      <button
        type="button"
        className="arch-v"
        data-fallo={fallo ? "" : undefined}
        aria-label={dice}
        data-tip={dice}
        onClick={() => (otro ? void fuente.archivoAbrir(a.ruta).then((ok) => setFallo(!ok)) : setAbierto(true))}
      >
        {miniatura && a.tipo === "imagen" ? <Miniatura ruta={a.ruta} lado="chica" /> : <Ico size={12} strokeWidth={2} aria-hidden="true" />}
        {etiqueta ? <span className="arch-et">{nombre}</span> : null}
      </button>
      {abierto ? <VerArchivo a={a} alCerrar={() => setAbierto(false)} /> : null}
    </>
  );
});

/** Una imagen que un worker leyó, más grande (el cuerpo del paso): un clic la abre en el visor. */
export const FotoArchivo = memo(function FotoArchivo({ a }: { a: ArchivoDeHerramienta }) {
  const [abierto, setAbierto] = useState(false);
  useIdioma();
  if (!a.absoluta) return null;
  return (
    <>
      <button type="button" className="arch-v arch-foto" aria-label={t("archivo.ver", { nombre: nombreDe(a.ruta) })} data-tip={t("archivo.ver", { nombre: nombreDe(a.ruta) })} onClick={() => setAbierto(true)}>
        <Miniatura ruta={a.ruta} lado="grande" />
      </button>
      {abierto ? <VerArchivo a={a} alCerrar={() => setAbierto(false)} /> : null}
    </>
  );
});
