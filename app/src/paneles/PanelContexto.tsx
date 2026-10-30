// El panel derecho de contexto: del líder que se está mirando y de sus workers, en qué se va la ventana de contexto y qué se puede apagar.
// Cada uno tiene una barra apilada (usado / ventana, partido por categoría, con palabra y número), un mapa de bloques con lo más pesado y la
// lista por categoría; tocar una categoría o un bloque abre sus ítems (tokens, cuántas veces se usó, "nunca usada" destacada) con su
// interruptor. Apagar vale para TODO Trama (`apagados:fijar`): se aplica a workers nuevos y al líder desde el próximo mensaje. La otra pestaña
// es el catálogo de skills (buscar, filtrar, ver tokens, prender y apagar). Los datos: src/datos/contexto.ts; la cuenta y el mapa: contexto-vista.ts.
// En el celular ocupa la pantalla y sólo se mira (apagar es de la PC).
import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleDashed, Lock, PanelRightClose, RefreshCw, Search, X } from "lucide-react";
import type { Hilo, Lider } from "../datos/contrato";
import type { Categoria, Desglose } from "../../electron/contexto-desglose";
import type { SkillCatalogo } from "../../electron/skills-catalogo";
import type { Catalogo, VistaApagados } from "../../electron/contexto-panel";
import { fuenteContexto, type Quien } from "../datos/contexto";
import { tareaDe, tipoDe } from "../barra/piezas";
import { modeloDe, nombreModelo } from "../hilo/opciones";
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
  pluginDeSkill,
  pluginsDe,
  porcentaje,
  sabeUsos,
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
const ALTO_MAPA = 46;
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
};
const Acc = createContext<Acciones>({ apagados: null, protegidas: [], puede: false, pendientes: new Set(), fijar: () => {} });

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
      className="cx-sw"
      aria-checked={!apagado}
      aria-label={nombre}
      aria-busy={ocupado || undefined}
      disabled={!!sin || ocupado}
      data-tip={tip}
      onClick={() => x && fijar(x, !apagado)}
    >
      <span className="cx-sw-p">{protegida ? <Lock size={10} strokeWidth={2.4} /> : apagado ? <X size={10} strokeWidth={2.6} /> : <Check size={10} strokeWidth={2.6} />}</span>
    </button>
  );
}

/** La barra apilada: un tramo por categoría, tan ancho como lo que ocupa de la ventana; el hueco es lo libre. */
function Barra({ cats, d, fina }: { cats: FilaCat[]; d: Desglose; fina?: boolean }) {
  const suma = cats.reduce((n, c) => n + c.tokens, 0);
  const libre = d.ventana ? Math.max(0, d.ventana - suma) : 0;
  const lista = cats.map((c) => `${nombreCat(c.id)} ${miles(c.tokens)}`).join(", ");
  return (
    <div className="cx-barra" data-fina={fina ? "" : undefined} role="img" aria-label={t("ctxp.barra", { lista: lista || "—" })}>
      {cats.map((c) => (
        <i key={c.id} data-cat={c.id} style={{ flexGrow: c.tokens }} />
      ))}
      {libre > 0 ? <i data-cat="libre" style={{ flexGrow: libre }} /> : null}
    </div>
  );
}

/** El mapa de bloques: lo más pesado de un vistazo. Cada bloque dice su nombre y lleva a su detalle; tocarlo abre la categoría. */
function Mapa({ d, alElegir }: { d: Desglose; alElegir: (cat: Categoria, clave: string | null) => void }) {
  const total = d.ventana ?? d.usado ?? 1;
  const colocados = useMemo(() => treemap(bloques(d), 100, ALTO_MAPA), [d]);
  if (!colocados.length) return null;
  return (
    <div className="cx-mapa" role="group" aria-label={t("ctxp.mapa")}>
      {colocados.map((b) => {
        const nombre = b.resto ? "" : b.nombre === "…" ? t("ctxp.mapaCat", { cat: nombreCat(b.cat) }) : b.nombre || nombreCat(b.cat);
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
            <div key={b.id} className="cx-bq" data-resto="" style={caja} role="img" aria-label={t("ctxp.mapaResto", { tokens: miles(b.tokens) })} data-tip={t("ctxp.mapaResto", { tokens: miles(b.tokens) })} />
          );
        const dice = t("ctxp.mapaBloque", { nombre, cat: nombreCat(b.cat), tokens: miles(b.tokens), pct: porcentaje(b.tokens, total) });
        return (
          <button key={b.id} type="button" className="cx-bq" data-cat={b.cat} style={caja} aria-label={dice} data-tip={dice} onClick={() => alElegir(b.cat, b.clave)}>
            {txt}
          </button>
        );
      })}
    </div>
  );
}

