// La tarjeta de un líder de la app mientras responde (dirección C · Anillo): un círculo con el ícono de lo que hace y un arco que gira como
// señal de vida; dos renglones (qué pasa, con un solo verbo, y el detalle); a la derecha el tiempo y el modelo, y «Ver todo» con el comando
// entero, los pasos y el progreso. Qué dice cada renglón: `vistaDe` en src/hilo/actividad-logica.ts. El arco lo mueve src/barra/latido.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Brain, ChevronDown, ChevronRight, Hand, MessageSquare, Pause, X, type LucideIcon } from "lucide-react";
import type { HaceLider } from "../datos/contrato";
import { latir } from "../barra/latido";
import { Reloj } from "../barra/piezas";
import { t } from "../i18n";
import { duracionFina, pintorDura } from "../tiempo";
import { alScroll, bajar, seguidor, seguir } from "./seguir";
import { cuentaMas, cuentaPasos, estadoDe, iconoDe, lineaPaso, muyLargo, PASOS, primeraLineaPensada, textoDetalle, ultimaFrasePensada, vistaDe, type Actividad as Act, type EstadoParalela, type Icono, type Paralela, type Paso, type Salida } from "./actividad-logica";
import type { LineaTiempo } from "./linea-tiempo";
import { Tierno } from "./Tierno";
import { EnlaceArchivo } from "./VerArchivo";
import { familiaDe } from "../barra/marca-familia";
import { claseAccion, TIPO_DE_CLAVE } from "./accion-tipo";
import { IconoClave } from "./IconoAccion";

/** Los dibujos que no son una herramienta; los de las herramientas salen del mapa único (./accion-tipo.ts) con su color suave. */
const PROPIOS: Record<string, LucideIcon> = { pensar: Brain, texto: MessageSquare, permiso: Hand };

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
        return (
          <li key={x.key} className="tv-li" data-k="herramienta">
            <IconoClave clave={x.icono} propios={PROPIOS} className="tv-ic" />
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
  /** Las herramientas que el último mensaje lanzó juntas y cómo va cada una (`paralelasDe`): con dos o más sin terminar, la tarjeta las cuenta. */
  paralelas?: Paralela[];
  /** Qué modelo y esfuerzo corre ("Sonnet 5.5", "high"), cuando se saben. */
  modelo?: string | null;
  effort?: string | null;
  /** La última línea de lo que devolvió el comando. */
  salida?: Salida | null;
  /** El comando entero, con sus renglones ("Ver todo"). */
  crudo?: string | null;
  /** Hace 2 min que no llega nada: desde cuándo (ms). */
  quieto?: number | null;
  /** Una herramienta andando sin soltar nada desde hace tanto (ms): no es un cuelgue, la tarjeta sigue como trabajando y lo dice en neutro. */
  callado?: number | null;
  /** "Ver todo" abierto (lo guarda quien la monta: sigue abierto en el próximo turno). */
  abierto: boolean;
  alAbrir: (abierto: boolean) => void;
  /** El turno terminó mal: cuánto duró y el error, a la vista. */
  fallo?: { dura: number | null; error: ReactNode };
  /** Se está yendo: el turno terminó bien y la tarjeta se pliega. */
  saliendo?: boolean;
};

const estadoVisible = (quieto: boolean, fallo: boolean) => (fallo ? "fallo" : quieto ? "quieto" : "corre");

const ESTADO_PARALELA = { corriendo: "hz.c.e.corriendo", espera: "hz.c.e.espera", listo: "hz.c.e.listo", error: "hz.c.e.error" } as const satisfies Record<EstadoParalela, string>;

/** Cómo se llama una herramienta en su ficha: un subagente, por su nombre en palabras. */
const nombreFicha = (x: Paralela) => (x.icono === "delegar" && (x.nombre === "Task" || x.nombre === "Agent") ? t("hz.c.subagente") : x.nombre);

/** El color del anillo y de su arco: el de la clase del ícono (los de las herramientas, los mismos que en el chat) o el del estado. */
function claseAnillo(act: Act, o: { fallo: boolean; quieto: boolean; paralelo: boolean }): string {
  if (o.fallo) return "fallo";
  if (o.quieto) return "quieto";
  if (act.tipo === "permiso") return "permiso";
  if (o.paralelo) return "paralelo";
  if (act.icono === "pensar" || act.icono === "texto") return act.icono;
  return claseAccion(TIPO_DE_CLAVE[act.icono] ?? "otra");
}

