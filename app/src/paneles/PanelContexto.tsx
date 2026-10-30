// El panel derecho de contexto: del líder que se está mirando y de sus workers, en qué se va la ventana de contexto y qué se puede apagar.
// Cada uno tiene una barra apilada (usado / ventana, partido por categoría, con palabra y número), un mapa de bloques con lo más pesado y la
// lista por categoría; tocar una categoría o un bloque abre sus ítems (tokens, cuántas veces se usó, "nunca usada" destacada) con su
// interruptor. Apagar vale para TODO Trama (`apagados:fijar`): se aplica a workers nuevos y al líder desde el próximo mensaje. La otra pestaña
// es el catálogo de skills (buscar, filtrar, ver tokens, prender y apagar). Los datos: src/datos/contexto.ts; la cuenta y el mapa: contexto-vista.ts.
// En el celular ocupa la pantalla y sólo se mira (apagar es de la PC).
import { createContext, Fragment, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleDashed, Lock, Minimize2, PanelRightClose, RefreshCw, Search, X, Zap } from "lucide-react";
import type { Hilo, Lider } from "../datos/contrato";
import type { Categoria, Desglose } from "../../electron/contexto-desglose";
import type { UsosCatalogo } from "../../electron/skills-catalogo";
import type { SkillCatalogo } from "../../electron/skills-catalogo";
import type { Catalogo, VistaApagados } from "../../electron/contexto-panel";
import type { VistaPrevia } from "../../electron/contexto-previa";
import { fuenteContexto, type Quien } from "../datos/contexto";
import { fuente } from "../datos/fuente";
import { tareaDe, tipoDe } from "../barra/piezas";
import { effortDe, MODELO_DEFAULT, MODELOS, modeloDe, nombreModelo } from "../hilo/opciones";
import { useCompactando } from "../hilo/compactando";
import { useAngosto } from "../angosto";
import { esVentana, mensaje } from "../puente";
import { MODO } from "../modo";
import { locale, t } from "../i18n";
import { useIdioma } from "../i18n/react";
import {
  bloques,
  categorias,
  CON_ITEMS,
  estaApagado,
  filtrarSkills,
  fraccionUsada,
  itemsDe,
  usadoNeto,
  pluginDeSkill,
  pluginsDe,
  porcentaje,
  treemap,
  usadas,
  type FiltroSkills,
  type FilaCat,
  type Item,
  type TipoApagado,
} from "./contexto-vista";
import "./contexto-panel.css";

const miles = (n: number) => n.toLocaleString(locale());
const nombreCat = (c: Categoria) => t(`ctxp.cat.${c}` as "ctxp.cat.mensajes");
/** El alto del mapa de bloques en las mismas unidades que su ancho (100): el CSS le da esa proporción. */
const ALTO_MAPA = 40;
/** Cuántas skills se pintan de entrada en el catálogo. */
const PAGINA_SKILLS = 40;

// --- Lo que comparten todas las filas: el registro de apagados y cómo cambiarlo -----------------------------------------------------------

type Acciones = {
  apagados: VistaApagados["apagados"] | null;
  protegidas: readonly string[];
  /** Apagar y prender sólo se puede desde la PC. */
  puede: boolean;
  pendientes: ReadonlySet<string>;
  fijar: (x: { tipo: TipoApagado; nombre: string }, apagar: boolean) => void;
  /** Lo que se usó en las sesiones recientes de la persona (`null`: no se sabe todavía: no se afirma "nunca usada"). */
  recientes: UsosCatalogo | null;
};
const Acc = createContext<Acciones>({ apagados: null, protegidas: [], puede: false, pendientes: new Set(), fijar: () => {}, recientes: null });

type Carga = { d: Desglose | null; error: string | null };

/** Los desgloses de un grupo de sesiones: todos juntos, de nuevo cuando cambia quiénes son o `refresco`. `undefined` = leyendo. */
function useDesgloses(pedidos: { clave: string; quien: Quien }[], refresco: number): ReadonlyMap<string, Carga> {
  const [mapa, setMapa] = useState<ReadonlyMap<string, Carga>>(new Map());
  const llave = JSON.stringify(pedidos);
  useEffect(() => {
    let vivo = true;
    const poner = (clave: string, f: (antes: Carga | undefined) => Carga) => setMapa((m) => new Map(m).set(clave, f(m.get(clave))));
    for (const p of JSON.parse(llave) as typeof pedidos)
      fuenteContexto.desglose(p.quien).then(
        (d) => vivo && poner(p.clave, () => ({ d, error: null })),
        (e) => vivo && poner(p.clave, (a) => ({ d: a?.d ?? null, error: mensaje(e) })),
      );
    return () => {
      vivo = false;
    };
  }, [llave, refresco]);
  return mapa;
}

// --- Piezas ----------------------------------------------------------------------------------------------------------------------------------

/** Prendido / apagado para todo Trama. El estado va en `aria-checked` y en el ícono de la perilla, no sólo en el color. */
function Interruptor({ x, nombre, protegida }: { x: { tipo: TipoApagado; nombre: string } | null; nombre: string; protegida?: boolean }) {
  const { apagados, puede, pendientes, fijar } = useContext(Acc);
  const apagado = x && apagados ? estaApagado(apagados, x) : false;
  const ocupado = x ? pendientes.has(`${x.tipo}:${x.nombre}`) : false;
  const sin = !x || !apagados || !puede || protegida;
  const tip = protegida ? t("ctxp.protegida") : !x ? t("ctxp.sinRuta") : !puede ? t("ctxp.soloPc") : apagado ? t("ctxp.prenderItem", { nombre }) : t("ctxp.apagarItem", { nombre });
  return (
    <button
      type="button"
      role="switch"
      className="cp-sw"
      aria-checked={!apagado}
      aria-label={nombre}
      aria-busy={ocupado || undefined}
      disabled={!!sin || ocupado}
      data-tip={tip}
      onClick={() => x && fijar(x, !apagado)}
    >
      <span className="cp-sw-p">{protegida ? <Lock size={10} strokeWidth={2.4} /> : apagado ? <X size={10} strokeWidth={2.6} /> : <Check size={10} strokeWidth={2.6} />}</span>
    </button>
  );
}

/**
 * El "?" chico de una categoría o de una pieza: abre debajo una explicación de una o dos líneas en palabras simples. Es un botón (se llega
 * con el teclado), dice qué explica y si está abierto (`aria-expanded`); el texto no se esconde con el color ni con el mouse encima.
 * Va en una fila de flex que envuelve: el texto ocupa su propia línea.
 */
function Ayuda({ k, nombre }: { k: string; nombre: string }) {
  const [abierta, setAbierta] = useState(MODO.captura === "contexto-panel-ayuda");
  const id = useId();
  const etq = t(abierta ? "ctxp.ayuda.cerrar" : "ctxp.ayuda.abrir", { nombre });
  return (
    <>
      <button type="button" className="cp-ay" aria-expanded={abierta} aria-controls={id} aria-label={etq} data-tip={etq} onClick={() => setAbierta(!abierta)}>
        <span aria-hidden>?</span>
      </button>
      {abierta ? (
        <p id={id} className="cp-ay-txt" role="note">
          {t(k as "ctxp.ayuda.mensajes")}
        </p>
      ) : null}
    </>
  );
}

