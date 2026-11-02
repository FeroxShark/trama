// La tarjeta de un líder de la app mientras responde (propuesta Frase, maquetas/rediseno-0.4/status-trabajando-b-*.png): la frase de lo que
// hace, la salida en una línea, "Ver todo" con el comando entero, los pasos y el progreso, y el pie con modelo y esfuerzo.
// Qué evento da cada tipo y qué dice cada línea: src/hilo/actividad-logica.ts. El movimiento: src/barra/latido-escenas.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Brain, ChevronDown, ChevronRight, FilePlus, FileText, Globe, Hand, MessageSquare, Pause, Pencil, Search, Terminal, Wrench, X, type LucideIcon } from "lucide-react";
import type { HaceLider } from "../datos/contrato";
import { latir } from "../barra/latido";
import { Reloj } from "../barra/piezas";
import { t } from "../i18n";
import { duracionFina, pintorDura } from "../tiempo";
import { alScroll, bajar, seguidor, seguir } from "./seguir";
import { cuentaMas, cuentaPasos, estadoDe, fraseDe, iconoDe, lineaPaso, muyLargo, PASOS, primeraLineaPensada, textoDetalle, ultimaFrasePensada, type Actividad as Act, type Icono, type Paso, type Salida } from "./actividad-logica";
import type { LineaTiempo } from "./linea-tiempo";
import { Escena } from "./Escenas";
import { Tierno } from "./Tierno";
import { EnlaceArchivo } from "./VerArchivo";
import "./tarjeta-frase.css";

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
            {x.archivo ? <EnlaceArchivo a={x.archivo} /> : null}
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
  /** Lo que hace (o lo último que hizo, si el turno falló): de acá sale el título. */
  hace: HaceLider | null;
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
  /** La última línea de lo que devolvió el comando. */
  salida?: Salida | null;
  /** El comando entero, con sus renglones ("Ver todo"). */
  crudo?: string | null;
  /** Hace 2 min que no llega nada: desde cuándo (ms). */
  quieto?: number | null;
  /** "Ver todo" abierto (lo guarda quien la monta: sigue abierto en el próximo turno). */
  abierto: boolean;
  alAbrir: (abierto: boolean) => void;
  /** El turno terminó mal: cuánto duró y el error, a la vista. */
  fallo?: { dura: number | null; error: ReactNode };
  /** Se está yendo: el turno terminó bien y la tarjeta se pliega. */
  saliendo?: boolean;
};

const estadoVisible = (quieto: boolean, fallo: boolean) => (fallo ? "fallo" : quieto ? "quieto" : "corre");

/**
 * La tarjeta de un líder trabajando (propuesta Frase): una cápsula baja hermana de la caja, con un círculo por tipo de herramienta y la frase de lo
 * que hace; abajo, la salida (o el comando) en una línea que se funde, "Ver todo" y el modelo. Un solo estado: el punto que late y el tiempo.
 * Parar queda sólo en la caja: siempre a la vista, aunque se suba por la conversación.
 */
