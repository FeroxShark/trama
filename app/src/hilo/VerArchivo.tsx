// Los archivos que una herramienta lee, escribe o edita (la actividad de un worker, de un subagente o de un líder) o que nombra
// un mensaje: una imagen abre el visor propio; PDF, markdown, texto, código, audio y video abren la hoja. Lo que ya no está dice
// "Archivo ya no disponible". Los bytes los lee el main por `archivo:ver` (electron/archivo-ver.ts), nunca `file://`.
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eye, FileAudio, FileText, FileVideo, FolderOpen, ImageIcon, SquareArrowOutUpRight, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { abribleConSistema, archivoDeRuta, extensionDe, type ArchivoDeHerramienta, type ArchivoVisto } from "../../electron/archivo-ruta";
import { nombreDe } from "../../electron/imagen-ruta";
import { fuente } from "../datos/fuente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { esVentana } from "../puente";
import { Filas } from "./Diff";
import { Texto } from "./Texto";
import { filasLeidas } from "./worker-datos";

/* Los ya leídos, para que volver a abrir (o repintar la línea) no los pida otra vez: pocos y chicos, un PDF pesa megas. */
const LEIDOS_MAX = 10;
export const PESO_CACHE = 3_000_000;
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

/* El archivo de `ruta` (`undefined` mientras se lee; `null` si ya no está), sólo cuando `activo`. */
export function useArchivoVisto(ruta: string, activo: boolean): ArchivoVisto | null | undefined {
  const [v, setV] = useState<ArchivoVisto | null | undefined>(() => (activo ? leidos.get(ruta) : undefined));
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

/* Verdadero cuando el elemento entra en pantalla (la miniatura no se pide antes). Sin IntersectionObserver, de entrada. */
export function useVisible(el: React.RefObject<HTMLElement | null>): boolean {
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

/* Los bytes en base64 como una URL del navegador (un PDF en un iframe o un video no andan con una data: URL); se suelta al cerrar. */
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

/* Captura `herramientas-resultados` con `HILOS_VARIANTE=archivo-<tipo>` (imagen, texto, md, pdf): el primer archivo de ese tipo sale abierto en el visor. */
const ABRIR_EN_CAPTURA = MODO.captura === "herramientas-resultados" ? (MODO.variante ?? "").replace(/^archivo-(md)$/, "markdown").replace(/^archivo-/, "") : "";
let abiertoEnCaptura = false;
const abrirEnCaptura = (tipo: string) => (ABRIR_EN_CAPTURA === tipo && !abiertoEnCaptura ? (abiertoEnCaptura = true) : false);

const ICONO = { imagen: ImageIcon, pdf: FileText, markdown: FileText, texto: FileText, audio: FileAudio, video: FileVideo, otro: SquareArrowOutUpRight } as const;
const ZOOM_MAX = 6;

/* Visor propio de imágenes: fondo oscuro, barra superior con datos y acciones, zoom por clic/rueda, arrastre y doble clic para volver a entera. */
function VisorImagen({ a, v, alCerrar }: { a: ArchivoDeHerramienta; v: ArchivoVisto | null | undefined; alCerrar: () => void }) {
  const quieto = useReducedMotion();
  useIdioma();
  const caja = useRef<HTMLDivElement>(null);
  const escena = useRef<HTMLDivElement>(null);
  const foto = useRef<HTMLImageElement>(null);
  useFoco(caja, { alCerrar });
  const nombre = nombreDe(a.ruta);
  const puedeVentana = esVentana() || MODO.fixtures;
  const sistema = puedeVentana && abribleConSistema(a.ruta);
  const src = v?.tipo === "imagen" ? `data:${v.mime};base64,${v.datos}` : null;
  const [medida, setMedida] = useState<{ ancho: number; alto: number } | null>(null);
  const [imgFallo, setImgFallo] = useState(false);
  const [escala, setEscala] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [arrastrando, setArrastrando] = useState(false);
  const [animar, setAnimar] = useState(false);
  const [falloSistema, setFalloSistema] = useState(false);
  const [falloCarpeta, setFalloCarpeta] = useState(false);
  const arrastre = useRef<{ id: number; sx: number; sy: number; px: number; py: number; movio: boolean } | null>(null);
  const suprimirClic = useRef(false);

  useEffect(() => {
    setMedida(null);
    setImgFallo(false);
    setEscala(1);
    setPan({ x: 0, y: 0 });
    setAnimar(false);
  }, [a.ruta]);

  useLayoutEffect(() => {
    const f = foto.current;
    if (src && f?.complete) {
      if (f.naturalWidth > 0) {
        setMedida({ ancho: f.naturalWidth, alto: f.naturalHeight });
        setImgFallo(false);
      } else {
        setImgFallo(true);
      }
    }
  }, [src]);

  const limitarPan = (nx: number, ny: number, s: number) => {
    const e = escena.current;
    const f = foto.current;
    if (!e || !f || s <= 1) return { x: 0, y: 0 };
    const ew = e.clientWidth;
    const eh = e.clientHeight;
    const maxX = Math.max(0, (f.offsetWidth * s - ew) / 2);
    const maxY = Math.max(0, (f.offsetHeight * s - eh) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, nx)),
      y: Math.max(-maxY, Math.min(maxY, ny)),
    };
  };

  const restablecer = () => {
    setEscala(1);
    setPan({ x: 0, y: 0 });
    setAnimar(true);
  };

  const hacerZoom = (objetivo: number, cx?: number, cy?: number, suave = false) => {
    const nueva = Math.max(1, Math.min(ZOOM_MAX, Number(objetivo.toFixed(3))));
    if (nueva <= 1.03) {
      setEscala(1);
      setPan({ x: 0, y: 0 });
      setAnimar(suave);
      return;
    }
    if (cx !== undefined && cy !== undefined && escena.current) {
      const r = escena.current.getBoundingClientRect();
      const dx = cx - (r.left + r.width / 2);
      const dy = cy - (r.top + r.height / 2);
      const factor = nueva / escala;
      setPan(limitarPan(dx - (dx - pan.x) * factor, dy - (dy - pan.y) * factor, nueva));
    } else {
      setPan((p) => limitarPan(p.x, p.y, nueva));
    }
    setEscala(nueva);
    setAnimar(suave);
  };

  const cargando = v === undefined;
  const falta = v === null || (src !== null && imgFallo);
  const acercada = escala > 1;

  return createPortal(
    <motion.div
      ref={caja}
      className="visor-img"
      data-tema="grafito"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={nombre}
      aria-busy={cargando}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: quieto ? 0 : 0.14 }}
      onKeyDown={(e) => {
        if (!src || imgFallo) return;
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          hacerZoom(escala === 1 ? 2 : escala * 1.35, undefined, undefined, true);
        } else if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          hacerZoom(escala / 1.35, undefined, undefined, true);
        } else if (e.key === "0") {
          e.preventDefault();
          restablecer();
        }
      }}
    >
      <div className="visor-img-barra" onClick={(e) => e.stopPropagation()}>
        <div className="visor-img-info">
          <span className="visor-img-icono" aria-hidden="true">
            <ImageIcon size={15} strokeWidth={1.8} />
          </span>
          <span className="visor-img-nombre" data-tip={a.ruta} title={a.ruta}>
            {nombre}
          </span>
          {medida ? (
            <span className="visor-img-medida">
              {t("visor.medida", { ancho: medida.ancho, alto: medida.alto })}
            </span>
          ) : null}
          {acercada ? (
            <button
              type="button"
              className="visor-img-zoom"
              aria-label={t("visor.restablecer")}
              data-tip={t("visor.restablecer")}
              onClick={restablecer}
            >
              {Math.round(escala * 100)}%
            </button>
          ) : null}
        </div>
        <div className="visor-img-acciones">
          {puedeVentana ? (
            <button
              type="button"
              className="visor-img-btn"
              data-fallo={falloCarpeta ? "" : undefined}
              aria-label={t("visor.mostrarCarpetaAria", { nombre })}
              data-tip={falloCarpeta ? t("visor.noAbrioCarpeta") : a.ruta}
              onClick={() => {
                setFalloCarpeta(false);
                void fuente.carpetaAbrir(a.ruta).then(
                  (ok) => setFalloCarpeta(!ok),
                  () => setFalloCarpeta(true),
                );
              }}
            >
              <FolderOpen size={14} strokeWidth={1.9} aria-hidden="true" />
              <span>{falloCarpeta ? t("visor.noAbrioCarpeta") : t("visor.mostrarCarpeta")}</span>
            </button>
          ) : null}
          {sistema ? (
            <button
              type="button"
              className="visor-img-btn"
              data-fallo={falloSistema ? "" : undefined}
              aria-label={t("archivo.abrirSistema", { nombre })}
              data-tip={falloSistema ? t("archivo.noAbrio") : t("archivo.sistema")}
              onClick={() => {
                setFalloSistema(false);
                void fuente.archivoAbrir(a.ruta).then(
                  (ok) => setFalloSistema(!ok),
                  () => setFalloSistema(true),
                );
              }}
            >
              <SquareArrowOutUpRight size={14} strokeWidth={1.9} aria-hidden="true" />
              <span>{falloSistema ? t("archivo.noAbrio") : t("archivo.sistema")}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="visor-img-cerrar"
            data-cerrar-visor
            aria-label={t("adjunto.cerrar")}
            data-tip={t("adjunto.cerrar")}
            onClick={alCerrar}
          >
            <X size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
      <div
        ref={escena}
        className="visor-img-escena"
        onWheel={(e) => {
          if (!src || imgFallo) return;
          const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
          hacerZoom(escala * factor, e.clientX, e.clientY, false);
        }}
        onClick={(e) => {
          if (suprimirClic.current) {
            suprimirClic.current = false;
            return;
          }
          if (e.target === e.currentTarget) alCerrar();
        }}
      >
        {cargando || falta ? (
          <div className="visor-estado" role="status" data-falla={falta ? "" : undefined}>
            {falta ? t(v === null ? "archivo.noDisponible" : "adjunto.noAbre", { nombre }) : t("adjunto.cargando")}
          </div>
        ) : null}
        {src && !imgFallo ? (
          <img
            ref={foto}
            className="visor-img-foto"
            src={src}
            alt={nombre}
            draggable={false}
            data-lista={medida ? "" : undefined}
            data-zoom={acercada ? "acercada" : "entera"}
            data-arrastrando={arrastrando ? "" : undefined}
            data-animar={animar && !quieto ? "" : undefined}
            style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${escala})` }}
            onLoad={(e) => {
              const f = e.currentTarget;
              if (f.naturalWidth > 0) {
                setMedida({ ancho: f.naturalWidth, alto: f.naturalHeight });
                setImgFallo(false);
              } else {
                setImgFallo(true);
              }
            }}
            onError={() => setImgFallo(true)}
            onPointerDown={(e) => {
              if (e.button !== 0 || escala <= 1) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              arrastre.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, movio: false };
              setArrastrando(true);
              setAnimar(false);
            }}
            onPointerMove={(e) => {
              const st = arrastre.current;
              if (!st || st.id !== e.pointerId) return;
              const dx = e.clientX - st.sx;
              const dy = e.clientY - st.sy;
              if (!st.movio && Math.hypot(dx, dy) > 4) st.movio = true;
              if (st.movio) setPan(limitarPan(st.px + dx, st.py + dy, escala));
            }}
            onPointerUp={(e) => {
              const st = arrastre.current;
              if (!st || st.id !== e.pointerId) return;
              arrastre.current = null;
              setArrastrando(false);
              if (st.movio) suprimirClic.current = true;
            }}
            onPointerCancel={(e) => {
              const st = arrastre.current;
              if (!st || st.id !== e.pointerId) return;
              arrastre.current = null;
              setArrastrando(false);
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (suprimirClic.current) {
                suprimirClic.current = false;
                return;
              }
              const prox = escala < 1.9 ? 2 : Math.min(ZOOM_MAX, Number((escala * 1.6).toFixed(2)));
              hacerZoom(prox, e.clientX, e.clientY, true);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              restablecer();
            }}
          />
        ) : null}
      </div>
    </motion.div>,
    document.body,
  );
}

/* Una vista del archivo sobre todo lo demás: un clic afuera, Esc o su botón la cierran. */
function Hoja({ a, v, linea, alCerrar }: { a: ArchivoDeHerramienta; v: ArchivoVisto | null | undefined; linea?: number | null; alCerrar: () => void }) {
  const quieto = useReducedMotion();
  useIdioma();
  const caja = useRef<HTMLDivElement>(null);
  useFoco(caja, { alCerrar });
  const url = useUrlDe(v);
  const nombre = nombreDe(a.ruta);
  const [fallo, setFallo] = useState(false);
  const Ico = ICONO[a.tipo];
  const sistema = esVentana() && abribleConSistema(a.ruta);
  // Abierto desde un resultado (`ruta:línea`): baja hasta esa línea, resaltada.
  const hayTexto = v?.tipo === "texto";
  useEffect(() => {
    if (hayTexto && linea != null) caja.current?.querySelector("[data-marca]")?.scrollIntoView({ block: "center" });
  }, [hayTexto, linea]);
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
  else if (v.tipo === "markdown") cuerpo = <div className="arch-md el"><Texto texto={v.texto} /></div>;
  else if (v.tipo === "texto")
    cuerpo = (
      <div className="arch-texto">
        <Filas filas={filasLeidas(v.texto, 1)} lang={extensionDe(a.ruta)} marca={linea} />
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

/* El archivo abierto: una imagen, en el visor propio; lo demás, en la hoja. */
export function VerArchivo({ a, linea, alCerrar }: { a: ArchivoDeHerramienta; linea?: number | null; alCerrar: () => void }) {
  const v = useArchivoVisto(a.ruta, true);
  if (a.tipo === "imagen" || v?.tipo === "imagen") return <VisorImagen a={a} v={v} alCerrar={alCerrar} />
  return <Hoja a={a} v={v} linea={linea} alCerrar={alCerrar} />
}

/*
 * Una ruta dentro de un texto (la salida de un grep, un error con `ruta:línea`) que abre el archivo en el visor, en esa línea. Lo que no se
 * puede ubicar (una ruta relativa sin carpeta) o no se puede abrir queda como texto: nunca un enlace que no hace nada.
 */
export function EnlaceTexto({ ruta, linea = null, className, tip, children }: { ruta: string; linea?: number | null; className?: string; tip?: string; children: ReactNode }) {
  useIdioma();
  const a = archivoDeRuta(ruta, "leer");
  const [abierto, setAbierto] = useState(false);
  const [fallo, setFallo] = useState(false);
  const otro = a?.tipo === "otro";
  if (!a?.absoluta || (otro && !(esVentana() && abribleConSistema(ruta)))) return <span className={className} data-sin-enlace="">{children}</span>;
  return (
    <>
      <button type="button" className={className} data-fallo={fallo ? "" : undefined} data-tip={fallo ? t("archivo.noAbrio") : tip} onClick={() => (otro ? void fuente.archivoAbrir(ruta).then((ok) => setFallo(!ok)) : setAbierto(true))}>
        {children}
      </button>
      {abierto ? <VerArchivo a={a} linea={linea} alCerrar={() => setAbierto(false)} /> : null}
    </>
  );
}

/* Una imagen chica en la línea: se pide cuando entra en pantalla y sólo si pesa poco. */
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

/*
 * El botón de un archivo de la actividad: abre el visor (o la app del sistema, si el visor no lo muestra). `miniatura`: una
 * imagen chica en la línea; `etiqueta`: el nombre del archivo escrito al lado. Una ruta relativa no se puede ubicar: no hay botón.
 */
export const EnlaceArchivo = memo(function EnlaceArchivo({ a, miniatura = true, etiqueta = false }: { a: ArchivoDeHerramienta; miniatura?: boolean; etiqueta?: boolean }) {
  useIdioma();
  const [abierto, setAbierto] = useState(() => !!a.absoluta && abrirEnCaptura(a.tipo));
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

/* Una imagen que un worker leyó, más grande (el cuerpo del paso): un clic la abre en el visor. */
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
