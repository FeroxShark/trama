// El tablero nuevo: al abrir, una lista de proyectos con lo que cada uno espera
// del usuario (preguntas y pruebas de la columna `espera-dueno`); adentro de uno, sus preguntas con las opciones
// como botones y sus pruebas con "anda" / "no anda"; abajo, fijo, "Mandar N respuestas": guarda cada una en
// su item (`tablero responder`) y deja el mensaje armado en la caja de un líder del proyecto, sin enviarlo.
// Sólo se manda lo que el usuario TOCÓ (la opción sugerida no cuenta hasta que la marca). Lo mandado queda en
// "Mandadas" del proyecto hasta que el líder cierra el item. El kanban de hoy es la pestaña "Todo" (`todo`).
// Reusa las opciones del chat (`.pq-op`, `.pq-otro`, src/hilo/Preguntas.tsx) y las pestañas del kanban (`.tb-vistas`).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronRight, CircleHelp, Copy, FlaskConical, Inbox, Send, X } from "lucide-react";
import { armarAviso, candidatos, elegirAviso, type LiderAviso } from "../datos/avisar";
import { fuenteTablero } from "../datos/fuenteTablero";
import { agrupar, destinoDe } from "../datos/iniciar";
import {
  OTRA,
  armarMensaje,
  armarProyectos,
  cuenta,
  ordenar,
  preguntaContestada,
  tocadas,
  type Pend,
  type ProyectoPend,
  type RespPregunta,
  type RespPrueba,
  type Respuestas,
} from "../datos/pendientes";
import { tono, type ItemId, type Tablero } from "../datos/tablero";
import { cargarTocado, podarTocado, soltarTocado, tocarPregunta, tocarPrueba, useTocado } from "../datos/tocado";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Selector, type Opcion } from "../hilo/Selector";
import { MODO } from "../modo";
import { useNombreProyecto } from "../datos/proyectos";
import type { PropsTablero } from "./Tablero";
import "./pendientes.css";
import "./tablero-vista.css";

type Props = Pick<PropsTablero, "carpetas" | "lideres" | "alRedactar" | "avisar"> & {
  /** El kanban de hoy, entero: la pestaña "Todo". */
  todo: ReactNode;
};

const COPIADO_MS = 1200;

const hace = (h: number) => (h < 48 ? t("pd.haceH", { n: Math.max(1, Math.round(h)) }) : t("pd.haceD", { n: Math.round(h / 24) }));
const preguntas = (n: number) => t(n === 1 ? "pd.preg1" : "pd.pregN", { n });
const pruebas = (n: number) => t(n === 1 ? "pd.prueba1" : "pd.pruebaN", { n });
const mandadas = (n: number) => t(n === 1 ? "pd.mandada1" : "pd.mandadaN", { n });
const tonoDe = (nombre: string) => ({ "--tono": tono(nombre) }) as CSSProperties;
const nombreDe = (nombre: string) => nombre || t("pd.sinProyecto");

/** Las capturas del kanban de siempre (`tablero`, `tablero-detalle`, …) abren la pestaña "Todo". */
const PESTANA0 = MODO.variante === "todo" || (!!MODO.captura?.startsWith("tablero") && !MODO.captura.startsWith("tablero-nuevo")) ? "todo" : "esperan";

