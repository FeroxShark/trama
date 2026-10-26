// Ramas: lo que hicieron los workers y todavía no está en main. Integrar corre
// los tests antes de tocar main; Descartar pide un segundo clic; lo integrado
// hace poco se puede deshacer. B22: lo seguro se integra solo (electron/
// autointegrar.ts, con la llave de arriba); el analista (un líder de la app
// aparte, `rol: "analista"`) recibe el brief de todas y contesta un veredicto
// por rama, que se ve en la fila con su botón; lo que murió con commits se
// retoma con un líder nuevo (src/datos/retomar.ts). B25: lo integrado hace poco
// se ve sano (✓) o en rojo si causó problemas (src/datos/salud.ts: revertida,
// `bien=no` o tests rojos en main después), y lo rojo se manda a verificar y
// arreglar con un líder nuevo en ese proyecto (src/datos/arreglar.ts).
import { useCallback, useEffect, useMemo, useState, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, CircleCheck, CircleHelp, Eye, GitMerge, Skull, Sparkles, Trash2, RotateCcw, MoreHorizontal, Archive, Hourglass, X, type LucideIcon } from "lucide-react";
import { RESORTE } from "../barra/Fila";
import { Reloj, tareaDe, tipoDe } from "../barra/piezas";
import { errorCorto } from "../barra/arbol";
import type { Estado, Hilo, Lider } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { fuentePaneles, type AccionRama, type EstadoAuto, type EstadoSalud } from "../datos/paneles";
import { fueSola, salud as saludDe, type Salud } from "../datos/salud";
import { paraVer, veredictos, type Juicio } from "../datos/analista";
import { ChatLider } from "../hilo/Lider";
import { effortDe, fantasma, MODELO_DEFAULT, modeloDe } from "../hilo/opciones";
import { MODO } from "../modo";
import { pintorHace } from "../tiempo";
import { t as tr } from "../i18n";
import { mensaje } from "../puente";
import { pasoLider, pasoWorker } from "./PasoLanzar";
import { conTexto, type Eleccion } from "./lanzar";
import { conCuenta, cuentas, filtroVigente, pasa, type FiltroRama } from "./ramas-vista";
import "./ramas-vista.css";

/** El ícono de cada veredicto: nunca sólo color. */
const ICONO_V: Record<string, LucideIcon> = { integrar: GitMerge, descartar: Trash2, retomar: RotateCcw, revisar: Eye };
/** El ícono del estado de la rama. */
const ICONO_E: Partial<Record<Estado, LucideIcon>> = { murio: Skull, listo: CircleCheck, entregado: CircleCheck, decision: CircleHelp, trabajando: Hourglass, colgado: Hourglass, archivado: Archive };

export type PropsRamas = {
  hilos: Hilo[] | null;
  /** Los mismos mapas de la barra: lo que se integra acá se ve cerrado allá. */
  optimista: Map<string, Estado>;
  errores: Map<string, string>;
  /** Acciones que `pa` todavía no terminó. */
  enCurso: Set<string>;
  alActuar: (id: string, accion: AccionRama) => void;
  alAbrir: (id: string) => void;
  /** Retomar (B22): un líder nuevo con el prompt de src/datos/retomar.ts, con lo elegido en el paso previo. Rechaza si no se pudo. */
  alRetomar: (h: Hilo, e: Eleccion) => Promise<void>;
  /** "Mandar a verificar y arreglar" (B25): un líder nuevo en ese proyecto, con lo elegido en el paso previo. Rechaza si no se pudo. */
  alArreglar: (h: Hilo, estado: Estado, e: Eleccion) => Promise<void>;
  /** Actualizar: un worker de `pa` que rebasa la rama sobre main y resuelve el choque, con lo elegido en el paso previo. Rechaza si no se pudo. */
  alActualizar: (h: Hilo, e: Eleccion) => Promise<void>;
  /** Las ramas cuyo Integrar chocó con main (80) hace un momento: ofrecen Actualizar. */
  conflictos: ReadonlySet<string>;
  /** El analista de Ramas del statusline (`null`: no hay). */
  analista: Lider | null;
};

type Item = { h: Hilo; estado: Estado };

