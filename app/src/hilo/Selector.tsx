// Selector propio (nada de <select> nativo): un botón con contorno y un menú
// que abre hacia arriba (si no hay lugar arriba, hacia abajo), en un portal a
// <body> con `position: fixed` para que ningún `overflow` de un ancestro lo
// recorte. Listbox con foco real en las opciones: flechas,
// Inicio/Fin, Enter o Espacio para elegir; Esc, Tab o clic afuera lo cierran.
import { Fragment, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronUp } from "lucide-react";
import { t } from "../i18n";
import { Reserva } from "../i18n/Fijo";
import { ChipLocal } from "./Logos";

export type Opcion = {
  id: string;
  nombre: string;
  /** Para qué sirve, en una línea. */
  desc: string;
  /** Lo que va delante del nombre (las barritas del esfuerzo). */
  marca?: ReactNode;
  /** El default de la tabla de routing. */
  rec?: boolean;
  /** `font-family` con que se escribe el nombre (el selector de fuentes: cada una en la suya). */
  fuente?: string;
  /** Se ve, con su `desc` diciendo por qué, pero no se elige (una máquina caída). */
  deshabilitada?: boolean;
  /** El rótulo de un grupo (la empresa de un modelo): se pinta antes de la primera opción de ese grupo, si la lista tiene más de uno. */
  grupo?: string;
  /** Corre en la GPU de esta máquina: lleva el chip de "local" junto al nombre. */
  local?: boolean;
};

type Props = {
  etiqueta: string;
  opciones: Opcion[];
  valor: string;
  alElegir: (id: string) => void;
  /** Marca fija del botón; si no, la de la opción elegida. */
  chip?: ReactNode;
  disabled?: boolean;
  /** Para las capturas: nace abierto. */
  abierto?: boolean;
  /**
   * Con esto el botón mide siempre lo de la opción más larga (y lo de estos
   * textos: los nombres en el otro idioma): elegir o cambiar de idioma no lo
   * agranda ni lo achica (B21). Sin esto, mide lo de la elegida.
   */
  reserva?: readonly string[];
};

/** El nombre de una opción, en su fuente si trae una. */
const nombreDe = (o: Opcion) => (o.fuente ? <span style={{ fontFamily: o.fuente }}>{o.nombre}</span> : o.nombre);

/** Aire que el menú le deja al borde de la ventana y al botón. */
const MARGEN = 8;
const SEPARACION = 6;

/** Pone el menú pegado al botón: arriba si entra, si no abajo (el lado con más lugar), con el alto topado al lugar que hay. */
function colocar(boton: HTMLElement, menu: HTMLElement) {
  const r = boton.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const st = menu.style;
  st.maxHeight = "";
  const arriba = r.top - SEPARACION - MARGEN;
  const abajo = vh - r.bottom - SEPARACION - MARGEN;
  const alto = menu.offsetHeight;
  const sube = alto <= arriba || (alto > abajo && arriba >= abajo);
  const lugar = Math.max(0, sube ? arriba : abajo);
  if (alto > lugar) st.maxHeight = `${lugar}px`;
  if (sube) {
    st.top = "auto";
    st.bottom = `${vh - r.top + SEPARACION}px`;
  } else {
    st.bottom = "auto";
    st.top = `${r.bottom + SEPARACION}px`;
  }
  // A lo ancho: alineado con el borde izquierdo del botón; si no entra, con el derecho; y nunca fuera de la ventana.
  const ancho = menu.offsetWidth;
  let izq = r.left;
  if (izq + ancho > vw - MARGEN) izq = r.right - ancho;
  st.left = `${Math.max(MARGEN, Math.min(izq, vw - MARGEN - ancho))}px`;
  st.transformOrigin = `${sube ? "bottom" : "top"} left`;
}

