// «Seguir con otro modelo» (#1791, parte 3): el selector de modelo que abre la acción del menú de un hilo y la de los avisos de límite o de
// «sin cupo». Un diálogo modal en un portal a <body> (como DialogoCambio) con un buscador y la lista de modelos por proveedor; lo que no
// tiene cupo se marca con su hora (ícono y palabra, no sólo el color) y va al final de su proveedor. Elegir una fila llama a `alElegir`
// (el host lanza `pa --seguir-con` o abre un líder nuevo con el resumen); mientras eso corre la lista queda quieta, y si falla el error
// se ve acá y se puede elegir otro. La lógica de la lista (orden, marcas, flechas): seguir-con.ts.
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Ban, Check, Clock, ScanSearch, Search } from "lucide-react";
import { fuente } from "../datos/fuente";
import type { Uso } from "../datos/contrato";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { cuandoFuturo } from "../tiempo";
import { Boton } from "../ui/componentes";
import { estadosCupoModelos } from "./cupo-modelos.ts";
import { filasSeguir, listaSeguir, moverSeguir, noElegible, resaltadaInicial, sinSesionDe, type OpcionSeguir, type SinSesion } from "./seguir-con.ts";
import "./seguir-dialogo.css";

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

export function SeguirCon({ de, opciones, actual, alElegir, alCerrar, preferido, busquedaInicial = "", esfuerzos }: Props) {
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
  const cupos = useMemo(() => estadosCupoModelos(opciones.map((o) => o.id), uso, Date.now() / 1000), [opciones, uso]);
  const grupos = useMemo(() => listaSeguir(opciones, cupos, actual, busqueda, sesiones), [opciones, cupos, actual, busqueda, sesiones]);
  const filas = useMemo(() => filasSeguir(grupos), [grupos]);
  const [resaltada, setResaltada] = useState(-1);
  // Al cambiar la búsqueda o llegar el cupo, la resaltada vuelve a la primera que se puede usar ya.
  useEffect(() => {
    const p = preferido ? filas.findIndex((f) => f.opcion.id === preferido && !noElegible(f) && !f.cupo?.sin) : -1;
    setResaltada(p >= 0 ? p : resaltadaInicial(filas));
  }, [filas, preferido]);
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
      setResaltada((i) => moverSeguir(filas, i, e.key as "ArrowDown" | "ArrowUp"));
    } else if (e.key === "Enter" && resaltada >= 0 && filas[resaltada] && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      elegir(filas[resaltada].opcion.id, esfuerzo);
    }
  };

  let n = -1;
  return createPortal(
    <div className="seg-fondo" data-seguir onMouseDown={(e) => e.target === e.currentTarget && !enviando && alCerrar()}>
      <div ref={raiz} className="seg" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} tabIndex={-1} onKeyDown={tecla}>
        <div className="seg-cab">
          <span className="seg-ico" aria-hidden="true">
            {de === "revisar" ? <ScanSearch size={16} strokeWidth={2.2} /> : <ArrowRightLeft size={16} strokeWidth={2.2} />}
          </span>
          <div className="seg-txt">
            <h3 id={`${id}-t`} className="seg-t">
              {t(de === "revisar" ? "revision.titulo" : "seguir.titulo")}
            </h3>
            <p id={`${id}-d`} className="seg-d">
              {t(de === "revisar" ? "revision.desc" : de === "worker" ? "seguir.descWorker" : "seguir.descLider")}
            </p>
          </div>
        </div>
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
        <div className="seg-lista" ref={lista} id={`${id}-l`} role="listbox" aria-label={t("seguir.lista")} aria-busy={!!enviando}>
          {!filas.length ? <p className="seg-vacio">{t("seguir.sinResultados")}</p> : null}
          {grupos.map((g) => (
            <Fragment key={g.clave}>
              <div className="seg-grupo" role="presentation">
                {g.nombre}
              </div>
              {g.filas.map((f) => {
                const i = ++n;
                const sin = !!f.cupo?.sin;
                const poco = !sin && !!f.cupo?.poco;
                const elegida = i === resaltada;
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
                    onMouseEnter={() => !conEsfuerzo && !noElegible(f) && !enviando && setResaltada(i)}
                    onClick={() => {
                      if (noElegible(f)) return;
                      if (conEsfuerzo) !enviando && setResaltada(i);
                      else elegir(f.opcion.id);
                    }}
                  >
                    <span className="seg-n">{f.opcion.nombre}</span>
                    <span className="seg-m">{f.sinSesion ? <MotivoSesion s={f.sinSesion} /> : f.opcion.desc}</span>
                    {enviando === f.opcion.id ? (
                      <span className="seg-e" data-e="envio" role="status">
                        {t(de === "revisar" ? "revision.revisando" : "seguir.continuando")}
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
              })}
            </Fragment>
          ))}
        </div>
        {error ? (
          <div className="caja-error" role="alert">
            {error}
          </div>
        ) : null}
        {conEsfuerzo && marcada && ofrecidos && ofrecidos.niveles.length ? (
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
          {conEsfuerzo ? (
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
