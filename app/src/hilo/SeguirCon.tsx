// «Seguir con otro modelo» (#1791, parte 3): el selector de modelo que abre la acción del menú de un hilo y la de los avisos de límite o de
// «sin cupo». Un diálogo modal en un portal a <body> (como DialogoCambio) con un buscador y la lista de modelos por proveedor; lo que no
// tiene cupo se marca con su hora (ícono y palabra, no sólo el color) y va al final de su proveedor. Elegir una fila llama a `alElegir`
// (el host lanza `pa --seguir-con` o abre un líder nuevo con el resumen); mientras eso corre la lista queda quieta, y si falla el error
// se ve acá y se puede elegir otro. La lógica de la lista (orden, marcas, flechas): seguir-con.ts.
import { useSalida } from "../movimiento";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Ban, Check, ChevronRight, Clock, MessagesSquare, ScanSearch, Search, X } from "lucide-react";
import { fuente } from "../datos/fuente";
import type { Uso } from "../datos/contrato";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { cuandoFuturo } from "../tiempo";
import { Boton, Interruptor } from "../ui/componentes";
import { estadosCupoModelos } from "./cupo-modelos.ts";
import { peorCasoLlamadas } from "./debate-logica.ts";
import { claveResaltada, filasSeguir, listaSeguir, moverSeguir, noElegible, plegadasAbiertas, resaltadaInicial, sinSesionDe, type FilaSeguir, type OpcionSeguir, type SinSesion } from "./seguir-con.ts";
import "./seguir-dialogo.css";
import "./debate.css";

type Props = {
  /** Qué se sigue: cambia lo que el diálogo dice que va a pasar. `revisar`: la segunda opinión sobre un plan (los mismos modelos, otro título y otro verbo). */
  de: "worker" | "lider" | "revisar";
  /** Los modelos entre los que se elige (los de un líder, o los de un worker). */
  opciones: readonly OpcionSeguir[];
  /** El modelo con el que venía (se ve, pero no se elige). */
  actual: string | null;
  /** Elegir un modelo: devuelve cuando ya está hecho (el diálogo lo cierra el host) o rechaza con el motivo (se muestra acá). */
  alElegir: (modelo: string, effort?: string) => Promise<void>;
  /**
   * Sólo la revisión: los esfuerzos que se ofrecen para un modelo (`niveles`, ya sin los apagados en Ajustes) y el de entrada. Con esto, elegir
   * una fila sólo la marca (el selector de esfuerzo va al lado) y se confirma con «Revisar» o con Enter.
   */
  esfuerzos?: (modelo: string) => { niveles: readonly string[]; defecto: string };
  /**
   * Sólo la revisión: con esto aparece el interruptor «Debate». Prendido, se eligen 2 o 3 modelos (cada uno con su esfuerzo) y de 1 a 3
   * rondas, y «Empezar debate» llama a esto; el flujo de un solo revisor (`alElegir`) queda como estaba.
   */
  alDebatir?: (x: { participantes: { modelo: string; effort: string }[]; rondas: number }) => Promise<void>;
  alCerrar: () => void;
  /** El modelo que queda resaltado al abrir si se puede usar ya (con cupo); si no, el primero que se puede. */
  preferido?: string;
  /** Captura: nace con esta búsqueda escrita. */
  busquedaInicial?: string;
};

/** El motivo de un modelo sin sesión; lo que va entre `comillas` se ve como código. */
function MotivoSesion({ s }: { s: SinSesion }) {
  return (
    <>
      {t("revision.sinSesion", { v: s.v, c: s.c })
        .split("`")
        .map((x, i) => (i % 2 ? <code key={i}>{x}</code> : x))}
    </>
  );
}

/** Cuántos modelos puede tener un debate y de cuántas rondas (los topes del moderador: electron/debate-texto.ts). */
const MODELOS_DEBATE = { min: 2, max: 3 } as const;
const RONDAS_DEBATE = [1, 2, 3] as const;
const RONDAS_DEFECTO = 2;