export function Selector({ etiqueta, opciones, valor, alElegir, chip, disabled, abierto: deEntrada = false, reserva }: Props) {
  const [abierto, setAbierto] = useState(deEntrada);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  // Sin opciones (los proyectos todavía no llegaron) el botón dice "…".
  const actual = opciones.find((o) => o.id === valor) ?? opciones[0] ?? { id: "", nombre: "…", desc: "" };

  // Con un solo grupo (los modelos de un worker: todos de Anthropic) el divisor no dice nada.
  const variosGrupos = new Set(opciones.map((o) => o.grupo).filter(Boolean)).size > 1;

  // Fijo a la ventana: sigue al botón si se hace scroll o cambia el tamaño.
  useLayoutEffect(() => {
    if (!abierto) return;
    const poner = () => {
      if (boton.current && menu.current) colocar(boton.current, menu.current);
    };
    poner();
    const alMover = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      poner();
    };
    window.addEventListener("resize", alMover);
    window.addEventListener("scroll", alMover, true);
    return () => {
      window.removeEventListener("resize", alMover);
      window.removeEventListener("scroll", alMover, true);
    };
  }, [abierto]);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? [])];

  // Al abrir, el foco va a la opción elegida.
  useLayoutEffect(() => {
    if (!abierto) return;
    const ops = items();
    (ops.find((o) => o.getAttribute("aria-selected") === "true") ?? ops[0])?.focus();
  }, [abierto]);

  const cerrar = (conFoco = true) => {
    setAbierto(false);
    if (conFoco) boton.current?.focus();
  };

  const teclaBoton = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setAbierto(true);
  };

  const teclaMenu = (e: KeyboardEvent) => {
    const ops = items();
    const i = ops.indexOf(document.activeElement as HTMLElement);
    const ir = (k: number) => {
      e.preventDefault();
      ops[Math.max(0, Math.min(ops.length - 1, k))]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        return ir(i + 1);
      case "ArrowUp":
        return ir(i - 1);
      case "Home":
        return ir(0);
      case "End":
        return ir(ops.length - 1);
      case "Escape":
        // Que no llegue a la barra: este Esc sólo cierra el menú.
        e.stopPropagation();
        return cerrar();
      case "Tab":
        // Sin preventDefault: el foco vuelve al botón y de ahí sigue su camino.
        return cerrar();
    }
  };

  return (
    <div className="pick">
      <button
        ref={boton}
        type="button"
        className="pbtn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        aria-label={`${etiqueta}: ${actual.nombre}`}
        onClick={() => setAbierto((a) => !a)}
        onKeyDown={teclaBoton}
      >
        {chip ?? actual.marca}
        {reserva ? (
          <Reserva texto={nombreDe(actual)} reserva={[...opciones.filter((o) => o !== actual).map(nombreDe), ...reserva]} />
        ) : (
          nombreDe(actual)
        )}
        <ChevronUp className="chev" size={12} strokeWidth={2} />
      </button>
      {abierto
        ? createPortal(
            <>
              <button type="button" className="fondo" tabIndex={-1} aria-label={t("comun.cerrarMenu")} onClick={() => cerrar(false)} />
              <div ref={menu} id={id} className="menu" role="listbox" aria-label={etiqueta} onKeyDown={teclaMenu}>
                <div className="mh" aria-hidden="true">
                  {etiqueta}
                </div>
                {opciones.map((o, i) => (
                  <Fragment key={o.id}>
                    {variosGrupos && o.grupo && o.grupo !== opciones[i - 1]?.grupo ? (
                      // Como el rótulo de arriba, oculto al lector: la `desc` de cada opción ya dice qué es.
                      <div className="mh mh-grupo" data-primero={i === 0 ? "" : undefined} aria-hidden="true">
                        {o.grupo}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      className="op"
                      tabIndex={-1}
                      disabled={o.deshabilitada}
                      aria-selected={o.id === actual.id}
                      onClick={() => {
                        alElegir(o.id);
                        cerrar();
                      }}
                    >
                      <span className="on1">
                        {o.marca}
                        {o.fuente ? <span style={{ fontFamily: o.fuente }}>{o.nombre}</span> : o.nombre}
                        {o.local ? <ChipLocal /> : null}
                        {o.rec ? <span className="rec">{t("selector.default")}</span> : null}
                      </span>
                      <span className="md">{o.desc}</span>
                      <Check className="ok" size={14} strokeWidth={2.2} />
                    </button>
                  </Fragment>
                ))}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
