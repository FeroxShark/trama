// Selector propio (nada de <select> nativo): un botón con contorno y un menú
// que abre hacia arriba (si no hay lugar arriba, hacia abajo), en un portal a
// <body> con `position: fixed` para que ningún `overflow` de un ancestro lo
// recorte. Listbox con foco real en las opciones: flechas,
// Inicio/Fin, Enter o Espacio para elegir; Esc, Tab o clic afuera lo cierran.
import { Fragment, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronUp, Search } from "lucide-react";
import { t } from "../i18n";
import { Reserva } from "../i18n/Fijo";
import { ChipLocal } from "./Logos";
import { filtrar, mover, repartir, type Flecha } from "./selector-columnas";

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
  /** En columnas: la columna si no es la de su `grupo` (los locales de GPU y los de Ollama van juntos). */
  col?: string;
  /** En columnas: el título de la columna, si no es el `grupo`. */
  colNombre?: string;
  /** En columnas: el logo del título de la columna. */
  colMarca?: ReactNode;
  /** En columnas: el lugar de la columna (menor, antes); sin esto, el orden en que aparecen. */
  colOrden?: number;
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
  /**
   * Un menú ancho con una columna por grupo (`Opcion.grupo`: el proveedor del modelo), todas a la vista, cada una con su título y su logo.
   * Las opciones sin grupo ("Elegí uno…") quedan arriba, a todo lo ancho. En un celular es una sola columna con los títulos pegados
   * arriba. Con muchas opciones trae una búsqueda. Con un solo grupo es el menú de siempre.
   */
  columnas?: boolean;
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

/** Desde cuántas opciones el menú en columnas trae la búsqueda. */
const CON_BUSQUEDA = 8;