export function SeguirCon({ de, opciones, actual, alElegir, alDebatir, alCerrar: alCerrarYa, preferido, busquedaInicial = "", esfuerzos }: Props) {
  // Se cierra con la salida corta (movimiento.ts): el fondo se funde y recién entonces se llama a alCerrar.
  const [alCerrar, saliendo] = useSalida(alCerrarYa);
  useIdioma();
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const [busqueda, setBusqueda] = useState(busquedaInicial);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El cupo de cada modelo: el mismo dato que la tarjeta de cupos de la barra (cupo-modelos.ts).
  const [uso, setUso] = useState<Uso | null>(null);
  useEffect(() => {
    let vivo = true;
    void fuente.uso().then((u) => vivo && setUso(u), () => {});
    const soltar = fuente.alCambiarUso((u) => vivo && setUso(u));
    return () => {
      vivo = false;
      soltar();
    };
  }, []);
  // Sólo la revisión mira las sesiones: el mismo estado de cuentas que Ajustes > Cuentas (`fuente.cuentas()`).
  const [sesiones, setSesiones] = useState<ReadonlyMap<string, SinSesion>>(() => new Map());
  useEffect(() => {
    if (de !== "revisar") return;
    let vivo = true;
    void fuente.cuentas().then((c) => vivo && setSesiones(new Map(opciones.flatMap((o) => { const s = sinSesionDe(o.id, c); return s ? [[o.id, s] as const] : []; }))), () => {});
    return () => {
      vivo = false;
    };
  }, [de, opciones]);
  // Subgrupos de generaciones anteriores abiertos o cerrados a mano, por clave de proveedor.
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({});
  const buscando = busqueda.trim() !== "";
  // El debate: los modelos marcados (en el orden en que se marcaron), el esfuerzo de cada uno y las rondas.
  const [debate, setDebate] = useState(false);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [esfuerzosDeb, setEsfuerzosDeb] = useState<Record<string, string>>({});
  const [rondas, setRondas] = useState<number>(RONDAS_DEFECTO);
  const enDebate = debate && !!alDebatir;
  const cupos = useMemo(() => estadosCupoModelos(opciones.map((o) => o.id), uso, Date.now() / 1000), [opciones, uso]);
  const grupos = useMemo(() => listaSeguir(opciones, cupos, actual, busqueda, sesiones), [opciones, cupos, actual, busqueda, sesiones]);
  const filas = useMemo(() => filasSeguir(grupos, expandidos, buscando, marcados), [grupos, expandidos, buscando, marcados]);
  const clave = claveResaltada(filas, busqueda);
  const [seleccion, setSeleccion] = useState<{ clave: string; indice: number } | null>(null);
  // Hasta que la persona elija, el cupo y las cuentas definen la fila inicial.
  if (seleccion && seleccion.clave !== clave) setSeleccion(null);
  const resaltada = seleccion?.clave === clave ? seleccion.indice : resaltadaInicial(filas, preferido);
  const setResaltada = (indice: number) => setSeleccion({ clave, indice });
  useEffect(() => {
    lista.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [resaltada]);

  useFoco(raiz, { alCerrar: enviando ? undefined : alCerrar, enfocar: "primero" });

  // Con selector de esfuerzo (la revisión): la fila marcada es la elegida y su esfuerzo es el que se ve; cambiar de modelo vuelve al de entrada.
  const conEsfuerzo = !!esfuerzos;
  const marcada = resaltada >= 0 ? (filas[resaltada]?.opcion.id ?? null) : null;
  const ofrecidos = useMemo(() => (esfuerzos && marcada ? esfuerzos(marcada) : null), [esfuerzos, marcada]);
  const [esfuerzoElegido, setEsfuerzoElegido] = useState<{ modelo: string; nivel: string } | null>(null);
  const esfuerzo = ofrecidos && esfuerzoElegido?.modelo === marcada && ofrecidos.niveles.includes(esfuerzoElegido.nivel) ? esfuerzoElegido.nivel : (ofrecidos?.defecto ?? "");
  const esfuerzoDe = (m: string) => {
    const o = esfuerzos?.(m);
    const e = esfuerzosDeb[m];
    return o && e && o.niveles.includes(e) ? e : (o?.defecto ?? "");
  };
  const alternar = (modelo: string) => {
    if (enviando || filas.some((f) => f.opcion.id === modelo && noElegible(f))) return;
    setMarcados((m) => (m.includes(modelo) ? m.filter((x) => x !== modelo) : m.length < MODELOS_DEBATE.max ? [...m, modelo] : m));
  };
  const debatible = marcados.length >= MODELOS_DEBATE.min && marcados.length <= MODELOS_DEBATE.max;
  const empezarDebate = () => {
    if (enviando || !alDebatir || !debatible) return;
    setEnviando("debate");
    setError(null);
    alDebatir({ participantes: marcados.map((m) => ({ modelo: m, effort: esfuerzoDe(m) })), rondas }).catch((e) => {
      setEnviando(null);
      setError(mensaje(e));
    });
  };
  const nombreDe = (id: string) => opciones.find((o) => o.id === id)?.nombre ?? id;
  const proveedores = [...new Set(marcados.map((m) => opciones.find((o) => o.id === m)).map((o) => o?.colNombre ?? o?.grupo ?? "").filter(Boolean))];
  const elegir = (modelo: string, nivel?: string) => {
    if (enviando || filas.some((f) => f.opcion.id === modelo && noElegible(f))) return;
    setEnviando(modelo);
    setError(null);
    alElegir(modelo, conEsfuerzo ? (nivel ?? esfuerzos?.(modelo).defecto ?? "") : undefined).catch((e) => {
      setEnviando(null);
      setError(mensaje(e));
    });
  };
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setResaltada(moverSeguir(filas, resaltada, e.key));
    } else if (e.key === "Enter" && resaltada >= 0 && filas[resaltada] && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      if (enDebate) alternar(filas[resaltada].opcion.id);
      else elegir(filas[resaltada].opcion.id, esfuerzo);
    }
  };

  let n = -1;
  const dibujarFila = (f: FilaSeguir) => {
    const i = ++n;
    const sin = !!f.cupo?.sin;
    const poco = !sin && !!f.cupo?.poco;
    const marcado = enDebate && marcados.includes(f.opcion.id);
    const elegida = enDebate ? marcado : i === resaltada;
    return (
      <div
        key={f.opcion.id}
        id={`${id}-o${i}`}
        className="seg-op"
        role="option"
        aria-selected={elegida}
        aria-disabled={noElegible(f) || undefined}
        data-sinsesion={f.sinSesion ? "" : undefined}
        data-cupo={sin ? "sin" : poco ? "poco" : undefined}
        data-actual={f.actual ? "" : undefined}
        data-enviando={enviando === f.opcion.id ? "" : undefined}
        data-marcado={marcado ? "" : undefined}
        data-foco={enDebate && i === resaltada ? "" : undefined}
        onMouseEnter={() => !conEsfuerzo && !noElegible(f) && !enviando && setResaltada(i)}
        onClick={() => {
          if (noElegible(f)) return;
          if (enDebate) {
            setResaltada(i);
            alternar(f.opcion.id);
          } else if (conEsfuerzo) !enviando && setResaltada(i);
          else elegir(f.opcion.id);
        }}
      >
        <span className="seg-n">{f.opcion.nombre}</span>
        <span className="seg-m">{f.sinSesion ? <MotivoSesion s={f.sinSesion} /> : f.opcion.desc}</span>
        {enviando === f.opcion.id ? (
          <span className="seg-e" data-e="envio" role="status">
            {t(de === "revisar" ? "revision.revisando" : "seguir.continuando")}
          </span>
        ) : marcado ? (
          <span className="seg-e" data-e="marcado">
            <Check size={11} strokeWidth={2.4} aria-hidden="true" />
            {t("debate.elegido")}
          </span>
        ) : f.sinSesion ? (
          <span className="seg-e" data-e="sinsesion">
            <Ban size={11} strokeWidth={2.4} aria-hidden="true" />
            {t("revision.sinSesionEtiqueta")}
          </span>
        ) : f.actual ? (
          <span className="seg-e" data-e="actual">
            <Check size={11} strokeWidth={2.4} aria-hidden="true" />
            {t("seguir.actual")}
          </span>
        ) : sin ? (
          <span className="seg-e" data-e="sin">
            <Ban size={11} strokeWidth={2.4} aria-hidden="true" />
            {f.cupo?.vuelve != null ? t("selector.sinCupoHasta", { cuando: cuandoFuturo(f.cupo.vuelve) }) : t("selector.sinCupo")}
          </span>
        ) : poco ? (
          <span className="seg-e" data-e="poco">
            <Clock size={11} strokeWidth={2.4} aria-hidden="true" />
            {t("selector.pocoCupoTip", { n: Math.round(f.cupo?.libre ?? 0) })}
          </span>
        ) : null}
      </div>
    );
  };
  return createPortal(
    <div className="seg-fondo" data-seguir data-saliendo={saliendo ? "" : undefined} onMouseDown={(e) => e.target === e.currentTarget && !enviando && alCerrar()}>
      <div ref={raiz} className="seg" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} tabIndex={-1} onKeyDown={tecla}>
        <div className="seg-cab">
          <span className="seg-ico" aria-hidden="true">
            {enDebate ? <MessagesSquare size={16} strokeWidth={2.2} /> : de === "revisar" ? <ScanSearch size={16} strokeWidth={2.2} /> : <ArrowRightLeft size={16} strokeWidth={2.2} />}
          </span>
          <div className="seg-txt">
            <h3 id={`${id}-t`} className="seg-t">
              {t(enDebate ? "debate.titulo" : de === "revisar" ? "revision.titulo" : "seguir.titulo")}
            </h3>
            <p id={`${id}-d`} className="seg-d">
              {t(enDebate ? "debate.desc" : de === "revisar" ? "revision.desc" : de === "worker" ? "seguir.descWorker" : "seguir.descLider")}
            </p>
          </div>
        </div>
        {alDebatir ? (
          <div className="dbt-modo">
            <label className="dbt-modo-t" htmlFor={`${id}-deb`}>
              <span className="dbt-modo-n">{t("debate.modo")}</span>
              <span className="dbt-modo-d">{t("debate.modoDesc")}</span>
            </label>
            <Interruptor id={`${id}-deb`} activo={debate} disabled={!!enviando} alCambiar={setDebate} />
          </div>
        ) : null}
        <label className="seg-buscar">
          <Search size={14} strokeWidth={2} aria-hidden="true" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={t("seguir.buscar")}
            aria-label={t("seguir.buscar")}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-l`}
            aria-activedescendant={resaltada >= 0 ? `${id}-o${resaltada}` : undefined}
            disabled={!!enviando}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="seg-lista mov-lista" ref={lista} id={`${id}-l`} role="listbox" aria-multiselectable={enDebate || undefined} aria-label={t("seguir.lista")} aria-busy={!!enviando}>
          {!grupos.length ? <p className="seg-vacio">{t("seguir.sinResultados")}</p> : null}
          {grupos.map((g) => {
            const abierto = plegadasAbiertas(g, expandidos, buscando, marcados);
            const titulo = g.tituloPlegadas ?? t("modelo.anteriores");
            return (
              <Fragment key={g.clave}>
                <div className="seg-grupo" role="presentation">
                  {g.nombre}
                </div>
                {g.filas.map(dibujarFila)}
                {g.plegadas.length > 0 ? (
                  buscando ? (
                    <>
                      <div className="seg-sub" role="presentation">
                        {titulo}
                      </div>
                      {g.plegadas.map(dibujarFila)}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="seg-sub seg-sub-btn"
                        aria-expanded={abierto}
                        disabled={!!enviando}
                        onClick={() => setExpandidos((prev) => ({ ...prev, [g.clave]: !abierto }))}
                      >
                        <ChevronRight size={12} strokeWidth={2.2} className="seg-sub-chev" aria-hidden="true" />
                        <span className="seg-sub-t">{titulo}</span>
                        <span className="seg-sub-n">{g.plegadas.length}</span>
                      </button>
                      {abierto ? g.plegadas.map(dibujarFila) : null}
                    </>
                  )
                ) : null}
              </Fragment>
            );
          })}
        </div>
        {error ? (
          <div className="caja-error" role="alert">
            {error}
          </div>
        ) : null}
        {enDebate ? (
          <>
            {marcados.length ? (
              <ul className="dbt-elegidos" aria-label={t("debate.elegidos")}>
                {marcados.map((m) => {
                  const o = esfuerzos?.(m);
                  const nivel = esfuerzoDe(m);
                  return (
                    <li key={m} className="dbt-el">
                      <span className="dbt-el-n">{nombreDe(m)}</span>
                      {o && o.niveles.length ? (
                        <div className="seg-esf" role="radiogroup" aria-label={t("revision.esfuerzoDe", { modelo: nombreDe(m) })}>
                          {o.niveles.map((n) => (
                            <button key={n} type="button" role="radio" aria-checked={n === nivel} className="seg-esf-b" disabled={!!enviando} onClick={() => setEsfuerzosDeb((x) => ({ ...x, [m]: n }))}>
                              {n === nivel ? <Check size={11} strokeWidth={2.4} aria-hidden="true" /> : null}
                              {n}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button type="button" className="dbt-quitar" aria-label={t("debate.quitar", { modelo: nombreDe(m) })} disabled={!!enviando} onClick={() => alternar(m)}>
                        <X size={13} strokeWidth={2.4} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="seg-esf" role="radiogroup" aria-label={t("debate.rondas")}>
              <span className="seg-esf-t" aria-hidden="true">
                {t("debate.rondas")}
              </span>
              {RONDAS_DEBATE.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={n === rondas} className="seg-esf-b" disabled={!!enviando} onClick={() => setRondas(n)}>
                  {n === rondas ? <Check size={11} strokeWidth={2.4} aria-hidden="true" /> : null}
                  {n}
                </button>
              ))}
            </div>
            <p className="dbt-ayuda" role="status">
              {debatible ? t("debate.ayudaCosto", { n: marcados.length, llamadas: peorCasoLlamadas(marcados.length, rondas), proveedores: proveedores.join(", ") }) : t("debate.ayudaElegi", { n: marcados.length })}
            </p>
          </>
        ) : null}
        {!enDebate && conEsfuerzo && marcada && ofrecidos && ofrecidos.niveles.length ? (
          <div className="seg-esf" role="radiogroup" aria-label={t("revision.esfuerzoDe", { modelo: filas[resaltada]?.opcion.nombre ?? "" })}>
            <span className="seg-esf-t" aria-hidden="true">
              {t("revision.esfuerzo")}
            </span>
            {ofrecidos.niveles.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === esfuerzo}
                className="seg-esf-b"
                disabled={!!enviando}
                onClick={() => setEsfuerzoElegido({ modelo: marcada, nivel: n })}
              >
                {n === esfuerzo ? <Check size={11} strokeWidth={2.4} aria-hidden="true" /> : null}
                {n}
              </button>
            ))}
          </div>
        ) : null}
        <div className="seg-pie">
          <Boton className="seg-cancelar" disabled={!!enviando} onClick={alCerrar}>
            {t("seguir.cancelar")}
          </Boton>
          {enDebate ? (
            <Boton primario disabled={!!enviando || !debatible} onClick={empezarDebate}>
              {enviando ? t("debate.iniciando") : t("debate.empezar")}
            </Boton>
          ) : conEsfuerzo ? (
            <Boton primario disabled={!!enviando || !marcada} onClick={() => marcada && elegir(marcada, esfuerzo)}>
              {t("revision.empezar")}
            </Boton>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