export function TableroNuevo({ todo, carpetas, lideres, alRedactar, avisar }: Props) {
  useIdioma();
  const [pestana, setPestana] = useState<"esperan" | "todo">(PESTANA0);
  const [abierto, setAbierto] = useState<string | null>(MODO.captura === "tablero-nuevo-proyecto" || MODO.captura === "tablero-nuevo-avisar" ? (MODO.variante === "sin" ? "baliza" : "atlas") : null);
  const [verParados, setVerParados] = useState(MODO.variante === "parados");
  const [datos, setDatos] = useState<Tablero | null>(() => fuenteTablero.guardado());
  const [errorLeer, setErrorLeer] = useState<string | null>(null);
  const [falla, setFalla] = useState<string | null>(null);
  const [mandando, setMandando] = useState(false);
  /** Lo que salió bien al avisar a un líder (una línea en el pie); se va con la próxima acción. */
  const [avisado, setAvisado] = useState<string | null>(null);
  const tocado = useTocado();
  const pedidas = useRef(0);

  const leer = () => {
    const n = ++pedidas.current;
    return fuenteTablero.leer().then(
      (nuevo) => {
        if (n !== pedidas.current) return;
        setDatos(nuevo);
        setErrorLeer(null);
      },
      (e: Error) => {
        if (n === pedidas.current) setErrorLeer(e.message);
      },
    );
  };
  useEffect(() => {
    cargarTocado();
    void leer();
    return fuenteTablero.alCambiar(() => void leer());
  }, []);

  const proyectos = useMemo(() => (datos ? armarProyectos(datos, Date.now()) : []), [datos]);
  // Lo que ya no espera (se cerró, se movió, ya se mandó) deja de figurar entre lo tocado.
  useEffect(() => {
    if (datos) podarTocado(proyectos);
  }, [datos, proyectos, tocado]);

  const { activos, parados } = ordenar(proyectos);
  const proyecto = proyectos.find((p) => p.nombre === abierto) ?? null;

  /** A dónde va el mensaje de un proyecto: su líder más reciente en la barra, o uno nuevo en su carpeta. */
  const destino = (p: ProyectoPend) => {
    const g = agrupar([(p.preguntas[0] ?? p.pruebas[0] ?? p.mandadas[0]).item], carpetas, lideres)[0];
    return { carpeta: g.carpeta, lider: destinoDe(g) };
  };
  /** Cómo se llama ese líder en el aviso del pie (uno sin título es la sesión del jefe, como en Iniciar); `null`: uno nuevo. */
  const nombreLider = (l: { nombre: string } | null) => (l ? l.nombre || t("lider.sesionJefe") : null);

  const mandar = async (p: ProyectoPend) => {
    const ts = tocadas(p, tocado);
    if (!ts.length || mandando) return;
    setMandando(true);
    setFalla(null);
    const hechas: typeof ts = [];
    let primero: string | null = null;
    let fallaron = 0;
    for (const x of ts) {
      try {
        await fuenteTablero.responder(x.pend.id, x.cli);
        hechas.push(x);
      } catch (e) {
        fallaron++;
        primero ??= (e as Error).message;
      }
    }
    soltarTocado(new Set(hechas.map((x) => x.pend.id)));
    if (fallaron) setFalla(t("pd.errorMandar", { n: fallaron, motivo: primero ?? "" }));
    if (hechas.length) {
      const d = destino(p);
      alRedactar({ carpeta: d.carpeta, lider: d.lider?.id ?? null, texto: armarMensaje(p.nombre, hechas) });
    }
    setMandando(false);
    void leer();
  };

  /**
   * "Responder y avisar": guarda la respuesta de ESTA pregunta (`tablero responder`, como Mandar) y además le escribe al líder
   * elegido un mensaje corto, por su cola (la misma de su caja). Sólo corre al tocar el botón; no abre la conversación.
   */
  const responderYAvisar = async (p: ProyectoPend, q: Pend, l: LiderAviso) => {
    const x = tocadas(p, tocado).find((y) => y.pend.id === q.id);
    if (!x || mandando) return;
    setMandando(true);
    setFalla(null);
    setAvisado(null);
    try {
      await fuenteTablero.responder(q.id, x.cli);
    } catch (e) {
      setFalla(t("pd.errorMandar", { n: 1, motivo: (e as Error).message }));
      setMandando(false);
      return;
    }
    soltarTocado(new Set([q.id]));
    const nombre = l.nombre || t("lider.sesionJefe");
    try {
      await avisar.alAvisar(l.id, armarAviso(p.nombre, x));
      setAvisado(t("pd.avisado", { nombre }));
    } catch (e) {
      setFalla(t("pd.errorAvisar", { nombre, motivo: (e as Error).message }));
    }
    setMandando(false);
    void leer();
  };

  /** Una mandada que el usuario quiere contestar de nuevo: se le borra la respuesta (`tablero responder --borrar`). */
  const volverAContestar = (id: ItemId) => {
    setFalla(null);
    fuenteTablero.responder(id, null).then(
      () => void leer(),
      (e: Error) => setFalla(e.message),
    );
  };

  return (
    <div className="pd" data-todo={pestana === "todo" ? "" : undefined}>
      <div className="pd-barra">
        <div className="tb-vistas" role="tablist">
          {(["esperan", "todo"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={pestana === v} onClick={() => setPestana(v)}>
              {t(v === "esperan" ? "pd.tabEsperan" : "pd.tabTodo")}
            </button>
          ))}
        </div>
      </div>
      {pestana === "todo" ? (
        <div className="pd-todo">{todo}</div>
      ) : !datos ? (
        <p className={errorLeer ? "pn-aviso pn-error" : "pn-aviso"}>{errorLeer ?? t("tablero.cargando")}</p>
      ) : proyecto ? (
        <Proyecto
          p={proyecto}
          r={tocado}
          liderNombre={nombreLider(destino(proyecto).lider)}
          falla={falla}
          avisado={avisado}
          mandando={mandando}
          cands={(q) => candidatos(q.item, carpetas, avisar.lideres, avisar.jefeDe)}
          alAvisar={(q, l) => void responderYAvisar(proyecto, q, l)}
          alVolver={() => {
            setAbierto(null);
            setFalla(null);
            setAvisado(null);
          }}
          alMandar={() => void mandar(proyecto)}
          alVolverAContestar={volverAContestar}
        />
      ) : (
        <div className="pd-lista-zona">
          {errorLeer ? <p className="pn-aviso pn-error" role="alert">{errorLeer}</p> : null}
          {datos.caidas.length ? <p className="pn-aviso">{t("tablero.maquinaCaida", { maquina: datos.caidas.join(", ") })}</p> : null}
          <p className="pd-intro">{t("pd.intro")}</p>
          {activos.length ? (
            <ul className="pd-lista">
              {activos.map((p) => (
                <Fila key={p.nombre} p={p} alAbrir={() => setAbierto(p.nombre)} />
              ))}
            </ul>
          ) : (
            <div className="pd-nada">
              <Inbox size={20} strokeWidth={1.6} aria-hidden="true" />
              <b>{t("pd.nada")}</b>
              <span>{t("pd.nadaGuia")}</span>
            </div>
          )}
          {parados.length ? (
            <>
              <button type="button" className="pd-parados" aria-expanded={verParados} onClick={() => setVerParados((v) => !v)}>
                <ChevronRight size={12} strokeWidth={2} />
                {t(parados.length === 1 ? "pd.parados1" : "pd.paradosN", { n: parados.length })}
              </button>
              {verParados ? (
                <ul className="pd-lista" data-parados="">
                  {parados.map((p) => (
                    <Fila key={p.nombre} p={p} alAbrir={() => setAbierto(p.nombre)} />
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Un proyecto de la lista: cuántas preguntas y pruebas lo esperan y hace cuánto se movió. */
function Fila({ p, alAbrir }: { p: ProyectoPend; alAbrir: () => void }) {
  const nom = useNombreProyecto();
  return (
    <li>
      <button type="button" className="pd-fila" onClick={alAbrir}>
        <span className="pd-punto" style={tonoDe(p.nombre)} />
        <span className="pd-nombre">{nombreDe(nom(p.nombre))}</span>
        <span className="pd-hace" data-tip={t("pd.ultima")}>{hace(p.hace)}</span>
        <span className="pd-nums">
          {p.preguntas.length ? (
            <span className="pd-num" data-tipo="pregunta">
              <CircleHelp size={12} strokeWidth={2} aria-hidden="true" />
              {preguntas(p.preguntas.length)}
            </span>
          ) : null}
          {p.pruebas.length ? (
            <span className="pd-num" data-tipo="prueba">
              <FlaskConical size={12} strokeWidth={2} aria-hidden="true" />
              {pruebas(p.pruebas.length)}
            </span>
          ) : null}
          {p.mandadas.length ? (
            <span className="pd-num" data-mandadas="">
              <Send size={12} strokeWidth={2} aria-hidden="true" />
              {mandadas(p.mandadas.length)}
            </span>
          ) : null}
        </span>
        <span className="pd-abrir">
          {t("pd.abrir")}
          <ChevronRight className="pd-ir" size={14} strokeWidth={2} aria-hidden="true" />
        </span>
      </button>
    </li>
  );
}

function Proyecto({
  p,
  r,
  liderNombre,
  falla,
  avisado,
  mandando,
  cands,
  alAvisar,
  alVolver,
  alMandar,
  alVolverAContestar,
}: {
  p: ProyectoPend;
  r: Respuestas;
  /** El líder cuya caja va a recibir el mensaje; `null`: uno nuevo. */
  liderNombre: string | null;
  falla: string | null;
  /** Lo que salió bien al avisar a un líder, en el pie. */
  avisado: string | null;
  mandando: boolean;
  /** A qué líderes vivos se les puede avisar de la respuesta a esa pregunta (el primero es el que originó la pregunta, o el más reciente). */
  cands: (q: Pend) => LiderAviso[];
  alAvisar: (q: Pend, l: LiderAviso) => void;
  alVolver: () => void;
  alMandar: () => void;
  alVolverAContestar: (id: ItemId) => void;
}) {
  const c = cuenta(p, r);
  const nom = useNombreProyecto();
  const [verMandadas, setVerMandadas] = useState(MODO.variante === "mandadas");
  // Para las capturas (`HILOS_VARIANTE=abajo`): la lista abierta hasta el final, donde están las pruebas.
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if ((MODO.variante === "abajo" || MODO.variante === "mandadas") && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, []);
  return (
    <section className="pd-proy">
      <header className="pd-cab">
        <button type="button" className="btn2 pd-volver" onClick={alVolver}>
          <ArrowLeft size={13} strokeWidth={2} />
          {t("pd.volver")}
        </button>
        <span className="pd-punto" style={tonoDe(p.nombre)} />
        <h2 className="pd-h">{nombreDe(nom(p.nombre))}</h2>
        <span className="pd-hace" data-tip={t("pd.ultima")}>{hace(p.hace)}</span>
      </header>
      <div className="pd-scroll" ref={scroll}>
        {p.preguntas.length ? (
          <>
            <h3 className="pd-sec">{t("pd.preguntas")}</h3>
            {p.preguntas.map((q) => (
              <Pregunta key={q.id} q={q} x={r.q[q.id] ?? { op: null, otra: "" }} cands={cands(q)} ocupado={mandando} alAvisar={(l) => alAvisar(q, l)} />
            ))}
          </>
        ) : null}
        {p.pruebas.length ? (
          <>
            <h3 className="pd-sec">{t("pd.pruebas")}</h3>
            {p.pruebas.map((u) => (
              <Prueba key={u.id} u={u} x={r.p[u.id] ?? { res: null, nota: "" }} />
            ))}
          </>
        ) : null}
        {p.mandadas.length ? (
          <>
            <button type="button" className="pd-parados pd-mand-t" aria-expanded={verMandadas} onClick={() => setVerMandadas((v) => !v)}>
              <ChevronRight size={12} strokeWidth={2} />
              {t("pd.mandadas", { n: p.mandadas.length })}
            </button>
            {verMandadas
              ? p.mandadas.map((m) => (
                  <article key={m.id} className="pd-card" data-mandada="">
                    <div className="pd-card-t">
                      <h4 className="pd-tit">{m.titulo}</h4>
                      <button type="button" className="pd-dejar" onClick={() => alVolverAContestar(m.id)}>
                        {t("pd.volverAContestar")}
                      </button>
                    </div>
                    <p className="pd-ctx">{t("pd.dijiste", { dice: dijo(m) })}</p>
                  </article>
                ))
              : null}
          </>
        ) : null}
      </div>
      <footer className="pd-pie">
        <div className="pd-pie-t">
          <span className="pd-pie-n">{t("pd.pie", { q: c.preguntas, tq: p.preguntas.length, p: c.pruebas, tp: p.pruebas.length })}</span>
          {falla ? (
            <span className="pd-pie-a pd-pie-error" role="alert">
              {falla}
            </span>
          ) : (
            <span className="pd-pie-a" role={avisado ? "status" : undefined}>
              {avisado ?? (liderNombre ? t("pd.pieAvisoLider", { nombre: liderNombre }) : t("pd.pieAvisoNuevo"))}
            </span>
          )}
        </div>
        <button type="button" className="btn2 pd-mandar" data-primario="" disabled={c.total === 0 || mandando} onClick={alMandar}>
          {c.total === 0 ? t("pd.mandar0") : t(c.total === 1 ? "pd.mandar1" : "pd.mandarN", { n: c.total })}
        </button>
      </footer>
    </section>
  );
}

/** Lo que el usuario había contestado, en una frase. */
function dijo(m: Pend): string {
  const r = m.respuesta;
  if (!r) return "";
  if (m.tipo === "prueba") return [r.anda === false ? t("pd.noAnda") : t("pd.anda"), r.texto].filter(Boolean).join(" · ");
  return r.opcionTexto || r.texto || r.opcion || "";
}

function Pregunta({ q, x, cands, ocupado, alAvisar }: { q: Pend; x: RespPregunta; cands: LiderAviso[]; ocupado: boolean; alAvisar: (l: LiderAviso) => void }) {
  const ok = preguntaContestada(x);
  const [elegido, setElegido] = useState<string>();
  const lider = elegirAviso(cands, elegido);
  return (
    <article className="pd-card" data-hecha={ok ? "" : undefined}>
      <div className="pd-card-t">
        <h4 className="pd-tit">{q.titulo}</h4>
        {ok ? (
          <button type="button" className="pd-dejar" onClick={() => tocarPregunta(q.id, { op: null, otra: "" })}>
            {t("pd.dejar")}
          </button>
        ) : (
          <span className="pd-sin">{t("pd.sinContestar")}</span>
        )}
      </div>
      {q.contexto ? <p className="pd-ctx">{q.contexto}</p> : null}
      {q.opciones.length ? (
        <div className="pd-ops" role="radiogroup" aria-label={q.titulo}>
          {q.opciones.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={x.op === o.id} className="pq-op" onClick={() => tocarPregunta(q.id, { op: o.id, otra: "" })}>
              <span className="pq-marca" />
              <span className="pq-txt">
                <span className="pq-l">{o.texto}</span>
              </span>
              {q.porDefecto === o.id ? <span className="pd-def">{t("pd.porDefecto")}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <input
        className="pq-otro pd-otra"
        type="text"
        value={x.otra}
        data-activa={x.op === OTRA ? "" : undefined}
        placeholder={q.opciones.length ? t("pd.otraPh") : t("pd.respondePh")}
        aria-label={q.opciones.length ? t("pd.otraPh") : t("pd.respondePh")}
        onChange={(e) => tocarPregunta(q.id, { op: e.target.value.trim() ? OTRA : null, otra: e.target.value })}
      />
      {ok && lider ? (
        <div className="pd-avisa">
          {cands.length > 1 ? (
            <div className="pn-abajo tb-filtro pd-avisa-d">
              <Selector
                etiqueta={t("pd.avisarDe")}
                opciones={cands.map((l): Opcion => ({ id: l.id, nombre: l.nombre || t("lider.sesionJefe"), desc: [l.origen === "terminal" ? t("pd.avisarTerminal") : "", l.ocupado ? t("tablero.ini.ocupado") : ""].filter(Boolean).join(" · ") }))}
                valor={lider.id}
                alElegir={setElegido}
                disabled={ocupado}
                abierto={MODO.captura === "tablero-nuevo-avisar" && MODO.variante === "elegir" && q.id === 9001}
              />
            </div>
          ) : null}
          <button type="button" className="btn2 pd-avisar" disabled={ocupado} data-tip={t("pd.avisarTip", { nombre: lider.nombre || t("lider.sesionJefe") })} onClick={() => alAvisar(lider)}>
            <Send size={13} strokeWidth={2} />
            {cands.length > 1 ? t("pd.avisarVarios") : t("pd.avisar", { nombre: lider.nombre || t("lider.sesionJefe") })}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function Prueba({ u, x }: { u: Pend; x: RespPrueba }) {
  return (
    <article className="pd-card" data-hecha={x.res ? "" : undefined} data-res={x.res ?? undefined}>
      <h4 className="pd-tit">{u.titulo}</h4>
      {u.que ? (
        <div className="pd-que">
          <span className="pd-que-t">{t("pd.queProbar")}</span>
          <Comando texto={u.que} />
        </div>
      ) : null}
      <div className="pd-res">
        <button type="button" aria-pressed={x.res === "anda"} data-res="anda" onClick={() => tocarPrueba(u.id, { ...x, res: x.res === "anda" ? null : "anda" })}>
          <Check size={14} strokeWidth={2} />
          {t("pd.anda")}
        </button>
        <button type="button" aria-pressed={x.res === "no-anda"} data-res="no-anda" onClick={() => tocarPrueba(u.id, { ...x, res: x.res === "no-anda" ? null : "no-anda" })}>
          <X size={14} strokeWidth={2} />
          {t("pd.noAnda")}
        </button>
      </div>
      {x.res ? (
        <input
          className="pq-otro pd-otra"
          type="text"
          value={x.nota}
          placeholder={t("pd.notaPh")}
          aria-label={t("pd.notaPh")}
          onChange={(e) => tocarPrueba(u.id, { ...x, nota: e.target.value })}
        />
      ) : null}
    </article>
  );
}

/** El comando o nombre exacto de una prueba, con su botón de copiar. */
function Comando({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  const etq = copiado ? t("tablero.copiado") : t("tablero.copiar");
  return (
    <span className="pd-cmd">
      <code>{texto}</code>
      <button
        type="button"
        className="tb-copiar"
        data-copiado={copiado ? "" : undefined}
        aria-label={etq}
        data-tip={etq}
        onClick={() => {
          void navigator.clipboard?.writeText(texto).then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), COPIADO_MS);
          });
        }}
      >
        {copiado ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={2} />}
      </button>
    </span>
  );
}