/** La barra apilada: un tramo por categoría, tan ancho como lo que ocupa de la ventana; el hueco es lo libre. */
function Barra({ cats, d, fina }: { cats: FilaCat[]; d: Desglose; fina?: boolean }) {
  const suma = cats.reduce((n, c) => n + c.tokens, 0);
  const libre = d.ventana ? Math.max(0, d.ventana - suma) : 0;
  const lista = cats.map((c) => `${nombreCat(c.id)} ${miles(c.tokens)}`).join(", ");
  return (
    <div className="cp-barra" data-fina={fina ? "" : undefined} role="img" aria-label={t("ctxp.barra", { lista: lista || "—" })}>
      {cats.map((c) => (
        <i key={c.id} data-cat={c.id} style={{ flexGrow: c.tokens }} />
      ))}
      {libre > 0 ? <i data-cat="libre" style={{ flexGrow: libre }} /> : null}
    </div>
  );
}

/** Las secciones del prompt que la vista sabe nombrar y explicar (`electron/contexto-sesion.ts`, `SECCIONES_CONOCIDAS`). */
const SECCIONES = new Set(["intro", "arnes", "sesion", "memoria", "entorno", "contexto"]);

/** El nombre de un bloque o de un ítem del sistema, en el idioma de la vista. Del prompt: la sección conocida, o su título tal cual, o "instrucción suelta". */
function nombreSis(sis: Item["sis"], nombre: string, detalle: string | null, seccion?: string | null): string {
  switch (sis) {
    case "prompt":
      return seccion && SECCIONES.has(seccion) ? t(`ctxp.sis.sec.${seccion}` as "ctxp.sis.sec.intro") : nombre || t(seccion === "suelta" ? "ctxp.sis.suelta" : "ctxp.sis.prompt");
    case "hook":
      return t("ctxp.sis.hook", { nombre });
    case "diferidas":
      return t("ctxp.sis.diferidas", { n: detalle ?? "0" });
    case "entorno":
      return t("ctxp.sis.entorno");
    case "resto":
      return t("ctxp.sis.resto");
    default:
      return nombre;
  }
}

/** La explicación de una pieza del sistema: la de su sección si es del prompt, o la de su tipo. */
const ayudaSis = (it: Pick<Item, "sis" | "seccion">): string =>
  it.sis === "prompt"
    ? it.seccion && SECCIONES.has(it.seccion)
      ? `ctxp.ayuda.sec.${it.seccion}`
      : it.seccion === "suelta"
        ? "ctxp.ayuda.suelta"
        : "ctxp.ayuda.secOtra"
    : `ctxp.ayuda.${it.sis}`;

/** El mapa de bloques: lo más pesado de un vistazo. Cada bloque dice su nombre y lleva a su detalle; tocarlo abre la categoría. Clic derecho en Mensajes: compactar. */
function Mapa({ d, apagados, alElegir, alMenu }: { d: Desglose; apagados: VistaApagados["apagados"] | null; alElegir: (cat: Categoria, clave: string | null) => void; alMenu?: (cat: Categoria) => void }) {
  const total = d.ventana ?? d.usado ?? 1;
  const colocados = useMemo(() => treemap(bloques(d, 14, apagados), 100, ALTO_MAPA), [d, apagados]);
  if (!colocados.length) return null;
  return (
    <div className="cp-mapa" role="group" aria-label={t("ctxp.mapa")}>
      {colocados.map((b) => {
        const nombre = b.resto ? "" : b.nombre === "…" ? t("ctxp.mapaCat", { cat: nombreCat(b.cat) }) : b.sis ? nombreSis(b.sis, b.nombre, null, b.seccion) : b.nombre || nombreCat(b.cat);
        const caja = {
          left: `${b.x}%`,
          top: `${(b.y / ALTO_MAPA) * 100}%`,
          width: `${b.w}%`,
          height: `${(b.h / ALTO_MAPA) * 100}%`,
        };
        // Con lugar: nombre y tokens; con poco: sólo el nombre; sin lugar: nada (queda el aria-label y el tooltip).
        const lugar = b.w >= 17 && b.h >= 12 ? "todo" : b.w >= 10 && b.h >= 7 ? "nombre" : "nada";
        const txt = (
          <>
            {lugar !== "nada" && !b.resto ? <b>{nombre}</b> : null}
            {lugar === "todo" ? <span>{miles(b.tokens)}</span> : null}
          </>
        );
        if (b.resto)
          return (
            <div key={b.id} className="cp-bq" data-resto="" style={caja} role="img" aria-label={t("ctxp.mapaResto", { tokens: miles(b.tokens) })} data-tip={t("ctxp.mapaResto", { tokens: miles(b.tokens) })}>
              {lugar !== "nada" ? <b>{t("ctxp.resto")}</b> : null}
              {lugar === "todo" ? <span>{miles(b.tokens)}</span> : null}
            </div>
          );
        const dice = t("ctxp.mapaBloque", { nombre, cat: nombreCat(b.cat), tokens: miles(b.tokens), pct: porcentaje(b.tokens, total) });
        return (
          <button
            key={b.id}
            type="button"
            className="cp-bq"
            data-cat={b.cat}
            style={caja}
            aria-label={dice}
            data-tip={dice}
            onClick={() => alElegir(b.cat, b.clave)}
            onContextMenu={
              alMenu && b.cat === "mensajes"
                ? (e) => {
                    e.preventDefault();
                    alMenu(b.cat);
                  }
                : undefined
            }
          >
            {txt}
          </button>
        );
      })}
    </div>
  );
}

/** Cuántas veces se usó (o que nunca) y si la mete un hook: la palabra va siempre, el ícono acompaña. */
function Uso({ it }: { it: Item }) {
  const rec = it.recientes && it.recientes > 0 ? <span className="cp-uso">{it.recientes === 1 ? t("ctxp.recientes1", { dias: DIAS }) : t("ctxp.recientesN", { n: it.recientes, dias: DIAS })}</span> : null;
  if (it.porHook)
    return (
      <>
        <span className="cp-uso" data-hook="" data-tip={t("ctxp.porHookTip")}>
          <Zap size={11} strokeWidth={2.2} aria-hidden />
          {t("ctxp.porHook")}
        </span>
        {rec}
      </>
    );
  if (it.usos === null) return rec;
  if (it.nunca)
    return (
      <span className="cp-uso" data-nunca="">
        <CircleDashed size={11} strokeWidth={2.2} aria-hidden />
        {t("ctxp.usos0")}
      </span>
    );
  return (
    <>
      <span className="cp-uso">{it.usos === 0 ? (rec ? null : t("ctxp.usos0")) : it.usos === 1 ? t("ctxp.usos1") : t("ctxp.usosN", { n: it.usos })}</span>
      {rec}
    </>
  );
}

/** Los días que mira el historial de usos (electron/skills-catalogo.ts, `DIAS_USOS`). */
const DIAS = 30;

