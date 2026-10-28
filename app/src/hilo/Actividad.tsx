// La tarjeta de actividad del chat (dirección C, referencias/maquetas/actividad): mientras un líder de la app responde, una
// escena de 2.75rem que actúa lo que hace, el estado (punto de color + verbo), qué modelo y esfuerzo corre, lo concreto, el tiempo,
// los tokens y los pasos de atrás con su icono (los últimos tres; el resto, tras "+N pasos"), y Parar.
// Qué evento da cada tipo y cómo se limpia el detalle: src/hilo/actividad-logica.ts. El movimiento: src/barra/latido-escenas.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bot, Brain, Check, ChevronDown, ChevronRight, FilePlus, FileText, Globe, Hand, MessageSquare, Pencil, Search, Terminal, Wrench, X, type LucideIcon } from "lucide-react";
import { latir } from "../barra/latido";
import { Reloj } from "../barra/piezas";
import { Chip } from "../ui/componentes";
import { t, type Clave } from "../i18n";
import { pintorDura } from "../tiempo";
import { alScroll, bajar, seguidor, seguir } from "./seguir";
import { estadoDe, iconoDe, muyLargo, PASOS, primeraLineaPensada, textoPaso, ultimaFrasePensada, type Actividad as Act, type Icono, type Paso } from "./actividad-logica";
import type { LineaTiempo } from "./linea-tiempo";
import { Escena } from "./Escenas";
import { Tierno } from "./Tierno";

/** Una clave de `actividad-logica.ts` (viaja como texto) ya traducida. */
const tx = (clave: string, vars?: Record<string, string | number>) => (t as (k: Clave, v?: Record<string, string | number>) => string)(clave as Clave, vars);

const ICONO: Record<Icono, LucideIcon> = {
  pensar: Brain,
  leer: FileText,
  buscar: Search,
  editar: Pencil,
  escribir: FilePlus,
  correr: Terminal,
  web: Globe,
  delegar: Bot,
  texto: MessageSquare,
  permiso: Hand,
  otro: Wrench,
};

/** Lo concreto: una frase fija (con su variable, si la lleva, y con mayúscula) o el comando / archivo / patrón tal cual. */
export const textoDetalle = (a: Act) => {
  if (!a.detalleClave) return a.detalle;
  const x = tx(a.detalleClave, { d: a.detalle });
  return x.charAt(0).toUpperCase() + x.slice(1);
};

/** Un paso ya pasado en palabras, o `null` si no vale la pena mostrarlo. */
export function lineaPaso(p: Paso): string | null {
  const x = textoPaso(p);
  return x ? tx(x.clave, { d: x.d, s: x.s ?? 0 }) : null;
}

