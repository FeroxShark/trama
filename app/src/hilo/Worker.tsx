// La vista de un worker (al tocarlo en la barra): la caja con la última acción en palabras y la consigna, la tira de la corrida en
// tiempo real, los pasos como un hilo y, a la derecha, el detalle crudo del elegido. Los pasos los arma el main de su transcript
// (src/hilo/usePasos.ts); lo que se saca de ellos (frases, grupos, tramos, cambios, rutas) es de worker-datos.ts. A un worker no se le
// escribe: acá sólo se mira, y se lo para. Maqueta: maquetas/rediseno-0.4/worker-vista-b-*.png.
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ArrowRightLeft, Bot, Brain, Check, ChevronRight, Copy, FilePlus, FileText, GitCommitHorizontal, Info, LoaderCircle, MessageCircleQuestion, MessageSquare, Pencil, Search, Square, Terminal, Timer, TriangleAlert, Wrench, X, type LucideIcon } from "lucide-react";
import { comoSettle, type Estado, type Hilo } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import type { Detalle, Paso, TipoPaso, VistaPasos } from "../datos/pasos";
import { useAngosto } from "../angosto";
import { latir } from "../barra/latido";
import { AccionesWorker } from "../barra/Fila";
import type { Como, Salida as SalidaSettle } from "../barra/arbol";
import { Reloj } from "../barra/piezas";
import { copiar } from "../copiar";
import { locale, t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import type { Pintor } from "../reloj";
import { Boton } from "../ui/componentes";
import { esperaTexto, pintorDura } from "../tiempo";
import "./worker-logica.css";
import "./atencion.css";
import { Entero } from "./Entero";
import { archivoDeRuta, type AccionArchivo } from "../../electron/archivo-ruta";
import { Filas } from "./Diff";
import { EnlaceArchivo, EnlaceTexto, FotoArchivo } from "./VerArchivo";
import { defDe } from "./modelos";
import { MODELOS_WORKER, modeloDe } from "./opciones";
import { SeguirCon } from "./SeguirCon";
import { Compactando } from "./Posta";
import { Texto } from "./Texto";
import { useCompactando } from "./compactando";
import { partirDecision } from "./turnos";
import { useSeguir } from "./useSeguir";
import {
  baseTira,
  chipsDe,
  commitDe,
  comandoEsGrep,
  diffDe,
  durCorta,
  durGrupo,
  esCambio,
  extension,
  falla as fallo,
  filas,
  filasCambios,
  filasEscritas,
  filasLeidas,
  frasePaso,
  fraseGrupo,
  leyendaDe,
  marcaCorta,
  marcasRegla,
  nombreDeArchivo,
  partirGrep,
  pasoDeRegla,
  pensarConFila,
  relojDe,
  resumenDe,
  rutaEnCwd,
  rutaRelativa,
  testsDe,
  textoFinal,
  tonoDeLinea,
  tramos,
  trozosConRutas,
  visibles,
  type ClaseGrupo,
  type GrupoGrep,
  type Nudo,
  type Tramo,
} from "./worker-datos";

const ICONO: Record<TipoPaso, LucideIcon> = {
  pensar: Brain,
  leer: FileText,
  buscar: Search,
  editar: Pencil,
  escribir: FilePlus,
  correr: Terminal,
  delegar: Bot,
  texto: MessageSquare,
  otro: Wrench,
};

const compacto = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** La frase como parte de otra oración: en minúscula, salvo que la segunda letra diga que es una sigla o un nombre. */
const minuscula = (s: string) => (s.length > 1 && s[1] === s[1].toLocaleLowerCase() ? s[0].toLocaleLowerCase() + s.slice(1) : s);

/** El reloj grande: "0:38", contado desde `desde` (ms). */
const pintorReloj =
  (desde: number): Pintor =>
  (a) => ({ texto: relojDe(a * 1000 - desde), en: 1 - (a % 1) });

/** Lo que lleva un paso: "38 s", "4 m 11 s", "1 h 05 m". */
const pintorLleva =
  (desde: number): Pintor =>
  (a) => ({ texto: durCorta(a * 1000 - desde), en: a * 1000 - desde >= 3_600_000 ? 60 - (a % 60) : 1 - (a % 1) });

function Cursor() {
  useLayoutEffect(latir, []);
  return <span className="parpadea wk-cursor" aria-hidden="true" />;
}

// ---- La cabecera: la hora y el ⓘ con lo que no cambia una decisión ------------------------------------------------------

/** Lo que va a la derecha de las migas: cuánto lleva o cuánto tardó, y el ⓘ con `filas` (dato, valor, si va en mono). */
export function Extras({ inicio, dur, vive, filas: filasInfo }: { inicio: number; dur: number | null; vive: boolean; filas: [string, string, boolean?][] }) {
  const pintor = useMemo(() => pintorDura(inicio), [inicio]);
  return (
    <>
      <span className="wk-tiempo">{vive ? <Reloj pintor={pintor} /> : dur !== null ? durCorta(dur) : null}</span>
      <div className="wk-info">
        <button type="button" aria-label={t("wk.info")}>
          <Info size={16} strokeWidth={1.8} />
        </button>
        <div className="wk-pop" role="tooltip">
          <dl>
            {filasInfo.map(([k, v, mono]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className={mono ? "mono" : undefined}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </>
  );
}

/** Los tokens del ⓘ: el total y cuánto vino del caché. */
export const tokensInfo = (e: VistaPasos["encabezado"]) => `${compacto(e.total)}${e.cache !== null ? ` · ${Math.round(e.cache * 100)} %` : ""}`;

/** Lo que va a la derecha de las migas de un worker: cuánto lleva o cuánto tardó, y el ⓘ (modelo, turnos, tokens y rama). */
export function WorkerExtras({ h, vista, vive }: { h: Hilo; vista: VistaPasos; vive: boolean }) {
  useIdioma();
  const e = vista.encabezado;
  const dur = e.dur ?? (h.duracion_s !== null ? h.duracion_s * 1000 : null);
  const modelo = e.modelo ?? h.modelo;
  const filasInfo: [string, string, boolean?][] = [
    [t("wk.infoModelo"), `${defDe(modelo)?.nombre ?? modelo}${e.effort ?? h.effort ? ` ${e.effort ?? h.effort}` : ""}`],
    [t("wk.infoTurnos"), String(e.turnos)],
    [t("wk.infoTokens"), tokensInfo(e)],
    [t("wk.infoRama"), h.rama ?? t("comun.sinRama"), true],
  ];
  // Sólo si esperó un puesto o lugar: el texto va visible, no en el ⓘ.
  return (
    <>
      {h.espera_s ? <span className="wk-espera">{t("wk.esperoEn", { d: esperaTexto(h.espera_s) })}</span> : null}
      <Extras inicio={h.inicio} dur={dur} vive={vive} filas={filasInfo} />
    </>
  );
}

// ---- El panel: lo crudo del paso elegido ---------------------------------------------------------------------------------

const Nota = ({ c }: { c: { recortado: boolean; total: number } | null | undefined }) => (c?.recortado ? <div className="wk-nota">{t("wk.recortado", { n: c.total })}</div> : null);

const Mas = ({ mas, menos }: { mas?: number; menos?: number }) => (
  <span className="wk-cnt">
    {mas ? <span className="wk-mas">+{mas}</span> : null}
    {menos ? <span className="wk-menos">−{menos}</span> : null}
  </span>
);

/** Una línea de salida: se ajusta al ancho con sangría colgante (nunca barra horizontal) y sus rutas con línea se pueden abrir. */
const LineaSalida = memo(function LineaSalida({ linea, cwd }: { linea: string; cwd: string | null }) {
  const sangria = /^ */.exec(linea)![0].length;
  return (
    <div className="wk-l" data-tono={tonoDeLinea(linea) ?? undefined} style={{ "--s": sangria } as CSSProperties}>
      {trozosConRutas(linea).map((z, i) =>
        "ruta" in z ? (
          <EnlaceTexto key={i} ruta={rutaEnCwd(z.ruta, cwd) ?? z.ruta} linea={z.linea} className="wk-ruta" tip={z.linea !== null ? t("wk.abrirLinea", { ruta: z.ruta, n: z.linea }) : undefined}>
            {z.t}
          </EnlaceTexto>
        ) : (
          z.t
        ),
      )}
    </div>
  );
});

function Salida({ texto, cwd, vacio, abajo }: { texto: string | null | undefined; cwd: string | null; vacio: string; abajo?: ReactNode }) {
  const ls = useMemo(() => {
    if (!texto) return [];
    const x = texto.split("\n");
    if (x[x.length - 1] === "") x.pop();
    return x;
  }, [texto]);
  return (
    <div className="wk-term">
      {ls.length ? ls.map((l, i) => <LineaSalida key={i} linea={l} cwd={cwd} />) : vacio ? <div className="wk-l" data-tono="tenue">{vacio}</div> : null}
      {abajo}
    </div>
  );
}

/** Los resultados de un grep: por archivo, con la ruta y los números de línea que abren el archivo ahí. */
function ResultadoGrep({ grupos, cwd }: { grupos: GrupoGrep[]; cwd: string | null }) {
  return (
    <div className="wk-grep">
      {grupos.map((g, i) => {
        const ruta = rutaEnCwd(g.ruta, cwd) ?? g.ruta;
        return (
          <section key={`${g.ruta}:${i}`} className="wk-grep-g">
            <header>
              <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
              <EnlaceTexto ruta={ruta} className="wk-ruta" tip={t("wk.abrirArchivo", { ruta: g.ruta })}>
                {rutaRelativa(g.ruta, cwd)}
              </EnlaceTexto>
              <span className="wk-grep-n">{g.cuenta ?? (g.lineas.length || null)}</span>
            </header>
            {g.lineas.map((l, j) => (
              <div key={j} className="wk-grep-l">
                {l.n !== null ? (
                  <EnlaceTexto ruta={ruta} linea={l.n} className="wk-ruta wk-grep-num" tip={t("wk.abrirLinea", { ruta: g.ruta, n: l.n })}>
                    {l.n}
                  </EnlaceTexto>
                ) : (
                  <span className="wk-grep-num" />
                )}
                <span>{l.texto}</span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Copia lo crudo; lo dice con el ícono y el tooltip durante un rato. */
function Copiar({ texto }: { texto: string }) {
  const [listo, setListo] = useState(false);
  const dice = listo ? t("wk.copiado") : t("wk.copiarComando");
  return (
    <button
      type="button"
      className="wk-copiar"
      aria-label={dice}
      data-tip={dice}
      data-listo={listo ? "" : undefined}
      onClick={() =>
        void copiar(texto).then((ok) => {
          if (!ok) return;
          setListo(true);
          // espera-justificada: el aviso de «Copiado» se ve un rato y vuelve solo.
          window.setTimeout(() => setListo(false), 1400);
        })
      }
    >
      {listo ? <Check size={15} strokeWidth={2.2} /> : <Copy size={15} strokeWidth={1.8} />}
    </button>
  );
}

/** La línea cruda de un paso (lo único que muestra el comando entero) y lo que se copia. */
function crudoDe(p: Paso, cwd: string | null): { linea: ReactNode; copia: string } | null {
  const d: Detalle = p.detalle;
  const ruta = (verbo: string, r: string, accion: AccionArchivo) => {
    const a = archivoDeRuta(r, accion);
    return {
      linea: (
        <>
          <span className="wk-pr">{verbo} </span>
          <EnlaceTexto ruta={r} className="wk-ruta" tip={t("wk.abrirArchivo", { ruta: r })}>
            {rutaRelativa(r, cwd)}
          </EnlaceTexto>
          {a ? <EnlaceArchivo a={a} /> : null}
        </>
      ),
      copia: r,
    };
  };
  switch (d.clase) {
    case "correr":
      return {
        linea: (
          <>
            <span className="wk-pr">$ </span>
            <span className="wk-cmd">{d.comando.t}</span>
          </>
        ),
        copia: d.comando.t,
      };
    case "leer":
      return ruta("Read", d.ruta, "leer");
    case "editar":
      return ruta("Edit", d.ruta, "editar");
    case "escribir":
      return ruta("Write", d.ruta, "escribir");
    case "buscar": {
      const linea = `${d.herramienta} "${d.patron}"${d.ruta ? ` ${d.ruta}` : ""}`;
      return { linea: <span className="wk-cmd">{linea}</span>, copia: d.patron };
    }
    case "delegar":
      return { linea: <span className="wk-cmd">{`${d.agente}${d.modelo ? ` · ${defDe(d.modelo)?.nombre ?? d.modelo}` : ""}`}</span>, copia: d.prompt.t };
    case "otro":
      return p.titulo ? { linea: <span className="wk-cmd">{p.titulo}</span>, copia: p.titulo } : null;
    default:
      return null;
  }
}

/** El cuerpo de un paso: el diff, lo escrito, lo leído, los resultados o la salida. */
function cuerpoDe(p: Paso, cwd: string | null, vive: boolean, colgado: boolean, corte: number | null): ReactNode {
  const d: Detalle = p.detalle;
  switch (d.clase) {
    case "editar":
      return d.cambios.map((c, i) => <Filas key={i} filas={diffDe(c)} lang={extension(d.ruta)} />);
    case "escribir":
      return (
        <>
          <Filas filas={filasEscritas(d.contenido.t)} lang={extension(d.ruta)} />
          <Nota c={d.contenido} />
        </>
      );
    case "leer":
      return d.imagen ? (
        <div className="wk-ag">
          <p className="wk-vacio">{t("wk.sinSalida")}</p>
          {archivoDeRuta(d.ruta, "leer") ? <FotoArchivo a={archivoDeRuta(d.ruta, "leer")!} /> : null}
        </div>
      ) : (
        <>
          <Filas filas={filasLeidas(d.texto?.t ?? "", d.desde)} lang={extension(d.ruta)} />
          <Nota c={d.texto} />
        </>
      );
    case "buscar": {
      const grupos = d.herramienta === "Grep" || d.herramienta === "Glob" ? partirGrep(d.texto?.t ?? "") : null;
      return (
        <>
          {grupos ? <ResultadoGrep grupos={grupos} cwd={cwd} /> : <Salida texto={d.texto?.t} cwd={cwd} vacio={t("wk.sinSalida")} />}
          <Nota c={d.texto} />
        </>
      );
    }
    case "correr": {
      const corre = p.estado === "corriendo" && vive;
      const grupos = comandoEsGrep(d.comando.t) && d.salida?.t && !corre ? partirGrep(d.salida.t) : null;
      if (grupos)
        return (
          <>
            <ResultadoGrep grupos={grupos} cwd={cwd} />
            <Nota c={d.salida} />
          </>
        );
      const abajo = corre ? (
        <>
          {!d.salida?.t ? <div className="wk-l" data-tono="tenue">{t("wk.salidaLuego")}</div> : null}
          {colgado && corte !== null ? (
            <div className="wk-silencio">
              <Timer size={15} strokeWidth={2} aria-hidden="true" />
              <Silencio desde={corte} />
            </div>
          ) : (
            <Cursor />
          )}
        </>
      ) : null;
      return (
        <>
          <Salida texto={d.salida?.t} cwd={cwd} vacio={corre ? "" : t("wk.sinSalida")} abajo={abajo} />
          <Nota c={d.salida} />
        </>
      );
    }
    case "delegar":
      return (
        <div className="wk-ag">
          <Entero texto={d.prompt.t} tag="blockquote" />
          {d.pasos.length ? (
            <ul className="wk-sub">
              {d.pasos.map((s) => {
                const S = ICONO[s.tipo];
                return (
                  <li key={s.id}>
                    <S size={13} strokeWidth={1.8} />
                    <span>{frasePaso(s, vive)}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {d.tokens ? <p className="wk-nota">{t("wk.delegaTokens", { n: compacto(d.tokens) })}</p> : null}
          {d.respuesta?.t ? <Entero texto={d.respuesta.t} className="wk-resp" /> : null}
        </div>
      );
    case "texto":
      return (
        <div className="wk-ag">
          <Texto texto={d.texto.t} />
        </div>
      );
    case "pensar":
      return <div className="wk-ag">{d.texto?.t ? <Texto texto={d.texto.t} /> : <p className="wk-vacio">{t("wk.pensoOculto")}</p>}</div>;
    default:
      return (
        <div className="wk-ag">
          <p className="wk-vacio">{p.titulo}</p>
        </div>
      );
  }
}

function Silencio({ desde }: { desde: number }) {
  const pintor = useMemo<Pintor>(() => {
    const lleva = pintorLleva(desde);
    return (a) => {
      const x = lleva(a);
      return { ...x, texto: t("wk.sinNovedades", { d: x.texto }) };
    };
  }, [desde]);
  return <Reloj pintor={pintor} />;
}

/** El pie del panel: cómo terminó el paso, en palabras y con ícono, y lo que tardó. */
function PieDe({ p, vive, colgado }: { p: Paso; vive: boolean; colgado: boolean }) {
  const d: Detalle = p.detalle;
  const lleva = useMemo<Pintor | null>(() => {
    if (p.estado !== "corriendo" || !vive || p.t === null) return null;
    const x = pintorLleva(p.t);
    return (a) => {
      const y = x(a);
      return { ...y, texto: t("wk.llevaD", { d: y.texto }) };
    };
  }, [p.estado, p.t, vive]);
  const dur = p.dur !== null && p.dur >= 1000 ? <span>{durCorta(p.dur)}</span> : null;
  if (p.estado === "corriendo")
    return (
      <footer className="wk-pie" data-tono={colgado && vive ? "trabado" : vive ? "vivo" : "tenue"}>
        {!vive ? (
          <b>{t("wk.noTermino")}</b>
        ) : colgado ? (
          <b>
            <TriangleAlert size={14} strokeWidth={2.2} aria-hidden="true" />
            {d.clase === "correr" ? t("wk.comandoAbierto") : t("estado.trabado")}
          </b>
        ) : (
          <b>
            <LoaderCircle size={14} strokeWidth={2.2} aria-hidden="true" />
            {t("wk.sigueCorriendo")}
          </b>
        )}
        {lleva ? <Reloj pintor={lleva} /> : null}
      </footer>
    );
  switch (d.clase) {
    case "correr": {
      const mal = fallo(p);
      return (
        <footer className="wk-pie" data-tono={mal ? "mal" : "ok"}>
          <b>
            {mal ? <X size={14} strokeWidth={2.4} aria-hidden="true" /> : <Check size={14} strokeWidth={2.4} aria-hidden="true" />}
            {t("wk.exit", { n: d.codigo ?? (mal ? 1 : 0) })}
          </b>
          {dur}
        </footer>
      );
    }
    case "buscar": {
      const grupos = d.herramienta === "Grep" || d.herramienta === "Glob" ? partirGrep(d.texto?.t ?? "") : null;
      return (
        <footer className="wk-pie">
          <b>{d.resultados ? t("wk.coincidencias", { n: d.resultados }) : t("wk.sinCoincidencias")}</b>
          {grupos && d.resultados ? <span>{grupos.length === 1 ? t("wk.enArchivo1") : t("wk.enArchivos", { n: grupos.length })}</span> : null}
          {dur}
        </footer>
      );
    }
    case "editar":
    case "escribir":
      return (
        <footer className="wk-pie">
          <Mas mas={d.mas} menos={d.menos} />
          {dur}
        </footer>
      );
    case "leer":
      return (
        <footer className="wk-pie">
          {d.lineas ? <span>{t("wk.lineasN", { n: d.lineas })}</span> : null}
          {dur}
        </footer>
      );
    default:
      return dur ? <footer className="wk-pie">{dur}</footer> : null;
  }
}

function DetallePaso({ p, cwd, vive, colgado, corte, dentro }: { p: Paso; cwd: string | null; vive: boolean; colgado: boolean; corte: number | null; dentro?: boolean }) {
  const crudo = useMemo(() => crudoDe(p, cwd), [p, cwd]);
  const cuerpo = useMemo(() => cuerpoDe(p, cwd, vive, colgado, corte), [p, cwd, vive, colgado, corte]);
  return (
    <>
      <header className={dentro ? "wk-ru" : "wk-ru wk-ru-panel"}>
        {dentro ? null : <p className="wk-ru-frase">{frasePaso(p, vive)}</p>}
        {crudo ? (
          <div className="wk-crudo">
            <div className="wk-crudo-l">{crudo.linea}</div>
            <Copiar texto={crudo.copia} />
          </div>
        ) : null}
      </header>
      <div className="wk-cuerpo">{cuerpo}</div>
      <PieDe p={p} vive={vive} colgado={colgado} />
    </>
  );
}

// ---- La tira: cada paso donde pasó, con el ancho de lo que tardó ----------------------------------------------------------

/** El largo de un tramo como variables de la hoja de estilos: `--total` lo actualiza un solo reloj, sin tocar React. */
const estiloTramo = (x: { t0: number; seg: number }) => ({ "--t0": Math.round(x.t0), "--seg": Math.round(x.seg) }) as CSSProperties;

type PropsTira = {
  ts: readonly Tramo[];
  /** Dónde está el 0, en ms. */
  cero: number;
  /** Cuándo terminó, o `null` si sigue. */
  fin: number | null;
  vive: boolean;
  /** Desde cuándo está trabado (la última novedad), en ms. */
  corte: number | null;
  sel: number | null;
  alElegir: (n: number) => void;
  raiz: RefObject<HTMLDivElement | null>;
};

function Tira({ ts, cero, fin, vive, corte, sel, alElegir, raiz }: PropsTira) {
  const pista = useRef<HTMLDivElement>(null);
  const tipEl = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ tr: Tramo; x: number } | null>(null);
  const totalFijo = fin !== null ? Math.max(1, fin - cero) : null;
  const [escala, setEscala] = useState(() => pasoDeRegla(totalFijo ?? Math.max(1, Date.now() - cero)));
  const escalaActual = useRef(escala);
  const total = totalFijo ?? Math.max(1, Date.now() - cero);
  const marcas = marcasRegla(total, totalFijo !== null ? pasoDeRegla(totalFijo) : escala);

  // Vivo: el total crece solo. El reloj del final de la regla pone `--total` en la raíz (tira e hilo) una vez por segundo; la escala de la regla sólo cuando hace falta.
  const pintorTotal = useMemo<Pintor>(
    () => (a) => {
      const ms = Math.max(1, a * 1000 - cero);
      raiz.current?.style.setProperty("--total", String(Math.round(ms)));
      const p = pasoDeRegla(ms);
      if (p !== escalaActual.current) {
        escalaActual.current = p;
        setEscala(p);
      }
      return { texto: durCorta(ms), en: ms >= 3_600_000 ? 60 - (a % 60) : 1 - (a % 1) };
    },
    [cero, raiz],
  );

  useLayoutEffect(() => {
    const el = tipEl.current;
    const caja = pista.current;
    if (!el || !caja || !tip) return;
    const w = el.offsetWidth;
    const W = caja.offsetWidth;
    el.style.left = `${Math.max(0, Math.min(W - w, tip.x - w / 2))}px`;
  }, [tip]);

  const mostrar = (el: EventTarget | null) => {
    const b = (el as HTMLElement | null)?.closest?.<HTMLElement>("[data-n]");
    const caja = pista.current?.getBoundingClientRect();
    if (!b || !caja) return setTip(null);
    const tr = ts.find((x) => x.p.n === Number(b.dataset.n));
    if (!tr) return setTip(null);
    const r = b.getBoundingClientRect();
    setTip({ tr, x: r.left + r.width / 2 - caja.left });
  };

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = ts.findIndex((x) => x.p.n === Number((e.target as HTMLElement).dataset?.n));
    if (i < 0) return;
    const prox = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? ts.length - 1 : null;
    if (prox === null || prox < 0 || prox >= ts.length) return;
    e.preventDefault();
    pista.current?.querySelector<HTMLElement>(`[data-n="${ts[prox].p.n}"]`)?.focus();
  };

  const foco = sel ?? ts[ts.length - 1]?.p.n;
  const colgadoEn = corte !== null ? Math.max(0, corte - cero) : null;
  const frac = colgadoEn !== null ? colgadoEn / total : 0;

  return (
    <div className="wk-tira" data-bandera={colgadoEn !== null ? "" : undefined}>
      <div className="wk-pista" ref={pista} role="group" aria-label={t("wk.mapa")} onMouseOver={(e) => mostrar(e.target)} onMouseLeave={() => setTip(null)} onFocus={(e) => mostrar(e.target)} onBlur={() => setTip(null)} onKeyDown={alTeclear}>
        {ts.map((tr) => {
          const { p } = tr;
          const mal = fallo(p);
          return (
            <button
              key={p.n}
              type="button"
              className="wk-seg"
              data-t={p.tipo}
              data-n={p.n}
              data-sel={p.n === sel ? "" : undefined}
              data-fallo={mal ? "" : undefined}
              data-vivo={tr.abierto && colgadoEn === null ? "" : undefined}
              data-abierto={tr.abierto && colgadoEn === null ? "" : undefined}
              data-commit={commitDe(p) ? "" : undefined}
              aria-label={mal ? `${frasePaso(p, vive)} · ${t("wk.chipFalla")}` : frasePaso(p, vive)}
              tabIndex={p.n === foco ? 0 : -1}
              style={colgadoEn !== null && tr.abierto ? estiloTramo({ t0: tr.t0, seg: Math.max(0, colgadoEn - tr.t0) }) : estiloTramo(tr)}
              onClick={() => alElegir(p.n)}
            />
          );
        })}
        {colgadoEn !== null ? (
          <>
            <span className="wk-seg-colgado" style={{ "--t0": Math.round(colgadoEn) } as CSSProperties} aria-hidden="true" />
            <span className="wk-bandera" data-lado={frac > 0.7 ? "izq" : undefined} style={{ "--t0": Math.round(colgadoEn) } as CSSProperties}>
              <TriangleAlert size={13} strokeWidth={2.2} aria-hidden="true" />
              {t("wk.seTrabo")}
            </span>
          </>
        ) : null}
        <div className="wk-tip" ref={tipEl} role="tooltip" data-on={tip ? "" : undefined} aria-hidden={!tip}>
          {tip ? (
            <>
              <b>{frasePaso(tip.tr.p, vive)}</b>
              <span>
                {tip.tr.abierto ? t("wk.tiraSigue", { a: durCorta(tip.tr.t0) }) : t("wk.tiraTip", { d: durCorta(tip.tr.seg), a: durCorta(tip.tr.t0) })}
                {fallo(tip.tr.p) ? ` · ${t("wk.chipFalla")}` : ""}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="wk-regla" aria-hidden="true">
        <span style={{ left: 0 }}>0</span>
        {marcas.map((m) => (
          <span key={m} className="wk-marca" style={{ "--m": m } as CSSProperties}>
            {marcaCorta(m)}
          </span>
        ))}
        {totalFijo !== null ? <span className="wk-regla-fin">{durCorta(totalFijo)}</span> : <Reloj pintor={pintorTotal} className="wk-regla-fin" />}
      </div>
    </div>
  );
}

// ---- El hilo: una fila por paso -------------------------------------------------------------------------------------------

/** El punto del hilo: chico para lo que sólo mira; relleno y con ícono para lo que cambió algo, salió mal o se trabó. */
function Nodo({ p, vive, colgado }: { p: Paso; vive: boolean; colgado: boolean }) {
  const corre = p.estado === "corriendo" && vive;
  useLayoutEffect(() => {
    if (corre) return latir();
  }, [corre]);
  if (corre && colgado)
    return (
      <span className="wk-nodo" data-marca="trabado">
        <TriangleAlert size={14} strokeWidth={2.2} aria-hidden="true" />
      </span>
    );
  if (corre)
    return (
      <span className="wk-nodo" data-marca="vivo">
        <i className="late" />
      </span>
    );
  if (fallo(p))
    return (
      <span className="wk-nodo" data-marca="error">
        <X size={14} strokeWidth={2.6} aria-hidden="true" />
      </span>
    );
  if (commitDe(p))
    return (
      <span className="wk-nodo" data-marca="commit">
        <GitCommitHorizontal size={15} strokeWidth={2.2} aria-hidden="true" />
      </span>
    );
  if (p.tipo === "editar" || p.tipo === "escribir") {
    const I = ICONO[p.tipo];
    return (
      <span className="wk-nodo" data-marca="cambio">
        <I size={13} strokeWidth={2.2} aria-hidden="true" />
      </span>
    );
  }
  if (p.tipo === "leer" || p.tipo === "buscar" || p.tipo === "correr")
    return (
      <span className="wk-nodo" data-marca="punto">
        <i />
      </span>
    );
  const I = ICONO[p.tipo];
  return (
    <span className="wk-nodo" data-marca="icono">
      <I size={15} strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}

const NudoHilo = ({ nudo, sel }: { nudo: Nudo; sel: number | null }) => (
  <span className="wk-nudo" data-sel={sel !== null && nudo.ns.includes(sel) ? "" : undefined} title={t("wk.nudo", { d: durCorta(nudo.ms) })}>
    <i aria-hidden="true" />
    {nudo.ms >= 1000 ? durCorta(nudo.ms) : null}
  </span>
);

const Hebra = ({ tr, abierto, colgado }: { tr: { t0: number; seg: number } | undefined; abierto?: boolean; colgado?: boolean }) =>
  tr ? <span className="wk-hebra" data-abierto={abierto ? "" : undefined} data-colgado={colgado ? "" : undefined} style={estiloTramo(tr)} aria-hidden="true" /> : null;

type PropsFila = {
  p: Paso;
  nudo: Nudo | null;
  tr: Tramo | undefined;
  /** Hay algún paso elegido entre los pensamientos del nudo: el nudo lo marca. */
  selN: number | null;
  sel: boolean;
  angosto: boolean;
  vive: boolean;
  colgado: boolean;
  corte: number | null;
  cwd: string | null;
  alElegir: (n: number) => void;
};

const FilaPaso = memo(function FilaPaso({ p, nudo, tr, selN, sel, angosto, vive, colgado, corte, cwd, alElegir }: PropsFila) {
  const d = p.detalle;
  const corre = p.estado === "corriendo" && vive;
  const sinTerminar = p.estado === "corriendo" && !vive;
  const pintor = useMemo(() => (corre && p.t !== null ? pintorLleva(p.t) : null), [corre, p.t]);
  const mal = fallo(p);
  const commit = commitDe(p);
  const ruta = d.clase === "editar" || d.clase === "escribir" ? rutaRelativa(d.ruta, cwd) : null;
  // El nombre ya está en la frase: abajo va sólo la carpeta.
  const carpeta = ruta ? ruta.slice(0, Math.max(0, ruta.length - nombreDeArchivo(ruta).length)).replace(/[\\/]$/, "") : "";
  const frase = frasePaso(p, vive);
  const pensado = d.clase === "pensar" && d.texto?.t ? frase.slice(0, frase.length - d.texto.t.trim().length) : null;
  const atras = d.clase === "pensar" || p.tipo === "leer" || p.tipo === "buscar";
  return (
    <li className="wk-li" data-t={p.tipo} data-nudo={nudo ? "" : undefined} data-trabado={corre && colgado ? "" : undefined}>
      {nudo ? <NudoHilo nudo={nudo} sel={selN} /> : null}
      <button type="button" className="wk-it" data-t={p.tipo} data-sel={sel ? "" : undefined} data-mal={mal ? "" : undefined} data-cambio={esCambio(p) ? "" : undefined} data-vivo={corre ? "" : undefined} data-tenue={atras ? "" : undefined} aria-pressed={sel} onClick={() => alElegir(p.n)}>
        <Nodo p={p} vive={vive} colgado={colgado} />
        <span className="wk-tx">
          <span className="wk-fr">{pensado ? <><b>{pensado.trim()}</b> {d.clase === "pensar" ? d.texto?.t.trim() : null}</> : frase}</span>
          {carpeta ? <span className="wk-subr">{carpeta}</span> : null}
        </span>
        {d.clase === "editar" || d.clase === "escribir" ? <Mas mas={d.mas} menos={d.menos} /> : null}
        {commit?.hash ? <span className="wk-hash">{commit.hash}</span> : null}
        {mal ? <span className="wk-ex">{d.clase === "correr" ? t("wk.exit", { n: d.codigo ?? 1 }) : t("wk.chipFalla")}</span> : null}
        {corre && colgado ? <span className="wk-trab">{t("wk.chipTrabado")}</span> : null}
        {sinTerminar ? <span className="wk-sinfin">{t("wk.sinTerminar")}</span> : null}
        {pintor ? <Reloj pintor={pintor} className="wk-dur" /> : p.dur !== null && p.dur >= 1000 ? <span className="wk-dur">{durCorta(p.dur)}</span> : null}
      </button>
      <Hebra tr={tr} abierto={tr?.abierto && !colgado} colgado={corre && colgado} />
      {sel && angosto ? (
        <div className="wk-dentro" data-t={p.tipo}>
          <DetallePaso p={p} cwd={cwd} vive={vive} colgado={colgado} corte={corte} dentro />
        </div>
      ) : null}
    </li>
  );
});

type PropsGrupo = Omit<PropsFila, "p" | "tr" | "sel" | "nudo"> & { ps: Paso[]; clase: ClaseGrupo; nudo: Nudo | null; nudos: Record<number, Nudo>; abierto: boolean; alAlternar: (n: number) => void; tramoDe: ReadonlyMap<number, Tramo> };

const GrupoFila = memo(function GrupoFila({ ps, clase, nudo, nudos, abierto, alAlternar, selN, tramoDe, angosto, vive, colgado, corte, cwd, alElegir }: PropsGrupo) {
  const primero = tramoDe.get(ps[0].n);
  const ultimo = tramoDe.get(ps[ps.length - 1].n);
  const adentro = !abierto && ps.some((p) => p.n === selN);
  const dur = durGrupo(ps);
  const tipo = ps[0].tipo;
  return (
    <li className="wk-li wk-gr" data-t={tipo} data-abierto={abierto ? "" : undefined} data-nudo={nudo ? "" : undefined}>
      {nudo ? <NudoHilo nudo={nudo} sel={selN} /> : null}
      <button type="button" className="wk-it" data-t={tipo} data-tenue="" data-sel-dentro={adentro ? "" : undefined} aria-expanded={abierto} onClick={() => alAlternar(ps[0].n)}>
        <span className="wk-nodo" data-marca="varios">
          <i />
          <i />
          <i />
        </span>
        <span className="wk-tx">
          <span className="wk-fr">
            {fraseGrupo(ps, clase, vive)}
            <ChevronRight size={13} strokeWidth={2} className="wk-caret" aria-hidden="true" />
          </span>
        </span>
        {dur >= 1000 ? <span className="wk-dur">{durCorta(dur)}</span> : null}
      </button>
      {!abierto ? <Hebra tr={primero && ultimo ? { t0: primero.t0, seg: ultimo.t0 + ultimo.seg - primero.t0 } : undefined} /> : null}
      {abierto ? (
        <ul>
          {ps.map((p) => (
            <FilaPaso key={p.n} p={p} nudo={nudos[p.n] ?? null} tr={tramoDe.get(p.n)} selN={selN} sel={p.n === selN} angosto={angosto} vive={vive} colgado={colgado} corte={corte} cwd={cwd} alElegir={alElegir} />
          ))}
        </ul>
      ) : null}
    </li>
  );
});

// ---- Los chips y la caja ---------------------------------------------------------------------------------------------------

/** Los chips del resultado: tests, archivos tocados y supuestos. `resultado`: el que se usa si los pasos no traen el texto final. */
export function Chips({ resultado, vista, pasos, vive, alElegir }: { resultado: string | null; vista: VistaPasos; pasos: readonly Paso[]; vive: boolean; alElegir: (n: number) => void }) {
  const tests = useMemo(() => testsDe(pasos), [pasos]);
  const archivos = useMemo(() => chipsDe(vista.encabezado), [vista.encabezado]);
  const { supuestos } = useMemo(() => resumenDe(textoFinal(vista.pasos) ?? resultado), [vista.pasos, resultado]);
  const del = (ruta: string) => [...pasos].reverse().find((p) => (p.detalle.clase === "editar" || p.detalle.clase === "escribir") && p.detalle.ruta === ruta)?.n;
  return (
    <div className="wk-chips">
      {tests ? (
        <button type="button" className="ui-chip wk-chip" data-ok={tests.ok ? "" : undefined} data-mal={tests.ok ? undefined : ""} data-tip={t("wk.testsTip", { que: frasePaso(tests.paso, vive) })} onClick={() => alElegir(tests.paso.n)}>
          {tests.ok ? <Check size={13} strokeWidth={2.4} /> : <X size={13} strokeWidth={2.4} />}
          {!tests.ok ? t("wk.testsFallan") : tests.n !== null ? t("wk.testsN", { n: tests.n }) : t("wk.tests")}
        </button>
      ) : null}
      {archivos.map((c) => (
        <button key={c.ruta} type="button" className="ui-chip wk-chip" data-tip={c.ruta} onClick={() => { const n = del(c.ruta); if (n !== undefined) alElegir(n); }}>
          <span className="wk-nombre">{c.nombre}</span>
          {c.mas ? <b className="wk-mas">+{c.mas}</b> : null}
          {c.menos ? <b className="wk-menos">−{c.menos}</b> : null}
        </button>
      ))}
      {!vive && supuestos.length ? (
        <span className="wk-sup">
          <button type="button" className="ui-chip wk-chip">
            {supuestos.length === 1 ? t("wk.supuestos1") : t("wk.supuestosN", { n: supuestos.length })}
          </button>
          <div className="wk-pop" role="tooltip">
            <ul>
              {supuestos.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        </span>
      ) : null}
    </div>
  );
}

/** La consigna plegada en una línea, con su flecha: abierta se lee entera. Lo que el usuario elige se respeta aunque cambie el estado. */
function Consigna({ texto, deEntrada }: { texto: string; deEntrada: boolean }) {
  const [eleccion, setEleccion] = useState<boolean | null>(null);
  const abierta = eleccion ?? deEntrada;
  return (
    <div className="wk-consigna" data-abierta={abierta ? "" : undefined}>
      <button type="button" className="wk-consigna-b" aria-expanded={abierta} onClick={() => setEleccion(!abierta)}>
        <ChevronRight size={14} strokeWidth={2} className="wk-caret" aria-hidden="true" />
        {t("wk.consigna")}
      </button>
      <div className="wk-consigna-t" tabIndex={abierta ? 0 : undefined}>
        {texto}
      </div>
    </div>
  );
}

/** Qué dice la caja de la última acción. */
type TonoCaja = "vivo" | "trabado" | "listo" | "falla" | "decision" | "frenado";

/** El reloj grande y la frase: mientras corre, el tiempo del paso; terminado, el total. */
function Portada({ tono, r, inicio, dur, corte, titulo, sub, aparte }: { tono: TonoCaja; r: ReturnType<typeof useRecorrido>; inicio: number; dur: number | null; corte: number | null; titulo: ReactNode; sub: ReactNode; aparte?: ReactNode }) {
  const ps = r.pasos;
  const corriendo = [...ps].reverse().find((p) => p.estado === "corriendo") ?? null;
  const ult = ps[ps.length - 1] ?? null;
  const vive = tono === "vivo" || tono === "trabado";
  // Desde cuándo cuenta el reloj vivo, y qué es lo que cuenta.
  const desde = !vive ? null : corriendo?.t ?? (ult?.t != null ? ult.t + (ult.dur ?? 0) : inicio * 1000);
  const unidad = !vive ? "wk.enTotal" : corriendo ? "wk.esteP" : !ps.length ? "wk.enTotal" : tono === "trabado" ? "wk.sinNovedad" : "wk.pensando";
  const pintor = useMemo(() => (desde !== null ? pintorReloj(desde) : null), [desde]);
  const hayReloj = pintor !== null || dur !== null;
  return (
    <div className="wk-portada" data-reloj={hayReloj ? "" : undefined}>
      {hayReloj ? (
        <div className="wk-reloj" data-corte={corte !== null ? "" : undefined}>
          {pintor ? <Reloj pintor={pintor} className="wk-reloj-n" /> : <span className="wk-reloj-n">{relojDe(dur!)}</span>}
          <span className="wk-reloj-u">{t(unidad as ClaveSola)}</span>
        </div>
      ) : null}
      <div className="wk-frase">
        <div className="wk-frase-t">
          {titulo}
          {aparte}
        </div>
        {sub ? <div className="wk-frase-s">{sub}</div> : null}
      </div>
    </div>
  );
}

/** La frase del último paso para el renglón de abajo de la caja: en minúscula y con su exit si salió mal. */
function ultimoPaso(ps: readonly Paso[], vive: boolean): string | null {
  const u = ps[ps.length - 1];
  if (!u) return null;
  const frase = minuscula(frasePaso(u, vive));
  return u.detalle.clase === "correr" && fallo(u) && u.detalle.codigo ? t("wk.ultimoPasoExit", { q: frase, n: u.detalle.codigo }) : t("wk.ultimoPaso", { q: frase });
}

/** El renglón de abajo de un paso vivo: de dónde viene, o que está pensando el próximo. */
function subVivo(ps: readonly Paso[]): string | null {
  const conFila = ps.filter((p) => p.detalle.clase !== "pensar" || pensarConFila(p));
  const u = conFila[conFila.length - 1];
  if (!u) return null;
  if (u.estado !== "corriendo") return t("wk.pensandoProx");
  const antes = conFila[conFila.length - 2];
  return antes ? t("wk.antes", { q: minuscula(frasePaso(antes)) }) : null;
}

function SubTrabado({ paso, corte }: { paso: Paso | null; corte: number }) {
  const pintor = useMemo<Pintor>(() => {
    const sin = pintorLleva(corte);
    const lleva = paso?.t != null ? pintorLleva(paso.t) : null;
    return (a) => {
      const s = sin(a);
      const l = lleva?.(a);
      return { en: Math.min(s.en, l?.en ?? Infinity), texto: l ? t("wk.subTrabado", { d: l.texto, s: s.texto }) : `${t("wk.sinNovedades", { d: s.texto })}.` };
    };
  }, [paso?.t, corte]);
  return <Reloj pintor={pintor} />;
}

// ---- La vista ------------------------------------------------------------------------------------------------------------

/** Qué paso se ve sin que el usuario haya elegido: vivo, el último con fila; falló, el último que falló; si no, el último que editó o escribió, el primero que falló o el último. */
function porDefecto(ps: readonly Paso[], vive: boolean, falla: boolean): number | null {
  if (!ps.length) return null;
  const conFila = ps.filter((p) => p.detalle.clase !== "pensar" || pensarConFila(p));
  const ult = conFila[conFila.length - 1] ?? ps[ps.length - 1];
  if (vive) return ult.n;
  if (falla) {
    for (let i = ps.length - 1; i >= 0; i--) if (fallo(ps[i])) return ps[i].n;
  }
  for (let i = ps.length - 1; i >= 0; i--) if (ps[i].tipo === "editar" || ps[i].tipo === "escribir") return ps[i].n;
  return ps.find((p) => fallo(p))?.n ?? ult.n;
}

type Props = {
  h: Hilo;
  estado: Estado;
  vista: VistaPasos;
  settle: SalidaSettle | null;
  alCerrar: (id: string, como?: Como) => void;
  alRetomar: (id: string) => void;
  alPasar: (h: Hilo) => Promise<void>;
};

/** El paso elegido, los grupos abiertos y el seguimiento del fondo: lo comparten la vista de un worker y la de un subagente. */
export function useRecorrido(vista: VistaPasos, vive: boolean, falla = false) {
  const angosto = useAngosto();
  const raiz = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  // Mientras trabaja, la lista sigue su fondo (src/hilo/seguir.ts); en el celular la zona que se mueve es toda la vista.
  const seg = useSeguir(angosto ? raiz : lista);

  const pasos = useMemo(() => visibles(vista.pasos), [vista.pasos]);
  const [elegido, setElegido] = useState<number | "ninguno" | null>(null);
  const [abiertos, setAbiertos] = useState<ReadonlySet<number>>(() => new Set());
  const [solo, setSolo] = useState(false);
  const porDef = useMemo(() => porDefecto(pasos, vive, falla), [pasos, vive, falla]);
  const selN = elegido === "ninguno" ? null : (elegido ?? porDef);
  const sel = pasos.find((p) => p.n === selN) ?? null;
  const fs = useMemo(() => (solo ? filasCambios(pasos) : filas(pasos)), [pasos, solo]);
  const cambios = useMemo(() => pasos.filter(esCambio), [pasos]);
  // Se abre el grupo del paso que se eligió desde afuera (la tira, un chip) y la lista va hasta él.
  const irA = useRef(false);
  const fsRef = useRef(fs);
  fsRef.current = fs;
  const alElegir = useCallback(
    (n: number) => {
      irA.current = true;
      const g = fsRef.current.find((f) => f.grupo && f.ps.some((p) => p.n === n));
      if (g?.grupo) setAbiertos((s) => (s.has(g.ps[0].n) ? s : new Set(s).add(g.ps[0].n)));
      setElegido((e) => (e === n && angosto ? "ninguno" : n));
    },
    [angosto],
  );
  const alternar = useCallback((n: number) => {
    setAbiertos((s) => {
      const x = new Set(s);
      if (!x.delete(n)) x.add(n);
      return x;
    });
  }, []);
  const alternarSolo = () => {
    // Al prender el filtro, si lo elegido no es un cambio, se pasa al último que hubo: el panel acompaña lo que queda en la lista.
    if (!solo && sel && !esCambio(sel) && cambios.length) setElegido(cambios[cambios.length - 1].n);
    setSolo(!solo);
  };

  useLayoutEffect(() => {
    if (!irA.current) return;
    irA.current = false;
    lista.current?.querySelector("[data-sel], [data-sel-dentro]")?.scrollIntoView({ block: "nearest" });
  }, [selN, abiertos]);

  // Terminado, la lista no baja sola al fondo: se queda en el paso que se ve.
  useLayoutEffect(() => {
    if (vive) return;
    seg.pegado = false;
    raiz.current?.querySelector("[data-sel]")?.scrollIntoView({ block: "nearest" });
  }, []);

  return { angosto, raiz, lista, pasos, abiertos, selN, sel, fs, solo, cambios, alElegir, alternar, alternarSolo };
}

/** La caja de arriba, la tira, el hilo de pasos y el detalle del elegido. `compacta`: desde cuándo compacta su contexto, o `null`. `corte`: desde cuándo está trabado. */
export function Recorrido({ r, vista, vive, compacta, arriba, corte = null }: { r: ReturnType<typeof useRecorrido>; vista: VistaPasos; vive: boolean; compacta: number | null; arriba: ReactNode; corte?: number | null }) {
  const { angosto, lista, pasos, abiertos, selN, sel, fs, solo, cambios, alElegir, alternar, alternarSolo } = r;
  const e = vista.encabezado;
  const cwd = e.cwd;
  const colgado = corte !== null;
  const fin = vive ? null : e.fin;
  const izq = useRef<HTMLDivElement>(null);
  const cero = baseTira(pasos, e.inicio, vista.omitidos);
  const ts = useMemo(() => (cero !== null ? tramos(pasos, cero, fin) : []), [pasos, cero, fin]);
  const tramoDe = useMemo(() => new Map(ts.map((x) => [x.p.n, x])), [ts]);
  // Terminado sin hora de fin: hasta donde llegó el último tramo.
  const finTira = fin ?? (vive || !ts.length ? null : Math.max(...ts.map((x) => x.t0 + x.seg)) + (cero ?? 0));
  const total = cero === null ? 1 : Math.max(1, (finTira ?? Date.now()) - cero);
  const ley = useMemo(() => leyendaDe(pasos), [pasos]);
  return (
    <div className="wk-paneles">
      <div className="wk-izq" ref={izq} style={{ "--total": Math.round(total) } as CSSProperties}>
        {arriba}
        {pasos.length && cero !== null ? (
          <>
            <Tira ts={ts} cero={cero} fin={finTira} vive={vive} corte={corte} sel={selN} alElegir={alElegir} raiz={izq} />
            <div className="wk-ley-fila">
              <ul className="wk-ley" aria-hidden="true">
                {ley.map((x) => (
                  <li key={x} data-t={x}>
                    <i />
                    {t(`wk.ley.${x}` as ClaveSola)}
                  </li>
                ))}
              </ul>
              <button type="button" className="wk-solo" role="switch" aria-checked={solo} onClick={alternarSolo}>
                <span className="wk-solo-t" aria-hidden="true">
                  <i />
                </span>
                {t("wk.soloCambios")}
                <span className="wk-solo-n">{cambios.length}</span>
              </button>
            </div>
          </>
        ) : null}
        <div className="wk-lista" ref={lista}>
          <ol aria-label={t("wk.pasos")}>
            {vista.omitidos > 0 && !solo ? <li className="wk-nota wk-omit">{t("wk.anteriores", { n: vista.omitidos })}</li> : null}
            {!pasos.length ? <li className="wk-nota">{t("wk.sinPasos")}</li> : null}
            {pasos.length && !fs.length ? <li className="wk-nota">{t("wk.sinCambios")}</li> : null}
            {fs.map((f) =>
              f.grupo ? (
                <GrupoFila key={f.ps[0].n} ps={f.ps} clase={f.clase} nudo={f.nudo} nudos={f.nudos} abierto={abiertos.has(f.ps[0].n)} alAlternar={alternar} selN={selN} tramoDe={tramoDe} angosto={angosto} vive={vive} colgado={colgado} corte={corte} cwd={cwd} alElegir={alElegir} />
              ) : (
                <FilaPaso key={f.p.n} p={f.p} nudo={f.nudo} tr={tramoDe.get(f.p.n)} selN={f.nudo ? selN : null} sel={f.p.n === selN} angosto={angosto} vive={vive} colgado={colgado} corte={corte} cwd={cwd} alElegir={alElegir} />
              ),
            )}
            {compacta !== null ? (
              <li className="wk-li">
                <Compactando desde={compacta} />
              </li>
            ) : null}
          </ol>
        </div>
      </div>
      {!angosto ? (
        <section className="wk-panel" data-t={sel?.tipo}>
          {sel ? (
            <DetallePaso key={sel.n} p={sel} cwd={cwd} vive={vive} colgado={colgado} corte={corte} />
          ) : (
            <p className="wk-panel-vacio">{t(pasos.length ? "wk.panelVacio" : "wk.sinPasos")}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

export { Portada, ultimoPaso, subVivo, Consigna };

export function VistaWorker({ h, estado, vista, settle, alCerrar, alRetomar, alPasar }: Props) {
  useIdioma();
  const colgado = estado === "colgado";
  const vive = estado === "trabajando" || colgado;
  const decide = estado === "decision";
  const murio = estado === "murio";
  const frenado = murio && h.frenado_en != null;
  const falla = murio && !frenado;
  const compacta = useCompactando(vive ? h.id : null);
  const r = useRecorrido(vista, vive, falla);

  const [parando, setParando] = useState(false);
  const [pasando, setPasando] = useState(false);
  const [errorPie, setErrorPie] = useState<string | null>(null);
  // «Seguir con otro modelo» (#1791): un worker que murió (por cupo o por lo que sea) sigue con un resumen de lo hecho, en su puesto y su rama.
  const [seguir, setSeguir] = useState(false);
  const parar = () => {
    if (parando) return;
    setParando(true);
    setErrorPie(null);
    fuente.parar(h).catch((e) => {
      setParando(false);
      setErrorPie(mensaje(e));
    });
  };
  const pasar = () => {
    if (pasando) return;
    setPasando(true);
    setErrorPie(null);
    alPasar(h).catch((e) => {
      setPasando(false);
      setErrorPie(mensaje(e));
    });
  };

  const final = textoFinal(vista.pasos) ?? (vive ? null : h.resultado);
  const { resultado } = useMemo(() => resumenDe(final), [final]);
  // La pregunta de un worker que espera una decisión (sin líder): entera, de su último mensaje.
  const partida = decide && final ? partirDecision(final) : null;
  const pregunta = partida?.decision ?? h.decision;

  const e = vista.encabezado;
  const ps = r.pasos;
  const corriendo = [...ps].reverse().find((p) => p.estado === "corriendo") ?? null;
  const ult = ps[ps.length - 1] ?? null;
  // Trabado: lo último que se supo es la última línea del transcript; desde ahí, nada.
  const corte = colgado ? (e.fin ?? (ult?.t != null ? ult.t + (ult.dur ?? 0) : h.inicio * 1000)) : null;
  const tono: TonoCaja = colgado ? "trabado" : vive ? "vivo" : falla ? "falla" : frenado ? "frenado" : decide ? "decision" : "listo";
  const dur = e.dur ?? (h.duracion_s !== null ? h.duracion_s * 1000 : null);
  const larga = (resultado?.length ?? 0) > 110;
  const Tit = ({ c }: { c: ReactNode }) => <h2 className="wk-tit" data-largo={larga ? "" : undefined}>{c}</h2>;

  let titulo: ReactNode;
  let sub: ReactNode = null;
  if (colgado) {
    const q = corriendo ?? ult;
    titulo = <Tit c={q ? t("wk.trabadoEn", { q: minuscula(frasePaso(q)) }) : t("wk.trabadoSolo")} />;
    sub = corte !== null ? <SubTrabado paso={corriendo} corte={corte} /> : null;
  } else if (vive) {
    const conFila = ps.filter((p) => p.detalle.clase !== "pensar" || pensarConFila(p));
    const q = corriendo ?? conFila[conFila.length - 1] ?? null;
    titulo = q ? <Tit c={frasePaso(q)} /> : <p className="wk-txt espera">{t("wk.espera")}</p>;
    sub = subVivo(ps);
  } else if (decide) {
    titulo = <Tit c={t("wk.tituloDecision")} />;
    sub = resultado ? <Entero texto={resultado} className="wk-txt" /> : null;
  } else {
    titulo = <Tit c={resultado ? <Entero texto={resultado} className="wk-txt" /> : t(falla ? "wk.tituloFalla" : frenado ? "wk.tituloFrenado" : "wk.sinResultado")} />;
    const ultimo = ultimoPaso(ps, false);
    const hizo = !!h.rama && (e.archivos.length > 0 || ps.some((p) => commitDe(p)));
    sub = ultimo ? `${ultimo}${murio && hizo ? ` ${t("wk.enRama")}` : ""}` : null;
  }

  return (
    <div className="wk" ref={r.raiz}>
      <div className="wk-in">
        <Recorrido
          r={r}
          vista={vista}
          vive={vive}
          compacta={compacta}
          corte={corte}
          arriba={
            <section className="wk-fin" aria-label={t("wk.resultado")} data-tono={tono} data-atencion={falla ? "falla" : decide ? "decision" : colgado ? "trabado" : undefined}>
              <Portada
                tono={tono}
                r={r}
                inicio={h.inicio}
                dur={dur}
                corte={corte}
                titulo={titulo}
                sub={sub}
                aparte={
                  falla || decide ? (
                    <span className="wk-aten-chip">
                      {falla ? <TriangleAlert size={13} strokeWidth={2.2} aria-hidden="true" /> : <MessageCircleQuestion size={13} strokeWidth={2.2} aria-hidden="true" />}
                      {t(falla ? "wk.chipFalla" : "wk.chipDecision")}
                    </span>
                  ) : null
                }
              />
              {errorPie ? (
                <div className="caja-error" role="alert">
                  {errorPie}
                </div>
              ) : null}
              {decide && pregunta ? (
                <div className="pregunta">
                  <div className="q">{t("estado.decision")}</div>
                  <Texto texto={pregunta} />
                </div>
              ) : null}
              {(e.tarea ?? h.tarea) ? <Consigna texto={e.tarea ?? h.tarea} deEntrada={estado === "trabajando"} /> : null}
              <div className="wk-pie-caja">
                <Chips resultado={h.resultado} vista={vista} pasos={r.pasos} vive={vive} alElegir={r.alElegir} />
                <div className="wk-acc">
                  {vive ? (
                    <Boton className="wk-parar" data-parar disabled={parando} onClick={parar}>
                      <Square size={12} strokeWidth={2.4} fill="currentColor" />
                      {parando ? t("accion.parando") : t("accion.parar")}
                    </Boton>
                  ) : decide ? (
                    <Boton className="wk-parar" data-pasar data-tip={t("vista.pasarTip")} disabled={pasando} onClick={pasar}>
                      {pasando ? t("vista.pasando") : t("vista.pasar")}
                    </Boton>
                  ) : murio ? (
                    <Boton className="wk-parar wk-seguir" data-seguir-con onClick={() => setSeguir(true)}>
                      <ArrowRightLeft size={13} strokeWidth={2.2} aria-hidden="true" />
                      {t("aviso.seguir")}
                    </Boton>
                  ) : null}
                  {settle && !vive ? <AccionesWorker key={h.id} id={h.id} salida={settle} como={comoSettle(h)} alCerrar={alCerrar} alRetomar={alRetomar} className="btn2" /> : null}
                </div>
              </div>
            </section>
          }
        />
      </div>
      {seguir ? (
        <SeguirCon
          de="worker"
          opciones={MODELOS_WORKER}
          actual={modeloDe(h.modelo)}
          alElegir={async (modelo) => {
            await fuente.seguirConWorker(h.id, modelo);
            setSeguir(false);
          }}
          alCerrar={() => setSeguir(false)}
        />
      ) : null}
    </div>
  );
}