/** Con estos estados la rama ya no está pendiente. */
const RESUELTO: ReadonlySet<Estado> = new Set(["integrado", "descartado", "revertido"]);
const VIVO: ReadonlySet<Estado> = new Set(["trabajando", "colgado"]);
/** Cuántas integradas se ofrecen para deshacer. */
const INTEGRADAS = 8;
/** Cuánto queda armado el Descartar esperando el segundo clic. */
const ARMADO_MS = 4000;

const fin = (h: Hilo) => h.inicio + (h.duracion_s ?? 0);

/** Las ramas sin integrar, por proyecto (lo más nuevo arriba), y las integradas hace poco (también las revertidas). */
export function ramas(hilos: Hilo[], optimista: Map<string, Estado>) {
  // Un `--seguir` trabaja sobre la rama del hilo que continúa: una fila por rama, la del último.
  const porRama = new Map<string, Item>();
  for (const h of hilos) {
    const k = h.rama ?? h.id;
    const otro = porRama.get(k);
    if (!otro || h.inicio > otro.h.inicio) porRama.set(k, { h, estado: optimista.get(h.id) ?? h.estado });
  }
  const grupos = new Map<string, Item[]>();
  const integradas: Item[] = [];
  for (const { h, estado } of porRama.values()) {
    if (estado === "integrado" || estado === "revertido") integradas.push({ h, estado });
    else if (h.rama && h.commits > 0 && !RESUELTO.has(estado)) {
      const g = grupos.get(h.proyecto);
      if (g) g.push({ h, estado });
      else grupos.set(h.proyecto, [{ h, estado }]);
    }
  }
  const pendientes = [...grupos].map(([proyecto, filas]) => ({
    proyecto,
    filas: filas.sort((a, b) => fin(b.h) - fin(a.h)),
  }));
  pendientes.sort((a, b) => fin(b.filas[0].h) - fin(a.filas[0].h));
  // `pa --hilos` no dice cuándo se integró: se ordena por cuándo terminó el worker.
  integradas.sort((a, b) => fin(b.h) - fin(a.h));
  return { pendientes, integradas: integradas.slice(0, INTEGRADAS) };
}

const commits = (n: number) => tr(n === 1 ? "comun.commit" : "comun.commits", { n });

/** "Integrar solo lo seguro": lo que dice el main, y lo que cambia. */
function useAuto(): [EstadoAuto | null, (si: boolean) => void] {
  const [auto, setAuto] = useState<EstadoAuto | null>(null);
  useEffect(() => {
    let vivo = true;
    void fuentePaneles.auto.leer().then((e) => vivo && setAuto(e), () => {});
    const soltar = fuentePaneles.auto.alCambiar((e) => vivo && setAuto(e));
    return () => {
      vivo = false;
      soltar();
    };
  }, []);
  const prender = useCallback((si: boolean) => {
    setAuto((a) => a && { ...a, prendido: si });
    fuentePaneles.auto.prender(si).catch(() => setAuto((a) => a && { ...a, prendido: !si }));
  }, []);
  return [auto, prender];
}

/** La salud de lo integrado (B25): lo que dice el main, y cada cambio. */
function useSalud(): EstadoSalud | null {
  const [s, setS] = useState<EstadoSalud | null>(null);
  useEffect(() => {
    let vivo = true;
    void fuentePaneles.salud.leer().then((e) => vivo && setS(e), () => {});
    const soltar = fuentePaneles.salud.alCambiar((e) => vivo && setS(e));
    return () => {
      vivo = false;
      soltar();
    };
  }, []);
  return s;
}