/** Un texto entero: lo muy largo se pliega (con fundido abajo) y "Ver todo" lo despliega. Nunca se corta con "…". */
function Entero({ texto, className }: { texto: string; className: string }) {
  const [abierto, setAbierto] = useState(false);
  const pliega = muyLargo(texto);
  return (
    <div className="tv-ent">
      <span className={pliega && !abierto ? `${className} tv-pliega` : className}>{texto}</span>
      {pliega ? (
        <button type="button" className="tv-mas" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
          {abierto ? t("hz.menos") : t("hz.todo")}
          <ChevronDown className="tv-fl" size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Un pensamiento: una línea compacta y gris ("Pensó: " y su primera línea, con "…" si no entra) que es un botón; un clic lo despliega
 * entero y otro lo pliega. Nada se pierde al llegar el siguiente: cada uno es su propia línea. El que todavía llega (`vivo`) dice
 * "Pensando…" y, plegado, muestra la última frase que escribió en esa misma línea (no empuja la conversación); abierto, sigue lo último que
 * escribe hasta que se sube.
 */
export function Pensamiento({ texto, vivo = false, abierto: inicial = false }: { texto: string; vivo?: boolean; abierto?: boolean }) {
  const [manual, setManual] = useState<boolean | null>(inicial ? true : null);
  const abierto = manual ?? false;
  const caja = useRef<HTMLDivElement>(null);
  const seg = useRef(seguidor()).current;
  const abrio = useRef(false);
  useLayoutEffect(() => {
    const u = caja.current;
    if (!u) return void (abrio.current = false);
    if (!abrio.current) {
      abrio.current = true;
      if (vivo) bajar(u, seg);
      else seg.pegado = false;
    } else if (vivo) seguir(u, seg);
  });
  return (
    <div className="tv-pl" data-abierto={abierto ? "" : undefined} data-vivo={vivo ? "" : undefined}>
      <button type="button" className="tv-pb" aria-expanded={abierto} onClick={() => setManual(!abierto)}>
        <ChevronRight className="tv-pf" size={11} strokeWidth={2} aria-hidden="true" />
        <span className="tv-pq">{vivo ? t("turno.pensando") : `${t("turno.penso")}:`}</span>
        {abierto ? null : <span className="tv-pr">{vivo ? ultimaFrasePensada(texto) : primeraLineaPensada(texto)}</span>}
      </button>
      {abierto ? (
        <div className="tv-pe" ref={caja} onScroll={(e) => alScroll(e.currentTarget, seg)}>
          {texto}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Varios pensamientos de un mismo tramo en UNA fila plegada ("Pensó · 10"); abierta, cada uno es su `Pensamiento` de siempre. Con uno solo
 * no hace falta: se pinta él (`Pensados`).
 */
export function PensamientosGrupo({ items, abierto: inicial = false }: { items: string[]; abierto?: boolean }) {
  const [abierto, setAbierto] = useState(inicial);
  return (
    <div className="tv-pl tv-pg" data-abierto={abierto ? "" : undefined}>
      <button type="button" className="tv-pb" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>
        <ChevronRight className="tv-pf" size={11} strokeWidth={2} aria-hidden="true" />
        <span className="tv-pq">{t("turno.penso.n", { n: items.length })}</span>
      </button>
      {abierto ? (
        <div className="tv-pgl">
          {items.map((x, i) => (
            <Pensamiento key={i} texto={x} abierto={inicial} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Los pensamientos de un tramo: los terminados, plegados en un solo grupo si son más de uno (si es uno, como siempre) y, si el último
 * todavía llega (`vivo`), ése aparte, debajo, a la vista.
 */
export function Pensados({ items, vivo = false, abierto = false }: { items: string[]; vivo?: boolean; abierto?: boolean }) {
  const hechos = vivo ? items.slice(0, -1) : items;
  return (
    <>
      {hechos.length > 1 ? <PensamientosGrupo items={hechos} abierto={abierto} /> : hechos.map((x, i) => <Pensamiento key={i} texto={x} abierto={abierto} />)}
      {vivo && items.length ? <Pensamiento texto={items[items.length - 1]} vivo abierto={abierto} /> : null}
    </>
  );
}

/** El estado de una herramienta del progreso (corriendo / ok / error), con el mismo punto que en el trabajo del turno. */
const EstadoLinea = ({ estado }: { estado: Extract<LineaTiempo, { tipo: "herramienta" }>["estado"] }) =>
  estado ? (
    <span className="ll-e" data-e={estado}>
      {t(`llamada.${estado}`)}
    </span>
  ) : null;

/**
 * El progreso del turno de un motor que deja ver su razonamiento: lo que fue pasando, en orden (los pensamientos terminados, plegados,
 * y las herramientas con su ícono, su nombre y su archivo o comando) y, abajo, el pensamiento que todavía llega escribiéndose. Una
 * ventana que sigue lo último que llegó hasta que se sube. No tapa la respuesta: vive dentro de la tarjeta.
 */
function Progreso({ lineas, pensando }: { lineas: LineaTiempo[]; pensando: string }) {
  const caja = useRef<HTMLUListElement>(null);
  const seg = useRef(seguidor()).current;
  const abrio = useRef(false);
  useLayoutEffect(() => {
    const u = caja.current;
    if (!u) return void (abrio.current = false);
    if (!abrio.current) {
      abrio.current = true;
      bajar(u, seg);
    } else seguir(u, seg);
  });
  const vivo = pensando.trim();
  if (!lineas.length && !vivo) return null;
  // Los pensamientos terminados, si son varios, en un solo grupo arriba: nunca N filas sueltas entre las herramientas.
  const pensados = lineas.flatMap((x) => (x.tipo === "pensamiento" ? [x.texto] : []));
  const agrupa = pensados.length > 1;
  return (
    // Dentro de un `role=status`: ni el texto que llega ni cada línea se anuncian de a pedazos.
    <ul className="tv-lt" ref={caja} aria-label={t("hz.progreso")} aria-live="off" onScroll={(e) => alScroll(e.currentTarget, seg)}>
      {agrupa ? (
        <li key="grupo" className="tv-li" data-k="pensamiento">
          <PensamientosGrupo items={pensados} />
        </li>
      ) : null}
      {lineas.map((x) => {
        if (x.tipo === "pensamiento")
          return agrupa ? null : (
            <li key={x.key} className="tv-li" data-k="pensamiento">
              <Pensamiento texto={x.texto} />
            </li>
          );
        const I = ICONO[x.icono];
        return (
          <li key={x.key} className="tv-li" data-k="herramienta">
            <I className="tv-ic" size={12} strokeWidth={1.9} aria-hidden="true" />
            <span className="tv-ln">{x.nombre}</span>
            <Entero texto={x.detalle} className="tv-pt" />
            <EstadoLinea estado={x.estado} />
          </li>
        );
      })}
      {vivo ? (
        <li key="vivo" className="tv-li" data-k="vivo">
          <Pensamiento texto={vivo} vivo />
        </li>
      ) : null}
    </ul>
  );
}

type Props = {
  act: Act;
  pasos: Paso[];
  /** Cuántos pasos lleva el turno (`pasos` guarda los últimos). */
  pasosN?: number;
  /** Desde cuándo responde el líder (s), o `null`. */
  desde: number | null;
  /** Los tokens de salida del turno, ya escritos ("1,2k"), o `null`. */
  tokens: string | null;
  /** Con los mensajes tiernos prendidos, la frase de siempre en vez del verbo genérico (pensando / escribiendo). */
  tierno?: string;
  /**
   * Un motor que deja ver su razonamiento: lo que lleva el turno (puede estar vacío), en orden: los pensamientos terminados y las
   * herramientas (`lineaDeTiempo`) y el pensamiento que todavía llega. `undefined`: no lo deja ver, y se muestran los pasos de siempre.
   */
  razon?: { lineas: LineaTiempo[]; pensando: string };
  /** Qué modelo y esfuerzo corre ("Sonnet 5.5", "high"), cuando se saben. */
  modelo?: string | null;
  effort?: string | null;
  /** Parar el turno (la misma acción que el botón de la caja). */
  alParar?: () => void;
  parando?: boolean;
  /** El turno ya terminó (`listo`) o falló (`error`): sin escena que se mueva ni Parar. */
  fin?: "listo" | "error";
};

export function Actividad({ act, pasos, pasosN, desde, tokens, tierno, razon, modelo, effort, alParar, parando, fin }: Props) {
  // La tarjeta existe sólo mientras hay actividad: el latido de las escenas corre mientras está montada.
  useEffect(() => (fin ? undefined : latir()), [fin]);
  const [todos, setTodos] = useState(false);
  const dura = useMemo(() => (desde !== null ? pintorDura(desde) : null), [desde]);
  const detalle = textoDetalle(act);
  const conRazon = !!razon && !fin;
  const lineas = pasos.map((p) => ({ l: lineaPaso(p), i: iconoDe(p.hace) })).filter((x): x is { l: string; i: Icono } => x.l !== null);
  // Con el progreso a la vista (pensamientos y herramientas en orden) los pasos de atrás sobran: serían lo mismo dos veces.
  const vis = conRazon ? [] : todos ? lineas : lineas.slice(0, PASOS);
  const ocultos = conRazon ? 0 : lineas.length - PASOS;
  const estado = fin ?? estadoDe(act);
  const verbo = fin ? t(fin === "listo" ? "hz.t.listo" : "hz.t.error") : tx(act.verbo);
  // El chip de arriba: trabajando, esperando (al modelo o a una respuesta de la persona) o terminado.
  const chip = fin ? (fin === "listo" ? { tono: "ok" as const, texto: t("hz.t.listo") } : { tono: "critico" as const, texto: t("hz.t.error") }) : estado === "permiso" || estado === "espera" ? { tono: "aviso" as const, texto: t("hz.c.esperando") } : { tono: undefined, texto: t("estado.trabajando") };
  const Det = ICONO[act.icono];
  return (
    // El `key` hace que el cambio de tipo entre con su fundido (`tv-entra`); dentro de un tipo sólo cambia el texto.
    <div className="tv" key={fin ?? act.tipo} data-t={fin ? "fin" : act.tipo} data-e={estado} role="status">
      <div className="tv-tar">
        {fin ? (
          <span className="esc tv-fin" aria-hidden="true">
            {fin === "listo" ? <Check size={22} strokeWidth={2} /> : <X size={22} strokeWidth={2} />}
          </span>
        ) : (
          <Escena tipo={act.tipo} />
        )}
        <div className="tv-cu">
          <div className="tv-t1">
            <Chip tono={chip.tono}>{chip.texto}</Chip>
            {tierno && !fin ? <Tierno semilla={tierno} className="tv-v" limpia /> : <span className="tv-v">{verbo}</span>}
            {modelo ? (
              <span className="tv-modelo" aria-label={t("hz.modelo")}>
                {modelo}
                {effort ? <span className="tv-ef">{effort}</span> : null}
              </span>
            ) : null}
            <span className="tv-meta">
              {dura ? <Reloj pintor={dura} className="tv-x" /> : null}
              {tokens ? <span className="tv-x">{tokens}</span> : null}
              {pasosN ? <span className="tv-x">{t("hz.pasos", { n: pasosN })}</span> : null}
            </span>
          </div>
          {detalle && !fin && !(conRazon && estado !== "permiso") ? (
            <div className="tv-det" data-fija={act.detalleClave ? "" : undefined}>
              {act.detalleClave ? null : <Det className="tv-ic" size={13} strokeWidth={1.9} aria-hidden="true" />}
              <Entero texto={detalle} className="tv-dt" />
              <span className="tv-vivo">{t("hz.enCurso")}</span>
            </div>
          ) : null}
          {conRazon ? <Progreso lineas={razon.lineas} pensando={razon.pensando} /> : null}
          {vis.length ? (
            <ul className="tv-pasos">
              {vis.map((p, i) => {
                const I = ICONO[p.i];
                return (
                  <li key={i}>
                    <I className="tv-ic" size={12} strokeWidth={1.9} aria-hidden="true" />
                    <Entero texto={p.l} className="tv-pt" />
                  </li>
                );
              })}
            </ul>
          ) : null}
          {ocultos > 0 || alParar ? (
            <div className="tv-pie">
              {ocultos > 0 ? (
                <button type="button" className="tv-mas" aria-expanded={todos} onClick={() => setTodos((x) => !x)}>
                  {todos ? t("hz.menos") : t("hz.mas", { n: ocultos })}
                  <ChevronDown className="tv-fl" size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
              {alParar && !fin ? (
                <button type="button" className="btn2 tv-parar" disabled={parando} onClick={alParar}>
                  {parando ? t("accion.parando") : t("accion.parar")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