/**
 * La tarjeta de un líder trabajando (dirección C · Anillo): una cápsula baja hermana de la caja. A la izquierda el círculo con el ícono de la
 * herramienta (o el número, con varias a la vez) y un arco que gira mientras está vivo (quieto, pidiendo permiso o fallado, no gira); en el medio
 * dos renglones; a la derecha el tiempo, el modelo y «Ver todo». Parar queda sólo en la caja: siempre a la vista, aunque se suba por la conversación.
 */
export function Actividad({ act, hace, pasos, pasosN, desde, tokens, tierno, razon, paralelas = [], modelo, effort, salida, crudo, quieto = null, callado = null, abierto, alAbrir, fallo, saliendo }: Props) {
  // El latido (el arco y la escena) corre mientras la tarjeta está viva.
  const viva = !fallo && !saliendo;
  useEffect(() => (viva ? latir() : undefined), [viva]);
  const [todos, setTodos] = useState(false);
  const dura = useMemo(() => (desde !== null ? pintorDura(desde) : null), [desde]);
  const sinNovedad = useMemo(() => (quieto !== null ? pintorDura(quieto / 1000, () => `${t("hz.quieto")} `) : null), [quieto]);
  const sinSalida = useMemo(() => (callado !== null ? pintorDura(callado / 1000, () => `${t("hz.callado")} `) : null), [callado]);
  const conRazon = !!razon && !fallo;
  const vista = vistaDe({ act, hace, pasos, salida, pensando: razon?.pensando, fallo: !!fallo, paralelas });
  const enParalelo = vista.n !== null;
  const lineas = pasos.map((p) => ({ l: lineaPaso(p), i: iconoDe(p.hace) })).filter((x): x is { l: string; i: Icono } => x.l !== null);
  // Con el progreso a la vista (pensamientos y herramientas en orden) los pasos de atrás sobran: serían lo mismo dos veces.
  const vis = conRazon ? [] : todos ? lineas : lineas.slice(0, PASOS);
  const ocultos = conRazon ? 0 : lineas.length - PASOS;
  const estado = estadoDe(act);
  // Lo entero de lo que arriba se ve en una línea: el comando con sus renglones, la pregunta o el permiso. Con varias a la vez no es de ninguna.
  const entero = enParalelo ? "" : act.tipo === "permiso" ? textoDetalle(act) : hace?.que === "herramienta" ? (crudo ?? (act.detalle !== hace.nombre ? act.detalle : "")) : "";
  const descripcion = !enParalelo && act.tipo !== "permiso" && hace?.que === "herramienta" ? (hace.desc ?? "") : "";
  const devuelto = !enParalelo && hace?.que === "herramienta" ? (salida?.linea ?? "") : "";
  const hayProgreso = conRazon && (razon.lineas.length > 0 || !!razon.pensando.trim());
  const hayCuerpo = !!entero || !!descripcion || !!devuelto || enParalelo || lineas.length > 0 || hayProgreso;
  const cuenta = [tokens, pasosN ? cuentaPasos(pasosN) : null].filter(Boolean).join(" · ");
  const clase = claseAnillo(act, { fallo: !!fallo, quieto: quieto !== null, paralelo: enParalelo });
  // El arco sólo gira con vida: quieto, esperando al usuario, fallado o yéndose, queda fijo.
  const gira = viva && clase !== "quieto" && clase !== "permiso";
  const detalle = vista.detalle;
  // Abierta, el comando (o el permiso) ya se lee entero abajo: no va dos veces.
  const detalleArriba = !(abierto && entero && (detalle.tipo === "mono" || act.tipo === "permiso"));
  return (
    <div className="tv" data-t={act.tipo} data-e={estado} data-estado={estadoVisible(quieto !== null, !!fallo)} data-abierto={abierto ? "" : undefined} data-error={fallo ? "" : undefined} data-saliendo={saliendo ? "" : undefined} role="status">
      <div className="tv-tar">
        <span className="tv-an" data-clase={clase} aria-hidden="true">
          <i className={gira ? "tv-arco gira-arco" : "tv-arco"} />
          {fallo ? <X size={16} strokeWidth={2.2} /> : quieto !== null ? <Pause size={16} strokeWidth={2} /> : vista.n !== null ? <span className="tv-n">{vista.n}</span> : <IconoClave key={act.icono} clave={act.icono} propios={PROPIOS} className="tv-ic" size={18} />}
        </span>
        <div className="tv-cu">
          <div className="tv-1">
            {/* La clave cambia con el paso: la frase nueva entra. */}
            {tierno ? <Tierno semilla={tierno} className="tv-v" limpia /> : <span className="tv-v" key={vista.verbo} data-tip={vista.verbo}>{vista.verbo}</span>}
            {vista.sub ? <span className="tv-sub">{vista.sub}</span> : null}
          </div>
          {/* `aria-live` apagado: lo que cambia solo no se anuncia de a pedazos. */}
          <div className="tv-2" aria-live="off">
            {!detalleArriba ? null : detalle.tipo === "chips" ? (
              <ul className="tv-chips" aria-label={t("hz.c.paralelas")}>
                {detalle.items.map((x, i) => (
                  <li key={i} className="tv-chip" data-e={x.estado}>
                    <IconoClave clave={x.icono} propios={PROPIOS} className="tv-ic" size={12} />
                    <span>{`${nombreFicha(x)} · ${t(ESTADO_PARALELA[x.estado])}`}</span>
                  </li>
                ))}
              </ul>
            ) : detalle.tipo === "vacio" ? null : (
              <span className="tv-out" key={detalle.texto} data-mono={detalle.tipo === "mono" ? "" : undefined}>
                {detalle.texto}
              </span>
            )}
          </div>
        </div>
        <div className="tv-der">
          {fallo ? (
            <span className="tv-est">
              <X size={14} strokeWidth={2.4} aria-hidden="true" />
              {t("hz.t.error")}
              {fallo.dura !== null ? ` · ${duracionFina(fallo.dura)}` : ""}
            </span>
          ) : sinNovedad ? (
            <span className="tv-est">
              <Reloj pintor={sinNovedad} className="tv-x" />
            </span>
          ) : dura ? (
            <span className="tv-est" aria-label={t("estado.trabajando")}>
              <Reloj pintor={dura} className="tv-x" />
              {sinSalida ? (
                <>
                  <span aria-hidden="true">·</span>
                  <Reloj pintor={sinSalida} className="tv-x" />
                </>
              ) : null}
            </span>
          ) : null}
          {modelo ? (
            <span className="tv-modelo" aria-label={[t("hz.modelo"), modelo, effort, cuenta].filter(Boolean).join(" · ")} data-tip={cuenta || undefined} tabIndex={cuenta ? 0 : undefined}>
              <i className="tv-fam" data-familia={familiaDe(modelo)} aria-hidden="true" />
              {modelo}
              {effort ? <span className="tv-ef">{effort}</span> : null}
            </span>
          ) : null}
        </div>
        {hayCuerpo ? (
          <button type="button" className="tv-ver" aria-expanded={abierto} onClick={() => alAbrir(!abierto)}>
            {abierto ? t("hz.menos") : t("hz.todo")}
            <ChevronDown className="tv-fl" size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        {fallo ? <div className="tv-err">{fallo.error}</div> : null}
        {hayCuerpo ? (
          // Siempre armado, para plegarse con su transición; cerrado no se llega con el teclado.
          <div className="tv-plieg">
            <div className="tv-cuerpo" inert={!abierto}>
              {descripcion ? (
                <div className="tv-det" data-fija="">
                  <span className="tv-dt">{descripcion}</span>
                </div>
              ) : null}
              {entero ? (
                <div className="tv-det" data-fija={act.tipo === "permiso" ? "" : undefined}>
                  {act.tipo === "permiso" ? null : <IconoClave clave={act.icono} propios={PROPIOS} className="tv-ic" size={13} />}
                  <span className="tv-dt">{entero}</span>
                </div>
              ) : null}
              {devuelto ? (
                <div className="tv-det">
                  <span className="tv-dt">{t("hz.c.salida", { d: devuelto })}</span>
                </div>
              ) : null}
              {enParalelo && detalle.tipo === "chips" ? (
                <ul className="tv-pasos">
                  {detalle.items.map((x, i) => (
                    <li key={i}>
                      <IconoClave clave={x.icono} propios={PROPIOS} className="tv-ic" />
                      <span className="tv-pt">{[`${nombreFicha(x)} · ${t(ESTADO_PARALELA[x.estado])}`, x.detalle].filter(Boolean).join(" — ")}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {vis.length ? (
                <ul className="tv-pasos">
                  {vis.map((p, i) => {
                    return (
                      <li key={i}>
                        <IconoClave clave={p.i} propios={PROPIOS} className="tv-ic" />
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
  );
}
