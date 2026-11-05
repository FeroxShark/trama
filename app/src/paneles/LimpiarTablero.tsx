// «Limpiar» del Tablero: un diálogo propio de Trama (nunca `confirm()`), del mismo estilo que «Limpiar chats» (src/barra/Limpiar.tsx), para
// cerrar en masa lo que ya no hace falta. Filtros (sin tocar hace tantos días, proyecto, tipo) y lo desactualizado sugerido y marcado:
// proyecto retirado, rama ya integrada, prueba de una versión vieja. Vista previa con el número y la lista; casillas para sacar alguno; un
// botón que dice cuántos cierra. NUNCA borra: cierra a `tirado` (`tablero tirar`, por item y de a pocos a la vez, con el progreso a la vista)
// y deja la tanda guardada (datos/tablero-tanda.ts) para «Deshacer», que reabre cada item en la columna de donde salió. Qué entra lo decide
// datos/tablero-limpiar.ts (puro, tests/tablero-limpiar.test.ts). Mientras corre, la lista queda fija: el tablero se relee con cada cierre.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Brush, Check, GitMerge, History, Undo2, X } from "lucide-react";
import { version as VERSION_TRAMA } from "../../package.json";
import { fuente } from "../datos/fuente";
import { fuenteTablero } from "../datos/fuenteTablero";
import { useNombreProyecto } from "../datos/proyectos";
import { numero, retirado, type ItemId, type Tablero } from "../datos/tablero";
import {
  DIAS_TABLERO,
  TIPOS_LIMPIAR,
  aCerrar,
  abiertosConMotivos,
  candidatosTablero,
  contarMotivos,
  correrEnLote,
  leerVersion,
  marcadoDeEntrada,
  tandaDe,
  type CandidatoTablero,
  type Filtros,
  type Motivo,
  type TipoLimpiar,
  type Version,
} from "../datos/tablero-limpiar";
import { guardarTanda, useTanda } from "../datos/tablero-tanda";
import { useFoco } from "../foco";
import { t, type ClaveSola } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Boton, Chip } from "../ui/componentes";
import "../hilo/seguir-dialogo.css";
import "../barra/limpiar-chats.css";
import "./limpiar-tablero.css";

const VERSION: Version = leerVersion(VERSION_TRAMA) ?? [0, 0, 0];

const TIPO: Record<TipoLimpiar, ClaveSola> = { prueba: "tbl.tipo.prueba", pregunta: "tbl.tipo.pregunta", idea: "tbl.tipo.idea" };
const MOTIVO: Record<Motivo, ClaveSola> = { retirado: "tbl.motivo.retirado", integrada: "tbl.motivo.integrada", vieja: "tbl.motivo.vieja" };
const ICONO = { retirado: Archive, integrada: GitMerge, vieja: History } as const;

/** Lo que dejó una limpieza: se dice arriba del tablero, junto a Deshacer. */
export type Resultado = { texto: string; falla: boolean };

type Props = {
  datos: Tablero;
  /** Termina (o se cancela): cierra el diálogo. Con `resultado`, algo se cerró (o falló) y se dice. */
  alCerrar: (resultado?: Resultado) => void;
  /** Captura y pruebas: "ahora", y las corridas integradas si no se quieren leer de `pa`. */
  ahora?: number;
  integradas?: ReadonlySet<string>;
};

const textoDias = (n: number) => (n === 0 ? t("tbl.cualquiera") : t("tbl.diasN", { n }));

