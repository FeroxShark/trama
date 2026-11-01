// Lo programado y lo pospuesto, al pie de la barra (#1792): una pastilla con cuántos mensajes hay programados y cuántas conversaciones
// están pospuestas; el clic abre un globito con cada uno (a qué hora sale o vuelve) para quitarlo o traer la conversación ya.
// Sin nada programado ni pospuesto no se ve nada. Lo guarda y lo dispara el main (electron/programados.ts); acá sólo se muestra.
import { CalendarClock, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { fuente } from "../datos/fuente";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { resumen } from "../programados-logica";
import { useProgramados } from "../programados";
import { cuandoFuturo } from "../tiempo";
import "../hilo/programar.css";

const hora = (ms: number) => cuandoFuturo(ms / 1000);

export const AvisoProgramados = memo(function AvisoProgramados() {
  useIdioma();
  const { mensajes, pospuestos } = useProgramados();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const globo = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const hay = mensajes.length + pospuestos.length;

  const alCerrar = useCallback(() => setAbierto(false), []);
  useFoco(globo, { activo: abierto, alCerrar, devolver: () => boton.current });
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    addEventListener("pointerdown", afuera, true);
    return () => removeEventListener("pointerdown", afuera, true);
  }, [abierto]);
  useEffect(() => {
    if (!hay) setAbierto(false);
  }, [hay]);

  if (!hay) return null;

  const partes = [
    mensajes.length ? t(mensajes.length === 1 ? "progr.pillM1" : "progr.pillMN", { n: mensajes.length }) : "",
    pospuestos.length ? t(pospuestos.length === 1 ? "progr.pillP1" : "progr.pillPN", { n: pospuestos.length }) : "",
  ].filter(Boolean);

  return (
    <div className="avc apr" ref={caja}>
      <button ref={boton} type="button" className="avc-b" aria-haspopup="dialog" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
        <CalendarClock size={12} strokeWidth={2} aria-hidden="true" />
        {partes.join(" · ")}
      </button>
      {abierto ? (
        <div ref={globo} className="avc-g" role="dialog" aria-label={t("progr.globoTitulo")} tabIndex={-1}>
          <div className="avc-t">{t("progr.globoTitulo")}</div>
          {mensajes.length ? (
            <section aria-label={t("progr.secMensajes")}>
              <div className="apr-sec">{t("progr.secMensajes")}</div>
              <ul className="avs-l">
                {mensajes.map((m) => (
                  <li key={m.id} className="avs-f" data-id={m.id} data-error={m.error ? "" : undefined}>
                    <div className="avs-x">
                      <div className="avs-n" title={m.texto}>{resumen(m.texto, 80)}</div>
                      <div className="avc-n">{t("progr.para", { nombre: m.nombre || t("lider.sesionJefe") })}</div>
                      <div className="avc-n apr-cuando" data-error={m.error ? "" : undefined}>{m.error ? t("progr.fallo", { e: m.error }) : hora(m.cuando)}</div>
                    </div>
                    <button type="button" className="avs-d" aria-label={t("progr.quitar")} data-tip={t("progr.quitar")} onClick={() => void fuente.programadoQuitar(m.id)}>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {pospuestos.length ? (
            <section aria-label={t("progr.secPospuestas")}>
              <div className="apr-sec">{t("progr.secPospuestas")}</div>
              <ul className="avs-l">
                {pospuestos.map((p) => (
                  <li key={p.sid} className="avs-f" data-sid={p.sid}>
                    <div className="avs-x">
                      <div className="avs-n" title={p.nombre || p.sid}>{p.nombre || t("lider.sesionJefe")}</div>
                      <div className="avc-n apr-cuando">{t("progr.vuelveEn", { cuando: hora(p.hasta) })}</div>
                    </div>
                    <div className="avs-acciones">
                      <button type="button" className="avs-a" onClick={() => void fuente.despertarLider(p.sid)}>
                        {t("progr.volverYa")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