export function Ramas({ hilos, optimista, errores, enCurso, alActuar, alAbrir, alRetomar, alArreglar, alActualizar, conflictos, analista }: PropsRamas) {
  const { pendientes, integradas } = useMemo(() => ramas(hilos ?? [], optimista), [hilos, optimista]);
  // Descartar: el primer clic lo arma, el segundo sobre el mismo botón descarta.
  const [armado, setArmado] = useState<string | null>(() =>
    MODO.captura === "ramas-confirmar" ? (pendientes[0]?.filas.find((f) => !VIVO.has(f.estado))?.h.id ?? null) : null,
  );
  useEffect(() => {
    if (!armado || MODO.captura) return;
    const t = window.setTimeout(() => setArmado(null), ARMADO_MS);
    return () => clearTimeout(t);
  }, [armado]);
  const [auto, prenderAuto] = useAuto();
  const sanas = useSalud();
  const [filtro, setFiltro] = useState<FiltroRama>("todas");
  // Los proyectos plegados (clic en su encabezado).
  const [plegados, setPlegados] = useState<ReadonlySet<string>>(new Set());
  const plegar = (p: string) =>
    setPlegados((a) => {
      const n = new Set(a);
      if (!n.delete(p)) n.add(p);
      return n;
    });

  // El analista: el del statusline o, hasta que aparezca ahí, el recién lanzado.
  const [nacido, setNacido] = useState<Lider | null>(null);
  // El recién lanzado manda sobre el del statusline: ése puede ser el viejo, recién cerrado.
  const an = nacido && analista?.id !== nacido.id ? nacido : (analista ?? nacido);
  const [abierto, setAbierto] = useState(MODO.captura === "ramas-analista");
  const [lanzando, setLanzando] = useState(false);
  const [errorAn, setErrorAn] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState("");
  const filas = useMemo(() => pendientes.flatMap((g) => g.filas.map((f) => f.h)), [pendientes]);
  const juicios = useMemo(() => {
    const ids = new Set(filas.map((h) => h.id));
    return (an && veredictos(respuesta, ids)) || new Map<string, Juicio>();
  }, [an, respuesta, filas]);

  const cuenta = useMemo(() => cuentas(filas.map((h) => h.id), juicios), [filas, juicios]);
  const vigente = filtroVigente(filtro, cuenta);

  /** Lanza al analista (o le manda el brief al que ya está) con lo elegido. Rechaza si no se pudo. */
  const lanzarAnalista = async ({ modelo, effort, texto: extra }: Eleccion) => {
    const quietas = filas.filter((h) => !VIVO.has(optimista.get(h.id) ?? h.estado));
    if (lanzando || !quietas.length || an?.ocupado) return;
    setLanzando(true);
    setErrorAn(null);
    try {
      const texto = conTexto(await fuentePaneles.brief(quietas, false), extra);
      // Siempre una conversación nueva: reusar la anterior falla al cambiar de motor (Claude, Gemini, DeepSeek...).
      if (an) await fuente.liderCerrar(an.id, "analista").catch(() => {});
      const e = { texto, modelo, effort, rol: "analista" as const };
      const sid = await fuente.liderNuevo(e);
      setNacido(fantasma(sid, e));
      setRespuesta("");
      setAbierto(true);
    } finally {
      setLanzando(false);
    }
  };
  // Analizar no lanza nada solo: abre el paso previo (el modelo del analista que ya está, o el de routing).
  const analizar = () => {
    if (lanzando || an?.ocupado) return;
    pasoLider("analizar", lanzarAnalista, { modelo: modeloDe(an?.modelo) ?? undefined, effort: effortDe(an?.effort) ?? undefined });
  };
  const cerrarAnalista = useCallback(() => {
    if (an) void fuente.liderCerrar(an.id, "analista").catch(() => {});
    setNacido(null);
    setRespuesta("");
  }, [an]);
  const sinCrear = useCallback(() => {}, []);
  // Una respuesta sin bloque json (seguir charlando) no borra los veredictos de antes.
  const guardarRespuesta = useCallback((t: string) => /```json/.test(t) && setRespuesta(t), []);
  // Captura `ramas-analista`: el analista ya contestó (con fixtures, un veredicto de cada uno).
  useEffect(() => {
    if (MODO.captura === "ramas-analista" && hilos && !an) lanzarAnalista({ modelo: MODELO_DEFAULT, effort: "high", texto: "" }).catch((e) => setErrorAn(mensaje(e)));
  }, [hilos]);

  if (!hilos) return <div className="pn-aviso">{tr("ramas.leyendo")}</div>;

  const total = pendientes.reduce((s, g) => s + g.filas.length, 0);
  const autoPorRama = new Map((auto?.enCurso ?? []).map((e) => [e.rama, e.fase]));
  const fallas = new Map((auto?.fallas ?? []).map((f) => [f.id, f]));
  const solas = new Set((auto?.integradas ?? []).map((x) => x.id));
  const ultimaSola = integradas.find((x) => x.estado === "integrado" && fueSola(x.h.id, sanas, solas));
  const fila = ({ h, estado }: Item) => {
    const f = fallas.get(h.id);
    return (
      <FilaRama
        key={h.id}
        h={h}
        estado={estado}
        error={errores.get(h.id) ?? (f && estado !== "integrado" ? f.error || tr("ramas.autoFallo", { rc: f.rc }) : null)}
        enCurso={enCurso.has(h.id)}
        auto={(h.rama && autoPorRama.get(h.rama)) || null}
        sola={fueSola(h.id, sanas, solas)}
        salud={estado === "integrado" || estado === "revertido" ? saludDe(h.id, estado, sanas) : null}
        alArreglar={alArreglar}
        juicio={juicios.get(h.id) ?? null}
        armado={armado === h.id}
        alArmar={setArmado}
        alActuar={alActuar}
        alAbrir={alAbrir}
        alRetomar={alRetomar}
        alActualizar={alActualizar}
        choco={conflictos.has(h.id) || f?.rc === 80}
      />
    );
  };

  return (
    <>
      <div className="pn-ramas-cab">
        <div className="pn-nota">
          {total === 0 ? tr("ramas.ninguna") : total === 1 ? tr("ramas.pendientes1") : tr("ramas.pendientesN", { n: total })}
        </div>
        {auto ? (
          <button
            type="button"
            className="pn-llave"
            aria-pressed={auto.prendido}
            data-tip={tr("ramas.autoQue")}
            onClick={() => prenderAuto(!auto.prendido)}
          >
            <span className="pn-llave-punto" />
            {tr("ramas.auto")}
          </button>
        ) : null}
      </div>
      {auto ? <div className="pn-nota pn-auto-nota">{tr("ramas.autoExplica", { estado: tr(auto.prendido ? "ramas.autoOn" : "ramas.autoOff") })}</div> : null}

      <section className="pn-analista" data-abierto={abierto && an ? "" : undefined}>
        <div className="pn-analista-cab">
          <button
            type="button"
            className="pn-analista-btn"
            disabled={lanzando || !!an?.ocupado || total === 0}
            onClick={analizar}
          >
            <Sparkles size={13} strokeWidth={1.8} />
            {lanzando ? tr("ramas.analizando") : an ? tr("ramas.reanalizar") : tr("ramas.analizar")}
          </button>
          {an ? (
            <>
              <button
                type="button"
                className="pn-ico pn-analista-pliegue"
                aria-expanded={abierto}
                aria-label={tr(abierto ? "ramas.analistaOcultar" : "ramas.analistaVer")}
                data-tip={tr(abierto ? "ramas.analistaOcultar" : "ramas.analistaVer")}
                onClick={() => setAbierto((a) => !a)}
              >
                <ChevronDown size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="pn-ico"
                aria-label={tr("ramas.analistaCerrar")}
                data-tip={tr("ramas.analistaCerrar")}
                onClick={cerrarAnalista}
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            </>
          ) : null}
        </div>
        {errorAn ? <div className="pn-error">{errorAn}</div> : null}
        {an ? (
          <div className="pn-analista-chat" hidden={!abierto}>
            <ChatLider key={an.id} l={an} alCreado={sinCrear} alNuevo={cerrarAnalista} mirar={false} mostrar={paraVer} alRespuesta={guardarRespuesta} />
          </div>
        ) : null}
      </section>

      {juicios.size > 0 && total > 0 ? (
        <div className="pn-filtros" role="group" aria-label={tr("ramas.filtrar")}>
          <button type="button" className="pn-chip-f" aria-pressed={vigente === "todas"} onClick={() => setFiltro("todas")}>
            {tr("ramas.f.todas")} <b>{total}</b>
          </button>
          {conCuenta(cuenta).map((v) => {
            const I = ICONO_V[v];
            return (
              <button key={v} type="button" className="pn-chip-f" data-veredicto={v} aria-pressed={vigente === v} onClick={() => setFiltro(v)}>
                <I size={12} strokeWidth={2} aria-hidden="true" />
                {tr(`ramas.f.${v}`)} <b>{cuenta[v]}</b>
              </button>
            );
          })}
          {cuenta.sin > 0 ? (
            <button type="button" className="pn-chip-f" aria-pressed={vigente === "sin"} onClick={() => setFiltro("sin")}>
              {tr("ramas.f.sin")} <b>{cuenta.sin}</b>
            </button>
          ) : null}
        </div>
      ) : null}

      <AnimatePresence mode="popLayout" initial={false}>
        {pendientes.map((g) => {
          const visibles = g.filas.filter((f) => pasa(f.h.id, juicios, vigente));
          if (!visibles.length) return null;
          const cerrado = plegados.has(g.proyecto);
          const cs = cuentas(visibles.map((f) => f.h.id), juicios);
          return (
          <motion.section
            key={g.proyecto}
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={RESORTE}
            className="pn-sec"
            aria-label={g.proyecto}
          >
            <h2 className="pn-h pn-h-plegable">
              <button type="button" className="pn-plegar" aria-expanded={!cerrado} onClick={() => plegar(g.proyecto)}>
                <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" data-cerrado={cerrado ? "" : undefined} />
                {g.proyecto} <span className="cuenta">{visibles.length}</span>
              </button>
              {conCuenta(cs).map((v) => {
                const I = ICONO_V[v];
                return (
                  <span key={v} className="pn-mini-v" data-veredicto={v} data-tip={tr(`ramas.f.${v}`)}>
                    <I size={11} strokeWidth={2} aria-hidden="true" />
                    {cs[v]}
                    <span className="pn-sr">{tr(`ramas.f.${v}`)}</span>
                  </span>
                );
              })}
            </h2>
            {cerrado ? null : (
              <ul className="pn-ramas">
                <AnimatePresence mode="popLayout" initial={false}>
                  {visibles.map(fila)}
                </AnimatePresence>
              </ul>
            )}
          </motion.section>
          );
        })}

        {integradas.length > 0 ? (
          <motion.section
            key=" integradas"
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={RESORTE}
            className="pn-sec"
          >
            <h2 className="pn-h">{tr("ramas.integradas")}</h2>
            {ultimaSola ? <div className="pn-nota pn-sola">{tr("ramas.integradoSolo", { v: tareaDe(ultimaSola.h) })}</div> : null}
            <ul className="pn-ramas">
              <AnimatePresence mode="popLayout" initial={false}>
                {integradas.map(fila)}
              </AnimatePresence>
            </ul>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </>
  );
}

type PropsFila = {
  /** Lo pone AnimatePresence (popLayout). */
  ref?: Ref<HTMLLIElement>;
  h: Hilo;
  estado: Estado;
  error: string | null;
  enCurso: boolean;
  /** Lo que hace con ella "Integrar solo lo seguro", si algo. */
  auto: "integrando" | "actualizando" | null;
  /** Se integró sola. */
  sola: boolean;
  /** Integrada o revertida: si causó problemas (B25). */
  salud: Salud | null;
  alArreglar: PropsRamas["alArreglar"];
  /** El veredicto del analista. */
  juicio: Juicio | null;
  armado: boolean;
  alArmar: (id: string | null) => void;
  alActuar: PropsRamas["alActuar"];
  alAbrir: PropsRamas["alAbrir"];
  alRetomar: PropsRamas["alRetomar"];
  alActualizar: PropsRamas["alActualizar"];
  /** Chocó con main (80): ofrece Actualizar. */
  choco: boolean;
};

function FilaRama({ ref, h, estado, error, enCurso, auto, sola, salud, alArreglar, juicio, armado, alArmar, alActuar, alAbrir, alRetomar, alActualizar, choco }: PropsFila) {
  const vivo = VIVO.has(estado);
  // Retomar, Arreglar y Actualizar no lanzan al tocarlos: abren el paso previo (modelo, esfuerzo y un texto) y lanza "Lanzar".
  const retomar = () => pasoLider("retomar", (e) => alRetomar(h, e));
  const integrada = estado === "integrado";
  const arreglar = () => pasoLider("arreglar", (e) => alArreglar(h, estado, e));
  const actualizar = () => pasoWorker("actualizar", (e) => alActualizar(h, e));
  const rojo = salud?.rojo ? salud : null;
  // Lo que murió con commits: lo primero es retomarlo (integrar queda, pero no adelante).
  const murio = estado === "murio";
  const hace = useMemo(() => pintorHace(vivo ? h.inicio : h.inicio + (h.duracion_s ?? 0)), [h, vivo]);
  const t = tipoDe(h, estado);
  const err = error;
  const corto = err ? errorCorto(err) : null;
  const descartar = (clase = "mini pn-descartar") => (
    <button
      type="button"
      className={clase}
      data-armado={armado ? "" : undefined}
      onClick={() => {
        if (!armado) return alArmar(h.id);
        alArmar(null);
        alActuar(h.id, "descartar");
      }}
      onBlur={() => armado && alArmar(null)}
      onPointerLeave={() => armado && alArmar(null)}
    >
      {armado ? tr("ramas.descartarSeguro") : tr("ramas.descartar")}
    </button>
  );
  const botonRetomar = (clase: string) => (
    <button type="button" className={clase} onClick={retomar}>
      {tr("ramas.retomar")}
    </button>
  );
  const botonIntegrar = (clase: string) => (
    <button type="button" className={clase} onClick={() => alActuar(h.id, "integrar")}>
      {tr("ramas.integrar")}
    </button>
  );
  const botonActualizar = (clase: string) => (
    <button type="button" className={clase} data-actualizar data-tip={tr("ramas.actualizarQue")} onClick={actualizar}>
      {tr("ramas.actualizar")}
    </button>
  );
  const botonAbrir = (clase: string) => (
    <button type="button" className={clase} onClick={() => alAbrir(h.id)}>
      {tr("ramas.revisar")}
    </button>
  );
  // Un primario por rama (el del veredicto, o el que toca según cómo terminó); lo demás, en el menú "más".
  const M = "pn-mas-it";
  const P = "mini pn-primario";
  const libre = !vivo && !integrada && !enCurso && !auto;
  const [primario, secundarias]: [ReactNode, ReactNode[]] = !libre
    ? [null, []]
    : juicio
      ? juicio.veredicto === "integrar"
        ? [botonIntegrar(P), [descartar(M)]]
        : juicio.veredicto === "descartar"
          ? [descartar("mini pn-descartar pn-primario"), [botonIntegrar(M)]]
          : juicio.veredicto === "retomar"
            ? [botonRetomar(P), [botonIntegrar(M), descartar(M)]]
            : [botonAbrir("mini"), [botonIntegrar(M), descartar(M)]]
      : murio
        ? [botonRetomar(P), [botonIntegrar(M), descartar(M)]]
        : choco
          ? [botonActualizar(P), [botonIntegrar(M), descartar(M)]]
          : [botonIntegrar("mini"), [descartar(M)]];
  const [largo, setLargo] = useState(false);
  const Ie = ICONO_E[estado];
  const Iv = juicio ? ICONO_V[juicio.veredicto] : null;
  return (
    <motion.li
      ref={ref}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={RESORTE}
      className="pn-rama"
      data-salud={salud ? (rojo ? "mal" : "bien") : undefined}
    >
      <div className="pn-rama-txt">
        <button type="button" className="pn-tarea" data-id={h.id} data-tip={tr("ramas.abrir")} onClick={() => alAbrir(h.id)}>
          {tareaDe(h)}
        </button>
        <div className="pn-chips">
          {t ? (
            <span className={`pn-estado c-${t.tipo}`}>
              {Ie ? <Ie size={12} strokeWidth={2} aria-hidden="true" /> : null}
              {t.texto}
            </span>
          ) : null}
          {juicio && Iv ? (
            <span className="pn-veredicto" data-veredicto={juicio.veredicto}>
              <Iv size={12} strokeWidth={2} aria-hidden="true" />
              {tr(`ramas.v.${juicio.veredicto}`)}
            </span>
          ) : null}
        </div>
        <div className="pn-sub">
          {salud ? (
            <span className="pn-salud" data-tip={tr(rojo ? `ramas.salud.${rojo.motivo}` : salud.rojo === false && salud.verificando ? "ramas.salud.verificando" : "ramas.salud.bien")}>
              {rojo ? <X size={12} strokeWidth={2.2} /> : <Check size={12} strokeWidth={2.2} />}
            </span>
          ) : null}
          {salud ? <span>{h.proyecto}</span> : null}
          {h.commits ? <span>{commits(h.commits)}</span> : null}
          <Reloj pintor={hace} />
          {sola ? <span className="pn-auto" data-tip={tr("ramas.autoQue")}>{tr("ramas.autoBadge")}</span> : null}
          {h.rama ? <span className="pn-mono">{h.rama}</span> : null}
        </div>
        {juicio?.motivo ? (
          <button type="button" className="pn-motivo" aria-expanded={largo} data-largo={largo ? "" : undefined} onClick={() => setLargo((x) => !x)} data-tip={largo ? undefined : tr("ramas.verMotivo")}>
            {juicio.motivo}
          </button>
        ) : null}
        {rojo ? (
          <div className="pn-error pn-rojo" data-tip={rojo.cola ?? (rojo.rc != null ? tr("ramas.salud.rc", { rc: rojo.rc }) : undefined)}>
            {tr(`ramas.salud.${rojo.motivo}`)}
          </div>
        ) : salud?.rojo === false && salud.verificando ? (
          <div className="pn-nota pn-verificando">{tr("ramas.salud.verificando")}</div>
        ) : null}
        {err ? (
          <div className="pn-error" data-tip={corto !== err ? err : undefined}>
            {corto}
          </div>
        ) : null}
      </div>
      {vivo ? null : auto ? (
        <span className="pn-espera">{tr(auto === "integrando" ? "ramas.autoIntegrando" : "ramas.autoActualizando")}</span>
      ) : enCurso ? (
        <span className="pn-espera">{integrada ? tr("ramas.integrando") : "…"}</span>
      ) : salud ? (
        <div className="pn-acc">
          {rojo ? (
            <button type="button" className="mini pn-primario" data-arreglar data-tip={tr("ramas.arreglarQue")} onClick={arreglar}>
              {tr("ramas.arreglar")}
            </button>
          ) : null}
          {integrada ? (
            <button type="button" className="mini" onClick={() => alActuar(h.id, "revertir")}>
              {tr("ramas.deshacer")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="pn-acc">
          {primario}
          {secundarias.length ? <MenuMas>{secundarias}</MenuMas> : null}
        </div>
      )}
    </motion.li>
  );
}

/** El menú de lo secundario de una rama ("más"): teclado completo (flechas, Esc) y se cierra al tocar afuera. */
function MenuMas({ children }: { children: ReactNode[] }) {
  const [abierto, setAbierto] = useState(false);
  const [caja, setCaja] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!abierto || !caja) return;
    const fuera = (e: PointerEvent) => !caja.contains(e.target as Node) && setAbierto(false);
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierto, caja]);
  const items = () => [...(caja?.querySelectorAll<HTMLElement>(".pn-mas-lista button") ?? [])];
  return (
    <div
      className="pn-mas"
      ref={setCaja}
      onKeyDown={(e) => {
        if (e.key === "Escape" && abierto) {
          e.stopPropagation();
          setAbierto(false);
          caja?.querySelector<HTMLElement>(".pn-mas-btn")?.focus();
        } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && abierto) {
          e.preventDefault();
          const xs = items();
          const i = xs.indexOf(document.activeElement as HTMLElement);
          xs[(i + (e.key === "ArrowDown" ? 1 : xs.length - 1)) % xs.length]?.focus();
        }
      }}
    >
      <button
        type="button"
        className="mini pn-mas-btn"
                aria-expanded={abierto}
        aria-label={tr("ramas.mas")}
        data-tip={tr("ramas.mas")}
        onClick={() => {
          setAbierto((a) => !a);
          if (!abierto) queueMicrotask(() => items()[0]?.focus());
        }}
      >
        <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {abierto ? (
        <div className="pn-mas-lista" role="group" aria-label={tr("ramas.mas")} onClick={(e) => (e.target as HTMLElement).closest("button") && !(e.target as HTMLElement).closest(".pn-descartar:not([data-armado])") && setAbierto(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
