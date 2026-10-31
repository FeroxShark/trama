// Selector propio (nada de <select> nativo): un botón con contorno y un menú
// que abre hacia arriba (si no hay lugar arriba, hacia abajo), en un portal a
// <body> con `position: fixed` para que ningún `overflow` de un ancestro lo
// recorte. Listbox con foco real en las opciones: flechas,
// Inicio/Fin, Enter o Espacio para elegir; Esc, Tab o clic afuera lo cierran.
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ban, Check, ChevronUp, Clock, Search } from "lucide-react";
import { t } from "../i18n";
import { Reserva } from "../i18n/Fijo";
import { cuandoFuturo } from "../tiempo";
import { ChipLocal } from "./Logos";
import { DialogoCambio, type DatosCambio } from "./DialogoCambio";
import type { EstadoCupo } from "./cupo-modelos.ts";
import { filtrar, moverEsfuerzo, repartir, type Flecha } from "./selector-columnas";
import { filtrarLista, moverResaltada } from "./selector-lista.ts";

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
  /** Gratis: la lista compacta lo marca con "Gratis" a la derecha (no sólo con el color). */
  gratis?: boolean;
  /** De OpenCode Go (plan pago de OpenCode): la lista compacta lo marca con el texto «Plan Go» a la derecha. */
  go?: boolean;
  /** De pago (tu clave de API, se paga por uso): la lista compacta lo marca con "De pago" a la derecha. */
  pago?: boolean;
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
  /** Con `buscar`: se ve siempre, aunque la búsqueda no la deje (la salida "Otra carpeta…"). */
  fija?: boolean;
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
   * Un menú compacto (ancho tope ~46rem, alto tope 60vh): a la izquierda un riel con una pestaña por grupo (`Opcion.grupo`: el proveedor del
   * modelo, con su logo y cuántos tiene) y a la derecha una sola lista, la del proveedor elegido, de un renglón por modelo. La búsqueda de arriba
   * mira todos los proveedores. En un celular el riel pasa arriba, en horizontal. Con un solo grupo es el menú de siempre.
   */
  columnas?: boolean;
  /** Si elegir esta opción pide confirmación (otro motor): los datos del diálogo, que se abre sobre el menú abierto; el valor no cambia hasta confirmar. */
  confirmar?: (id: string) => DatosCambio | null;
  /** Lo que se suma al nombre cuando la barra se compacta ("· med": el esfuerzo fusionado en el chip); lo muestra el CSS. */
  sufijo?: string;
  /** El cupo de cada modelo, por id (`cupo-modelos.ts`): sin cupo se ve atenuado con su hora; poco cupo lleva un punto ámbar. Sin esto, ninguno lleva marca. */
  cupos?: ReadonlyMap<string, EstadoCupo>;
  /** Lo mismo por proveedor (la clave de su pestaña): sin cupo lleva el ícono en el riel. */
  cuposColumnas?: ReadonlyMap<string, EstadoCupo>;
  /** Lo que va debajo de la lista, según la pestaña abierta (con `clave` null, nada): p. ej. lo que trae el motor de ese proveedor. */
  pie?: (clave: string | null) => ReactNode;
  /** Para las capturas: nace con el diálogo de esta opción. */
  confirmando?: string;
  /** Cada vez que cambia (y no es 0) el menú se abre; con `pestana`, en el riel de ese proveedor (el “Cambiar de modelo” de un error). */
  senalAbrir?: number;
  pestana?: string | null;
  /**
   * Lo elegido difiere de lo que usa el turno en curso: se aplica al próximo mensaje. Lleva un reloj y "próx." junto al valor (no sólo
   * color) y el texto de acá como tooltip y en el nombre accesible del botón. El selector sigue abierto: nunca se bloquea por un turno.
   */
  pendiente?: string;
  /** Lo mismo para algo que este botón no muestra de entrada (el esfuerzo, cuando la barra lo fusiona en el chip del modelo): la marca sólo se ve con la barra compacta. */
  pendienteCompacto?: string;
  enteras?: boolean;
  /**
   * El esfuerzo del modelo, cuando la barra lo fusiona en el chip (`sufijo`): el menú del modelo lo trae al pie, para elegirlo ahí. Con esto,
   * elegir un modelo no cierra el menú (el esfuerzo se elige en él); se cierra al elegir el esfuerzo, al tocar afuera o con Esc o Tab.
   */
  esfuerzo?: { etiqueta: string; opciones: Opcion[]; valor: string; alElegir: (id: string) => void };
  /**
   * Con esto el menú de una sola lista trae un buscador arriba: el texto es su placeholder y su nombre accesible. Filtra por nombre y
   * descripción (sin mayúsculas ni tildes); las flechas mueven la resaltada, Enter elige y Esc cierra. No aplica en columnas.
   */
  buscar?: string;
  /** Para las capturas: nace con esta búsqueda escrita (junto con `abierto`). */
  busquedaInicial?: string;
};

