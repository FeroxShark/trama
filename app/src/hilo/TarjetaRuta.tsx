// Tarjetas breves debajo de un mensaje del asistente para abrir carpetas o `.html` nombrados sin tocar el texto.
// Una carpeta se abre en el explorador de archivos; un `.html`, en el navegador del sistema (`fuente.archivoAbrir`).
import { useMemo, useState } from "react";
import type { Plataforma } from "../../electron/rutas";
import { resultadoCarpeta } from "../datos/carpeta-abrir";
import { fuente } from "../datos/fuente";
import { detalleDe, reportar } from "../errores";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { esVentana } from "../puente";
import { ICONO, IcAbrirSistema, IcArchivo, IcCarpeta } from "../ui/iconos";
import { acortarRuta, nombreRuta, rutasMencionadas, type RutaMencionada } from "./rutas-mencionadas";

function plataformaActual(): Plataforma {
  if (typeof location !== "undefined" && new URLSearchParams(location.search).get("plataforma") === "win32") return "win32";
  if (typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)) return "win32";
  return "linux";
}

export function TarjetaRuta({ item }: { item: RutaMencionada }) {
  useIdioma();
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombre = nombreRuta(item.ruta);
  const corta = acortarRuta(item.ruta, 52);
  const Icono = item.tipo === "carpeta" ? IcCarpeta : IcArchivo;
  const esCarpeta = item.tipo === "carpeta";
  const carpeta = item.ruta;
  const etiquetaAbrir = t(esCarpeta ? "ruta.abrirCarpeta" : "ruta.mostrarArchivo", { nombre });

  async function abrir() {
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
        if (!(await fuente.archivoAbrir(item.ruta))) setError(t("archivo.noDisponible", { nombre }));
        return;
      }
      const res = await resultadoCarpeta(
        () => fuente.carpetaAbrir(carpeta),
        (e) => reportar("carpeta", detalleDe(e)),
      );
      if (res === "app") setError(t("ruta.reiniciar"));
      else if (res === "no-carpeta") setError(t("archivo.carpetaNoAbrio", { ruta: carpeta }));
    } catch (e) {
      reportar("carpeta", detalleDe(e));
      setError(t("ruta.reiniciar"));
    } finally {
      setAbriendo(false);
    }
  }

  return (
    <div className="tarjeta-ruta" role="listitem" data-tipo={item.tipo}>
      <div className="tarjeta-ruta-fila">
        <span className="tarjeta-ruta-icono" aria-hidden="true">
          <Icono size={ICONO.size} strokeWidth={ICONO.strokeWidth} />
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
          <span>{t(esCarpeta ? "ruta.abrir" : "ruta.mostrar")}</span>
          <IcAbrirSistema size={13} strokeWidth={ICONO.strokeWidth} aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p className="tarjeta-ruta-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TarjetasRuta({ texto }: { texto: string }) {
  useIdioma();
  const plat = plataformaActual();
  const items = useMemo(() => rutasMencionadas(texto, plat), [texto, plat]);
  if ((!esVentana() && !MODO.fixtures) || items.length === 0) return null;
  return (
    <div className="tarjetas-ruta" role="list" aria-label={t("ruta.lista")}>
      {items.map((item) => (
        <TarjetaRuta key={`${item.tipo}:${item.ruta}`} item={item} />
      ))}
    </div>
  );
}
