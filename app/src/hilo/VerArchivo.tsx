// Los archivos que una herramienta lee, escribe o edita (la actividad de un worker, de un subagente o de un líder) o que nombra
// un mensaje: una imagen abre el visor propio; PDF, markdown, texto, código, audio y video abren la hoja. Lo que ya no está dice
// "Archivo ya no disponible". Los bytes los lee el main por `archivo:ver` (electron/archivo-ver.ts), nunca `file://`.
import { useAtrasVisor } from "../angosto";
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Copy, Download, Eye, FileAudio, FileText, FileVideo, FolderOpen, ImageIcon, Link2, Maximize, RotateCcw, RotateCw, SquareArrowOutUpRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { abribleConSistema, archivoDeRuta, extensionDe, type ArchivoDeHerramienta, type ArchivoVisto } from "../../electron/archivo-ruta";
import { nombreDe } from "../../electron/imagen-ruta";
import { fuente } from "../datos/fuente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { esVentana } from "../puente";
import { Menu, type ItemMenu } from "../barra/Menu";
import { copiarConAviso, copiarImagen } from "../copiar";
import { Filas } from "./Diff";
import { Texto } from "./Texto";
import { filasLeidas } from "./worker-datos";
import {
  cursorDeVisor,
  escalaAjuste,
  esMismaEscala,
  galeriaDe,
  girar,
  limitarPan,
  medidaGirada,
  panConRueda,
  PASO_BOTON,
  PASO_RUEDA,
  PASO_TECLA_PAN,
  porcentajeZoom,
  puedeArrastrar,
  siguienteEscalaAlClic,
  vecino,
  zoomHaciaPunto,
  type Giro,
  type Punto,
  type Tamano,
} from "./visor-zoom";

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
  // Guarda de qué ruta es lo leído: al pasar a otra imagen no se ve, ni un cuadro, la anterior.
  const [s, setS] = useState<{ ruta: string; v: ArchivoVisto | null | undefined }>(() => ({ ruta, v: activo ? leidos.get(ruta) : undefined }));
  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    setS({ ruta, v: leidos.get(ruta) });
    void pedir(ruta).then((x) => vigente && setS({ ruta, v: x }));
    return () => {
      vigente = false;
    };
  }, [ruta, activo]);
  return s.ruta === ruta ? s.v : activo ? leidos.get(ruta) : undefined;
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
/** Las rutas de las imágenes que el chat de `ruta` tiene a la vista, en el orden en que aparecen (cada botón que abre una lleva `data-imagen-ruta`). */
function rutasDeImagenes(ruta: string): string[] {
  if (typeof document === "undefined") return [ruta];
  const todos = [...document.querySelectorAll<HTMLElement>("[data-imagen-ruta]")];
  const propio = todos.find((e) => e.getAttribute("data-imagen-ruta") === ruta);
  const chat = propio?.closest(".conv") ?? null;
  return todos.filter((e) => !chat || chat.contains(e)).map((e) => e.getAttribute("data-imagen-ruta") ?? "");
}

/** Pasar a otra imagen del chat: el lugar ("N de M") y qué hacer con anterior y siguiente (`null` en el extremo). */
type Galeria = { n: number; total: number; anterior: (() => void) | null; siguiente: (() => void) | null };

/* Visor propio de imágenes: una barra de vidrio arriba (nombre, medida y «N de M» · zoom · girar, copiar, guardar, carpeta, sistema, cerrar) y la
   imagen debajo. Abre con la imagen ENTERA (ajustada al área, sin agrandar las chicas); clic o doble clic alterna entre Ajustar y 100 %, la rueda
   acerca hacia el puntero (con Shift desplaza), se arrastra siempre que no entre, y el clic derecho trae el mismo menú de copiar y abrir. Si el
   chat tiene varias imágenes, flechas a los costados (y ← →) pasan de una a otra. Girar sólo cambia cómo se ve: copiar y guardar usan el original.
   La cuenta: visor-zoom.ts. */