export function Actividad({ act, hace, pasos, pasosN, desde, tokens, tierno, razon, modelo, effort, salida, crudo, quieto = null, abierto, alAbrir, fallo, saliendo }: Props) {
  // El latido (el punto y la escena) corre mientras la tarjeta está viva.
  const viva = !fallo && !saliendo;
  useEffect(() => (viva ? latir() : undefined), [viva]);
  const [todos, setTodos] = useState(false);
  const dura = useMemo(() => (desde !== null ? pintorDura(desde) : null), [desde]);
  const sinNovedad = useMemo(() => (quieto !== null ? pintorDura(quieto / 1000, () => `${t("hz.quieto")} `) : null), [quieto]);
  const conRazon = !!razon && !fallo;
  const frase = fraseDe({ act, hace, pasos, salida, pensando: razon?.pensando, fallo: !!fallo });
  const lineas = pasos.map((p) => ({ l: lineaPaso(p), i: iconoDe(p.hace) })).filter((x): x is { l: string; i: Icono } => x.l !== null);
  // Con el progreso a la vista (pensamientos y herramientas en orden) los pasos de atrás sobran: serían lo mismo dos veces.
  const vis = conRazon ? [] : todos ? lineas : lineas.slice(0, PASOS);
  const ocultos = conRazon ? 0 : lineas.length - PASOS;
  const estado = estadoDe(act);
  // Lo entero de lo que abajo se ve en una línea: el comando con sus renglones, la pregunta o el permiso.
  const entero = act.tipo === "permiso" ? textoDetalle(act) : hace?.que === "herramienta" ? (crudo ?? (act.detalle !== hace.nombre ? act.detalle : "")) : "";
  const hayProgreso = conRazon && (razon.lineas.length > 0 || !!razon.pensando.trim());
  const hayCuerpo = !!entero || lineas.length > 0 || hayProgreso;
  const cuenta = [tokens, pasosN ? cuentaPasos(pasosN) : null].filter(Boolean).join(" · ");
  const Det = ICONO[act.icono];
  return (
    <div className="tv" data-t={act.tipo} data-e={estado} data-estado={estadoVisible(quieto !== null, !!fallo)} data-abierto={abierto ? "" : undefined} data-error={fallo ? "" : undefined} data-saliendo={saliendo ? "" : undefined} role="status">
      <div className="tv-tar">
        <span className="tv-tile" aria-hidden="true">
          {fallo ? <X size={20} strokeWidth={2} /> : quieto !== null ? <Pause size={20} strokeWidth={2} /> : <Escena key={act.tipo} tipo={act.tipo} />}
        </span>
        <div className="tv-cu">
          <div className="tv-1">
            <span className="tv-frase">
              {frase.antes.length ? (
                <span className="tv-ant">
                  <span>{frase.antes.join("  ›  ")}  ›</span>
                </span>
              ) : null}
              {/* La clave cambia con el paso: la frase nueva entra y la de antes ya quedó en la miga. */}
              {tierno ? <Tierno semilla={tierno} className="tv-v" limpia /> : <span className="tv-v" key={frase.titulo} data-tip={frase.titulo}>{frase.titulo}</span>}
            </span>
            {fallo ? (
              <span className="tv-est">
                <X size={14} strokeWidth={2.4} aria-hidden="true" />
                {t("hz.t.error")}
                {fallo.dura !== null ? ` · ${duracionFina(fallo.dura)}` : ""}
              </span>
            ) : sinNovedad ? (
              <span className="tv-est">
                <i className="tv-punto" />
                <Reloj pintor={sinNovedad} className="tv-x" />
              </span>
            ) : dura ? (
              <span className="tv-est" aria-label={t("estado.trabajando")}>
                <i className={saliendo ? "tv-punto" : "tv-punto late"} />
                <Reloj pintor={dura} className="tv-x" />
              </span>
            ) : null}
          </div>
          <div className="tv-2">
            {frase.verbo ? <span className="tv-verbo" data-error={salida?.error ? "" : undefined}>{frase.verbo}</span> : null}
            {/* `aria-live` apagado: la salida cambia sola y no se anuncia de a pedazos. */}
            <span className="tv-out" key={frase.linea} data-mono={frase.mono ? "" : undefined} aria-live="off">
              {frase.linea}
            </span>
            {hayCuerpo ? (
              <button type="button" className="tv-ver" aria-expanded={abierto} onClick={() => alAbrir(!abierto)}>
                {abierto ? t("hz.menos") : t("hz.todo")}
                <ChevronDown className="tv-fl" size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
            {modelo ? (
              <span className="tv-modelo" aria-label={[t("hz.modelo"), modelo, effort, cuenta].filter(Boolean).join(" · ")} data-tip={cuenta || undefined} tabIndex={cuenta ? 0 : undefined}>
                {modelo}
                {effort ? <span className="tv-ef">{effort}</span> : null}
              </span>
            ) : null}
          </div>
          {fallo ? <div className="tv-err">{fallo.error}</div> : null}
          {hayCuerpo ? (
            // Siempre armado, para plegarse con su transición; cerrado no se llega con el teclado.
            <div className="tv-plieg">
              <div className="tv-cuerpo" inert={!abierto}>
                {entero ? (
                  <div className="tv-det" data-fija={act.tipo === "permiso" ? "" : undefined}>
                    {act.tipo === "permiso" ? null : <Det className="tv-ic" size={13} strokeWidth={1.9} aria-hidden="true" />}
                    <span className="tv-dt">{entero}</span>
                  </div>
                ) : null}
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
                {ocultos > 0 ? (
                  <button type="button" className="tv-mas" aria-expanded={todos} onClick={() => setTodos((x) => !x)}>
                    {todos ? t("hz.menos") : cuentaMas(ocultos)}
                    <ChevronDown className="tv-fl" size={12} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
                {conRazon ? <Progreso lineas={razon.lineas} pensando={razon.pensando} /> : null}
                {/* Lo mismo que el tooltip del modelo, para quien no tiene mouse (el celular). */}
                {cuenta ? <span className="tv-cuenta">{cuenta}</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