function FilaItem({ it, uid, foco, estimado }: { it: Item; uid: string; foco: boolean; estimado: boolean }) {
  const { apagados } = useContext(Acc);
  const [hijos, setHijos] = useState(false);
  const [texto, setTexto] = useState(false);
  const apagado = it.apaga && apagados ? estaApagado(apagados, it.apaga) : false;
  const idHijos = useId();
  const idTexto = useId();
  const nombre = nombreSis(it.sis, it.nombre, it.detalle, it.seccion);
  // De una sección conocida del prompt se ve también su título original; de la suelta, sus primeras palabras.
  const detalle = it.sis === "diferidas" || it.sis === "resto" ? null : it.sis === "prompt" && it.seccion && SECCIONES.has(it.seccion) ? it.nombre || null : it.detalle;
  return (
    <li id={`${uid}-${it.clave}`} className="cp-it" data-apagado={apagado ? "" : undefined} data-foco={foco ? "" : undefined} data-fantasma={it.fantasma ? "" : undefined}>
      <div className="cp-it-nom">
        <b>{nombre}</b>
        {detalle ? <small title={detalle}>{detalle}</small> : null}
      </div>
      <span className="cp-num" data-tip={apagado ? t("ctxp.noSuma") : estimado ? t("ctxp.estimado") : undefined}>
        {it.tokens === null ? (it.fantasma ? "—" : t(it.diferida ? "ctxp.soloNombre" : "ctxp.sinTokens")) : `${estimado ? "≈" : ""}${miles(it.tokens)}`}
      </span>
      {it.sis ? <span className="cp-sw-hueco" /> : <Interruptor x={it.apaga} nombre={nombre} protegida={it.protegida} />}
      <div className="cp-it-det">
        <Uso it={it} />
        {it.sis ? <Ayuda k={ayudaSis(it)} nombre={nombre} /> : null}
        {it.nunca && !it.porHook ? <Ayuda k="ctxp.ayuda.nunca" nombre={t("ctxp.usos0")} /> : null}
        {it.diferida ? <span className="cp-etq">{t("ctxp.diferida")}</span> : null}
        {it.diferida ? <Ayuda k="ctxp.ayuda.diferida" nombre={t("ctxp.diferida")} /> : null}
        {it.diferidos ? <span className="cp-etq">{t("ctxp.diferidosDe", { tokens: miles(it.diferidos) })}</span> : null}
        {it.resultados ? <span className="cp-etq">{t("ctxp.resultadosEn", { tokens: miles(it.resultados) })}</span> : null}
        {it.protegida ? (
          <span className="cp-etq">
            <Lock size={10} strokeWidth={2.2} aria-hidden />
            {t("ctxp.protegida")}
          </span>
        ) : null}
        {apagado ? (
          <span className="cp-etq" data-apagada="">
            <X size={10} strokeWidth={2.6} aria-hidden />
            {it.fantasma ? t("ctxp.fantasma") : t("ctxp.apagada")}
          </span>
        ) : null}
        {it.hijos.length ? (
          <button type="button" className="cp-link" aria-expanded={hijos} aria-controls={idHijos} onClick={() => setHijos(!hijos)}>
            {hijos ? t("ctxp.ocultarHerramientas") : t("ctxp.verHerramientas", { n: it.hijos.length })}
          </button>
        ) : null}
        {it.texto ? (
          <button type="button" className="cp-link" aria-expanded={texto} aria-controls={idTexto} onClick={() => setTexto(!texto)}>
            {texto ? t("ctxp.ocultarTexto") : t("ctxp.verTexto")}
          </button>
        ) : null}
      </div>
      {texto && it.texto ? (
        <div id={idTexto} className="cp-texto">
          <pre tabIndex={0} aria-label={t("ctxp.textoDe", { nombre })}>
            {it.texto}
          </pre>
          {it.truncado ? <small>{t("ctxp.textoCortado", { n: miles(it.texto.length) })}</small> : null}
        </div>
      ) : null}
      {hijos ? (
        <ul id={idHijos} className="cp-hijos" aria-label={t("ctxp.herramientasDe", { srv: it.nombre })}>
          {it.hijos.map((h) => (
            <FilaItem key={h.clave} it={h} uid={`${uid}-${it.clave}`} foco={false} estimado={estimado} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const motivoDe = (d: Desglose) =>
  d.fuente !== "sin-desglose" && d.motivo === null ? null : t(d.motivo === "sin-transcript" ? "ctxp.sinDesglose.sinTranscript" : d.motivo === "sin-uso" ? "ctxp.sinDesglose.sinUso" : "ctxp.sinDesglose.motor");

/** Cuántos segundos se espera a que el líder empiece a compactar antes de decir que no lo hizo. */
const ESPERA_COMPACTAR_S = 30;

type FaseCompactar = "reposo" | "preguntando" | "enviando" | "esperando" | "compactando" | "midiendo";

/**
 * El flujo de Compactar del líder: pregunta en una línea, manda `/compact`, mira si empezó a compactar (`useCompactando`), y al terminar
 * vuelve a medir y dice de cuántos a cuántos tokens quedó. Un worker no recibe comandos: ahí sólo se explica por qué no.
 */
function useCompactar(lider: Lider | null, d: Desglose, alRefrescar: () => void) {
  const [fase, setFase] = useState<FaseCompactar>("reposo");
  const [nota, setNota] = useState<{ ok: boolean; texto: string } | null>(null);
  const antes = useRef<{ usado: number | null; d: Desglose } | null>(null);
  const desde = useCompactando(lider?.id ?? null);
  const compactando = desde !== null;
  const vio = useRef(false);
  const puede = !!lider && lider.origen === "app" && !lider.ocupado && fase === "reposo";
  const porque = !lider ? t("ctxp.compactarWorker") : lider.origen !== "app" ? t("ctxp.compactarTerminal") : lider.ocupado && fase === "reposo" ? t("ctxp.compactarOcupado") : t("ctxp.compactarTip");

  const pedir = useCallback(() => {
    if (puede) {
      setNota(null);
      setFase("preguntando");
    }
  }, [puede]);
  const cancelar = useCallback(() => setFase("reposo"), []);
  const confirmar = useCallback(() => {
    if (!lider) return;
    const modelo = modeloDe(lider.modelo) ?? lider.modelo ?? MODELO_DEFAULT;
    antes.current = { usado: d.usado, d };
    vio.current = false;
    setFase("enviando");
    fuente.liderMandar(lider.id, { texto: "/compact", modelo, effort: effortDe(lider.effort, modelo) ?? lider.effort ?? "" }).then(
      () => setFase("esperando"),
      (e) => {
        setFase("reposo");
        setNota({ ok: false, texto: t("ctxp.compactarError", { motivo: mensaje(e) }) });
      },
    );
  }, [lider, d]);

  // Empezó a compactar → compactando; dejó de hacerlo → vuelve a medir.
  useEffect(() => {
    if (compactando) {
      vio.current = true;
      if (fase === "esperando") setFase("compactando");
    } else if (vio.current && (fase === "compactando" || fase === "esperando")) {
      vio.current = false;
      setFase("midiendo");
      alRefrescar();
    }
  }, [compactando, fase, alRefrescar]);
  // Nunca arrancó: no se queda esperando para siempre.
  useEffect(() => {
    if (fase !== "esperando") return;
    const x = setTimeout(() => {
      if (vio.current) return;
      setFase("reposo");
      setNota({ ok: false, texto: t("ctxp.compactarNada") });
    }, ESPERA_COMPACTAR_S * 1000);
    return () => clearTimeout(x);
  }, [fase]);
  // La medición nueva llegó: se dice el antes y el después.
  useEffect(() => {
    if (fase !== "midiendo" || !antes.current || d === antes.current.d) return;
    const a = antes.current.usado;
    setNota({ ok: true, texto: a !== null && d.usado !== null ? t("ctxp.compactado", { antes: miles(a), despues: miles(d.usado) }) : t("ctxp.compactadoSin") });
    antes.current = null;
    setFase("reposo");
  }, [fase, d]);

  return { fase, nota, puede, porque, pedir, cancelar, confirmar };
}

/** La fila de Compactar bajo el título de Mensajes: botón, confirmación de una línea y el resultado. */
function FilaCompactar({ c, sinLider }: { c: ReturnType<typeof useCompactar>; sinLider: boolean }) {
  const { fase } = c;
  const trabajando = fase === "enviando" || fase === "esperando" || fase === "compactando" || fase === "midiendo";
  return (
    <div className="cp-compactar">
      {fase === "preguntando" ? (
        <div className="cp-confirmar" role="alertdialog" aria-label={t("ctxp.compactarPregunta")}>
          <span>{t("ctxp.compactarPregunta")}</span>
          <button type="button" className="btn2" autoFocus onClick={c.confirmar}>
            {t("ctxp.compactarSi")}
          </button>
          <button type="button" className="cp-link" onClick={c.cancelar}>
            {t("ctxp.cancelar")}
          </button>
        </div>
      ) : (
        <button type="button" className="btn2 cp-compactar-btn" disabled={!c.puede} aria-busy={trabajando || undefined} data-tip={c.porque} onClick={c.pedir}>
          <Minimize2 size={13} strokeWidth={1.9} aria-hidden />
          {trabajando ? t("ctxp.compactandoAhora") : t("ctxp.compactar")}
        </button>
      )}
      {sinLider ? <small>{t("ctxp.compactarWorker")}</small> : null}
      <p className="cp-vivo" role={c.nota && !c.nota.ok ? "alert" : "status"} data-error={c.nota && !c.nota.ok ? "" : undefined}>
        {c.nota?.texto}
      </p>
    </div>
  );
}

/** El desglose entero de uno: resumen, barra, mapa y las categorías con sus ítems. `lider`: si es el de un líder, deja compactarlo. */
function Detalle({ d, uid, inicial, lider, alRefrescar }: { d: Desglose; uid: string; inicial?: Categoria | null; lider?: Lider | null; alRefrescar: () => void }) {
  const { protegidas, apagados, recientes } = useContext(Acc);
  const [abierta, setAbierta] = useState<Categoria | null>(inicial ?? null);
  const [foco, setFoco] = useState<string | null>(null);
  const cats = useMemo(() => categorias(d, apagados), [d, apagados]);
  const frac = fraccionUsada(d, apagados);
  const usado = usadoNeto(d, apagados);
  const total = d.ventana ?? d.usado ?? 0;
  const compactar = useCompactar(lider ?? null, d, alRefrescar);
  const elegir = useCallback((c: Categoria, clave: string | null) => {
    setAbierta(c);
    setFoco(clave);
  }, []);
  // Al venir de un bloque, el ítem se ve sin tener que buscarlo en la lista.
  useEffect(() => {
    if (foco) document.getElementById(`${uid}-${foco}`)?.scrollIntoView({ block: "nearest" });
  }, [foco, abierta, uid]);
  const vacio = motivoDe(d);
  if (vacio && !cats.length) return <p className="cp-nada">{vacio}</p>;
  const baja = d.usado !== null && usado !== null && usado < d.usado;
  const menuMensajes = () => {
    elegir("mensajes", null);
    compactar.pedir();
  };
  const menuTitulo = (e: ReactMouseEvent) => {
    e.preventDefault();
    menuMensajes();
  };
  return (
    <div className="cp-det">
      <p className="cp-uso-total">
        {usado !== null && d.ventana ? (
          <>
            <b className="cp-num">
              {d.estimado ? <span data-tip={t("ctxp.estimado")}>≈</span> : null}
              {t("ctxp.usadoDe", { usado: miles(usado), ventana: miles(d.ventana) })}
            </b>
            {frac !== null ? <span>{t("ctxp.pctVentana", { pct: Math.round(frac * 100) })}</span> : null}
            {d.ventanaEstimada ? <span data-tip={t("ctxp.ventanaSupuesta")}>*</span> : null}
          </>
        ) : usado !== null ? (
          <b className="cp-num">{t("ctxp.usado", { usado: miles(usado) })}</b>
        ) : null}
      </p>
      {baja && d.usado !== null && usado !== null ? <p className="cp-nota">{t("ctxp.sinLoApagado", { medido: miles(d.usado), neto: miles(usado) })}</p> : null}
      {d.desactualizado && d.medidoEn ? <p className="cp-nota">{t("ctxp.medidoA", { hora: new Date(d.medidoEn).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })}</p> : null}
      <Barra cats={cats} d={d} />
      <Mapa d={d} apagados={apagados} alElegir={elegir} alMenu={lider ? menuMensajes : undefined} />
      <ul className="cp-cats">
        {cats.map((c) => {
          const crudo = d.categorias.filter((x) => x.id === c.id && !x.diferido).reduce((n, x) => n + x.tokens, 0);
          const items = CON_ITEMS.has(c.id) ? itemsDe(d, c.id, protegidas, { apagados, recientes, tokensCat: crudo }) : [];
          const abre = abierta === c.id;
          const idCuerpo = `${uid}-cat-${c.id}`;
          return (
            <li key={c.id} className="cp-cat" data-cat={c.id} data-abierta={abre ? "" : undefined}>
              <div className="cp-cat-cab">
                <h4 onContextMenu={c.id === "mensajes" && lider ? menuTitulo : undefined}>
                  <button type="button" aria-expanded={abre} aria-controls={idCuerpo} data-tip={t("ctxp.verDetalle", { cat: nombreCat(c.id) })} onClick={() => setAbierta(abre ? null : c.id)}>
                    <i className="cp-color" aria-hidden />
                    <span className="cp-cat-n">{nombreCat(c.id)}</span>
                    <span className="cp-num" data-tip={c.estimado ? t("ctxp.estimado") : undefined}>
                      {c.estimado ? "≈" : ""}
                      {miles(c.tokens)}
                    </span>
                    <span className="cp-pct">{porcentaje(c.tokens, total)} %</span>
                    <ChevronRight size={14} strokeWidth={2} className="cp-chev" aria-hidden />
                  </button>
                </h4>
                <Ayuda k={`ctxp.ayuda.${c.id}`} nombre={nombreCat(c.id)} />
              </div>
              {c.id === "mensajes" ? <FilaCompactar c={compactar} sinLider={!lider} /> : null}
              {abre ? (
                <div id={idCuerpo} className="cp-cuerpo">
                  {c.id === "sistema" && d.sistema.some((p) => p.tipo === "prompt") ? <p className="cp-nota">{d.promptVersion ? t("ctxp.sis.notaVersion", { version: d.promptVersion }) : t("ctxp.sis.nota")}</p> : null}
                  {items.length ? (
                    <ul className="cp-items" aria-label={nombreCat(c.id)}>
                      {items.map((it, k) => (
                        <Fragment key={it.clave}>
                          {c.id === "herramientas" && (k === 0 || items[k - 1].diferida !== it.diferida) ? (
                            <li className="cp-sub" aria-hidden="true">
                              {t(it.diferida ? "ctxp.herr.diferidas" : "ctxp.herr.cargadas", { n: items.filter((x) => x.diferida === it.diferida).length })}
                            </li>
                          ) : null}
                          <FilaItem it={it} uid={`${uid}-${c.id}`} foco={foco === it.clave} estimado={c.estimado || d.estimado} />
                        </Fragment>
                      ))}
                    </ul>
                  ) : (
                    <p className="cp-nada">{t(`ctxp.catDesc.${c.id}` as "ctxp.catDesc.sistema")}</p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {vacio ? <p className="cp-nada">{vacio}</p> : null}
    </div>
  );
}

// --- Líder y workers ------------------------------------------------------------------------------------------------------------------------

function Cargando({ carga, alReintentar }: { carga: Carga | undefined; alReintentar: () => void }) {
  if (!carga) return <p className="cp-nada">{t("ctxp.leyendo")}</p>;
  return (
    <div className="cp-error" role="alert">
      <p>{t("ctxp.error", { motivo: carga.error ?? "?" })}</p>
      <button type="button" className="btn2" onClick={alReintentar}>
        {t("ctxp.reintentar")}
      </button>
    </div>
  );
}

function FilaWorker({ h, carga, abierto, alAlternar, alAbrir, alReintentar, alRefrescar, inicial }: { h: Hilo; carga: Carga | undefined; abierto: boolean; alAlternar: () => void; alAbrir: () => void; alReintentar: () => void; alRefrescar: () => void; inicial?: Categoria | null }) {
  const id = useId();
  const { apagados } = useContext(Acc);
  const d = carga?.d ?? null;
  const cats = useMemo(() => (d ? categorias(d, apagados) : []), [d, apagados]);
  const frac = d ? fraccionUsada(d, apagados) : null;
  const tipo = h.en_cola ? "cola" : (tipoDe(h, h.estado)?.tipo ?? "");
  const estado = h.en_cola ? t("ctxp.enCola") : (tipoDe(h, h.estado)?.texto ?? h.estado);
  return (
    <li className="cp-w" data-abierto={abierto ? "" : undefined}>
      <div className="cp-w-cab">
        <button type="button" className="cp-w-btn" aria-expanded={abierto} aria-controls={id} onClick={alAlternar}>
          <ChevronRight size={14} strokeWidth={2} className="cp-chev" aria-hidden />
          <span className="cp-w-nom">
            <b>{tareaDe(h)}</b>
            <span className="cp-w-est" data-tipo={tipo}>
              <i aria-hidden />
              {estado}
            </span>
          </span>
          {d && d.fuente !== "sin-desglose" && d.ventana ? (
            <span className="cp-w-mini">
              <span className="cp-pct" data-tip={d.estimado ? t("ctxp.estimado") : undefined}>
                {d.estimado ? "≈" : ""}
                {frac !== null ? Math.round(frac * 100) : 0} %
              </span>
              <Barra cats={cats} d={d} fina />
            </span>
          ) : (
            <span className="cp-w-mini">
              <span className="cp-pct">{carga ? t("comun.sinDato") : "…"}</span>
            </span>
          )}
        </button>
        <button type="button" className="cp-ico" aria-label={t("ctxp.abrirHilo", { n: tareaDe(h) })} data-tip={t("ctxp.abrirHilo", { n: tareaDe(h) })} onClick={alAbrir}>
          <ArrowUpRight size={14} strokeWidth={1.8} />
        </button>
      </div>
      {abierto ? (
        <div id={id} className="cp-w-cuerpo">
          {d ? <Detalle d={d} uid={`w-${h.id}`} inicial={inicial} alRefrescar={alRefrescar} /> : <Cargando carga={carga} alReintentar={alReintentar} />}
        </div>
      ) : null}
    </li>
  );
}

// --- Catálogo de skills ---------------------------------------------------------------------------------------------------------------------

function FilaSkill({ s, nunca, porHook, veces }: { s: SkillCatalogo; nunca: boolean; porHook: boolean; veces: number }) {
  const { apagados } = useContext(Acc);
  const apagada = s.estado === "apagada" || (apagados ? estaApagado(apagados, { tipo: "skills", nombre: s.clave }) : false);
  const origen = s.origen === "plugin" || s.origen === "claudeai" ? pluginDeSkill(s) : s.origen === "proyecto" && s.de ? `${t("ctxp.origen.proyecto")}: ${s.de}` : t(`ctxp.origen.${s.origen}` as "ctxp.origen.usuario");
  const pluginOff = s.estado === "plugin-apagado";
  return (
    <li className="cp-it cp-sk" data-apagado={apagada || pluginOff ? "" : undefined}>
      <div className="cp-it-nom">
        <b>{s.clave}</b>
        <small>{origen}</small>
      </div>
      <span className="cp-num" data-tip={s.tokensEstimado ? t("ctxp.estimado") : undefined}>
        {s.tokensEstimado ? "≈" : ""}
        {miles(s.tokens)}
      </span>
      {pluginOff ? <span className="cp-sw-hueco" /> : <Interruptor x={{ tipo: "skills", nombre: s.clave }} nombre={s.clave} />}
      <p className="cp-sk-desc">{s.descripcion}</p>
      <div className="cp-it-det">
        {porHook && !apagada && !pluginOff ? (
          <span className="cp-uso" data-hook="" data-tip={t("ctxp.porHookTip")}>
            <Zap size={11} strokeWidth={2.2} aria-hidden />
            {t("ctxp.porHook")}
          </span>
        ) : null}
        {veces > 0 ? <span className="cp-uso">{veces === 1 ? t("ctxp.recientes1", { dias: DIAS }) : t("ctxp.recientesN", { n: veces, dias: DIAS })}</span> : null}
        {nunca && !porHook && !apagada && !pluginOff ? (
          <span className="cp-uso" data-nunca="">
            <CircleDashed size={11} strokeWidth={2.2} aria-hidden />
            {t("ctxp.usos0")}
          </span>
        ) : null}
        {apagada ? (
          <span className="cp-etq" data-apagada="">
            <X size={10} strokeWidth={2.6} aria-hidden />
            {t("ctxp.apagada")}
          </span>
        ) : null}
        {pluginOff ? <span className="cp-etq">{t("ctxp.pluginApagado")}</span> : null}
      </div>
    </li>
  );
}

function CatalogoSkills({ cat, error, alReintentar, desgloses }: { cat: Catalogo | null; error: string | null; alReintentar: () => void; desgloses: Desglose[] }) {
  const [f, setF] = useState<FiltroSkills>(() => ({ q: MODO.captura === "contexto-panel-skills" && MODO.variante === "buscar" ? "nube" : "", solo: MODO.captura === "contexto-panel-skills" && MODO.variante !== "buscar" ? "nunca" : "todas", plugin: "" }));
  const [limite, setLimite] = useState(PAGINA_SKILLS);
  const { apagados } = useContext(Acc);
  const entrada = useId();
  const usos = cat?.usos ?? null;
  // "Nunca usada" sólo se afirma con el historial de todas las sesiones recientes; sin él, no se sabe (nada de adivinar con la sesión abierta).
  const sabe = !!usos;
  const vistas = useMemo(() => usadas(desgloses, usos), [desgloses, usos]);
  // Lo que se muestra como apagado sale del registro (cambia al instante con un interruptor), no de lo leído.
  const lista = useMemo(
    () =>
      (cat?.skills ?? []).map((s): SkillCatalogo =>
        s.estado === "plugin-apagado" ? s : { ...s, estado: apagados && (apagados.skills.includes(s.clave) || apagados.skills.includes(s.nombre)) ? "apagada" : "activa" },
      ),
    [cat, apagados],
  );
  const plugins = useMemo(() => pluginsDe(lista), [lista]);
  const mostradas = useMemo(() => filtrarSkills(lista, f, { sabe, usadas: vistas }), [lista, f, sabe, vistas]);
  const pesan = useMemo(() => lista.filter((s) => s.estado === "activa").reduce((n, s) => n + s.tokens, 0), [lista]);
  const activas = lista.filter((s) => s.estado === "activa").length;
  useEffect(() => setLimite(PAGINA_SKILLS), [f]);
  if (error && !cat) return <Cargando carga={{ d: null, error }} alReintentar={alReintentar} />;
  if (!cat) return <p className="cp-nada">{t("ctxp.leyendo")}</p>;
  const filtros: [FiltroSkills["solo"], string][] = [
    ["todas", "ctxp.f.todas"],
    ["apagadas", "ctxp.f.apagadas"],
    ["nunca", "ctxp.f.nunca"],
  ];
  return (
    <div className="cp-cat-skills">
      <label className="cp-buscar" htmlFor={entrada}>
        <Search size={14} strokeWidth={1.8} aria-hidden />
        <input id={entrada} type="search" value={f.q} placeholder={t("ctxp.buscar")} aria-label={t("ctxp.buscarEtq")} spellCheck={false} autoComplete="off" onChange={(e) => setF({ ...f, q: e.target.value })} />
      </label>
      <div className="cp-filtros" role="group" aria-label={t("ctxp.filtros")}>
        {filtros.map(([k, etq]) => (
          <button key={k} type="button" className="cp-chip" aria-pressed={f.solo === k} onClick={() => setF({ ...f, solo: k })}>
            {t(etq as "ctxp.f.todas")}
          </button>
        ))}
        {plugins.length ? (
          <label className="cp-plugin">
            <span className="cp-sr">{t("ctxp.plugin")}</span>
            <select value={f.plugin} onChange={(e) => setF({ ...f, plugin: e.target.value })}>
              <option value="">{t("ctxp.pluginTodos")}</option>
              {plugins.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="cp-cuenta" role="status">
        {t("ctxp.cuenta", { n: mostradas.length, total: lista.length })}
        <span>{t("ctxp.activasPesan", { n: activas, tokens: miles(pesan) })}</span>
      </p>
      {usos ? <p className="cp-nota">{t("ctxp.usosRecientes", { dias: usos.dias, n: usos.sesiones })}</p> : <p className="cp-nota">{t("ctxp.sinUsosRecientes")}</p>}
      {f.solo === "nunca" && !sabe ? <p className="cp-nada">{t("ctxp.nuncaSinDato")}</p> : null}
      {mostradas.length === 0 && !(f.solo === "nunca" && !sabe) ? <p className="cp-nada">{t("ctxp.sinResultados")}</p> : null}
      <ul className="cp-items">
        {mostradas.slice(0, limite).map((s) => (
          <FilaSkill
            key={s.id}
            s={s}
            nunca={sabe && !vistas.has(s.clave) && !vistas.has(s.nombre)}
            porHook={!!usos && (usos.porHook.includes(s.clave) || usos.porHook.includes(s.nombre))}
            veces={usos ? (usos.skills[s.clave] ?? usos.skills[s.nombre] ?? 0) : 0}
          />
        ))}
      </ul>
      {mostradas.length > limite ? (
        <button type="button" className="btn2 cp-mas" onClick={() => setLimite(limite + PAGINA_SKILLS)}>
          {t("ctxp.masSkills", { n: mostradas.length - limite })}
        </button>
      ) : null}
    </div>
  );
}

// --- El panel ------------------------------------------------------------------------------------------------------------------------------

type Props = {
  /** El líder que se mira (o el del worker que se mira); `null`: ninguno. */
  lider: Lider | null;
  /** Sus workers (los vivos primero). */
  workers: Hilo[];
  alCerrar: () => void;
  alAbrirHilo: (id: string) => void;
};

type Pestana = "sesiones" | "skills" | "previa";

// --- Vista previa: qué cargaría un líder o un worker nuevo -------------------------------------------------------------------------------

const fechaCorta = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(locale(), { day: "numeric", month: "short" }) : "—");

/**
 * Elegir qué lanzar (líder o worker nuevo), en qué proyecto y con qué modelo, y ver lo que cargaría sin lanzar nada. Reusa el detalle de una
 * sesión (barra, mapa, categorías, interruptores): apagar o prender vale para todo Trama y la cuenta se rehace sola. Si falta el prompt base de
 * esta versión de Claude Code se captura una vez (contexto-base.ts); sin la PC sólo se mira.
 */
function VistaPreviaTab({ refresco }: { refresco: number }) {
  const { apagados, puede } = useContext(Acc);
  const [tipo, setTipo] = useState<"lider" | "worker">("lider");
  const [proyecto, setProyecto] = useState(MODO.captura === "contexto-panel-previa" ? "/home/persona/proyectos/atlas" : "");
  const [modelo, setModelo] = useState(MODELO_DEFAULT);
  const [carga, setCarga] = useState<{ v: VistaPrevia | null; error: string | null } | null>(null);
  const [capturando, setCapturando] = useState(false);
  const [errCaptura, setErrCaptura] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const sola = useRef(false);
  const uid = useId();
  const llaveApagados = JSON.stringify(apagados);

  // Se rehace al cambiar la elección, lo apagado o con Actualizar; mientras tanto se sigue viendo lo anterior.
  useEffect(() => {
    let vivo = true;
    fuenteContexto.previa({ tipo, proyecto, modelo }).then(
      (v) => vivo && setCarga({ v, error: null }),
      (e) => vivo && setCarga((a) => ({ v: a?.v ?? null, error: mensaje(e) })),
    );
    return () => {
      vivo = false;
    };
  }, [tipo, proyecto, modelo, llaveApagados, refresco, intento]);

  const capturar = useCallback(async (forzar: boolean) => {
    setCapturando(true);
    setErrCaptura(null);
    try {
      await fuenteContexto.capturarBase(forzar);
    } catch (e) {
      setErrCaptura(mensaje(e));
    } finally {
      setCapturando(false);
      setIntento((n) => n + 1);
    }
  }, []);

  // Sin prompt base se captura solo, una vez; si falla queda el botón. (Las capturas de pantalla muestran el estado "falta" tal cual.)
  const base = carga?.v?.base ?? null;
  useEffect(() => {
    if (base?.estado !== "falta" || !puede || sola.current || MODO.captura) return;
    sola.current = true;
    void capturar(false);
  }, [base?.estado, puede, capturar]);

  const v = carga?.v ?? null;
  const proyectos = v?.proyectos ?? [];
  const modelos = MODELOS.filter((m) => m.id.startsWith("claude-"));
  const sinModelo = !modelos.some((m) => m.id === modelo);
  const tipos: ["lider" | "worker", string][] = [
    ["lider", "ctxp.previa.lider"],
    ["worker", "ctxp.previa.worker"],
  ];

  return (
    <div className="cp-previa">
      <div className="cp-ay-fila">
        <p className="cp-nota">{t("ctxp.previa.intro")}</p>
        <Ayuda k="ctxp.previa.ayuda" nombre={t("ctxp.previa")} />
      </div>
      <div className="cp-previa-form">
        <div className="cp-previa-tipos" role="group" aria-label={t("ctxp.previa.tipo")}>
          {tipos.map(([k, etq]) => (
            <button key={k} type="button" className="cp-chip" aria-pressed={tipo === k} onClick={() => setTipo(k)}>
              {t(etq as "ctxp.previa.lider")}
            </button>
          ))}
        </div>
        <label className="cp-previa-campo" htmlFor={`${uid}-proy`}>
          <span>{t("ctxp.previa.proyecto")}</span>
          <select id={`${uid}-proy`} value={proyecto} onChange={(e) => setProyecto(e.target.value)}>
            <option value="">{t("ctxp.previa.home")}</option>
            {proyectos.map((p) => (
              <option key={p.ruta} value={p.ruta}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="cp-previa-campo" htmlFor={`${uid}-mod`}>
          <span>{t("ctxp.previa.modelo")}</span>
          <select id={`${uid}-mod`} value={modelo} onChange={(e) => setModelo(e.target.value)}>
            {sinModelo ? <option value={modelo}>{nombreModelo(modelo)}</option> : null}
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
      {base ? (
        <div className="cp-previa-base" data-estado={base.estado} role="status">
          <p>
            {capturando
              ? t("ctxp.previa.capturando")
              : base.estado === "falta"
                ? t("ctxp.previa.base.falta")
                : base.estado === "lista"
                  ? t("ctxp.previa.base.lista", { version: base.version ?? "?", fecha: fechaCorta(base.capturadoEn) })
                  : t("ctxp.previa.base.vieja", { version: base.version ?? "?", fecha: fechaCorta(base.capturadoEn), instalada: base.instalada ?? "?" })}
          </p>
          {errCaptura ? <p className="cp-previa-err" role="alert">{t("ctxp.previa.capturaError", { motivo: errCaptura })}</p> : null}
          {base.estado !== "lista" && !capturando ? (
            puede ? (
              <button type="button" className="btn2" onClick={() => void capturar(base.estado === "vieja")}>
                {t(base.estado === "falta" ? "ctxp.previa.capturar" : "ctxp.previa.recapturar")}
              </button>
            ) : (
              <p>{t("ctxp.soloPc")}</p>
            )
          ) : null}
        </div>
      ) : null}
      {carga?.error ? (
        <div className="cp-error" role="alert">
          <p>{t("ctxp.error", { motivo: carga.error })}</p>
          <button type="button" className="btn2" onClick={() => setIntento((n) => n + 1)}>
            {t("ctxp.reintentar")}
          </button>
        </div>
      ) : null}
      {!carga ? <p className="cp-nada">{t("ctxp.leyendo")}</p> : null}
      {v?.desglose ? (
        <>
          <Detalle key={`${tipo}:${proyecto}:${modelo}`} d={v.desglose} uid={`previa-${uid}`} alRefrescar={() => setIntento((n) => n + 1)} />
          {tipo === "worker" ? <p className="cp-nota">{t("ctxp.previa.notaWorker")}</p> : v.desglose.mcp.length ? <p className="cp-nota">{t("ctxp.previa.mcp")}</p> : null}
        </>
      ) : null}
      {v ? (
        <section className="cp-previa-hooks" aria-label={t("ctxp.previa.hooks", { n: v.hooks.length })}>
          <h4 className="cp-h">
            <span>{t("ctxp.previa.hooks", { n: v.hooks.length })}</span>
          </h4>
          {v.hooks.length ? (
            <ul className="cp-hooks">
              {v.hooks.map((h, i) => (
                <li key={`${h.evento}:${h.nombre}:${i}`}>
                  <code>{h.evento}</code>
                  <span>{h.nombre}</span>
                  <small>{h.origen}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cp-nada">{t("ctxp.previa.sinHooks")}</p>
          )}
          <p className="cp-nota">{t("ctxp.previa.hooksNota")}</p>
        </section>
      ) : null}
    </div>
  );
}

export const PanelContexto = memo(function PanelContexto({ lider, workers, alCerrar, alAbrirHilo }: Props) {
  useIdioma();
  const angosto = useAngosto();
  const [pestana, setPestana] = useState<Pestana>(MODO.captura === "contexto-panel-skills" ? "skills" : MODO.captura === "contexto-panel-previa" ? "previa" : "sesiones");
  const [apagados, setApagados] = useState<VistaApagados | null>(null);
  const [pendientes, setPendientes] = useState<ReadonlySet<string>>(new Set());
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [refresco, setRefresco] = useState(0);
  // En la captura "contexto-panel-cat" el primer worker viene abierto y el líder con una categoría a la vista.
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(() => new Set(MODO.captura === "contexto-panel-cat" && workers[0] ? [workers[0].id] : []));
  const puede = esVentana() || MODO.fixtures;

  useEffect(() => {
    let vivo = true;
    fuenteContexto.apagados().then(
      (a) => vivo && setApagados(a),
      () => {},
    );
    return () => {
      vivo = false;
    };
  }, []);

  const fijar = useCallback<Acciones["fijar"]>(async (x, apagar) => {
    const k = `${x.tipo}:${x.nombre}`;
    setPendientes((p) => new Set(p).add(k));
    try {
      setApagados(await fuenteContexto.fijar(x.tipo, x.nombre, apagar));
      setAviso({ ok: true, texto: t(apagar ? "ctxp.fijadoApagado" : "ctxp.fijadoPrendido", { nombre: x.nombre }) });
    } catch (e) {
      setAviso({ ok: false, texto: t("ctxp.fijarError", { nombre: x.nombre, motivo: mensaje(e) }) });
    } finally {
      setPendientes((p) => {
        const n = new Set(p);
        n.delete(k);
        return n;
      });
    }
  }, []);

  const refrescar = useCallback(() => setRefresco((n) => n + 1), []);
  // Captura "contexto-panel" con HILOS_VARIANTE=refrescado: toca Actualizar solo, para comparar las cifras antes y después.
  useEffect(() => {
    if (MODO.captura !== "contexto-panel" || MODO.variante !== "refrescado") return;
    const x = setTimeout(refrescar, 300);
    return () => clearTimeout(x);
  }, [refrescar]);

  // El catálogo se lee acá (no en la pestaña) porque lo que se usó en las sesiones recientes también lo necesitan los ítems de cada sesión.
  // El historial puede estar indexando: si `usos` vino vacío se reintenta cada 15 s, hasta 6 veces.
  const sid = lider?.id ?? null;
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const reintentosUsos = useRef(0);
  useEffect(() => {
    let vivo = true;
    fuenteContexto.catalogo(sid ?? undefined).then(
      (c) => {
        if (!vivo) return;
        setCat(c);
        setCatError(null);
      },
      (e) => vivo && setCatError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, [sid, intento, refresco]);
  useEffect(() => {
    reintentosUsos.current = 0;
  }, [sid, refresco]);
  useEffect(() => {
    if (!cat || cat.usos || reintentosUsos.current >= 6) return;
    const x = setTimeout(() => {
      reintentosUsos.current += 1;
      setIntento((n) => n + 1);
    }, 15000);
    return () => clearTimeout(x);
  }, [cat]);

  const acciones = useMemo<Acciones>(
    () => ({ apagados: apagados?.apagados ?? null, protegidas: apagados?.protegidas ?? ["Bash", "Read", "Edit", "Write"], puede, pendientes, fijar, recientes: cat?.usos ?? null }),
    [apagados, puede, pendientes, fijar, cat?.usos],
  );

  // El líder y sus workers, todos juntos: de nuevo al terminar el líder de responder, al cambiar quiénes son o con Actualizar.
  const topeWorkers = workers.slice(0, 12);
  const pedidos = useMemo(
    () => [...(lider ? [{ clave: lider.id, quien: { lider: lider.id } }] : []), ...topeWorkers.map((h) => ({ clave: h.id, quien: { worker: h.id } }))],
    [lider?.id, topeWorkers.map((h) => h.id).join(",")],
  );
  const ocupado = lider?.ocupado ?? false;
  const antes = useRef(ocupado);
  useEffect(() => {
    if (antes.current && !ocupado) setRefresco((n) => n + 1);
    antes.current = ocupado;
  }, [ocupado]);
  const cargas = useDesgloses(pedidos, refresco);
  const deLider = lider ? cargas.get(lider.id) : undefined;
  const todos = useMemo(() => [...cargas.values()].map((c) => c.d).filter((d): d is Desglose => !!d), [cargas]);

  const pestanas: [Pestana, string][] = [
    ["sesiones", "ctxp.sesiones"],
    ["skills", "ctxp.catalogo"],
    ["previa", "ctxp.previa"],
  ];
  const tecla = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = pestanas.findIndex(([k]) => k === pestana);
    const sig: Pestana = pestanas[(i + (e.key === "ArrowRight" ? 1 : pestanas.length - 1)) % pestanas.length][0];
    setPestana(sig);
    (e.currentTarget.parentElement?.querySelector(`[data-pestana="${sig}"]`) as HTMLElement | null)?.focus();
  };
  const alternar = (id: string) =>
    setAbiertos((a) => {
      const n = new Set(a);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <Acc.Provider value={acciones}>
      <aside className="cs cp" aria-label={t("ctxp.titulo")}>
        <header className="cp-cab">
          <button type="button" className="lado" aria-label={angosto ? t("comun.aLista") : t("ctxp.ocultar")} data-tip={angosto ? t("comun.aLista") : t("ctxp.ocultar")} onClick={alCerrar}>
            {angosto ? <ArrowLeft size={18} strokeWidth={1.8} /> : <PanelRightClose size={16} strokeWidth={1.8} />}
          </button>
          <b>{t("ctxp.titulo")}</b>
          <button type="button" className="cp-ico" aria-label={t("ctxp.actualizar")} data-tip={t("ctxp.actualizar")} onClick={refrescar}>
            <RefreshCw size={14} strokeWidth={1.8} />
          </button>
        </header>
        <div className="cp-aviso">
          <p>{puede ? t("ctxp.aviso") : t("ctxp.soloPc")}</p>
          <p className="cp-vivo" role={aviso && !aviso.ok ? "alert" : "status"} data-error={aviso && !aviso.ok ? "" : undefined}>
            {aviso?.texto}
          </p>
        </div>
        <div className="cp-pestanas" role="tablist" aria-label={t("ctxp.pestanas")}>
          {pestanas.map(([k, etq]) => (
            <button key={k} type="button" role="tab" id={`cp-tab-${k}`} data-pestana={k} aria-selected={pestana === k} aria-controls={`cp-pan-${k}`} tabIndex={pestana === k ? 0 : -1} onClick={() => setPestana(k)} onKeyDown={tecla}>
              {t(etq as "ctxp.sesiones")}
            </button>
          ))}
        </div>
        <div className="cp-cuerpo-panel" role="tabpanel" id={`cp-pan-${pestana}`} aria-labelledby={`cp-tab-${pestana}`}>
          {pestana === "sesiones" ? (
            !lider ? (
              <p className="cp-nada">{t("ctxp.sinLider")}</p>
            ) : (
              <>
                <section className="cp-sesion" aria-label={t("ctxp.lider")}>
                  <h3 className="cp-h">
                    <span>{t("ctxp.lider")}</span>
                    <b>{lider.nombre || t("lider.sesionJefe")}</b>
                    {lider.modelo ? <small>{nombreModelo(modeloDe(lider.modelo) ?? lider.modelo)}</small> : null}
                  </h3>
                  {deLider?.d ? <Detalle key={lider.id} d={deLider.d} uid={`l-${lider.id}`} lider={lider} alRefrescar={refrescar} inicial={MODO.captura === "contexto-panel-cat" ? "skills" : null} /> : <Cargando carga={deLider} alReintentar={refrescar} />}
                </section>
                <section className="cp-sesion" aria-label={t("ctxp.workers", { n: workers.length })}>
                  <h3 className="cp-h">
                    <span>{t("ctxp.workers", { n: workers.length })}</span>
                  </h3>
                  {workers.length === 0 ? (
                    <p className="cp-nada">{t("ctxp.sinWorkers")}</p>
                  ) : (
                    <ul className="cp-ws">
                      {topeWorkers.map((h) => (
                        <FilaWorker
                          key={h.id}
                          h={h}
                          carga={cargas.get(h.id)}
                          abierto={abiertos.has(h.id)}
                          alAlternar={() => alternar(h.id)}
                          alAbrir={() => alAbrirHilo(h.id)}
                          alReintentar={refrescar}
                          alRefrescar={refrescar}
                          inicial={MODO.captura === "contexto-panel-cat" ? "memoria" : null}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )
          ) : pestana === "previa" ? (
            <VistaPreviaTab refresco={refresco} />
          ) : (
            <CatalogoSkills cat={cat} error={catError} alReintentar={() => setIntento((n) => n + 1)} desgloses={todos} />
          )}
        </div>
      </aside>
    </Acc.Provider>
  );
});
