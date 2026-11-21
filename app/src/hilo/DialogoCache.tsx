// Con la caché vencida y un contexto grande, el primer mensaje espera a que la persona elija: seguir la misma sesión (relee todo),
// empezar con un resumen o compactar antes (en Claude con un modelo más barato conectado y no excluido donde entre el chat; en Gemini con el
// mismo modelo). «Seguir la misma sesión» va siempre primero, marcada y con el foco. Esc, el fondo o «Ahora no» = el mensaje sigue en la caja.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, MessageSquarePlus, Minimize2, ScrollText, Snowflake } from "lucide-react";
import { t } from "../i18n";
import type { EleccionCache, VeredictoCache } from "../../electron/cache-pregunta";
import type { OpcionCompactarCache } from "./cache-compactar";

export type DatosCache = {
  veredicto: VeredictoCache;
  /** Claude abre una conversación nueva; agy sigue en la misma. */
  nueva: boolean;
  /** Nombre del modelo con que sigue la conversación. */
  modeloNombre: string;
  /** 3ª opción (compactar antes de seguir), si aplica. */
  compactar: OpcionCompactarCache;
};

const mil = (n: number) => Math.max(1, Math.round(n / 1000));

export function DialogoCache({
  datos,
  alElegir,
  alCompactar,
  alCancelar,
}: {
  datos: DatosCache;
  alElegir: (e: EleccionCache, recordar: boolean) => void;
  alCompactar?: (modeloCompactar: string) => void;
  alCancelar: () => void;
}) {
  const id = useId();
  const [recordar, setRecordar] = useState(false);
  const candidatos = datos.compactar?.tipo === "claude" ? datos.compactar.candidatos : [];
  const defectoId = datos.compactar?.tipo === "claude" ? datos.compactar.elegidoDefecto.id : "";
  const [barato, setBarato] = useState(defectoId);
  useEffect(() => setBarato(defectoId), [defectoId]);
  const elegido = candidatos.find((c) => c.id === barato) ?? (datos.compactar?.tipo === "claude" ? datos.compactar.elegidoDefecto : null);

  const dialogo = useRef<HTMLDivElement>(null);
  const seguir = useRef<HTMLButtonElement>(null);
  const { veredicto: v } = datos;
  useEffect(() => seguir.current?.focus(), []);
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return alCancelar();
    }
    if (e.key !== "Tab") return;
    e.preventDefault();
    const a = [...(dialogo.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? [])];
    if (!a.length) return;
    const i = a.indexOf(document.activeElement as HTMLElement);
    a[(i + (e.shiftKey ? a.length - 1 : 1)) % a.length]?.focus();
  };
  // Claude abre otra conversación: el ícono lo dice antes que el texto.
  const IconoResumen = datos.nueva ? MessageSquarePlus : ScrollText;
  const opSeguir = (
    <button ref={seguir} type="button" className="cache-op cache-op-prim" data-cache-seguir onClick={() => alElegir("seguir", recordar)}>
      <MessageCircle className="cache-op-ico" size={20} strokeWidth={1.75} aria-hidden="true" />
      <span className="cache-op-txt">
        <span className="cache-op-t">{t("cache.seguir")}</span>
        <span className="cache-op-d">{t("cache.seguirDet", { k: mil(v.tokensSeguir), modelo: datos.modeloNombre })}</span>
      </span>
    </button>
  );
  const opResumen = (
    <button type="button" className="cache-op" data-cache-resumen onClick={() => alElegir("resumen", recordar)}>
      <IconoResumen className="cache-op-ico" size={20} strokeWidth={1.75} aria-hidden="true" />
      <span className="cache-op-txt">
        <span className="cache-op-t">{t("cache.resumen")}</span>
        {datos.nueva ? <span className="cache-op-nueva">{t("cache.resumenClaude")}</span> : null}
        <span className="cache-op-d">{t("cache.resumenDet", { k: mil(v.tokensResumen), modelo: datos.modeloNombre })}</span>
      </span>
    </button>
  );
  const gemini = datos.compactar?.tipo === "gemini" ? datos.compactar : null;
  const opCompactar =
    datos.compactar?.tipo === "claude" && elegido ? (
      <div className="cache-op cache-op-comp">
        <button type="button" className="cache-op-btn" data-cache-compactar onClick={() => alCompactar?.(elegido.id)}>
          <Minimize2 className="cache-op-ico" size={20} strokeWidth={1.75} aria-hidden="true" />
          <span className="cache-op-txt">
            <span className="cache-op-t">{t("cache.compactarClaude", { barato: elegido.nombre, modelo: datos.modeloNombre })}</span>
            <span className="cache-op-d">{t("cache.compactarClaudeDet", { k: mil(v.tokensSeguir), barato: elegido.nombre, modelo: datos.modeloNombre })}</span>
          </span>
        </button>
        {candidatos.length > 1 ? (
          <div className="cache-op-sel" role="group" aria-label={t("cache.compactarCon")}>
            <span className="cache-op-sel-l">{t("cache.compactarCon")}</span>
            <div className="cache-chips">
              {candidatos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="cache-chip"
                  data-activo={c.id === elegido.id ? "" : undefined}
                  aria-pressed={c.id === elegido.id}
                  onClick={() => setBarato(c.id)}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    ) : gemini ? (
      <button type="button" className="cache-op" data-cache-compactar onClick={() => alCompactar?.(gemini.modelo)}>
        <Minimize2 className="cache-op-ico" size={20} strokeWidth={1.75} aria-hidden="true" />
        <span className="cache-op-txt">
          <span className="cache-op-t">{t("cache.compactarGemini")}</span>
          <span className="cache-op-d">{t("cache.compactarGeminiDet", { k: mil(v.tokensSeguir), modelo: datos.modeloNombre })}</span>
        </span>
      </button>
    ) : null;
  return createPortal(
    <div className="cambio-fondo" data-cache onMouseDown={(e) => e.target === e.currentTarget && alCancelar()}>
      <div ref={dialogo} className="cambio cache-dialogo" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} onKeyDown={tecla}>
        <h3 id={`${id}-t`} className="cambio-t">
          <Snowflake size={16} strokeWidth={2} aria-hidden="true" />
          {t("cache.titulo")}
        </h3>
        <p id={`${id}-d`} className="cambio-d">
          {t("cache.texto")}
        </p>
        <div className="cache-opciones">
          {opSeguir}
          {opResumen}
          {opCompactar}
        </div>
        <label className="cache-recordar">
          <input type="checkbox" data-cache-recordar checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
          {t("cache.recordar")}
        </label>
        <div className="cambio-b">
          <button type="button" className="btn2" data-cache-no onClick={alCancelar}>
            {t("cache.ahoraNo")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
