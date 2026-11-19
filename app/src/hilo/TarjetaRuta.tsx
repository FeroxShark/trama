// Rutas que nombra un mensaje del asistente, para abrir carpetas, `.html` o archivos mostrables sin salir de Trama: tocables en su
// lugar del texto (`ArchivoEnLinea`; las carpetas, `Carpeta` de Texto.tsx) y las imágenes grandes al pie.
// Una carpeta se abre en el explorador; un `.html`, en el navegador; las imágenes y otros archivos mostrables, en el visor propio.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Eye, FolderOpen } from "lucide-react";
import { copiar } from "../copiar";
import {
  tipoDeArchivo,
  type ArchivoDeHerramienta,
} from "../../electron/archivo-ruta";
import type { Plataforma } from "../../electron/rutas";
import { resultadoCarpeta } from "../datos/carpeta-abrir";
import { fuente } from "../datos/fuente";
import { detalleDe, reportar } from "../errores";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { esVentana } from "../puente";
import { ICONO, IcAbrirSistema, IcArchivo, IcCarpeta } from "../ui/iconos";
import {
  acortarRuta,
  nombreRuta,
  rutasSinLugar,
  type RutaMencionada,
} from "./rutas-mencionadas";
import {
  PESO_CACHE,
  VerArchivo,
  useArchivoVisto,
  useVisible,
} from "./VerArchivo";

// Las capturas del visor abren la segunda imagen del chat (así se ven «2 de 5» y las dos flechas).
let imagenesDeCaptura = 0;
let visorCapturaAbierto = false;
const abrirVisorCaptura = (esImg: boolean) =>
  MODO.captura?.startsWith("visor-imagen") && esImg && !visorCapturaAbierto && imagenesDeCaptura++ === 1
    ? (visorCapturaAbierto = true)
    : false;

export function plataformaActual(): Plataforma {
  if (
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("plataforma") === "win32"
  )
    return "win32";
  if (typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent))
    return "win32";
  return "linux";
}

