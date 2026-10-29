// Las acciones de cada mensaje del chat de un líder: Copiar (todos), Editar (los del usuario), Volver acá y Ramificar.
// La fila vive aparte de `Turno` y de `Yo` (un hermano más en `.conv`, sin alto: no mueve nada) y se muestra al pasar el mouse
// por el mensaje o al tener el foco adentro; con el dedo, al tocar el mensaje.
import { memo, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent as EventoPuntero } from "react";
import { Check, Copy, GitBranch, Paperclip, Pencil, Undo2 } from "lucide-react";
import { copiar } from "../copiar";
import { es } from "../atajos";
import { esTactil } from "../angosto";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { esVentana, main, mensaje } from "../puente";
import { ARCHIVO_MAX, IMAGENES_MAX, type Imagen } from "../../electron/imagenes";
import { archivosDeDatos, type Adjunto, type Archivo, ErrorAdjunto, pegadoSinTexto, prepararAdjunto, sumarAdjuntos } from "./adjuntos";
import { Adjuntos } from "./Imagenes";
import type { Punto } from "./turnos";
import "./acciones.css";

/** Qué se puede hacer en este líder, ahora. Un objeto estable: sólo cambia si cambia algo de esto. */
export type Acciones = {
  /** Volver acá y Editar: un líder que no sea local (cualquier motor), quieto y que ningún otro proceso tiene abierto. */
  rebobina: boolean;
  /** Ramificar: un líder que no sea local (cualquier motor). */
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
 * Editar un mensaje del usuario, en su lugar: el texto, sus imágenes y archivos (se quitan con × y se suman con el clip o
 * pegando, como en la caja), Enviar y Cancelar. Enviar sigue la conversación desde el mensaje anterior, con lo nuevo; lo que
 * venía después queda fuera de esa línea.
 */
export function EditorMensaje({
  inicial,
  previos,
  guardar,
  alEnviar,
  alCancelar,
}: {
  inicial: string;
  /** Las imágenes y archivos que tenía el mensaje. */
  previos: readonly (Imagen | Archivo)[];
  /** Guarda un archivo nuevo y da su ruta (el mismo que usa la caja). */
  guardar: (nombre: string, datos: Uint8Array) => Promise<string>;
  alEnviar: (texto: string, adjuntos: readonly Adjunto[]) => void;
  alCancelar: () => void;
}) {
  useIdioma();
  const [v, setV] = useState(inicial);
  const [inicio] = useState(() => sumarAdjuntos([], previos).lista);
  const [lista, setLista] = useState(inicio);
  // La lista también va en `ahora`: dos pegados seguidos ven lo del otro antes de repintar.
  const ahora = useRef(inicio);
  const cambiar = (nueva: readonly Adjunto[]) => {
    ahora.current = nueva;
    setLista(nueva);
  };
  const [error, setError] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const elegir = useRef<HTMLInputElement>(null);
  // Adónde va el cursor tras pegar texto (el de Wayland, que llega async).
  const cursor = useRef<number | null>(null);
  // Al abrir: foco al final del texto. El alto lo pone el CSS (field-sizing), como en la caja.
  useLayoutEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.focus({ preventScroll: true });
    c.setSelectionRange(c.value.length, c.value.length);
  }, []);
  useLayoutEffect(() => {
    const c = campo.current;
    if (c && cursor.current !== null) {
      c.setSelectionRange(cursor.current, cursor.current);
      cursor.current = null;
    }
  }, [v]);
  const puede = v.trim().length > 0 || lista.length > 0;
  const enviar = () => puede && alEnviar(v, lista);
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
  // Archivos pegados o elegidos: las imágenes se achican si hace falta; el resto lo guarda `guardar`.
  const adjuntar = (fs: readonly File[]) => {
    if (!fs.length) return;
    setError(null);
    void Promise.allSettled(fs.map((f) => prepararAdjunto(f, guardar))).then((rs) => {
      const ok = rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const mal = rs.find((r): r is PromiseRejectedResult => r.status === "rejected");
      const { lista: nueva, sobran } = sumarAdjuntos(ahora.current, ok);
      cambiar(nueva);
      if (mal)
        setError(
          mal.reason instanceof ErrorAdjunto
            ? mal.reason.grande
              ? t("adjunto.grande", { v: mal.reason.grande, n: ARCHIVO_MAX / 1024 / 1024 })
              : t("adjunto.leer")
            : mensaje(mal.reason),
        );
      else if (sobran) setError(t("adjunto.muchas", { n: IMAGENES_MAX }));
    });
    campo.current?.focus();
  };
  const quitar = (id: number) => cambiar(ahora.current.filter((a) => a.id !== id));
  // Igual que en la caja: el texto pegado sigue su camino; los archivos del portapapeles, a la lista.
  const pegar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const fs = archivosDeDatos(e.clipboardData);
    if (!fs.length) {
      // Sin nada que el navegador sepa pegar (Wayland): el texto lo pide el main.
      const leer = esVentana() ? main?.portapapeles : undefined;
      if (!leer || !pegadoSinTexto(e.clipboardData)) return;
      e.preventDefault();
      const c = e.currentTarget;
      const [ini, fin] = [c.selectionStart, c.selectionEnd];
      void leer.texto().then((txt) => {
        if (!txt) return;
        const base = c.value;
        cursor.current = ini + txt.length;
        setV(base.slice(0, ini) + txt + base.slice(fin));
      }, (err) => setError(mensaje(err)));
      return;
    }
    if (!e.clipboardData.types.includes("text/plain")) e.preventDefault();
    adjuntar(fs);
  };
  return (
    <div className="am-editor">
      {lista.length ? <Adjuntos lista={lista} alQuitar={quitar} /> : null}
      <textarea ref={campo} value={v} rows={1} aria-label={t("acciones.editar")} spellCheck={false} onChange={(e) => setV(e.target.value)} onKeyDown={tecla} onPaste={pegar} />
      {error ? <div className="caja-error" role="alert">{error}</div> : null}
      <div className="am-editor-b">
        <input
          ref={elegir}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            adjuntar(Array.from(e.currentTarget.files ?? []));
            e.currentTarget.value = "";
          }}
        />
        <button type="button" className="clip" aria-label={t("adjunto.adjuntar")} data-tip={t("adjunto.adjuntar")} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir.current?.click()}>
          <Paperclip size={13} strokeWidth={2} />
        </button>
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

/**
 * Con el dedo no hay pointerleave: tocar fuera de la conversación (la caja, la cabecera, el fondo) cierra la fila abierta.
 * Lo de adentro de `.conv` lo resuelve `sobreMensaje`. Devuelve el quitar del listener.
 */
export function cerrarSobreFuera(): () => void {
  const fuera = (e: PointerEvent) => {
    if (e.target instanceof Element && e.target.closest(".conv")) return;
    document.querySelectorAll(".am[data-sobre]").forEach((n) => n.removeAttribute("data-sobre"));
  };
  document.addEventListener("pointerdown", fuera);
  return () => document.removeEventListener("pointerdown", fuera);
}