export function LimpiarTablero({ datos, alCerrar, ahora, integradas: integradasDadas }: Props) {
  useIdioma();
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const nombre = useNombreProyecto();
  const [dias, setDias] = useState<number>(0);
  const [proyecto, setProyecto] = useState<string | null>(null);
  const [tipos, setTipos] = useState<ReadonlySet<TipoLimpiar>>(new Set(TIPOS_LIMPIAR));
  const [soloSugeridos, setSoloSugeridos] = useState(true);
  const [marcas, setMarcas] = useState<ReadonlyMap<ItemId, boolean>>(new Map());
  // Las corridas ya integradas salen de `pa --hilos`; hasta que lleguen no se sugiere ni se cierra nada (por las dudas).
  const [integradas, setIntegradas] = useState<ReadonlySet<string> | null>(integradasDadas ?? null);
  useEffect(() => {
    if (integradasDadas) return;
    let vivo = true;
    void fuente
      .hilos()
      .then((r) => vivo && setIntegradas(new Set(r.hilos.filter((h) => h.estado === "integrado").map((h) => h.id))))
      .catch(() => vivo && setIntegradas(new Set()));
    return () => void (vivo = false);
  }, [integradasDadas]);
  // Cerrando: la lista que se está cerrando y cuántos van. Fija: el tablero cambia con cada cierre.
  const [cerrando, setCerrando] = useState<{ lista: CandidatoTablero[]; listos: number } | null>(null);
  const parar = useRef(false);

  const s = ahora ?? Date.now();
  const todos = useMemo(
    () => (integradas ? abiertosConMotivos(datos, { retirados: new Set(datos.proyectos.filter(retirado).map((p) => p.proyecto)), integradas, version: VERSION }, s) : []),
    [datos, integradas, s],
  );
  const filtros: Filtros = { dias, proyecto, tipos, soloSugeridos };
  const lista = useMemo(() => candidatosTablero(todos, filtros), [todos, dias, proyecto, tipos, soloSugeridos]);
  // Cerrando, la lista es la que se mandó: el tablero se relee con cada cierre y las filas no pueden irse de a una.
  const mostrada = cerrando ? cerrando.lista : lista;
  const marcados = cerrando ? cerrando.lista : aCerrar(lista, filtros, marcas);
  const idsMarcados = useMemo(() => new Set(marcados.map((c) => c.item.id)), [marcados]);
  const motivos = useMemo(() => contarMotivos(todos), [todos]);
  const proyectos = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of todos) n.set(c.item.proyecto, (n.get(c.item.proyecto) ?? 0) + 1);
    return [...n].sort((a, b) => nombre(a[0] || "~").localeCompare(nombre(b[0] || "~"), undefined, { sensitivity: "base" }));
  }, [todos, nombre]);

  const salir = () => {
    if (cerrando) parar.current = true;
    else alCerrar();
  };
  useFoco(raiz, { alCerrar: salir, enfocar: "primero" });

  const poner = (c: CandidatoTablero, v: boolean) =>
    setMarcas((m) => {
      const n = new Map(m);
      if (v === marcadoDeEntrada(c, filtros)) n.delete(c.item.id);
      else n.set(c.item.id, v);
      return n;
    });
  const todosMarcados = marcados.length === mostrada.length;
  const alternarTodos = () => setMarcas(new Map(lista.map((c) => [c.item.id, !todosMarcados])));
  const alternarTipo = (k: TipoLimpiar) =>
    setTipos((a) => {
      const n = new Set(a);
      if (!n.delete(k)) n.add(k);
      return n;
    });

  const cerrar = async () => {
    if (!marcados.length || cerrando) return;
    const lista0 = marcados;
    parar.current = false;
    setCerrando({ lista: lista0, listos: 0 });
    const r = await correrEnLote(lista0, (c) => fuenteTablero.tirar(c.item.id), {
      alAvanzar: (listos) => setCerrando({ lista: lista0, listos }),
      parar: () => parar.current,
    });
    // La tanda se guarda acá y no en quien abre el diálogo: si el panel se cierra a mitad de camino, Deshacer igual la tiene.
    if (r.hechos.length) guardarTanda(tandaDe(r.hechos, Date.now()));
    const hechos = r.hechos.length;
    const texto = r.fallos.length
      ? t("tbl.hechoFallas", { n: hechos, fallas: r.fallos.length, motivo: r.fallos[0].error })
      : t(hechos === 1 ? "tbl.hecho1" : "tbl.hechoN", { n: hechos });
    alCerrar(hechos || r.fallos.length ? { texto, falla: r.fallos.length > 0 } : undefined);
  };

  const titulo = t("tbl.titulo");
  const sinDatos = integradas === null;

  return createPortal(
    <div className="seg-fondo" data-limpiar-tablero onMouseDown={(e) => e.target === e.currentTarget && salir()}>
      <div ref={raiz} className="seg lim tbl" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} tabIndex={-1}>
        <div className="seg-cab">
          <span className="seg-ico" aria-hidden="true">
            <Brush size={16} strokeWidth={2.2} />
          </span>
          <div className="seg-txt">
            <h3 id={`${id}-t`} className="seg-t">
              {titulo}
            </h3>
            <p id={`${id}-d`} className="seg-d">
              {t("tbl.desc")}
            </p>
          </div>
        </div>

        <fieldset className="tbl-filtros" disabled={!!cerrando}>
          <div className="lim-plazo">
            <span id={`${id}-p`} className="lim-plazo-t">
              {t("tbl.antig")}
            </span>
            <div className="lim-seg" role="radiogroup" aria-labelledby={`${id}-p`}>
              {DIAS_TABLERO.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={dias === d} className="lim-seg-b" onClick={() => setDias(d)}>
                  {dias === d ? <Check size={12} aria-hidden="true" /> : null}
                  {textoDias(d)}
                </button>
              ))}
            </div>
          </div>
          <div className="lim-plazo">
            <span id={`${id}-k`} className="lim-plazo-t">
              {t("tbl.tipo")}
            </span>
            <div className="lim-seg" role="group" aria-labelledby={`${id}-k`}>
              {TIPOS_LIMPIAR.map((k) => (
                <button key={k} type="button" aria-pressed={tipos.has(k)} className="lim-seg-b" onClick={() => alternarTipo(k)}>
                  {tipos.has(k) ? <Check size={12} aria-hidden="true" /> : null}
                  {t(TIPO[k])}
                </button>
              ))}
            </div>
          </div>
          <div className="lim-plazo">
            <label htmlFor={`${id}-y`} className="lim-plazo-t">
              {t("tbl.proyecto")}
            </label>
            <select id={`${id}-y`} className="pn-campo tbl-sel" value={proyecto ?? ""} onChange={(e) => setProyecto(e.target.value === "" ? null : e.target.value)}>
              <option value="">{t("tbl.todosProy")}</option>
              {proyectos.map(([p, n]) => (
                <option key={p || "-"} value={p}>
                  {`${p ? nombre(p) : t("pd.sinProyecto")} (${n})`}
                </option>
              ))}
            </select>
            <label className="tbl-solo">
              <input type="checkbox" className="lim-chk" checked={soloSugeridos} onChange={(e) => setSoloSugeridos(e.target.checked)} />
              {t("tbl.soloSug")}
            </label>
          </div>
        </fieldset>
        {motivos.retirado + motivos.integrada + motivos.vieja > 0 ? <p className="tbl-resumen">{t("tbl.resumen", motivos)}</p> : null}

        {sinDatos ? (
          <p className="seg-vacio" role="status">
            {t("tbl.leyendo")}
          </p>
        ) : mostrada.length === 0 ? (
          <p className="seg-vacio" role="status">
            {t("tbl.vacio")}
          </p>
        ) : (
          <>
            <div className="lim-barra">
              <span role="status" aria-live="polite">
                {cerrando ? t("tbl.cerrando", { listos: cerrando.listos, total: cerrando.lista.length }) : t("tbl.marcados", { n: marcados.length, total: mostrada.length })}
              </span>
              <button type="button" className="lim-todos" onClick={alternarTodos} disabled={!!cerrando}>
                {t(todosMarcados ? "tbl.desmarcarTodos" : "tbl.marcarTodos")}
              </button>
            </div>
            {cerrando ? <progress className="tbl-prog" max={cerrando.lista.length} value={cerrando.listos} aria-label={t("tbl.cerrando", { listos: cerrando.listos, total: cerrando.lista.length })} /> : null}
            <ul className="lim-lista" aria-label={t("tbl.lista")}>
              {mostrada.map((c) => (
                <Fila key={String(c.item.id)} c={c} marcado={idsMarcados.has(c.item.id)} bloqueado={!!cerrando} alAlternar={(v) => poner(c, v)} nombre={nombre} />
              ))}
            </ul>
          </>
        )}
        <p className="lim-nota">{t("tbl.nota")}</p>
        <div className="seg-pie lim-pie">
          <Boton className="seg-cancelar" onClick={salir}>
            {t(cerrando ? "tbl.parar" : "tbl.cancelar")}
          </Boton>
          <Boton primario className="lim-archivar" disabled={!marcados.length || !!cerrando || sinDatos} onClick={() => void cerrar()}>
            {t("tbl.cerrar", { n: marcados.length })}
          </Boton>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Fila({ c, marcado, bloqueado, alAlternar, nombre }: { c: CandidatoTablero; marcado: boolean; bloqueado: boolean; alAlternar: (v: boolean) => void; nombre: (p: string) => string }) {
  const i = c.item;
  const hace = c.dias === 0 ? t("tbl.hoy") : t("tbl.haceD", { n: c.dias });
  return (
    <li className="lim-fila tbl-fila" data-marcado={marcado ? "" : undefined} data-limpiar-fila={String(i.id)}>
      <label className="lim-label">
        <input type="checkbox" className="lim-chk" checked={marcado} disabled={bloqueado} onChange={(e) => alAlternar(e.target.checked)} />
        <span className="lim-txt">
          <span className="lim-nombre" title={i.titulo}>
            {i.titulo}
          </span>
          <span className="lim-meta">
            #{numero(i.id)} · {i.proyecto ? nombre(i.proyecto) : t("pd.sinProyecto")} · {t(TIPO[c.tipo])} · {hace}
          </span>
        </span>
        {c.motivos.map((m) => {
          const Ico = ICONO[m];
          return (
            <Chip key={m}>
              <Ico size={11} strokeWidth={2.4} aria-hidden="true" /> {t(MOTIVO[m])}
            </Chip>
          );
        })}
      </label>
    </li>
  );
}

