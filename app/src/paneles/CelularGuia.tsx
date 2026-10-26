// Ajustes > Celular: lo que explica y muestra el estado, sin tocar el borrador (eso sigue en AjustesEditar.tsx):
// el estado "escuchando" con su dirección, los tres pasos para conectar el teléfono (con el QR, generado acá, de la dirección)
// y el renglón de cada dispositivo (sistema, IP de la tailnet y la última vez que entró).
import { useMemo, useState } from "react";
import { copiarConAviso } from "../copiar";
import type { AccesoCelular } from "../datos/paneles";
import { t } from "../i18n";
import { qr, qrCamino } from "../qr";
import { pintorHace } from "../tiempo";
import { Chip } from "../ui/componentes";
import { IcCelular, IcOk } from "../ui/iconos";
import "./celular.css";

/** Margen blanco del QR, en módulos: la norma pide 4 y sin él varias cámaras no lo encuentran. */
const MARGEN = 4;

/** El QR de una dirección como un solo `<path>` (sin una imagen aparte ni una librería); `null` si no entra. */
export function CodigoQr({ url }: { url: string }) {
  const dibujo = useMemo(() => {
    const m = qr(url);
    return m ? { lado: m.length + MARGEN * 2, camino: qrCamino(m) } : null;
  }, [url]);
  if (!dibujo) return null;
  return (
    <svg className="cel-qr" viewBox={`${-MARGEN} ${-MARGEN} ${dibujo.lado} ${dibujo.lado}`} role="img" aria-label={t("ajustes.celQrAlt", { url })} shapeRendering="crispEdges">
      <rect x={-MARGEN} y={-MARGEN} width={dibujo.lado} height={dibujo.lado} fill="#fff" />
      <path d={dibujo.camino} fill="#0d1a2e" />
    </svg>
  );
}

/** La dirección con su botón de copiar. */
function Direccion({ url }: { url: string }) {
  const [copiada, setCopiada] = useState(false);
  return (
    <div className="cel-url">
      <code className="cel-url-txt" data-tip={url}>
        {url}
      </code>
      <button
        type="button"
        className="btn2 cel-copiar"
        onClick={() => {
          void copiarConAviso(url).then((ok) => {
            setCopiada(ok);
            window.setTimeout(() => setCopiada(false), 1400);
          });
        }}
      >
        {copiada ? <IcOk size={14} aria-hidden /> : null}
        {copiada ? t("ajustes.celCopiada") : t("ajustes.celCopiar")}
      </button>
    </div>
  );
}

/** El estado de lo guardado y andando: escuchando (con la dirección), prendido sin escuchar, o apagado. */
export function EstadoEscucha({ activo, url }: { activo: boolean; url: string | undefined }) {
  const tono = activo ? (url ? "ok" : "aviso") : undefined;
  const titulo = !activo ? t("ajustes.celEstApagado") : url ? t("ajustes.celEstEscucha") : t("ajustes.celEstEspera");
  const detalle = !activo ? t("ajustes.celApagado") : url ? t("ajustes.celEstEscuchaDet") : t("ajustes.celSinEscuchar");
  return (
    <div className="cel-estado" data-escucha={activo && url ? "" : undefined} role="status">
      <span className="cel-estado-ico" aria-hidden>
        <IcCelular size={18} strokeWidth={1.8} />
      </span>
      <div className="cel-estado-txt">
        <div className="cel-estado-fila">
          <Chip tono={tono}>{titulo}</Chip>
        </div>
        {detalle ? <div className="cel-estado-det">{detalle}</div> : null}
      </div>
    </div>
  );
}

/** Los tres pasos. El tercero lleva la dirección y el QR cuando trama está escuchando. */
export function PasosCelular({ url }: { url: string | undefined }) {
  return (
    <ol className="cel-pasos" aria-label={t("ajustes.celGuia")}>
      <li className="cel-paso">
        <span className="cel-n" aria-hidden>
          1
        </span>
        <div className="cel-paso-c">
          <div className="cel-paso-t">{t("ajustes.celPaso1")}</div>
          <div className="cel-paso-d">{t("ajustes.celPaso1Que")}</div>
        </div>
      </li>
      <li className="cel-paso">
        <span className="cel-n" aria-hidden>
          2
        </span>
        <div className="cel-paso-c">
          <div className="cel-paso-t">{t("ajustes.celPaso2")}</div>
          <div className="cel-paso-d">{t("ajustes.celPaso2Que")}</div>
        </div>
      </li>
      <li className="cel-paso">
        <span className="cel-n" aria-hidden>
          3
        </span>
        <div className="cel-paso-c">
          <div className="cel-paso-t">{t("ajustes.celPaso3")}</div>
          {url ? (
            <div className="cel-abrir">
              <div className="cel-abrir-l">
                <div className="cel-paso-d">{t("ajustes.celPaso3Que")}</div>
                <Direccion url={url} />
              </div>
              <CodigoQr url={url} />
            </div>
          ) : (
            <div className="cel-paso-d">{t("ajustes.celPaso3Falta")}</div>
          )}
        </div>
      </li>
    </ol>
  );
}

/** "Android", "iOS"…: lo que dice Tailscale del sistema, con los nombres de siempre. */
const SISTEMAS: Record<string, string> = { android: "Android", ios: "iOS", macos: "macOS", windows: "Windows", linux: "Linux", ipados: "iPadOS" };
const sistemaLegible = (s: string | null) => (s ? (SISTEMAS[s.toLowerCase()] ?? s) : null);

/** El renglón chico de un dispositivo: "Android · 192.0.2.12 · hace 4 m", o que todavía no entró. */
export function detalleAcceso(a: AccesoCelular | undefined, ahora = Date.now()): string {
  if (!a) return t("ajustes.celNuncaEntro");
  const hace = pintorHace(a.visto / 1000)(ahora / 1000).texto;
  return [sistemaLegible(a.sistema), a.ip, hace].filter(Boolean).join(" · ");
}