function VisorImagen({ a, v, alCerrar, galeria }: { a: ArchivoDeHerramienta; v: ArchivoVisto | null | undefined; alCerrar: () => void; galeria: Galeria | null }) {
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
  const [medida, setMedida] = useState<Tamano | null>(null);
  const [area, setArea] = useState<Tamano>({ ancho: 0, alto: 0 });
  const [imgFallo, setImgFallo] = useState(false);
  // `null` = Ajustar (sigue al área si la ventana cambia); un número = escala fija (1 = 100 %).
  const [zoom, setZoom] = useState<number | null>(null);
  const [pan, setPan] = useState<Punto>({ x: 0, y: 0 });
  // `giro` (0/90/180/270) decide la medida que ocupa; `angulo` suma las vueltas para que la animación gire siempre por el lado corto.
  const [vista, setVista] = useState<{ giro: Giro; angulo: number }>({ giro: 0, angulo: 0 });
  const [arrastrando, setArrastrando] = useState(false);
  const [animar, setAnimar] = useState(false);
  const [falloSistema, setFalloSistema] = useState(false);
  const [falloCarpeta, setFalloCarpeta] = useState(false);
  const [guardado, setGuardado] = useState<"ok" | "fallo" | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const arrastre = useRef<{ id: number; sx: number; sy: number; px: number; py: number; movio: boolean } | null>(null);
  const suprimirClic = useRef(false);

  // Al pasar a otra imagen: sin zoom, sin giro y sin lo medido de la anterior (antes de que la nueva avise su medida).
  useLayoutEffect(() => {
    setMedida(null);
    setImgFallo(false);
    setZoom(null);
    setPan({ x: 0, y: 0 });
    setVista({ giro: 0, angulo: 0 });
    setAnimar(false);
    setFalloSistema(false);
    setFalloCarpeta(false);
    setGuardado(null);
  }, [a.ruta]);

  // El aviso de «Guardada» (o de que falló) se apaga solo.
  useEffect(() => {
    if (!guardado) return;
    const id = window.setTimeout(() => setGuardado(null), 2200);
    return () => window.clearTimeout(id);
  }, [guardado]);

  // El área útil: la escena menos su margen. Con ResizeObserver, Ajustar sigue a la ventana.
  useLayoutEffect(() => {
    const e = escena.current;
    if (!e) return;
    const medir = () => {
      const cs = getComputedStyle(e);
      const px = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const py = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      setArea({ ancho: Math.max(0, e.clientWidth - px), alto: Math.max(0, e.clientHeight - py) });
    };
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const o = new ResizeObserver(medir);
    o.observe(e);
    return () => o.disconnect();
  }, []);

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

  // `natural` es la medida del archivo; `img`, la que ocupa en pantalla (girada de lado, ancho y alto cambian de lugar).
  const natural: Tamano = medida ?? { ancho: 0, alto: 0 };
  const img = medidaGirada(natural, vista.giro);
  const ajuste = medida ? escalaAjuste(img.ancho, img.alto, area.ancho, area.alto) : 1;
  const escala = zoom ?? ajuste;
  const movible = medida ? puedeArrastrar(img.ancho, img.alto, escala, area.ancho, area.alto) : false;
  const panVisto = limitarPan(pan, img.ancho, img.alto, escala, area.ancho, area.alto);
  const usable = !!src && !imgFallo && !!medida;

  /** El punto de la pantalla relativo al centro de la escena (lo que espera zoomHaciaPunto). */
  const focoDe = (cx: number, cy: number): Punto | null => {
    const r = escena.current?.getBoundingClientRect();
    return r ? { x: cx - (r.left + r.width / 2), y: cy - (r.top + r.height / 2) } : null;
  };
  const ajustar = (suave = true) => {
    setZoom(null);
    setPan({ x: 0, y: 0 });
    setAnimar(suave);
  };
  const irA = (objetivo: number, foco: Punto | null = null, suave = true) => {
    if (!usable) return;
    const r = zoomHaciaPunto({ escala, pan: panVisto }, objetivo, img, area, ajuste, foco);
    if (esMismaEscala(r.escala, ajuste)) return ajustar(suave);
    setZoom(r.escala);
    setPan(r.pan);
    setAnimar(suave);
  };
  const mover = (dx: number, dy: number) => {
    if (!movible) return;
    setPan(limitarPan({ x: panVisto.x + dx, y: panVisto.y + dy }, img.ancho, img.alto, escala, area.ancho, area.alto));
    setAnimar(false);
  };
  const girarVista = (sentido: 1 | -1) => {
    if (!usable) return;
    setVista((x) => ({ giro: girar(x.giro, sentido), angulo: x.angulo + 90 * sentido }));
    setPan({ x: 0, y: 0 });
    setAnimar(true);
  };

  const mostrarCarpeta = () => {
    setFalloCarpeta(false);
    void fuente.carpetaAbrir(a.ruta).then(
      (ok) => setFalloCarpeta(!ok),
      () => setFalloCarpeta(true),
    );
  };
  const abrirSistema = () => {
    setFalloSistema(false);
    void fuente.archivoAbrir(a.ruta).then(
      (ok) => setFalloSistema(!ok),
      () => setFalloSistema(true),
    );
  };
  const guardarComo = () => {
    void fuente.archivoGuardarComo(a.ruta).then(
      (r) => setGuardado(r === "guardado" ? "ok" : r === "fallo" ? "fallo" : null),
      () => setGuardado("fallo"),
    );
  };
  const copiarLaImagen = () => {
    if (v?.tipo === "imagen") void copiarImagen({ mime: v.mime, datos: v.datos }, foto.current);
  };
  const items: ItemMenu[] = [
    ...(v?.tipo === "imagen" ? [{ clave: "copiar", texto: t("visor.copiarImagen"), alElegir: () => (setMenu(null), copiarLaImagen()) }] : []),
    { clave: "ruta", texto: t("visor.copiarRuta"), alElegir: () => (setMenu(null), void copiarConAviso(a.ruta)) },
    ...(puedeVentana && usable ? [{ clave: "guardar", texto: t("visor.guardarComo"), alElegir: () => (setMenu(null), guardarComo()) }] : []),
    ...(puedeVentana ? [{ clave: "carpeta", texto: t("visor.mostrarCarpeta"), alElegir: () => (setMenu(null), mostrarCarpeta()) }] : []),
    ...(sistema ? [{ clave: "sistema", texto: t("archivo.sistema"), alElegir: () => (setMenu(null), abrirSistema()) }] : []),
  ];

  // Captura `visor-imagen-menu`: el menú abierto en el medio, cuando la imagen ya está.
  useEffect(() => {
    if (MODO.captura !== "visor-imagen-menu" || !medida) return;
    const r = escena.current?.getBoundingClientRect();
    if (r) setMenu({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, [medida]);

  const cargando = v === undefined;
  const falta = v === null || (src !== null && imgFallo);
  const cursor = cursorDeVisor({ arrastrando, puedeArrastrar: movible, escala, ajuste });
  const ajustada = zoom === null;
  const alAnterior = galeria?.anterior ?? null;
  const alSiguiente = galeria?.siguiente ?? null;

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
        if (menu) return;
        const k = e.key;
        // Con varias imágenes, ← → pasan de una a otra (Shift desplaza de costado); sin galería, las flechas desplazan.
        if (galeria && (k === "ArrowLeft" || k === "ArrowRight") && !e.shiftKey) {
          (k === "ArrowLeft" ? alAnterior : alSiguiente)?.();
          e.preventDefault();
          return;
        }
        if (!usable) return;
        if (k === "+" || k === "=") irA(escala * PASO_BOTON);
        else if (k === "-" || k === "_") irA(escala / PASO_BOTON);
        else if (k === "0") ajustar();
        else if (k === "1") irA(1);
        else if (k === "ArrowLeft") mover(PASO_TECLA_PAN, 0);
        else if (k === "ArrowRight") mover(-PASO_TECLA_PAN, 0);
        else if (k === "ArrowUp") mover(0, PASO_TECLA_PAN);
        else if (k === "ArrowDown") mover(0, -PASO_TECLA_PAN);
        else return;
        e.preventDefault();
      }}
    >
      <div className="visor-img-barra" onClick={(e) => e.stopPropagation()}>
        <div className="visor-img-info">
          <span className="visor-img-icono" aria-hidden="true">
            <ImageIcon size={15} strokeWidth={1.8} />
          </span>
          <span className="visor-img-nombre" data-tip={a.ruta} data-tip-abajo="" title={a.ruta}>
            {nombre}
          </span>
          {medida ? <span className="visor-img-chip">{t("visor.medida", { ancho: medida.ancho, alto: medida.alto })}</span> : null}
          {galeria ? <span className="visor-img-chip">{t("visor.posicion", { n: galeria.n, total: galeria.total })}</span> : null}
        </div>
        {usable ? (
          <div className="visor-img-grupo" role="group" aria-label={t("visor.zoomGrupo")}>
            <button type="button" className="visor-img-ib" aria-label={t("visor.alejar")} data-tip={t("visor.alejar")} data-tip-abajo="" onClick={() => irA(escala / PASO_BOTON)}>
              <ZoomOut size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className="visor-img-pct" role="status" aria-label={t("visor.zoomActual", { n: porcentajeZoom(escala) })}>
              {t("visor.porcentaje", { n: porcentajeZoom(escala) })}
            </span>
            <button type="button" className="visor-img-ib" aria-label={t("visor.acercar")} data-tip={t("visor.acercar")} data-tip-abajo="" onClick={() => irA(escala * PASO_BOTON)}>
              <ZoomIn size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className="visor-img-sep" aria-hidden="true" />
            <button type="button" className="visor-img-ib" aria-pressed={ajustada} aria-label={t("visor.ajustarTip")} data-tip={t("visor.ajustarTip")} data-tip-abajo="" onClick={() => ajustar()}>
              <Maximize size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="visor-img-ib visor-img-ib-txt"
              aria-pressed={zoom !== null && esMismaEscala(zoom, 1)}
              aria-label={t("visor.cienTip")}
              data-tip={t("visor.cienTip")}
              data-tip-abajo=""
              onClick={() => irA(1)}
            >
              {t("visor.cien")}
            </button>
          </div>
        ) : null}
        <div className="visor-img-grupo visor-img-acciones" role="group" aria-label={t("visor.accionesGrupo")}>
          {usable ? (
            <>
              <button type="button" className="visor-img-ib" aria-label={t("visor.girarIzq")} data-tip={t("visor.girarIzq")} data-tip-abajo="" onClick={() => girarVista(-1)}>
                <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <button type="button" className="visor-img-ib" aria-label={t("visor.girarDer")} data-tip={t("visor.girarDer")} data-tip-abajo="" onClick={() => girarVista(1)}>
                <RotateCw size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <span className="visor-img-sep" aria-hidden="true" />
              <button type="button" className="visor-img-ib" aria-label={t("visor.copiarImagen")} data-tip={t("visor.copiarImagen")} data-tip-abajo="" onClick={copiarLaImagen}>
                <Copy size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <button type="button" className="visor-img-ib" aria-label={t("visor.copiarRuta")} data-tip={t("visor.copiarRuta")} data-tip-abajo="" onClick={() => void copiarConAviso(a.ruta)}>
                <Link2 size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              {puedeVentana ? (
                <button
                  type="button"
                  className="visor-img-ib"
                  data-fallo={guardado === "fallo" ? "" : undefined}
                  aria-label={t("visor.guardarComoAria", { nombre })}
                  data-tip={guardado === "fallo" ? t("visor.noGuardo") : guardado === "ok" ? t("visor.guardada") : t("visor.guardarComo")}
                  data-tip-abajo=""
                  onClick={guardarComo}
                >
                  {guardado === "ok" ? <Check size={16} strokeWidth={2.2} aria-hidden="true" /> : <Download size={16} strokeWidth={2} aria-hidden="true" />}
                </button>
              ) : null}
            </>
          ) : null}
          {puedeVentana || sistema ? <span className="visor-img-sep" aria-hidden="true" /> : null}
          {puedeVentana ? (
            <button
              type="button"
              className="visor-img-ib"
              data-fallo={falloCarpeta ? "" : undefined}
              aria-label={t("visor.mostrarCarpetaAria", { nombre })}
              data-tip={falloCarpeta ? t("visor.noAbrioCarpeta") : t("visor.mostrarCarpeta")}
              data-tip-abajo=""
              onClick={mostrarCarpeta}
            >
              <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
          {sistema ? (
            <button
              type="button"
              className="visor-img-ib"
              data-fallo={falloSistema ? "" : undefined}
              aria-label={t("archivo.abrirSistema", { nombre })}
              data-tip={falloSistema ? t("archivo.noAbrio") : t("archivo.sistema")}
              data-tip-abajo=""
              onClick={abrirSistema}
            >
              <SquareArrowOutUpRight size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
          <span className="visor-img-sep" aria-hidden="true" />
          <button type="button" className="visor-img-ib" data-cerrar-visor aria-label={t("adjunto.cerrar")} data-tip={t("adjunto.cerrar")} data-tip-abajo="" onClick={alCerrar}>
            <X size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        ref={escena}
        className="visor-img-escena"
        onWheel={(e) => {
          if (!usable) return;
          if (e.shiftKey) {
            setPan(panConRueda(panVisto, e.deltaX, e.deltaY, img, escala, area));
            setAnimar(false);
            return;
          }
          irA(escala * (e.deltaY < 0 ? PASO_RUEDA : 1 / PASO_RUEDA), focoDe(e.clientX, e.clientY), false);
        }}
        onContextMenu={(e) => {
          if (!usable) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
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
            data-lista={medida && area.ancho > 0 ? "" : undefined}
            data-animar={animar && !quieto ? "" : undefined}
            style={
              medida
                ? {
                    width: natural.ancho * escala,
                    height: natural.alto * escala,
                    cursor,
                    transform: `translate(-50%, -50%) translate3d(${panVisto.x}px, ${panVisto.y}px, 0) rotate(${vista.angulo}deg)`,
                  }
                : undefined
            }
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
              if (e.button !== 0) return;
              e.preventDefault();
              if (!movible) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              arrastre.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, px: panVisto.x, py: panVisto.y, movio: false };
              setAnimar(false);
            }}
            onPointerMove={(e) => {
              const st = arrastre.current;
              if (!st || st.id !== e.pointerId) return;
              const dx = e.clientX - st.sx;
              const dy = e.clientY - st.sy;
              if (!st.movio && Math.hypot(dx, dy) > 4) {
                st.movio = true;
                setArrastrando(true);
              }
              if (st.movio) setPan(limitarPan({ x: st.px + dx, y: st.py + dy }, img.ancho, img.alto, escala, area.ancho, area.alto));
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
              if (e.detail > 1) return;
              const prox = siguienteEscalaAlClic(escala, ajuste);
              if (esMismaEscala(prox, ajuste)) ajustar();
              else irA(prox, focoDe(e.clientX, e.clientY));
            }}
          />
        ) : null}
        {alAnterior ? (
          <button type="button" className="visor-img-nav" data-lado="anterior" aria-label={t("visor.anterior")} data-tip={t("visor.anterior")} onClick={alAnterior}>
            <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        {alSiguiente ? (
          <button type="button" className="visor-img-nav" data-lado="siguiente" aria-label={t("visor.siguiente")} data-tip={t("visor.siguiente")} onClick={alSiguiente}>
            <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {menu ? <Menu x={menu.x} y={menu.y} items={items} nivel="visor" alCerrar={() => setMenu(null)} className="visor-img-menu" tema="grafito" ariaLabel={t("visor.menuAria")} /> : null}
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

/* El archivo abierto: una imagen, en el visor propio (con las otras imágenes del chat, para pasar de una a otra); lo demás, en la hoja. */
export function VerArchivo({ a, linea, alCerrar }: { a: ArchivoDeHerramienta; linea?: number | null; alCerrar: () => void }) {
  // El atrás del celular cierra el visor (y no la app): todo cierre pasa por acá.
  const cerrar = useAtrasVisor(alCerrar);
  const [ruta, setRuta] = useState(a.ruta);
  // Las del chat se juntan al abrir (con todo el chat ya dibujado: por eso no al crear el estado): lo que llegue después no mueve el lugar de la que se está mirando.
  const [rutas, setRutas] = useState([a.ruta]);
  useLayoutEffect(() => {
    if (a.tipo === "imagen") setRutas(galeriaDe(rutasDeImagenes(a.ruta), a.ruta).rutas);
  }, [a.ruta, a.tipo]);
  const actual = ruta === a.ruta ? a : (archivoDeRuta(ruta, "leer") ?? a);
  const v = useArchivoVisto(actual.ruta, true);
  if (actual.tipo === "imagen" || v?.tipo === "imagen") {
    const i = rutas.indexOf(actual.ruta);
    const salto = (sentido: 1 | -1) => {
      const j = vecino(i, rutas.length, sentido);
      return j === null ? null : () => setRuta(rutas[j]);
    };
    const galeria = rutas.length > 1 && i >= 0 ? { n: i + 1, total: rutas.length, anterior: salto(-1), siguiente: salto(1) } : null;
    return <VisorImagen a={actual} v={v} alCerrar={cerrar} galeria={galeria} />;
  }
  return <Hoja a={a} v={v} linea={linea} alCerrar={cerrar} />;
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
        data-imagen-ruta={a.tipo === "imagen" ? a.ruta : undefined}
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
      <button type="button" className="arch-v arch-foto" data-imagen-ruta={a.ruta} aria-label={t("archivo.ver", { nombre: nombreDe(a.ruta) })} data-tip={t("archivo.ver", { nombre: nombreDe(a.ruta) })} onClick={() => setAbierto(true)}>
        <Miniatura ruta={a.ruta} lado="grande" />
      </button>
      {abierto ? <VerArchivo a={a} alCerrar={() => setAbierto(false)} /> : null}
    </>
  );
});
