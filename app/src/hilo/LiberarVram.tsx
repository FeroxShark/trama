// Qué se puede liberar de la VRAM cuando el modelo local no entra (dentro del detalle de ContextoLocal). Lee la lista de la CLI
// `vram` (electron/vram.ts), dice de cada servicio cuánto libera y si con eso el modelo entra, y lo libera con su botón, que
// pide confirmar: parar Handy o el TTS es de verdad. Nada se libera solo ni al abrir. Un servicio por vez.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { Estimacion } from "../../electron/locales-calc";
import type { ConsumidorVram } from "../../electron/vram";
import { fuente } from "../datos/fuente";
import { t, textoMain, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { efectoDeLiberar, faltaMiB } from "./vram";

const gb = (miB: number) => (miB / 1024).toFixed(1);
const kilo = (x: number) => {
  const k = x / 1024;
  return Number.isInteger(k) ? String(k) : k.toFixed(1);
};

/** Lo que pasa con el servicio al liberarlo, según cómo lo libera la CLI. */
const QUE_PASA: Record<string, ClaveSola> = {
  stop: "vram.accionStop",
  restart: "vram.accionRestart",
  term: "vram.accionTerm",
};

/** Segundos que la confirmación espera antes de volver sola al botón (un clic suelto no queda armado). */
const CONFIRMA_S = 6;

type Nota = { tipo: "ok" | "error"; texto: string };

type Props = {
  est: Estimacion;
  info: { ctxMin: number; ctxMax: number; paso: number };
  /** El contexto que se quiere (el del campo). */
  pedido: number | null;
  /** Después de liberar: que el detalle relea la GPU. */
  alLiberar: () => void;
};

export function LiberarVram({ est, info, pedido, alLiberar }: Props) {
  useIdioma();
  const [lista, setLista] = useState<ConsumidorVram[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [confirma, setConfirma] = useState<string | null>(null);
  const [liberando, setLiberando] = useState<string | null>(null);
  const [nota, setNota] = useState<Nota | null>(null);
  const tope = useRef<ReturnType<typeof setTimeout>>(undefined);

  const leer = useCallback(() => {
    fuente.vram().then(
      (e) => {
        setLista(e.consumidores);
        setFallo(null);
      },
      (e) => setFallo(textoMain(mensaje(e))),
    );
  }, []);
  useEffect(leer, [leer]);
  useEffect(() => () => clearTimeout(tope.current), []);

  const armar = (id: string) => {
    clearTimeout(tope.current);
    setConfirma(id);
    setNota(null);
    tope.current = setTimeout(() => setConfirma(null), CONFIRMA_S * 1000);
  };
  const desarmar = () => {
    clearTimeout(tope.current);
    setConfirma(null);
  };

  const liberar = async (c: ConsumidorVram) => {
    if (liberando) return;
    desarmar();
    setLiberando(c.id);
    try {
      const r = await fuente.liberarVram(c.id);
      if (r.ok) setNota({ tipo: "ok", texto: t("vram.hecho", { nombre: r.nombre, gb: gb(r.liberadoMiB ?? c.miB) }) });
      else setNota({ tipo: "error", texto: textoMain(r.error ?? "") || t("vram.fallo", { nombre: c.nombre }) });
    } catch (e) {
      setNota({ tipo: "error", texto: textoMain(mensaje(e)) });
    } finally {
      setLiberando(null);
      leer();
      alLiberar();
    }
  };

  const falta = pedido != null ? faltaMiB(est, pedido) : 0;

  return (
    <section className="vr" aria-label={t("vram.titulo")}>
      <div className="vr-h">
        <span>{t("vram.titulo")}</span>
        {falta > 0 && pedido != null ? <span className="vr-falta">{t("vram.falta", { gb: gb(falta), k: kilo(pedido) })}</span> : null}
      </div>
      {fallo ? (
        <p className="cl-nota" data-tipo="error" role="alert">
          {fallo}
        </p>
      ) : lista == null ? (
        <p className="cl-nota">{t("vram.leyendo")}</p>
      ) : lista.length === 0 ? (
        <p className="cl-nota">{t("vram.nada")}</p>
      ) : (
        <ul className="vr-lista">
          {lista.map((c) => {
            const ef = efectoDeLiberar(est, info, c.miB, pedido ?? info.ctxMin);
            const armado = confirma === c.id;
            return (
              <li key={c.id} className="vr-fila" data-armado={armado ? "" : undefined}>
                <div className="vr-datos">
                  <span className="vr-nombre">{c.nombre}</span>
                  <span className="vr-gb">{t("vram.libera", { gb: gb(c.miB) })}</span>
                  <span className="vr-veredicto" data-v={ef.veredicto}>
                    {ef.veredicto === "no" ? t("vram.no") : ef.veredicto === "entra" ? t("vram.entra", { k: kilo(pedido ?? ef.ctx) }) : t("vram.menos", { k: kilo(ef.ctx) })}
                  </span>
                  {armado ? <span className="vr-aviso">{t(QUE_PASA[c.accion] ?? "vram.accionOtra")}</span> : null}
                </div>
                <div className="vr-botones">
                  {armado ? (
                    <>
                      <button type="button" className="btn2 vr-ok" disabled={liberando != null} onClick={() => liberar(c)}>
                        {t("vram.confirmar")}
                      </button>
                      <button type="button" className="btn2" onClick={desarmar}>
                        {t("vram.cancelar")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn2"
                      disabled={liberando != null}
                      aria-label={t("vram.liberarA", { nombre: c.nombre })}
                      onClick={() => armar(c.id)}
                    >
                      {liberando === c.id ? t("vram.liberando") : t("vram.liberar")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {nota ? (
        <p className="cl-nota" data-tipo={nota.tipo} role={nota.tipo === "error" ? "alert" : "status"}>
          {nota.tipo === "ok" ? <Check size={13} aria-hidden="true" /> : null}
          <span>{nota.texto}</span>
        </p>
      ) : null}
    </section>
  );
}
