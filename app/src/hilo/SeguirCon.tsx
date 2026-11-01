// «Seguir con otro modelo» (#1791, parte 3): el selector de modelo que abre la acción del menú de un hilo y la de los avisos de límite o de
// «sin cupo». Un diálogo modal en un portal a <body> (como DialogoCambio) con un buscador y la lista de modelos por proveedor; lo que no
// tiene cupo se marca con su hora (ícono y palabra, no sólo el color) y va al final de su proveedor. Elegir una fila llama a `alElegir`
// (el host lanza `pa --seguir-con` o abre un líder nuevo con el resumen); mientras eso corre la lista queda quieta, y si falla el error
// se ve acá y se puede elegir otro. La lógica de la lista (orden, marcas, flechas): seguir-con.ts.
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Ban, Check, Clock, Search } from "lucide-react";
import { fuente } from "../datos/fuente";
import type { Uso } from "../datos/contrato";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { mensaje } from "../puente";
import { cuandoFuturo } from "../tiempo";
import { Boton } from "../ui/componentes";
import { estadosCupoModelos } from "./cupo-modelos.ts";
import { filasSeguir, listaSeguir, moverSeguir, resaltadaInicial, type OpcionSeguir } from "./seguir-con.ts";
import "./seguir-dialogo.css";

type Props = {
  /** Qué se sigue: cambia lo que el diálogo dice que va a pasar. */
  de: "worker" | "lider";
  /** Los modelos entre los que se elige (los de un líder, o los de un worker). */
  opciones: readonly OpcionSeguir[];
  /** El modelo con el que venía (se ve, pero no se elige). */
  actual: string | null;
  /** Elegir un modelo: devuelve cuando ya está hecho (el diálogo lo cierra el host) o rechaza con el motivo (se muestra acá). */
  alElegir: (modelo: string) => Promise<void>;
  alCerrar: () => void;
  /** Captura: nace con esta búsqueda escrita. */
  busquedaInicial?: string;
};

export function SeguirCon({ de, opciones, actual, alElegir, alCerrar, busquedaInicial = "" }: Props) {
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
  const cupos = useMemo(() => estadosCupoModelos(opciones.map((o) => o.id), uso, Date.now() / 1000), [opciones, uso]);
  const grupos = useMemo(() => listaSeguir(opciones, cupos, actual, busqueda), [opciones, cupos, actual, busqueda]);
  const filas = useMemo(() => filasSeguir(grupos), [grupos]);
  const [resaltada, setResaltada] = useState(-1);
  // Al cambiar la búsqueda o llegar el cupo, la resaltada vuelve a la primera que se puede usar ya.
  useEffect(() => setResaltada(resaltadaInicial(filas)), [filas]);
  useEffect(() => {
    lista.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [resaltada]);

  useFoco(raiz, { alCerrar: enviando ? undefined : alCerrar, enfocar: "primero" });

  const elegir = (modelo: string) => {
    if (enviando) return;
    setEnviando(modelo);
    setError(null);
    alElegir(modelo).catch((e) => {
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
      elegir(filas[resaltada].opcion.id);
    }
  };

  let n = -1;
  return createPortal(
    <div className="seg-fondo" data-seguir onMouseDown={(e) => e.target === e.currentTarget && !enviando && alCerrar()}>
      <div ref={raiz} className="seg" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} tabIndex={-1} onKeyDown={tecla}>
        <div className="seg-cab">
          <span className="seg-ico" aria-hidden="true">
            <ArrowRightLeft size={16} strokeWidth={2.2} />
          </span>
          <div className="seg-txt">
            <h3 id={`${id}-t`} className="seg-t">
              {t("seguir.titulo")}
            </h3>
            <p id={`${id}-d`} className="seg-d">
              {t(de === "worker" ? "seguir.descWorker" : "seguir.descLider")}
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
                    aria-disabled={f.actual || undefined}
                    data-cupo={sin ? "sin" : poco ? "poco" : undefined}
                    data-actual={f.actual ? "" : undefined}
                    data-enviando={enviando === f.opcion.id ? "" : undefined}
                    onMouseEnter={() => !f.actual && !enviando && setResaltada(i)}
                    onClick={() => !f.actual && elegir(f.opcion.id)}
                  >
                    <span className="seg-n">{f.opcion.nombre}</span>
                    <span className="seg-m">{f.opcion.desc}</span>
                    {enviando === f.opcion.id ? (
                      <span className="seg-e" data-e="envio" role="status">
                        {t("seguir.continuando")}
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
        <div className="seg-pie">
          <Boton className="seg-cancelar" disabled={!!enviando} onClick={alCerrar}>
            {t("seguir.cancelar")}
          </Boton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