/**
 * La franja de arriba del Tablero tras limpiar: lo que se cerró y «Deshacer», que reabre cada item de la última tanda en la columna de
 * donde salió (`tablero mover`, por item, con el progreso). Sin tanda y sin mensaje no pinta nada. «Ocultar» la olvida: lo cerrado sigue en `tirado`.
 */
export function AvisoLimpieza({ resultado, alOcultar, alCambiar }: { resultado: Resultado | null; alOcultar: () => void; alCambiar: () => void }) {
  useIdioma();
  const tanda = useTanda();
  const [reabriendo, setReabriendo] = useState<{ listos: number; total: number } | null>(null);
  const [dijo, setDijo] = useState<Resultado | null>(null);
  const mostrado = dijo ?? resultado;
  if (!tanda && !mostrado && !reabriendo) return null;

  const deshacer = async () => {
    if (!tanda || reabriendo) return;
    setDijo(null);
    setReabriendo({ listos: 0, total: tanda.items.length });
    const r = await correrEnLote(tanda.items, (x) => fuenteTablero.mover(x.id, x.columna), { alAvanzar: (listos, total) => setReabriendo({ listos, total }) });
    // Lo que no se pudo reabrir queda en la tanda para reintentar; lo reabierto sale.
    const reabiertos = new Set(r.hechos);
    const quedan = tanda.items.filter((x) => !reabiertos.has(x));
    guardarTanda(quedan.length ? { ...tanda, items: quedan } : null);
    setReabriendo(null);
    setDijo(
      r.fallos.length
        ? { texto: t("tbl.deshechoFallas", { n: r.hechos.length, fallas: r.fallos.length, motivo: r.fallos[0].error }), falla: true }
        : { texto: t("tbl.deshecho", { n: r.hechos.length }), falla: false },
    );
    alCambiar();
  };

  const texto = reabriendo ? t("tbl.deshaciendo", reabriendo) : (mostrado?.texto ?? t(tanda!.items.length === 1 ? "tbl.hecho1" : "tbl.hechoN", { n: tanda!.items.length }));
  return (
    <div className="tbl-aviso" data-falla={mostrado?.falla && !reabriendo ? "" : undefined} role="status" aria-live="polite" data-aviso-limpieza>
      <span className="tbl-aviso-t">{texto}</span>
      {tanda ? (
        <button type="button" className="tbl-deshacer" disabled={!!reabriendo} onClick={() => void deshacer()}>
          <Undo2 size={13} strokeWidth={2.2} aria-hidden="true" />
          {t("tbl.deshacer")}
        </button>
      ) : null}
      <button
        type="button"
        className="tbl-ocultar"
        disabled={!!reabriendo}
        aria-label={t("tbl.ocultar")}
        onClick={() => {
          guardarTanda(null);
          setDijo(null);
          alOcultar();
        }}
      >
        <X size={14} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
