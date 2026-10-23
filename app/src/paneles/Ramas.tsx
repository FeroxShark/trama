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
import { useCallback, useEffect, useMemo, useState, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Sparkles, X } from "lucide-react";
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

  // El analista: el del statusline o, hasta que aparezca ahí, el recién lanzado.
  const [nacido, setNacido] = useState<Lider | null>(null);
  const an = analista ?? nacido;
  const [abierto, setAbierto] = useState(MODO.captura === "ramas-analista");
  const [lanzando, setLanzando] = useState(false);
  const [errorAn, setErrorAn] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState("");
  const filas = useMemo(() => pendientes.flatMap((g) => g.filas.map((f) => f.h)), [pendientes]);
  const juicios = useMemo(() => {
    const ids = new Set(filas.map((h) => h.id));
    return (an && veredictos(respuesta, ids)) || new Map<string, Juicio>();
  }, [an, respuesta, filas]);

  /** Lanza al analista (o le manda el brief al que ya está) con lo elegido. Rechaza si no se pudo. */
  const lanzarAnalista = async ({ modelo, effort, texto: extra }: Eleccion) => {
    const quietas = filas.filter((h) => !VIVO.has(optimista.get(h.id) ?? h.estado));
    if (lanzando || !quietas.length || an?.ocupado) return;
    setLanzando(true);
    setErrorAn(null);
    try {
      const texto = conTexto(await fuentePaneles.brief(quietas, !!an), extra);
      if (an) await fuente.liderMandar(an.id, { texto, modelo, effort });
      else {
        const e = { texto, modelo, effort, rol: "analista" as const };
        const sid = await fuente.liderNuevo(e);
        setNacido(fantasma(sid, e));
      }
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

      <AnimatePresence mode="popLayout" initial={false}>
        {pendientes.map((g) => (
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
            <h2 className="pn-h">
              {g.proyecto} <span className="cuenta">{g.filas.length}</span>
            </h2>
            <ul className="pn-ramas">
              <AnimatePresence mode="popLayout" initial={false}>
                {g.filas.map(fila)}
              </AnimatePresence>
            </ul>
          </motion.section>
        ))}

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
  const descartar = (
    <button
      type="button"
      className="mini pn-descartar"
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
  const botonRetomar = (primario: boolean) => (
    <button type="button" className={primario ? "mini pn-primario" : "mini"} onClick={retomar}>
      {tr("ramas.retomar")}
    </button>
  );
  // El botón del veredicto: el único que hace lo que dijo el analista.
  const accionJuicio =
    juicio && !vivo && !integrada && !enCurso && !auto
      ? juicio.veredicto === "integrar"
        ? <button type="button" className="mini pn-primario" onClick={() => alActuar(h.id, "integrar")}>{tr("ramas.integrar")}</button>
        : juicio.veredicto === "descartar"
          ? descartar
          : juicio.veredicto === "retomar"
            ? botonRetomar(true)
            : <button type="button" className="mini" onClick={() => alAbrir(h.id)}>{tr("ramas.revisar")}</button>
      : null;
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
        <div className="pn-sub">
          {salud ? (
            <span className="pn-salud" data-tip={tr(rojo ? `ramas.salud.${rojo.motivo}` : salud.rojo === false && salud.verificando ? "ramas.salud.verificando" : "ramas.salud.bien")}>
              {rojo ? <X size={12} strokeWidth={2.2} /> : <Check size={12} strokeWidth={2.2} />}
            </span>
          ) : null}
          {salud ? <span>{h.proyecto}</span> : null}
          {h.commits ? <span>{commits(h.commits)}</span> : null}
          <Reloj pintor={hace} />
          {t && (vivo || estado === "decision" || murio) ? <span className={`c-${t.tipo}`}>{t.texto}</span> : null}
          {sola ? <span className="pn-auto" data-tip={tr("ramas.autoQue")}>{tr("ramas.autoBadge")}</span> : null}
          {h.rama ? <span className="pn-mono">{h.rama}</span> : null}
        </div>
        {juicio ? (
          <div className="pn-juicio" data-veredicto={juicio.veredicto}>
            <span className="pn-juicio-v">{tr(`ramas.v.${juicio.veredicto}`)}</span>
            {juicio.motivo ? <span className="pn-juicio-m">{juicio.motivo}</span> : null}
          </div>
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
      ) : accionJuicio ? (
        // Con veredicto, un solo botón: el que dijo el analista.
        <div className="pn-acc">{accionJuicio}</div>
      ) : (
        <div className="pn-acc">
          {murio ? botonRetomar(true) : null}
          {choco && !murio ? (
            <button type="button" className="mini pn-primario" data-actualizar data-tip={tr("ramas.actualizarQue")} onClick={actualizar}>
              {tr("ramas.actualizar")}
            </button>
          ) : null}
          <button type="button" className="mini" onClick={() => alActuar(h.id, "integrar")}>
            {tr("ramas.integrar")}
          </button>
          {descartar}
        </div>
      )}
    </motion.li>
  );
}
