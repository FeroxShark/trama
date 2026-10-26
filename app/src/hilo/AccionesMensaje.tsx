// Las acciones de cada mensaje del chat de un líder: Copiar (todos), Editar (los del usuario), Volver acá y Ramificar.
// La fila vive aparte de `Turno` y de `Yo` (un hermano más en `.conv`, sin alto: no mueve nada) y se muestra al pasar el mouse
// por el mensaje o al tener el foco adentro; con el dedo, al tocar el mensaje.
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as EventoPuntero } from "react";
import { Check, Copy, GitBranch, Pencil, Undo2 } from "lucide-react";
import { copiar } from "../copiar";
import { es } from "../atajos";
import { esTactil } from "../angosto";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import type { Punto } from "./turnos";
import "./acciones.css";

/** Qué se puede hacer en este líder, ahora. Un objeto estable: sólo cambia si cambia algo de esto. */
export type Acciones = {
  /** Volver acá y Editar: un líder de Claude, quieto y que ningún otro proceso tiene abierto. */
  rebobina: boolean;
  /** Ramificar: un líder de Claude. */
  ramifica: boolean;
  /** Por qué no se puede rebobinar ahora (tooltip de los botones apagados), o `null`. */
  motivo: string | null;
  volver: (p: Punto) => void;
  ramificar: (p: Punto) => void;
};

/** Cuánto se queda el tilde de "copiado". */
const TILDE_MS = 1500;

/**
 * La fila de un mensaje. `propio`: es del usuario (tiene Editar y va a la derecha). `alEditar` abre el editor en el lugar del
 * mensaje; sin `punto.previo` (el primer mensaje: no hay de dónde seguir) no hay Editar.
 */
export const AccionesMensaje = memo(function AccionesMensaje({
  texto,
  punto,
  propio,
  acciones,
  alEditar,
}: {
  texto: string;
  punto: Punto | undefined;
  propio: boolean;
  acciones: Acciones | null;
  alEditar?: () => void;
}) {
  useIdioma();
  const [copiado, setCopiado] = useState(false);
  const reloj = useRef(0);
  useEffect(() => () => clearTimeout(reloj.current), []);
  const copiarTexto = () => {
    void copiar(texto).then((ok) => {
      if (!ok) return;
      setCopiado(true);
      clearTimeout(reloj.current);
      reloj.current = window.setTimeout(() => setCopiado(false), TILDE_MS);
    });
  };
  const rebobina = !!acciones && !!punto && acciones.rebobina;
  const ramifica = !!acciones && !!punto && acciones.ramifica;
  // Un mensaje sin uuid (recién escrito, o de antes de compactar) no se puede señalar: sólo Copiar.
  const apagado = !!acciones && !!punto && !acciones.rebobina ? acciones.motivo : null;
  return (
    <div className="am" data-lado={propio ? "der" : "izq"}>
      <div className="am-fila" role="toolbar" aria-label={t("acciones.titulo")}>
        <button type="button" className="am-b" data-hecho={copiado ? "" : undefined} aria-label={t(copiado ? "acciones.copiado" : "acciones.copiar")} data-tip={t(copiado ? "acciones.copiado" : "acciones.copiar")} onClick={copiarTexto}>
          {copiado ? <Check size={14} strokeWidth={2.2} /> : <Copy size={14} strokeWidth={2} />}
        </button>
        {propio && acciones && punto?.previo && (rebobina || apagado) ? (
          <button type="button" className="am-b" disabled={!rebobina} aria-label={t("acciones.editar")} data-tip={apagado ?? t("acciones.editar")} onClick={alEditar}>
            <Pencil size={14} strokeWidth={2} />
          </button>
        ) : null}
        {acciones && punto && (rebobina || apagado) ? (
          <button type="button" className="am-b" disabled={!rebobina} aria-label={t("acciones.volver")} data-tip={apagado ?? t("acciones.volver")} onClick={() => acciones.volver(punto)}>
            <Undo2 size={14} strokeWidth={2} />
          </button>
        ) : null}
        {ramifica && acciones && punto ? (
          <button type="button" className="am-b" aria-label={t("acciones.ramificar")} data-tip={t("acciones.ramificar")} onClick={() => acciones.ramificar(punto)}>
            <GitBranch size={14} strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Editar un mensaje del usuario, en su lugar: el campo con el texto de antes, Enviar y Cancelar. Enviar sigue la
 * conversación desde el mensaje anterior, con el texto nuevo; lo que venía después queda fuera de esa línea.
 */
export function EditorMensaje({ inicial, alEnviar, alCancelar }: { inicial: string; alEnviar: (texto: string) => void; alCancelar: () => void }) {
  useIdioma();
  const [v, setV] = useState(inicial);
  const campo = useRef<HTMLTextAreaElement>(null);
  // Al abrir: foco al final del texto. Y el alto sigue al contenido.
  useLayoutEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.focus({ preventScroll: true });
    c.setSelectionRange(c.value.length, c.value.length);
  }, []);
  useLayoutEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.style.height = "auto";
    c.style.height = `${c.scrollHeight}px`;
  }, [v]);
  const puede = v.trim().length > 0;
  const enviar = () => puede && alEnviar(v);
  const tecla = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      alCancelar();
    } else if (es("enviar", e) && !esTactil()) {
      e.preventDefault();
      enviar();
    }
  };
  return (
    <div className="am-editor">
      <textarea ref={campo} value={v} rows={1} aria-label={t("acciones.editar")} spellCheck={false} onChange={(e) => setV(e.target.value)} onKeyDown={tecla} />
      <div className="am-editor-b">
        <button type="button" className="am-cancelar" onClick={alCancelar}>
          {t("acciones.cancelar")}
        </button>
        <button type="button" className="am-enviar" disabled={!puede} onClick={enviar}>
          {t("acciones.enviar")}
        </button>
      </div>
    </div>
  );
}

/**
 * Qué fila de acciones se ve: la del mensaje bajo el mouse. Se engancha a `.conv` (pointerover / pointerleave) y marca
 * `data-sobre` a mano, sin estado de React: pasar el mouse por 3000 mensajes no repinta nada. Con el dedo, tocar el mensaje
 * muestra su fila (no depende del hover); el foco lo resuelve el CSS (`:focus-within`).
 */
export function sobreMensaje(e: EventoPuntero<HTMLElement>): void {
  // Con el dedo, tocar un mensaje muestra su fila; soltar el dedo (pointerleave) no la esconde.
  if (e.type === "pointerleave" && e.pointerType === "touch") return;
  const conv = e.currentTarget;
  conv.querySelector(":scope > .am[data-sobre]")?.removeAttribute("data-sobre");
  if (e.type === "pointerleave") return;
  // El hijo directo de `.conv` bajo el mouse, y su mensaje: de la marca `i.k` que lo abre hasta la próxima.
  let n: Element | null = e.target instanceof Element ? e.target : null;
  while (n && n.parentElement !== conv) n = n.parentElement;
  while (n && !n.matches("i.k")) n = n.previousElementSibling;
  for (n = n?.nextElementSibling ?? null; n && !n.matches("i.k"); n = n.nextElementSibling) {
    if (n.matches(".am")) {
      n.setAttribute("data-sobre", "");
      return;
    }
  }
}