export function TarjetaRuta({ item }: { item: RutaMencionada }) {
  useIdioma();
  const infoArchivo = useMemo(
    () => (item.tipo === "archivo" ? tipoDeArchivo(item.ruta) : null),
    [item.tipo, item.ruta],
  );
  const esArchivo = item.tipo === "archivo";
  const esImagen = infoArchivo?.tipo === "imagen";
  const [abriendo, setAbriendo] = useState(false);
  const [verAbierto, setVerAbierto] = useState(
    () => esArchivo && abrirVisorCaptura(!!esImagen),
  );
  const [error, setError] = useState<string | null>(null);
  const [imgFallo, setImgFallo] = useState(false);
  const filaRef = useRef<HTMLDivElement>(null);
  const visible = useVisible(filaRef);
  const visto = useArchivoVisto(item.ruta, !!esImagen && visible);

  useEffect(() => {
    setImgFallo(false);
  }, [item.ruta]);

  const nombre = nombreRuta(item.ruta);
  const corta = acortarRuta(item.ruta, 52);
  const esCarpeta = item.tipo === "carpeta";
  const Icono = esCarpeta ? IcCarpeta : IcArchivo;
  const miniaturaSrc =
    esImagen &&
    !imgFallo &&
    visto?.tipo === "imagen" &&
    visto.datos.length <= PESO_CACHE
      ? `data:${visto.mime};base64,${visto.datos}`
      : null;
  const etiquetaAbrir = esArchivo
    ? t("archivo.ver", { nombre })
    : t(esCarpeta ? "ruta.abrirCarpeta" : "ruta.mostrarArchivo", { nombre });
  const textoBoton = esArchivo
    ? t("ruta.ver")
    : t(esCarpeta ? "ruta.abrir" : "ruta.mostrar");

  const archivoParaVisor: ArchivoDeHerramienta | null = infoArchivo
    ? {
        ruta: item.ruta,
        accion: "leer",
        tipo: infoArchivo.tipo,
        mime: infoArchivo.mime,
        absoluta: null,
      }
    : null;

  async function abrir() {
    if (esArchivo) {
      setVerAbierto(true);
      return;
    }
    if (abriendo) return;
    setAbriendo(true);
    setError(null);
    try {
      if (!esVentana() && !MODO.fixtures) {
        setError(t("ruta.reiniciar"));
        return;
      }
      if (!esCarpeta) {
        // Un rechazo es que el pedido no llegó (ventana nueva con proceso viejo); `false`, que el archivo no está o no abrió.
        if (!(await fuente.archivoAbrir(item.ruta)))
          setError(t("archivo.noDisponible", { nombre }));
        return;
      }
      const res = await resultadoCarpeta(
        () => fuente.carpetaAbrir(item.ruta),
        (e) => reportar("carpeta", detalleDe(e)),
      );
      if (res === "app") setError(t("ruta.reiniciar"));
      else if (res === "no-carpeta")
        setError(t("archivo.carpetaNoAbrio", { ruta: item.ruta }));
    } catch (e) {
      reportar("carpeta", detalleDe(e));
      setError(t("ruta.reiniciar"));
    } finally {
      setAbriendo(false);
    }
  }

  return (
    <div className="tarjeta-ruta" role="listitem" data-tipo={item.tipo}>
      <div ref={filaRef} className="tarjeta-ruta-fila">
        <span
          className="tarjeta-ruta-icono"
          data-miniatura={miniaturaSrc ? "" : undefined}
          aria-hidden="true"
        >
          {miniaturaSrc ? (
            <img
              className="tarjeta-ruta-img"
              src={miniaturaSrc}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setImgFallo(true)}
            />
          ) : (
            <Icono size={ICONO.size} strokeWidth={ICONO.strokeWidth} />
          )}
        </span>
        <div className="tarjeta-ruta-texto">
          <span className="tarjeta-ruta-nombre">{nombre}</span>
          <span className="tarjeta-ruta-ruta" title={item.ruta}>
            {corta}
          </span>
        </div>
        <button
          type="button"
          className="tarjeta-ruta-abrir"
          aria-label={etiquetaAbrir}
          disabled={abriendo}
          onClick={() => void abrir()}
        >
          <span>{textoBoton}</span>
          {esArchivo ? (
            <Eye size={13} strokeWidth={ICONO.strokeWidth} aria-hidden="true" />
          ) : (
            <IcAbrirSistema
              size={13}
              strokeWidth={ICONO.strokeWidth}
              aria-hidden="true"
            />
          )}
        </button>
      </div>
      {error ? (
        <p className="tarjeta-ruta-error" role="status">
          {error}
        </p>
      ) : null}
      {verAbierto && archivoParaVisor ? (
        <VerArchivo
          a={archivoParaVisor}
          alCerrar={() => setVerAbierto(false)}
        />
      ) : null}
    </div>
  );
}