export function Selector({ etiqueta, opciones, valor, alElegir, chip, disabled, abierto: deEntrada = false, reserva, columnas = false }: Props) {
  const [abierto, setAbierto] = useState(deEntrada);
  const [busqueda, setBusqueda] = useState("");
  const buscador = useRef<HTMLInputElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  // Sin opciones (los proyectos todavía no llegaron) el botón dice "…".
  const actual = opciones.find((o) => o.id === valor) ?? opciones[0] ?? { id: "", nombre: "…", desc: "" };

  // Con un solo grupo (los modelos de un worker: todos de Anthropic) el divisor no dice nada.
  const variosGrupos = new Set(opciones.map((o) => o.grupo ?? o.col).filter(Boolean)).size > 1;
  // En columnas sólo si hay más de un grupo: con uno solo (los modelos de un worker, todos de Anthropic) una columna angosta no aporta.
  const enColumnas = columnas && variosGrupos;
  const conBusqueda = enColumnas && opciones.length >= CON_BUSQUEDA;
  const visibles = useMemo(() => (enColumnas ? filtrar(opciones, busqueda) : opciones), [enColumnas, opciones, busqueda]);
  const reparto = useMemo(() => repartir(visibles), [visibles]);

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

  // Al filtrar, el menú cambia de alto: se vuelve a poner junto al botón.
  useLayoutEffect(() => {
    if (abierto && boton.current && menu.current) colocar(boton.current, menu.current);
  }, [abierto, busqueda]);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? [])];

  // Al abrir, el foco va a la opción elegida.
  useLayoutEffect(() => {
    if (!abierto) return;
    const ops = items();
    (ops.find((o) => o.getAttribute("aria-selected") === "true") ?? ops[0])?.focus();
  }, [abierto]);

  const cerrar = (conFoco = true) => {
    setAbierto(false);
    setBusqueda("");
    if (conFoco) boton.current?.focus();
  };

  const teclaBoton = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setAbierto(true);
  };

  /** Las opciones elegibles por sección (0 = la fila de arriba, 1… = cada columna), para moverse con las flechas. */
  const secciones = () => {
    const ss = [...(menu.current?.querySelectorAll<HTMLElement>("[data-sec]") ?? [])];
    return ss.map((sec) => [...sec.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)')]);
  };

  const teclaColumnas = (e: KeyboardEvent) => {
    const enBuscador = e.target === buscador.current;
    if (e.key === "Escape") {
      e.stopPropagation();
      if (enBuscador && busqueda) {
        e.preventDefault();
        setBusqueda("");
        return;
      }
      return cerrar();
    }
    if (e.key === "Tab") return cerrar();
    const ss = secciones();
    const primera = ss.find((s) => s.length)?.[0];
    if (enBuscador) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        primera?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        primera?.click();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const activo = document.activeElement as HTMLElement | null;
      const s = ss.findIndex((sec) => activo && sec.includes(activo));
      if (s < 0) return primera?.focus();
      const desde = { s, i: ss[s]!.indexOf(activo!) };
      const a = mover(ss.map((x) => x.length), desde, e.key as Flecha);
      // Arriba de la primera opción está la búsqueda.
      if (a.s === desde.s && a.i === desde.i && e.key === "ArrowUp") return buscador.current?.focus();
      ss[a.s]?.[a.i]?.focus();
      return;
    }
    // Escribir estando en una opción lleva a la búsqueda (la letra queda escrita ahí).
    if (conBusqueda && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") buscador.current?.focus();
  };

  const teclaMenu = (e: KeyboardEvent) => {
    if (enColumnas) return teclaColumnas(e);
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

  const opcion = (o: Opcion) => (
    <button
      key={o.id}
      type="button"
      role="option"
      className="op"
      tabIndex={-1}
      disabled={o.deshabilitada}
      aria-selected={o.id === actual.id}
      title={enColumnas ? `${o.nombre}${o.desc ? ` · ${o.desc}` : ""}` : undefined}
      onClick={() => {
        alElegir(o.id);
        cerrar();
      }}
    >
      <span className="on1">
        {o.marca}
        {o.fuente ? <span style={{ fontFamily: o.fuente }}>{o.nombre}</span> : <span className="on-n">{o.nombre}</span>}
        {o.local ? <ChipLocal /> : null}
        {o.rec ? <span className="rec">{t("selector.default")}</span> : null}
      </span>
      <span className="md">{o.desc}</span>
      <Check className="ok" size={14} strokeWidth={2.2} />
    </button>
  );

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
              <div
                ref={menu}
                id={enColumnas ? undefined : id}
                className="menu"
                data-columnas={enColumnas ? reparto.columnas.length : undefined}
                style={enColumnas ? ({ "--n": Math.max(1, reparto.columnas.length) } as React.CSSProperties) : undefined}
                role={enColumnas ? undefined : "listbox"}
                aria-label={enColumnas ? undefined : etiqueta}
                onKeyDown={teclaMenu}
              >
                {enColumnas ? (
                  <>
                    <div className="mc-cab">
                      <span className="mh" aria-hidden="true">
                        {etiqueta}
                      </span>
                      {conBusqueda ? (
                        <label className="mc-busca">
                          <Search size={13} strokeWidth={2} aria-hidden="true" />
                          <input
                            ref={buscador}
                            type="search"
                            value={busqueda}
                            placeholder={t("selector.buscar")}
                            aria-label={t("selector.buscar")}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(e) => setBusqueda(e.target.value)}
                          />
                        </label>
                      ) : null}
                    </div>
                    <div id={id} className="mc-lista" role="listbox" aria-label={etiqueta}>
                      {reparto.arriba.length ? (
                        <div className="mc-arriba" data-sec="0">
                          {reparto.arriba.map((o) => opcion(o))}
                        </div>
                      ) : (
                        <div data-sec="0" hidden />
                      )}
                      <div className="mc-cols">
                        {reparto.columnas.map((c, k) => (
                          <div key={c.clave} className="mc-col" role="group" aria-labelledby={`${id}-c${k}`} data-sec={k + 1}>
                            <div id={`${id}-c${k}`} className="mc-tit">
                              {c.ops[0]?.colMarca ?? c.ops[0]?.marca}
                              <span>{c.nombre}</span>
                            </div>
                            {c.ops.map((o, i) => (
                              <Fragment key={o.id}>
                                {o.grupo && o.grupo !== c.nombre && o.grupo !== c.ops[i - 1]?.grupo ? <div className="mc-sub">{o.grupo}</div> : null}
                                {opcion(o)}
                              </Fragment>
                            ))}
                          </div>
                        ))}
                      </div>
                      {!visibles.length ? <div className="mc-nada">{t("selector.nada")}</div> : null}
                    </div>
                  </>
                ) : (
                  <>
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
                        {opcion(o)}
                      </Fragment>
                    ))}
                  </>
                )}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