/** Cuántas veces se usó (o que nunca): la palabra va siempre, el ícono acompaña a "nunca usada". */
function Uso({ it }: { it: Item }) {
  if (it.usos === null) return null;
  if (it.nunca)
    return (
      <span className="cx-uso" data-nunca="">
        <CircleDashed size={11} strokeWidth={2.2} aria-hidden />
        {t("ctxp.usos0")}
      </span>
    );
  return <span className="cx-uso">{it.usos === 0 ? t("ctxp.usos0") : it.usos === 1 ? t("ctxp.usos1") : t("ctxp.usosN", { n: it.usos })}</span>;
}

function FilaItem({ it, uid, foco, estimado }: { it: Item; uid: string; foco: boolean; estimado: boolean }) {
  const { apagados } = useContext(Acc);
  const [hijos, setHijos] = useState(false);
  const apagado = it.apaga && apagados ? estaApagado(apagados, it.apaga) : false;
  const idHijos = useId();
  return (
    <li id={`${uid}-${it.clave}`} className="cx-it" data-apagado={apagado ? "" : undefined} data-foco={foco ? "" : undefined}>
      <div className="cx-it-nom">
        <b>{it.nombre}</b>
        {it.detalle ? <small title={it.detalle}>{it.detalle}</small> : null}
      </div>
      <span className="cx-num" data-tip={estimado ? t("ctxp.estimado") : undefined}>
        {it.tokens === null ? t("ctxp.sinTokens") : `${estimado ? "≈" : ""}${miles(it.tokens)}`}
      </span>
      <Interruptor x={it.apaga} nombre={it.nombre} protegida={it.protegida} />
      <div className="cx-it-det">
        <Uso it={it} />
        {it.diferida ? <span className="cx-etq">{t("ctxp.diferida")}</span> : null}
        {it.protegida ? (
          <span className="cx-etq">
            <Lock size={10} strokeWidth={2.2} aria-hidden />
            {t("ctxp.protegida")}
          </span>
        ) : null}
        {apagado ? (
          <span className="cx-etq" data-apagada="">
            <X size={10} strokeWidth={2.6} aria-hidden />
            {t("ctxp.apagada")}
          </span>
        ) : null}
        {it.hijos.length ? (
          <button type="button" className="cx-link" aria-expanded={hijos} aria-controls={idHijos} onClick={() => setHijos(!hijos)}>
            {hijos ? t("ctxp.ocultarHerramientas") : t("ctxp.verHerramientas", { n: it.hijos.length })}
          </button>
        ) : null}
      </div>
      {hijos ? (
        <ul id={idHijos} className="cx-hijos" aria-label={t("ctxp.herramientasDe", { srv: it.nombre })}>
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

/** El desglose entero de uno: resumen, barra, mapa y las categorías con sus ítems. */
function Detalle({ d, uid, inicial }: { d: Desglose; uid: string; inicial?: Categoria | null }) {
  const { protegidas } = useContext(Acc);
  const [abierta, setAbierta] = useState<Categoria | null>(inicial ?? null);
  const [foco, setFoco] = useState<string | null>(null);
  const cats = useMemo(() => categorias(d), [d]);
  const frac = fraccionUsada(d);
  const total = d.ventana ?? d.usado ?? 0;
  const elegir = useCallback((c: Categoria, clave: string | null) => {
    setAbierta(c);
    setFoco(clave);
  }, []);
  // Al venir de un bloque, el ítem se ve sin tener que buscarlo en la lista.
  useEffect(() => {
    if (foco) document.getElementById(`${uid}-${foco}`)?.scrollIntoView({ block: "nearest" });
  }, [foco, abierta, uid]);
  const vacio = motivoDe(d);
  if (vacio && !cats.length) return <p className="cx-nada">{vacio}</p>;
  return (
    <div className="cx-det">
      <p className="cx-uso-total">
        {d.usado !== null && d.ventana ? (
          <>
            <b className="cx-num">
              {d.estimado ? <span data-tip={t("ctxp.estimado")}>≈</span> : null}
              {t("ctxp.usadoDe", { usado: miles(d.usado), ventana: miles(d.ventana) })}
            </b>
            {frac !== null ? <span>{t("ctxp.pctVentana", { pct: Math.round(frac * 100) })}</span> : null}
            {d.ventanaEstimada ? <span data-tip={t("ctxp.ventanaSupuesta")}>*</span> : null}
          </>
        ) : d.usado !== null ? (
          <b className="cx-num">{t("ctxp.usado", { usado: miles(d.usado) })}</b>
        ) : null}
      </p>
      <Barra cats={cats} d={d} />
      <Mapa d={d} alElegir={elegir} />
      <ul className="cx-cats">
        {cats.map((c) => {
          const items = CON_ITEMS.has(c.id) ? itemsDe(d, c.id, protegidas) : [];
          const abre = abierta === c.id;
          const idCuerpo = `${uid}-cat-${c.id}`;
          return (
            <li key={c.id} className="cx-cat" data-cat={c.id} data-abierta={abre ? "" : undefined}>
              <h4>
                <button type="button" aria-expanded={abre} aria-controls={idCuerpo} data-tip={t("ctxp.verDetalle", { cat: nombreCat(c.id) })} onClick={() => setAbierta(abre ? null : c.id)}>
                  <i className="cx-color" aria-hidden />
                  <span className="cx-cat-n">{nombreCat(c.id)}</span>
                  <span className="cx-num" data-tip={c.estimado ? t("ctxp.estimado") : undefined}>
                    {c.estimado ? "≈" : ""}
                    {miles(c.tokens)}
                  </span>
                  <span className="cx-pct">{porcentaje(c.tokens, total)} %</span>
                  <ChevronRight size={14} strokeWidth={2} className="cx-chev" aria-hidden />
                </button>
              </h4>
              {abre ? (
                <div id={idCuerpo} className="cx-cuerpo">
                  {items.length ? (
                    <ul className="cx-items" aria-label={nombreCat(c.id)}>
                      {items.map((it) => (
                        <FilaItem key={it.clave} it={it} uid={`${uid}-${c.id}`} foco={foco === it.clave} estimado={c.estimado || d.estimado} />
                      ))}
                    </ul>
                  ) : (
                    <p className="cx-nada">{t(`ctxp.catDesc.${c.id}` as "ctxp.catDesc.sistema")}</p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {vacio ? <p className="cx-nada">{vacio}</p> : null}
    </div>
  );
}

// --- Líder y workers ------------------------------------------------------------------------------------------------------------------------

function Cargando({ carga, alReintentar }: { carga: Carga | undefined; alReintentar: () => void }) {
  if (!carga) return <p className="cx-nada">{t("ctxp.leyendo")}</p>;
  return (
    <div className="cx-error" role="alert">
      <p>{t("ctxp.error", { motivo: carga.error ?? "?" })}</p>
      <button type="button" className="btn2" onClick={alReintentar}>
        {t("ctxp.reintentar")}
      </button>
    </div>
  );
}

function FilaWorker({ h, carga, abierto, alAlternar, alAbrir, alReintentar, inicial }: { h: Hilo; carga: Carga | undefined; abierto: boolean; alAlternar: () => void; alAbrir: () => void; alReintentar: () => void; inicial?: Categoria | null }) {
  const id = useId();
  const d = carga?.d ?? null;
  const cats = useMemo(() => (d ? categorias(d) : []), [d]);
  const frac = d ? fraccionUsada(d) : null;
  const tipo = h.en_cola ? "cola" : (tipoDe(h, h.estado)?.tipo ?? "");
  const estado = h.en_cola ? t("ctxp.enCola") : (tipoDe(h, h.estado)?.texto ?? h.estado);
  return (
    <li className="cx-w" data-abierto={abierto ? "" : undefined}>
      <div className="cx-w-cab">
        <button type="button" className="cx-w-btn" aria-expanded={abierto} aria-controls={id} onClick={alAlternar}>
          <ChevronRight size={14} strokeWidth={2} className="cx-chev" aria-hidden />
          <span className="cx-w-nom">
            <b>{tareaDe(h)}</b>
            <span className="cx-w-est" data-tipo={tipo}>
              <i aria-hidden />
              {estado}
            </span>
          </span>
          {d && d.fuente !== "sin-desglose" && d.ventana ? (
            <span className="cx-w-mini">
              <span className="cx-pct" data-tip={d.estimado ? t("ctxp.estimado") : undefined}>
                {d.estimado ? "≈" : ""}
                {frac !== null ? Math.round(frac * 100) : 0} %
              </span>
              <Barra cats={cats} d={d} fina />
            </span>
          ) : (
            <span className="cx-w-mini">
              <span className="cx-pct">{carga ? t("comun.sinDato") : "…"}</span>
            </span>
          )}
        </button>
        <button type="button" className="cx-ico" aria-label={t("ctxp.abrirHilo", { n: tareaDe(h) })} data-tip={t("ctxp.abrirHilo", { n: tareaDe(h) })} onClick={alAbrir}>
          <ArrowUpRight size={14} strokeWidth={1.8} />
        </button>
      </div>
      {abierto ? (
        <div id={id} className="cx-w-cuerpo">
          {d ? <Detalle d={d} uid={`w-${h.id}`} inicial={inicial} /> : <Cargando carga={carga} alReintentar={alReintentar} />}
        </div>
      ) : null}
    </li>
  );
}

// --- Catálogo de skills ---------------------------------------------------------------------------------------------------------------------

function FilaSkill({ s, nunca }: { s: SkillCatalogo; nunca: boolean }) {
  const { apagados } = useContext(Acc);
  const apagada = s.estado === "apagada" || (apagados ? estaApagado(apagados, { tipo: "skills", nombre: s.clave }) : false);
  const origen = s.origen === "plugin" || s.origen === "claudeai" ? pluginDeSkill(s) : s.origen === "proyecto" && s.de ? `${t("ctxp.origen.proyecto")}: ${s.de}` : t(`ctxp.origen.${s.origen}` as "ctxp.origen.usuario");
  const pluginOff = s.estado === "plugin-apagado";
  return (
    <li className="cx-it cx-sk" data-apagado={apagada || pluginOff ? "" : undefined}>
      <div className="cx-it-nom">
        <b>{s.clave}</b>
        <small>{origen}</small>
      </div>
      <span className="cx-num" data-tip={s.tokensEstimado ? t("ctxp.estimado") : undefined}>
        {s.tokensEstimado ? "≈" : ""}
        {miles(s.tokens)}
      </span>
      {pluginOff ? <span className="cx-sw-hueco" /> : <Interruptor x={{ tipo: "skills", nombre: s.clave }} nombre={s.clave} />}
      <p className="cx-sk-desc">{s.descripcion}</p>
      <div className="cx-it-det">
        {nunca && !apagada && !pluginOff ? (
          <span className="cx-uso" data-nunca="">
            <CircleDashed size={11} strokeWidth={2.2} aria-hidden />
            {t("ctxp.usos0")}
          </span>
        ) : null}
        {apagada ? (
          <span className="cx-etq" data-apagada="">
            <X size={10} strokeWidth={2.6} aria-hidden />
            {t("ctxp.apagada")}
          </span>
        ) : null}
        {pluginOff ? <span className="cx-etq">{t("ctxp.pluginApagado")}</span> : null}
      </div>
    </li>
  );
}

function CatalogoSkills({ sid, desgloses }: { sid: string | null; desgloses: Desglose[] }) {
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<FiltroSkills>(() => ({ q: MODO.captura === "contexto-panel-skills" && MODO.variante === "buscar" ? "nube" : "", solo: MODO.captura === "contexto-panel-skills" && MODO.variante !== "buscar" ? "nunca" : "todas", plugin: "" }));
  const [limite, setLimite] = useState(PAGINA_SKILLS);
  const [intento, setIntento] = useState(0);
  const { apagados } = useContext(Acc);
  const entrada = useId();
  useEffect(() => {
    let vivo = true;
    setError(null);
    fuenteContexto.catalogo(sid ?? undefined).then(
      (c) => vivo && setCat(c),
      (e) => vivo && setError(mensaje(e)),
    );
    return () => {
      vivo = false;
    };
  }, [sid, intento]);
  const sabe = desgloses.some(sabeUsos);
  const vistas = useMemo(() => usadas(desgloses), [desgloses]);
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
  if (error) return <Cargando carga={{ d: null, error }} alReintentar={() => setIntento(intento + 1)} />;
  if (!cat) return <p className="cx-nada">{t("ctxp.leyendo")}</p>;
  const filtros: [FiltroSkills["solo"], string][] = [
    ["todas", "ctxp.f.todas"],
    ["apagadas", "ctxp.f.apagadas"],
    ["nunca", "ctxp.f.nunca"],
  ];
  return (
    <div className="cx-cat-skills">
      <label className="cx-buscar" htmlFor={entrada}>
        <Search size={14} strokeWidth={1.8} aria-hidden />
        <input id={entrada} type="search" value={f.q} placeholder={t("ctxp.buscar")} aria-label={t("ctxp.buscarEtq")} spellCheck={false} autoComplete="off" onChange={(e) => setF({ ...f, q: e.target.value })} />
      </label>
      <div className="cx-filtros" role="group" aria-label={t("ctxp.filtros")}>
        {filtros.map(([k, etq]) => (
          <button key={k} type="button" className="cx-chip" aria-pressed={f.solo === k} onClick={() => setF({ ...f, solo: k })}>
            {t(etq as "ctxp.f.todas")}
          </button>
        ))}
        {plugins.length ? (
          <label className="cx-plugin">
            <span className="cx-sr">{t("ctxp.plugin")}</span>
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
      <p className="cx-cuenta" role="status">
        {t("ctxp.cuenta", { n: mostradas.length, total: lista.length })}
        <span>{t("ctxp.activasPesan", { n: activas, tokens: miles(pesan) })}</span>
      </p>
      {f.solo === "nunca" && !sabe ? <p className="cx-nada">{t("ctxp.nuncaSinDato")}</p> : null}
      {mostradas.length === 0 && !(f.solo === "nunca" && !sabe) ? <p className="cx-nada">{t("ctxp.sinResultados")}</p> : null}
      <ul className="cx-items">
        {mostradas.slice(0, limite).map((s) => (
          <FilaSkill key={s.id} s={s} nunca={sabe && !vistas.has(s.clave) && !vistas.has(s.nombre)} />
        ))}
      </ul>
      {mostradas.length > limite ? (
        <button type="button" className="btn2 cx-mas" onClick={() => setLimite(limite + PAGINA_SKILLS)}>
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

type Pestana = "sesiones" | "skills";

export const PanelContexto = memo(function PanelContexto({ lider, workers, alCerrar, alAbrirHilo }: Props) {
  useIdioma();
  const angosto = useAngosto();
  const [pestana, setPestana] = useState<Pestana>(MODO.captura === "contexto-panel-skills" ? "skills" : "sesiones");
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

  const acciones = useMemo<Acciones>(
    () => ({ apagados: apagados?.apagados ?? null, protegidas: apagados?.protegidas ?? ["Bash", "Read", "Edit", "Write"], puede, pendientes, fijar }),
    [apagados, puede, pendientes, fijar],
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
  ];
  const tecla = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const sig: Pestana = pestana === "sesiones" ? "skills" : "sesiones";
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
      <aside className="cs cx" aria-label={t("ctxp.titulo")}>
        <header className="cx-cab">
          <button type="button" className="lado" aria-label={angosto ? t("comun.aLista") : t("ctxp.ocultar")} data-tip={angosto ? t("comun.aLista") : t("ctxp.ocultar")} onClick={alCerrar}>
            {angosto ? <ArrowLeft size={18} strokeWidth={1.8} /> : <PanelRightClose size={16} strokeWidth={1.8} />}
          </button>
          <b>{t("ctxp.titulo")}</b>
          <button type="button" className="cx-ico" aria-label={t("ctxp.actualizar")} data-tip={t("ctxp.actualizar")} onClick={() => setRefresco((n) => n + 1)}>
            <RefreshCw size={14} strokeWidth={1.8} />
          </button>
        </header>
        <div className="cx-aviso">
          <p>{puede ? t("ctxp.aviso") : t("ctxp.soloPc")}</p>
          <p className="cx-vivo" role={aviso && !aviso.ok ? "alert" : "status"} data-error={aviso && !aviso.ok ? "" : undefined}>
            {aviso?.texto}
          </p>
        </div>
        <div className="cx-pestanas" role="tablist" aria-label={t("ctxp.pestanas")}>
          {pestanas.map(([k, etq]) => (
            <button key={k} type="button" role="tab" id={`cx-tab-${k}`} data-pestana={k} aria-selected={pestana === k} aria-controls={`cx-pan-${k}`} tabIndex={pestana === k ? 0 : -1} onClick={() => setPestana(k)} onKeyDown={tecla}>
              {t(etq as "ctxp.sesiones")}
            </button>
          ))}
        </div>
        <div className="cx-cuerpo-panel" role="tabpanel" id={`cx-pan-${pestana}`} aria-labelledby={`cx-tab-${pestana}`}>
          {pestana === "sesiones" ? (
            !lider ? (
              <p className="cx-nada">{t("ctxp.sinLider")}</p>
            ) : (
              <>
                <section className="cx-sesion" aria-label={t("ctxp.lider")}>
                  <h3 className="cx-h">
                    <span>{t("ctxp.lider")}</span>
                    <b>{lider.nombre || t("lider.sesionJefe")}</b>
                    {lider.modelo ? <small>{nombreModelo(modeloDe(lider.modelo) ?? lider.modelo)}</small> : null}
                  </h3>
                  {deLider?.d ? <Detalle key={lider.id} d={deLider.d} uid={`l-${lider.id}`} inicial={MODO.captura === "contexto-panel-cat" ? "skills" : null} /> : <Cargando carga={deLider} alReintentar={() => setRefresco((n) => n + 1)} />}
                </section>
                <section className="cx-sesion" aria-label={t("ctxp.workers", { n: workers.length })}>
                  <h3 className="cx-h">
                    <span>{t("ctxp.workers", { n: workers.length })}</span>
                  </h3>
                  {workers.length === 0 ? (
                    <p className="cx-nada">{t("ctxp.sinWorkers")}</p>
                  ) : (
                    <ul className="cx-ws">
                      {topeWorkers.map((h) => (
                        <FilaWorker
                          key={h.id}
                          h={h}
                          carga={cargas.get(h.id)}
                          abierto={abiertos.has(h.id)}
                          alAlternar={() => alternar(h.id)}
                          alAbrir={() => alAbrirHilo(h.id)}
                          alReintentar={() => setRefresco((n) => n + 1)}
                          inicial={MODO.captura === "contexto-panel-cat" ? "memoria" : null}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )
          ) : (
            <CatalogoSkills sid={lider?.id ?? null} desgloses={todos} />
          )}
        </div>
      </aside>
    </Acc.Provider>
  );
});