/** El nombre de una opción, en su fuente si trae una. */
const nombreDe = (o: Opcion) => (o.fuente ? <span style={{ fontFamily: o.fuente }}>{o.nombre}</span> : o.nombre);

/** «sin cupo hasta <cuándo>», o sólo «sin cupo» si no se sabe cuándo vuelve. */
const textoSinCupo = (c: EstadoCupo) => (c.vuelve !== null ? t("selector.sinCupoHasta", { cuando: cuandoFuturo(c.vuelve) }) : t("selector.sinCupo"));

/** «poco cupo: N % libre», con el número del dato. */
const textoPocoCupo = (c: EstadoCupo) => t("selector.pocoCupoTip", { n: Math.round(c.libre ?? 0) });

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

export function Selector({ etiqueta, opciones, valor, alElegir, chip, disabled, abierto: deEntrada = false, reserva, columnas = false, confirmar, sufijo, cupos, cuposColumnas, pie, confirmando, senalAbrir = 0, pestana = null, pendiente, pendienteCompacto, enteras = false, esfuerzo, buscar, busquedaInicial }: Props) {
  const [abierto, setAbierto] = useState(deEntrada || !!confirmando);
  const [pend, setPend] = useState<{ id: string; datos: DatosCambio } | null>(() => {
    const d = confirmando && confirmar ? confirmar(confirmando) : null;
    return d ? { id: confirmando!, datos: d } : null;
  });
  const [busqueda, setBusqueda] = useState(busquedaInicial ?? "");
  // Con `buscar`: la fila resaltada por las flechas, como índice en lo que queda con la búsqueda.
  const [resaltada, setResaltada] = useState(0);
  const [tab, setTab] = useState<string | null>(null);
  useEffect(() => {
    if (!senalAbrir || disabled) return;
    setTab(pestana);
    setAbierto(true);
  }, [senalAbrir]); // eslint-disable-line react-hooks/exhaustive-deps
  const buscador = useRef<HTMLInputElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  // Sin opciones (los proyectos todavía no llegaron) el botón dice "…".
  const actual = opciones.find((o) => o.id === valor) ?? opciones[0] ?? { id: "", nombre: "…", desc: "" };
  const cupoActual = cupos?.get(actual.id);
  /** La marca de cupo de una fila o una pestaña: prohibido con su hora si está sin cupo, punto ámbar si queda poco. Siempre con texto (oculto para el lector). */
  const marcaCupo = (c: EstadoCupo | undefined) => {
    if (c?.sin) {
      return (
        <>
          <Ban size={11} strokeWidth={2.2} aria-hidden="true" />
          <span className="oculto">{textoSinCupo(c)}</span>
        </>
      );
    }
    if (c?.poco) {
      return (
        <>
          <span className="oc-punto" aria-hidden="true" />
          <span className="oculto">{textoPocoCupo(c)}</span>
        </>
      );
    }
    return null;
  };

  // Con un solo grupo (los modelos de un worker: todos de Anthropic) el divisor no dice nada.
  const variosGrupos = new Set(opciones.map((o) => o.grupo ?? o.col).filter(Boolean)).size > 1;
  // En columnas sólo si hay más de un grupo: con uno solo (los modelos de un worker, todos de Anthropic) una columna angosta no aporta.
  const enColumnas = columnas && variosGrupos;
  const conBusqueda = enColumnas && opciones.length >= CON_BUSQUEDA;
  // El menú de una sola lista con buscador (`buscar`): lo que queda con lo escrito, y la resaltada dentro de eso.
  const buscable = !!buscar && !enColumnas;
  const lista = useMemo(() => (buscable ? filtrarLista(opciones, busqueda) : opciones), [buscable, opciones, busqueda]);
  const res = Math.max(0, Math.min(resaltada, lista.length - 1));
  const idOpcion = (i: number) => `${id}-${i}`;
  const visibles = useMemo(() => (enColumnas ? filtrar(opciones, busqueda) : opciones), [enColumnas, opciones, busqueda]);
  const reparto = useMemo(() => repartir(visibles), [visibles]);
  // El riel: una pestaña por proveedor (todos, aunque la búsqueda deje a alguno sin coincidencias; entonces va con un 0).
  const riel = useMemo(() => (enColumnas ? repartir(opciones).columnas : []), [enColumnas, opciones]);
  const buscando = busqueda.trim() !== "";
  const claveDe = (o: Opcion) => o.col ?? o.grupo;
  const tabActiva = (tab && riel.some((c) => c.clave === tab) ? tab : null) ?? (claveDe(actual) && riel.some((c) => c.clave === claveDe(actual)) ? claveDe(actual) : null) ?? riel[0]?.clave ?? null;
  const cuenta = (clave: string) => reparto.columnas.find((c) => c.clave === clave)?.ops.length ?? 0;

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

  // Al abrir, el foco va a la opción elegida (con buscador, a la búsqueda, con la elegida resaltada o la primera que queda).
  useLayoutEffect(() => {
    if (!abierto) return;
    if (buscable) {
      setResaltada(Math.max(0, lista.findIndex((o) => o.id === actual.id)));
      return buscador.current?.focus();
    }
    const ops = items();
    (ops.find((o) => o.getAttribute("aria-selected") === "true") ?? ops[0])?.focus();
  }, [abierto]);

  // Con buscador, la resaltada queda a la vista al bajar o subir con las flechas.
  useLayoutEffect(() => {
    if (buscable) menu.current?.querySelector<HTMLElement>("[data-resaltada]")?.scrollIntoView({ block: "nearest" });
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  const cerrar = (conFoco = true) => {
    setAbierto(false);
    setBusqueda("");
    setTab(null);
    if (conFoco) boton.current?.focus();
  };

  // Con el esfuerzo al pie del menú, elegir un modelo lo deja abierto: el esfuerzo se elige ahí.
  const alElegirOpcion = (id: string) => {
    alElegir(id);
    if (!esfuerzo) cerrar();
  };

  const teclaBoton =(e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setAbierto(true);
  };

  /** Las opciones de la lista (de la pestaña, o de todas las que coinciden con la búsqueda). */
  const filas = () => [...(menu.current?.querySelectorAll<HTMLElement>('.mc-lista [role="option"]:not(:disabled)') ?? [])];
  const pestanas = () => [...(menu.current?.querySelectorAll<HTMLElement>('.mc-riel [role="tab"]') ?? [])];
  const hojear = (clave: string) => {
    if (!buscando) return setTab(clave);
    // Buscando se ven todos los proveedores: la pestaña lleva al suyo.
    menu.current?.querySelector<HTMLElement>(`[data-grupo-clave="${CSS.escape(clave)}"]`)?.scrollIntoView({ block: "start" });
  };

  /** Los niveles de la fila de esfuerzo (al pie del menú). */
  const niveles = () => [...(menu.current?.querySelectorAll<HTMLElement>('.mc-esf [role="radio"]') ?? [])];
  /** Abajo de la última opción va a la fila de esfuerzo: al nivel elegido (o al primero). `false` si no hay fila. */
  const irAEsfuerzo = () => {
    const r = niveles();
    (r.find((x) => x.getAttribute("aria-checked") === "true") ?? r[0])?.focus();
    return r.length > 0;
  };
  /** Arriba de la fila de esfuerzo vuelve a la lista: a la opción elegida, o a la última si no está a la vista. */
  const volverALista = () => {
    const ops = items();
    (ops.find((o) => o.getAttribute("aria-selected") === "true") ?? ops[ops.length - 1])?.focus();
  };

  /** Las teclas dentro de la fila de esfuerzo: flechas y Inicio/Fin recorren los niveles; Enter o Espacio (el clic) elige y cierra. */
  const teclaEsfuerzo = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      return cerrar();
    }
    if (e.key === "Tab") return cerrar();
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const r = niveles();
    const k = moverEsfuerzo(r.length, r.indexOf(document.activeElement as HTMLElement), e.key as Flecha);
    if (k === null) return volverALista();
    r[k]?.focus();
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
    const activo = document.activeElement as HTMLElement | null;
    const op = filas();
    const tabs = pestanas();
    const enRiel = !!activo && tabs.includes(activo);
    if (enBuscador) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        op[0]?.focus();
      } else if (e.key === "Enter") {
        e.preventDefault();
        op[0]?.click();
      }
      return;
    }
    if (enRiel) {
      const i = tabs.indexOf(activo!);
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const k = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : Math.max(0, Math.min(tabs.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
        if (k === 0 && e.key === "ArrowUp" && i === 0) return buscador.current?.focus();
        tabs[k]?.focus();
        const c = tabs[k]?.dataset.clave;
        if (c) hojear(c);
      } else if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        (op.find((o) => o.getAttribute("aria-selected") === "true") ?? op[0])?.focus();
      }
      return;
    }
    const i = activo ? op.indexOf(activo) : -1;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (i < 0) return op[0]?.focus();
      if (e.key === "ArrowDown" && i === op.length - 1 && irAEsfuerzo()) return;
      if (e.key === "ArrowUp" && i === 0) return buscador.current?.focus() ?? tabs[0]?.focus();
      op[e.key === "Home" ? 0 : e.key === "End" ? op.length - 1 : Math.max(0, Math.min(op.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      // De vuelta al riel: a la pestaña del proveedor de la opción en la que está.
      const g = activo?.closest<HTMLElement>("[data-grupo-clave]")?.dataset.grupoClave ?? tabActiva;
      (tabs.find((x) => x.dataset.clave === g) ?? tabs[0])?.focus();
      return;
    }
    // Escribir estando en una opción lleva a la búsqueda (la letra queda escrita ahí).
    if (conBusqueda && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") buscador.current?.focus();
  };

  // Con buscador el foco se queda en la búsqueda: las flechas mueven la resaltada, Enter elige la resaltada, Esc y Tab cierran.
  const teclaBuscar = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      return cerrar();
    }
    if (e.key === "Tab") return cerrar();
    if (e.key === "Enter") {
      e.preventDefault();
      const o = lista[res];
      if (!o || o.deshabilitada) return;
      const datos = confirmar?.(o.id);
      // Otro motor: el menú sigue abierto y el chip como estaba hasta que se confirme.
      if (datos) return setPend({ id: o.id, datos });
      return alElegirOpcion(o.id);
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setResaltada(moverResaltada(lista.length, res, e.key));
    }
  };

  const teclaMenu = (e: KeyboardEvent) => {
    if (esfuerzo && niveles().includes(document.activeElement as HTMLElement)) return teclaEsfuerzo(e);
    if (enColumnas) return teclaColumnas(e);
    if (buscable) return teclaBuscar(e);
    const ops = items();
    const i = ops.indexOf(document.activeElement as HTMLElement);
    const ir = (k: number) => {
      e.preventDefault();
      ops[Math.max(0, Math.min(ops.length - 1, k))]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        if (i === ops.length - 1 && irAEsfuerzo()) return e.preventDefault();
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

  // `i` (solo con buscador) es el lugar en la lista filtrada: la resaltada se marca y el puntero la pasa a ella.
  const opcion = (o: Opcion, i?: number) => (
    <button
      key={o.id}
      id={i === undefined ? undefined : idOpcion(i)}
      type="button"
      role="option"
      className="op"
      tabIndex={-1}
      disabled={o.deshabilitada}
      aria-selected={o.id === actual.id}
      data-resaltada={i !== undefined && i === res ? "" : undefined}
      onMouseEnter={i === undefined ? undefined : () => setResaltada(i)}
      title={enColumnas ? `${o.nombre}${o.desc ? ` · ${o.desc}` : ""}` : undefined}
      onClick={() => {
        const datos = confirmar?.(o.id);
        // Otro motor: el menú sigue abierto y el chip como estaba hasta que se confirme.
        if (datos) return setPend({ id: o.id, datos });
        alElegirOpcion(o.id);
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

  /** Un modelo en la lista compacta: un renglón (nombre y, a la derecha, "Gratis" / "De pago" / "por defecto"); la descripción, sólo en el resaltado. */
  const opcionCompacta = (o: Opcion, colNombre: string) => {
    const nom = o.nombre.replace(/\s·\s(?:por\s)?([^·]+)$/, (m, g: string) => (g === colNombre || g === o.colNombre || g === o.grupo || (o.gratis && g === "Gratis") || (o.go && g === "Plan Go") ? "" : m));
    return (
      <button
        key={o.id}
        type="button"
        role="option"
        className="op op-c"
        tabIndex={-1}
        disabled={o.deshabilitada}
        aria-selected={o.id === actual.id}
        data-agotada={cupos?.get(o.id)?.sin ? "" : undefined}
        title={`${o.nombre}${o.desc ? ` · ${o.desc}` : ""}${cupos?.get(o.id)?.sin ? ` · ${textoSinCupo(cupos.get(o.id)!)}` : ""}`}
        onClick={() => {
          const datos = confirmar?.(o.id);
          // Otro motor: el menú sigue abierto y el chip como estaba hasta que se confirme.
          if (datos) return setPend({ id: o.id, datos });
          alElegirOpcion(o.id);
        }}
      >
        <span className="on1">
          {o.marca ? <span className="on-ico" aria-hidden="true">{o.marca}</span> : null}
          {o.fuente ? <span style={{ fontFamily: o.fuente }}>{nom}</span> : <span className="on-n">{nom}</span>}
          {o.local ? <ChipLocal /> : null}
        </span>
        <span className="oc-meta">
          {o.gratis ? <span className="oc-tag" data-tag="gratis">{t("selector.gratis")}</span> : null}
          {o.go ? <span className="oc-tag" data-tag="go">{t("selector.planGo")}</span> : null}
          {cupos?.get(o.id)?.sin ? (
            <span className="oc-tag" data-tag="agotado">
              <Ban size={11} strokeWidth={2.2} aria-hidden="true" /> {textoSinCupo(cupos.get(o.id)!)}
            </span>
          ) : null}
          {cupos?.get(o.id)?.poco ? (
            <span className="oc-tag" data-tag="poco" title={textoPocoCupo(cupos.get(o.id)!)}>
              <span className="oc-punto" aria-hidden="true" /> {t("selector.pocoCupo")}
            </span>
          ) : null}
          {o.pago ? <span className="oc-tag" data-tag="pago">{t("selector.pago")}</span> : null}
          {o.rec ? <span className="rec">{t("selector.default")}</span> : null}
        </span>
        <Check className="ok" size={14} strokeWidth={2.2} />
        <span className="md">{o.desc}</span>
      </button>
    );
  };

  // La fila del esfuerzo al pie del menú del modelo: un nivel por botón, el elegido con tilde y en negrita (no sólo con el color).
  const filaEsfuerzo = esfuerzo ? (
    <div className="mc-esf" role="radiogroup" aria-label={esfuerzo.etiqueta}>
      <span className="mh mc-esf-t" aria-hidden="true">
        {esfuerzo.etiqueta}
      </span>
      {esfuerzo.opciones.map((o) => {
        const elegida = o.id === esfuerzo.valor;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            className="mc-esf-op"
            tabIndex={-1}
            aria-checked={elegida}
            title={o.desc}
            onClick={() => {
              esfuerzo.alElegir(o.id);
              cerrar();
            }}
          >
            {o.marca}
            <span className="mc-esf-n">{o.nombre}</span>
            {elegida ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  ) : null;

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
        aria-label={`${etiqueta}: ${actual.nombre}${cupoActual?.sin ? `, ${textoSinCupo(cupoActual)}` : ""}${pendiente || pendienteCompacto ? `, ${t("selector.pendienteEtiqueta")}` : ""}`}
        data-tip={[cupoActual?.sin ? textoSinCupo(cupoActual) : null, pendiente ?? pendienteCompacto].filter(Boolean).join(" · ") || undefined}
        data-agotada={cupoActual?.sin ? "" : undefined}
        data-pendiente={pendiente ? "" : undefined}
        onClick={() => setAbierto((a) => !a)}
        onKeyDown={teclaBoton}
      >
        {chip ?? actual.marca}
        {reserva ? (
          <Reserva texto={nombreDe(actual)} reserva={[...opciones.filter((o) => o !== actual).map(nombreDe), ...reserva]} />
        ) : (
          nombreDe(actual)
        )}
        {cupoActual?.sin ? <Ban className="pbtn-cupo" size={12} strokeWidth={2.2} aria-hidden="true" /> : null}
        {sufijo ? (
          <span className="pbtn-suf" aria-hidden="true">
            · {sufijo}
          </span>
        ) : null}
        {pendiente || pendienteCompacto ? (
          <span className="pbtn-pend" data-compacto={pendiente ? undefined : ""} aria-hidden="true">
            <Clock size={11} strokeWidth={2.2} />
            <span className="pbtn-pend-t">{t("selector.proximo")}</span>
          </span>
        ) : null}
        <ChevronUp className="chev" size={12} strokeWidth={2} />
      </button>
      {pend ? (
        <DialogoCambio
          datos={pend.datos}
          alSi={() => {
            const id = pend.id;
            setPend(null);
            alElegirOpcion(id);
          }}
          alNo={() => {
            setPend(null);
            cerrar();
          }}
        />
      ) : null}
      {abierto
        ? createPortal(
            <>
              <button type="button" className="fondo" tabIndex={-1} aria-label={t("comun.cerrarMenu")} onClick={() => cerrar(false)} />
              <div
                ref={menu}
                id={enColumnas || buscable ? undefined : id}
                className="menu"
                data-columnas={enColumnas ? reparto.columnas.length : undefined}
                data-enteras={enteras ? "" : undefined}
                data-buscar={buscable ? "" : undefined}
                role={enColumnas || buscable ? undefined : "listbox"}
                aria-label={enColumnas || buscable ? undefined : etiqueta}
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
                    <div className="mc-cuerpo">
                      <div className="mc-riel" role="tablist" aria-orientation="vertical" aria-label={etiqueta}>
                        {riel.map((c) => (
                          <button
                            key={c.clave}
                            type="button"
                            role="tab"
                            className="mc-tab"
                            tabIndex={-1}
                            data-clave={c.clave}
                            aria-selected={!buscando && c.clave === tabActiva}
                            data-vacia={buscando && cuenta(c.clave) === 0 ? "" : undefined}
                            data-agotada={cuposColumnas?.get(c.clave)?.sin ? "" : undefined}
                            onClick={() => hojear(c.clave)}
                          >
                            {c.ops[0]?.colMarca ?? c.ops[0]?.marca}
                            <span className="mc-tn">{c.nombre}</span>
                            <span className="mc-cnt">{buscando ? cuenta(c.clave) : c.ops.length}</span>
                            {marcaCupo(cuposColumnas?.get(c.clave))}
                          </button>
                        ))}
                      </div>
                      <div id={id} className="mc-lista" role="listbox" aria-label={etiqueta}>
                        {!buscando && reparto.arriba.length ? <div className="mc-arriba">{reparto.arriba.map((o) => opcionCompacta(o, ""))}</div> : null}
                        {reparto.columnas
                          .filter((c) => buscando || c.clave === tabActiva)
                          .map((c) => (
                            <div key={c.clave} className="mc-col" role="group" aria-label={c.nombre} data-grupo-clave={c.clave}>
                              {buscando ? (
                                <div className="mc-tit">
                                  {c.ops[0]?.colMarca ?? c.ops[0]?.marca}
                                  <span>{c.nombre}</span>
                                </div>
                              ) : null}
                              {c.ops.map((o, i) => (
                                <Fragment key={o.id}>
                                  {o.grupo && o.grupo !== c.nombre && o.grupo !== c.ops[i - 1]?.grupo ? <div className="mc-sub">{o.grupo}</div> : null}
                                  {opcionCompacta(o, c.nombre)}
                                </Fragment>
                              ))}
                            </div>
                          ))}
                        {!visibles.length ? <div className="mc-nada">{t("selector.nada")}</div> : null}
                      </div>
                    </div>
                    {pie ? <div className="mc-pie">{pie(tabActiva)}</div> : null}
                    {filaEsfuerzo}
                  </>
                ) : buscable ? (
                  <>
                    <div className="mc-cab">
                      <span className="mh" aria-hidden="true">
                        {etiqueta}
                      </span>
                      <label className="mc-busca">
                        <Search size={13} strokeWidth={2} aria-hidden="true" />
                        <input
                          ref={buscador}
                          type="search"
                          role="combobox"
                          aria-expanded="true"
                          aria-controls={id}
                          aria-autocomplete="list"
                          aria-activedescendant={lista.length ? idOpcion(res) : undefined}
                          value={busqueda}
                          placeholder={buscar}
                          aria-label={buscar}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(e) => {
                            setBusqueda(e.target.value);
                            setResaltada(0);
                          }}
                        />
                      </label>
                    </div>
                    <div id={id} className="mc-lista-f" role="listbox" aria-label={etiqueta}>
                      {buscando && !lista.some((o) => !o.fija) ? <div className="mc-nada">{t("selector.sinCoincidencias")}</div> : null}
                      {lista.map((o, i) => opcion(o, i))}
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
                    {filaEsfuerzo}
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