/** El botoncito de copiar la ruta, al lado de una ruta tocable del texto (archivo o carpeta): dice «Ruta copiada» con una tilde un rato. */
/** Abre la carpeta del archivo con el archivo marcado (explorador del sistema): para ver dónde está, sin abrirlo. */
export function EnCarpeta({ ruta }: { ruta: string }) {
  useIdioma();
  const [fallo, setFallo] = useState(false);
  const dice = t(fallo ? "ruta.enCarpetaNo" : "ruta.enCarpeta");
  return (
    <button
      type="button"
      className="ruta-copiar"
      data-fallo={fallo ? "" : undefined}
      aria-label={dice}
      data-tip={dice}
      onClick={() => void fuente.carpetaAbrir(ruta).then((ok) => setFallo(!ok), () => setFallo(true))}
    >
      <FolderOpen size={12} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

export function CopiarRuta({ ruta }: { ruta: string }) {
  useIdioma();
  const [hecho, setHecho] = useState(false);
  const reloj = useRef(0);
  useEffect(() => () => clearTimeout(reloj.current), []);
  const dice = t(hecho ? "ruta.copiada" : "ruta.copiar");
  return (
    <button
      type="button"
      className="ruta-copiar"
      data-hecho={hecho ? "" : undefined}
      aria-label={dice}
      data-tip={dice}
      onClick={() =>
        void copiar(ruta).then((ok) => {
          if (!ok) return;
          setHecho(true);
          clearTimeout(reloj.current);
          reloj.current = window.setTimeout(() => setHecho(false), 1500);
        })
      }
    >
      {hecho ? (
        <Check size={12} strokeWidth={2.4} aria-hidden="true" />
      ) : (
        <Copy size={12} strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * Un archivo nombrado en código en línea, tocable en su lugar del mensaje (como las carpetas): uno mostrable se abre en el visor; un
 * `.html`, en el navegador. Si no se pudo abrir, lo dicen el color y el aviso.
 */
export function ArchivoEnLinea({
  item,
  texto,
}: {
  item: RutaMencionada;
  texto: string;
}) {
  useIdioma();
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombre = nombreRuta(item.ruta);
  const info = item.tipo === "archivo" ? tipoDeArchivo(item.ruta) : null;
  const dice =
    error ??
    (info
      ? t("archivo.ver", { nombre })
      : t("ruta.mostrarArchivo", { nombre }));
  async function abrir() {
    if (info) return setVer(true);
    setError(null);
    try {
      if (!(await fuente.archivoAbrir(item.ruta)))
        setError(t("archivo.noDisponible", { nombre }));
    } catch (e) {
      reportar("carpeta", detalleDe(e));
      setError(t("ruta.reiniciar"));
    }
  }
  const Ico = info ? Eye : IcAbrirSistema;
  return (
    <span className="ruta-linea">
      <button
        type="button"
        className="ruta-carpeta"
        data-fallo={error ? "" : undefined}
        aria-label={dice}
        data-tip={dice}
        onClick={() => void abrir()}
      >
        <code data-ruta="">{texto}</code>
        <Ico size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      <EnCarpeta ruta={item.ruta} />
      <CopiarRuta ruta={item.ruta} />
      {ver && info ? (
        <VerArchivo
          a={{
            ruta: item.ruta,
            accion: "leer",
            tipo: info.tipo,
            mime: info.mime,
            absoluta: null,
          }}
          alCerrar={() => setVer(false)}
        />
      ) : null}
    </span>
  );
}

/**
 * Una imagen que nombra el mensaje, a la vista y grande (como la muestra Claude Code): tocarla abre el visor. Mientras se lee, un hueco del
 * mismo lugar para que el chat no salte; si no está o no se puede mostrar, la tarjeta de siempre con su aviso.
 */
function TarjetaImagen({ item }: { item: RutaMencionada }) {
  useIdioma();
  const caja = useRef<HTMLDivElement>(null);
  const visible = useVisible(caja);
  const visto = useArchivoVisto(item.ruta, visible);
  const [fallo, setFallo] = useState(false);
  const [ver, setVer] = useState(() => abrirVisorCaptura(true));
  const nombre = nombreRuta(item.ruta);
  useEffect(() => setFallo(false), [item.ruta]);
  if (visto === null || fallo || (visto && visto.tipo !== "imagen"))
    return <TarjetaRuta item={item} />;
  const info = tipoDeArchivo(item.ruta);
  const src =
    visto?.tipo === "imagen"
      ? `data:${visto.mime};base64,${visto.datos}`
      : null;
  return (
    <div ref={caja} className="tarjeta-img" role="listitem">
      <button
        type="button"
        className="tarjeta-img-btn"
        data-imagen-ruta={item.ruta}
        aria-label={t("archivo.ver", { nombre })}
        title={item.ruta}
        onClick={() => setVer(true)}
      >
        {src ? (
          <img
            src={src}
            alt={nombre}
            decoding="async"
            onError={() => setFallo(true)}
          />
        ) : (
          <span className="tarjeta-img-cargando" aria-hidden="true" />
        )}
      </button>
      <span className="tarjeta-img-nombre" title={item.ruta}>
        {nombre}
      </span>
      {ver ? (
        <VerArchivo
          a={{
            ruta: item.ruta,
            accion: "leer",
            tipo: info.tipo,
            mime: info.mime,
            absoluta: null,
          }}
          alCerrar={() => setVer(false)}
        />
      ) : null}
    </div>
  );
}

/** Al pie del mensaje, sólo las imágenes que nombra, grandes; las carpetas y los archivos se tocan en su lugar del texto (Texto.tsx). */
export function TarjetasRuta({ texto }: { texto: string }) {
  useIdioma();
  const plat = plataformaActual();
  const imagenes = useMemo(() => rutasSinLugar(texto, plat), [texto, plat]);
  if ((!esVentana() && !MODO.fixtures) || imagenes.length === 0) return null;
  return (
    <div
      className="tarjetas-img"
      role="list"
      aria-label={t("ruta.lista")}
      data-varias={imagenes.length > 1 ? "" : undefined}
    >
      {imagenes.map((item) => (
        <TarjetaImagen key={item.ruta} item={item} />
      ))}
    </div>
  );
}
