// «Reportar un bug»: el bicho del pie de la barra. Al tocarlo se saca la captura de la ventana tal como estaba (antes de abrir el
// diálogo, así se ve el problema y no el diálogo), y el diálogo pide qué pasó. «Abrir en GitHub» arma una carpeta en Descargas con
// `captura.png` y `log.txt` (limpio de claves, correos y la carpeta personal: electron/reporte.ts), abre el issue nuevo del repo con el
// texto prellenado y abre la carpeta, para arrastrar los dos archivos al issue (GitHub no deja adjuntarlos por la URL). El repo es
// público: el diálogo lo dice. Sólo en la ventana de la PC. Estilo: el diálogo de «Limpiar chats» (seguir-dialogo.css).
// Si esta Trama tiene receptor, lo primero es «Enviar anónimo» (electron/reporte-anonimo.ts): le llega sólo al desarrollador, sin nombre
// ni cuenta; la captura va en JPEG achicado (la arma `aJpeg`). GitHub queda como segunda opción.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bug, Check } from "lucide-react";
import { fuente } from "../datos/fuente";
import { useFoco } from "../foco";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Boton } from "../ui/componentes";
import "../hilo/seguir-dialogo.css";
import "./limpiar-chats.css";
import "./reporte-dialogo.css";

type Props = {
  /** La captura sacada al tocar el bicho (PNG en base64), o `null` si no hubo. */
  captura: string | null;
  alCerrar: () => void;
};

type Estado = { fase: "escribiendo" } | { fase: "armando" } | { fase: "listo"; carpeta: string } | { fase: "enviado" } | { fase: "error"; error: string };

/** La captura PNG (base64) → JPEG de hasta 1600 px de ancho (base64), para que el envío sea chico. `null` si no se pudo. */
async function aJpeg(png: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const escala = Math.min(1, 1600 / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * escala);
    c.height = Math.round(img.naturalHeight * escala);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1] ?? null;
  } catch {
    return null;
  }
}

export function Reporte({ captura, alCerrar }: Props) {
  useIdioma();
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState("");
  const [conCaptura, setConCaptura] = useState(captura !== null);
  const [conLog, setConLog] = useState(true);
  const [estado, setEstado] = useState<Estado>({ fase: "escribiendo" });
  const [anonimo, setAnonimo] = useState(false);
  useFoco(raiz, { alCerrar, enfocar: "primero" });
  useEffect(() => {
    let vivo = true;
    void fuente.reporteAnonimo().then((v) => vivo && setAnonimo(v), () => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  const enviarAnonimo = async () => {
    if (!texto.trim() || estado.fase === "armando") return;
    setEstado({ fase: "armando" });
    const jpeg = conCaptura && captura ? await aJpeg(captura) : null;
    const r = await fuente.enviarReporte({ descripcion: texto, captura: jpeg, log: conLog });
    // El texto queda escrito si falla: se puede reintentar.
    setEstado(r.ok ? { fase: "enviado" } : { fase: "error", error: textoMain(r.error) });
  };

  const enviar = async () => {
    if (!texto.trim() || estado.fase === "armando") return;
    setEstado({ fase: "armando" });
    const r = await fuente.armarReporte({ descripcion: texto, captura: conCaptura ? captura : null, log: conLog });
    if (!r.ok) return setEstado({ fase: "error", error: textoMain(r.error) });
    fuente.abrirNotasTrama(r.url);
    if (conCaptura || conLog) void fuente.carpetaAbrir(r.carpeta).catch(() => false);
    setEstado({ fase: "listo", carpeta: r.carpeta });
  };

  const listo = estado.fase === "listo";
  const enviado = estado.fase === "enviado";
  const cerrado = listo || enviado;
  return createPortal(
    <div className="seg-fondo" data-reporte onMouseDown={(e) => e.target === e.currentTarget && alCerrar()}>
      <div ref={raiz} className="seg rep" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} tabIndex={-1}>
        <div className="seg-cab">
          <span className="seg-ico" aria-hidden="true">
            {cerrado ? <Check size={16} strokeWidth={2.2} /> : <Bug size={16} strokeWidth={2.2} />}
          </span>
          <div className="seg-txt">
            <h3 id={`${id}-t`} className="seg-t">
              {enviado ? t("reporte.enviadoTitulo") : listo ? t("reporte.listoTitulo") : t("reporte.titulo")}
            </h3>
            <p id={`${id}-d`} className="seg-d">
              {enviado ? t("reporte.enviadoDesc") : listo ? t("reporte.listoDesc") : anonimo ? t("reporte.descAnonimo") : t("reporte.desc")}
            </p>
          </div>
        </div>
        {enviado ? null : listo ? (
          <p className="rep-carpeta" role="status">
            <span className="rep-carpeta-t">{t("reporte.carpeta")}</span>
            <code>{estado.carpeta}</code>
          </p>
        ) : (
          <>
            <label className="rep-campo">
              <span className="rep-campo-t">{t("reporte.quepaso")}</span>
              <textarea
                className="lz-texto rep-texto"
                value={texto}
                rows={5}
                maxLength={3000}
                placeholder={t("reporte.queEjemplo")}
                disabled={estado.fase === "armando"}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void (anonimo ? enviarAnonimo() : enviar());
                }}
              />
            </label>
            <div className="rep-adjuntos">
              {captura !== null ? (
                <label className="lim-label rep-adj">
                  <input type="checkbox" className="lim-chk" checked={conCaptura} onChange={(e) => setConCaptura(e.target.checked)} />
                  <img className="rep-mini" src={`data:image/png;base64,${captura}`} alt="" />
                  <span className="rep-adj-t">{t("reporte.conCaptura")}</span>
                </label>
              ) : null}
              <label className="lim-label rep-adj">
                <input type="checkbox" className="lim-chk" checked={conLog} onChange={(e) => setConLog(e.target.checked)} />
                <span className="rep-adj-t">{t("reporte.conLog")}</span>
              </label>
            </div>
            <p className="lim-nota">{anonimo ? t("reporte.notaAnonimo") : t("reporte.nota")}</p>
            {estado.fase === "error" ? (
              <p className="bv-error" role="alert">
                {t("reporte.error", { error: estado.error })}
              </p>
            ) : null}
          </>
        )}
        <div className="seg-pie lim-pie">
          {cerrado ? (
            <Boton primario className="lim-archivar" onClick={alCerrar}>
              {t("reporte.cerrar")}
            </Boton>
          ) : (
            <>
              <Boton className="seg-cancelar" onClick={alCerrar}>
                {t("reporte.cancelar")}
              </Boton>
              {anonimo ? (
                <>
                  <Boton disabled={!texto.trim() || estado.fase === "armando"} onClick={() => void enviar()}>
                    {t("reporte.enviar")}
                  </Boton>
                  <Boton primario className="lim-archivar" disabled={!texto.trim() || estado.fase === "armando"} aria-busy={estado.fase === "armando"} onClick={() => void enviarAnonimo()}>
                    {t("reporte.enviarAnonimo")}
                  </Boton>
                </>
              ) : (
                <Boton primario className="lim-archivar" disabled={!texto.trim() || estado.fase === "armando"} aria-busy={estado.fase === "armando"} onClick={() => void enviar()}>
                  {t("reporte.enviar")}
                </Boton>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
