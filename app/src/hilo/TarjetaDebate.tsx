// El modo debate de «Revisar con otro modelo» en el chat del líder: la tarjeta en vivo (`TarjetaDebate`: la ronda, el tiempo, lo que
// dijo cada modelo, la pregunta con un botón por opción, «Cortar y concluir» y «Cancelar») y la conclusión que llegó al líder como
// mensaje (`TarjetaConclusionDebate`, con la clase `rv` de la tarjeta del revisor: «Ver la tarjeta» la encuentra igual). Cada postura y
// cada fase se dicen con ícono y palabra. La lógica: debate-logica.ts; el estado viene del main: debate-vivo.ts. Estilos: debate.css.
import { memo, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Check, CircleAlert, Eye, Hand, Hourglass, Info, Loader, LogOut, MessagesSquare, MessageSquareQuote, Minus, PencilLine, Sparkles, TriangleAlert, X } from "lucide-react";
import { fuente } from "../datos/fuente";
import type { LineaDebate } from "../../electron/debate-texto";
import type { PasoRevision } from "../../electron/revision-plan-texto";
import type { leerMensajeDebate } from "../../electron/debate-texto";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { Boton } from "../ui/componentes";
import { Texto } from "./Texto";
import { accionesDebate, claveMotivo, columnasDebate, debateVivo, duracionDebate, minutosQueFaltan, rondasDebate, rondaVista, type ColumnaDebate, type EstadoColumna } from "./debate-logica";
import { limpiarDebate, useDebate } from "./debate-vivo";
import { irA } from "./RevisionVista";
import { tiempoCorrido } from "./revision-logica";
import { contarTarjetas, verTarjeta } from "./revision-ver";
import "./tarjeta-revision.css";
import "./debate.css";

/** Un tic por segundo mientras el debate sigue: el reloj del subtítulo y la cuenta de la pregunta. */
function useAhora(activo: boolean): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!activo) return;
    setAhora(Date.now());
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activo]);
  return ahora;
}

/** Cada estado de una columna con su ícono y su palabra: el color sólo acompaña. */
const POSTURA: Record<EstadoColumna, { ico: typeof Check; clave: string }> = {
  acuerdo: { ico: Check, clave: "debate.postura.acuerdo" },
  cambio: { ico: TriangleAlert, clave: "debate.postura.cambio" },
  pregunta: { ico: Hand, clave: "debate.postura.pregunta" },
  escribiendo: { ico: PencilLine, clave: "debate.postura.escribiendo" },
  espera: { ico: Hourglass, clave: "debate.postura.espera" },
  salio: { ico: LogOut, clave: "debate.postura.salio" },
  sinTurno: { ico: Minus, clave: "debate.postura.sinTurno" },
};

/** Una línea del debate: lo que dijo un modelo, lo que contestó el dueño, un modelo que salió, una nota o la conclusión. */
const Linea = memo(function Linea({ l }: { l: LineaDebate }) {
  useIdioma();
  if (l.tipo === "nota")
    return (
      <li className="dbt-nota" data-tipo="nota">
        <Info size={12} strokeWidth={2.2} aria-hidden="true" />
        <span>{(t as (k: string, v?: Record<string, string | number>) => string)(l.clave ?? "", l.vars)}</span>
      </li>
    );
  if (l.tipo === "fallo")
    return (
      <li className="dbt-nota" data-tipo="fallo">
        <CircleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
        <span>{t("debate.salio", { modelo: l.nombre, motivo: textoMain(l.error ?? "") })}</span>
      </li>
    );
  if (l.tipo === "dueno")
    return (
      <li className="dbt-turno" data-tipo="dueno">
        <div className="dbt-quien">
          <span className="dbt-nombre">{t("debate.vos")}</span>
        </div>
        <p className="dbt-dicho">{l.argumento}</p>
      </li>
    );
  const p = l.tipo === "turno" && l.postura ? POSTURA[l.postura] : null;
  const Ico = l.tipo === "conclusion" ? MessageSquareQuote : p?.ico;
  return (
    <li className="dbt-turno" data-tipo={l.tipo} data-postura={l.postura ?? undefined}>
      <div className="dbt-quien">
        <span className="dbt-nombre">{l.nombre}</span>
        <span className="dbt-chip">
          {Ico ? <Ico size={11} strokeWidth={2.4} aria-hidden="true" /> : null}
          {l.tipo === "conclusion" ? t("debate.conclusion") : p ? t(p.clave as never) : null}
        </span>
        {l.tipo === "turno" ? <span className="dbt-ronda">{t("debate.ronda", { n: l.ronda })}</span> : null}
      </div>
      {l.argumento ? (
        <div className="dbt-texto">
          <Texto texto={l.argumento} />
        </div>
      ) : null}
      {l.plan ? (
        <details className="rv-plan dbt-plan">
          <summary>{t(l.tipo === "conclusion" ? "debate.planConsensuado" : "debate.planPropuesto")}</summary>
          <Texto texto={l.plan} />
        </details>
      ) : null}
    </li>
  );
});

/** Lo que un modelo leyó o está leyendo, en palabras: el más nuevo primero, con el nombre entero en el `title`. */
const Paso = ({ p, vivo }: { p: PasoRevision; vivo: boolean }) => (
  <li title={p.v}>
    <Eye size={12} strokeWidth={2} aria-hidden="true" />
    <span>{(t as (k: string, v?: Record<string, string | number>) => string)(`debate.${vivo ? "leyendo" : "leyo"}.${p.k === "otro" ? "leer" : p.k}`, { v: p.v })}</span>
  </li>
);

/** La columna de un modelo en la mesa: su postura en palabras e ícono, lo que dijo (o va diciendo), y abajo lo que leyó y usó. */
const Columna = memo(function Columna({ c, tono }: { c: ColumnaDebate; tono: string }) {
  useIdioma();
  const p = POSTURA[c.estado];
  const Ico = p.ico;
  const texto = useRef<HTMLDivElement>(null);
  // El texto baja solo mientras llega (si la persona no subió a releer).
  useEffect(() => {
    const el = texto.current;
    if (el && c.estado === "escribiendo" && el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
  }, [c.texto, c.estado]);
  const escribiendo = c.estado === "escribiendo";
  const pasos = [...(c.leyendo ? [{ p: c.leyendo, vivo: true }] : []), ...c.leyo.filter((x) => x !== c.leyendo).map((x) => ({ p: x, vivo: false }))].slice(0, 3);
  return (
    <li className="dbt-col" data-estado={c.estado} style={{ "--tono": tono } as CSSProperties}>
      <header className="dbt-col-cab">
        <span className="dbt-av" aria-hidden="true">
          {c.inicial}
        </span>
        <span className="dbt-nombre">{c.nombre}</span>
        {c.effort ? <span className="dbt-p-e">{c.effort}</span> : null}
      </header>
      <p className="dbt-postura">
        <Ico size={13} strokeWidth={2.2} aria-hidden="true" />
        {t(p.clave as never)}
      </p>
      <div className="dbt-col-texto el" ref={texto} tabIndex={0} aria-label={t("debate.columna", { modelo: c.nombre })}>
        {escribiendo ? (
          c.texto ? (
            <p className="dbt-vivo">
              {c.texto}
              <span className="dbt-cursor" aria-hidden="true" />
            </p>
          ) : (
            <p className="dbt-vacio">{t("debate.leyendoPlan")}</p>
          )
        ) : c.texto ? (
          <Texto texto={c.texto} />
        ) : null}
        {c.plan ? (
          <details className="rv-plan dbt-plan">
            <summary>{t("debate.planPropuesto")}</summary>
            <Texto texto={c.plan} />
          </details>
        ) : null}
      </div>
      {pasos.length || c.uso.length ? (
        <ul className="dbt-pie">
          {pasos.map((x) => (
            <Paso key={`${x.p.k}:${x.p.v}`} p={x.p} vivo={x.vivo} />
          ))}
          {c.uso.slice(0, 2).map((u) => (
            <li key={u} title={u}>
              <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
              <span>{t("debate.uso", { v: u })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
});

/** El color de cada columna, en el orden en que hablan: sólo identifica al modelo (la postura se dice con ícono y palabra). */
const TONOS = ["var(--probar)", "var(--acento)", "var(--carpeta)"];

/**
 * El debate de un líder, en vivo: va encima de la caja (como el progreso de la revisión simple) hasta que se lo cierra. `zona` es el
 * chat (`.conv-zona`): ahí llega la conclusión como mensaje del líder y ahí lleva «Ver la tarjeta».
 */
export function TarjetaDebate({ sid, zona }: { sid: string; zona: RefObject<HTMLDivElement | null> }) {
  useIdioma();
  const e = useDebate(sid);
  const ahora = useAhora(debateVivo(e));
  const lista = useRef<HTMLOListElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mandando, setMandando] = useState(false);
  // Cuántas tarjetas había en el chat cuando empezó el debate: la que llega es la que sobra después (revision-ver.ts).
  const base = useRef<{ id: string; n: number } | null>(null);
  const [espera, setEspera] = useState<string | null>(null);
  const [elegida, setElegida] = useState<number | null>(null);
  const nLineas = e?.lineas.filter((l) => l.tipo !== "turno").length ?? 0;
  useEffect(() => {
    const z = zona.current;
    if (!e || !z || base.current?.id === e.id || !debateVivo(e)) return;
    base.current = { id: e.id, n: contarTarjetas(z) };
  }, [e?.id, e?.fase, zona]);
  // La lista baja sola con cada línea nueva (si la persona no subió a leer: queda donde está cuando ya no está al final).
  useEffect(() => {
    const el = lista.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [nLineas]);
  // Un debate nuevo vuelve a seguir la ronda en curso.
  useEffect(() => setElegida(null), [e?.id]);
  const alVer = () => {
    const z = zona.current;
    const n = e && base.current?.id === e.id ? base.current.n : null;
    const el = z ? verTarjeta(n, z) : null;
    if (el) irA(el);
    else if (e) setEspera(e.id);
  };
  useEffect(() => {
    const z = zona.current;
    if (!e || espera !== e.id || !z) return;
    const n = base.current?.id === e.id ? base.current.n : null;
    const mirar = () => {
      const el = verTarjeta(n, z);
      if (!el) return;
      irA(el);
      setEspera(null);
    };
    mirar();
    const mo = new MutationObserver(mirar);
    mo.observe(z, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [espera, e?.id, zona]);
  if (!e) return null;

  const ac = accionesDebate(e.fase);
  // La ronda que se mira: la que corre (o la última), salvo que la persona haya elegido otra con los chips.
  const ronda = elegida !== null && elegida <= rondaVista(e) ? elegida : rondaVista(e);
  const columnas = columnasDebate(e, ronda);
  // Lo que no es el turno de un modelo (la respuesta del dueño, notas, salidas y la conclusión) va aparte, debajo de la mesa.
  const aparte = e.lineas.filter((l) => l.tipo !== "turno");
  const nombres = e.participantes.map((p) => p.nombre).join(", ");
  const titulo = e.fase === "hecho" ? t(e.motivo === "simple" ? "debate.hechaSimple" : "debate.hecha") : e.fase === "cancelado" ? t("debate.cancelada") : e.fase === "fallo" ? t("debate.fallo") : e.fase === "entregando" ? t("debate.entregando") : e.fase === "concluyendo" ? t("debate.concluyendo") : t("debate.corriendo", { modelos: nombres });
  const subtitulo = [e.ronda > 0 && debateVivo(e) ? t("debate.rondaDe", { n: e.ronda, total: e.rondas }) : null, tiempoCorrido(duracionDebate(e, ahora))].filter(Boolean).join(" · ");
  const accion = (f: () => Promise<unknown>) => {
    if (mandando) return;
    setMandando(true);
    setError(null);
    f().then(() => setMandando(false), (x) => (setMandando(false), setError(String((x as Error).message))));
  };
  const q = e.pregunta;
  return (
    <section className="rv dbt" data-fase={e.fase} aria-label={titulo}>
      <header className="rv-cab">
        <span className="rv-ico" aria-hidden="true">
          {e.fase === "hecho" ? <Check size={15} strokeWidth={2.4} /> : e.fase === "cancelado" || e.fase === "fallo" ? <CircleAlert size={15} strokeWidth={2.2} /> : <MessagesSquare size={15} strokeWidth={2.2} />}
        </span>
        <div className="rv-txt">
          <h4 className="rv-t" role="status">
            {titulo}
          </h4>
          <p className="rv-s">{e.fase === "fallo" && e.error ? textoMain(e.error) : e.fase === "cancelado" ? t("debate.canceladaDesc") : subtitulo}</p>
        </div>
      </header>

      {e.ronda > 0 ? (
        <div className="dbt-rondas" role="group" aria-label={t("debate.rondasElegir")}>
          {rondasDebate(e).map((n) => (
            <button key={n} type="button" className="dbt-ronda-chip" aria-pressed={n === ronda} onClick={() => setElegida(n === rondaVista(e) ? null : n)}>
              {t("debate.ronda", { n })}
            </button>
          ))}
        </div>
      ) : null}

      {columnas.length && e.ronda > 0 ? (
        <ol className="dbt-mesa" aria-label={t("debate.lista")} data-n={columnas.length}>
          {columnas.map((c, i) => (
            <Columna key={c.modelo} c={c} tono={TONOS[i % TONOS.length]!} />
          ))}
        </ol>
      ) : null}

      {aparte.length ? (
        <ol className="dbt-lista el" ref={lista} tabIndex={0} aria-label={t("debate.aparte")}>
          {aparte.map((l) => (
            <Linea key={l.n} l={l} />
          ))}
        </ol>
      ) : null}

      {e.fase === "concluyendo" || (e.fase === "corriendo" && e.ronda < 1) ? (
        <p className="dbt-espera" role="status">
          <Loader size={12} strokeWidth={2.2} aria-hidden="true" />
          {e.fase === "concluyendo" ? t("debate.escribiendoConclusion") : t("debate.pensando")}
        </p>
      ) : null}

      {q ? (
        <div className="dbt-pregunta" role="group" aria-labelledby={`dbt-q-${e.id}`}>
          <p id={`dbt-q-${e.id}`} className="dbt-q">
            <Hand size={13} strokeWidth={2.2} aria-hidden="true" />
            <span>{t("debate.pregunta", { modelo: q.nombre, texto: q.texto })}</span>
          </p>
          <div className="dbt-opciones">
            {q.opciones.map((o) => (
              <Boton key={o} primario disabled={mandando} onClick={() => accion(() => fuente.debateResponder(sid, o))}>
                {o}
              </Boton>
            ))}
            <Boton disabled={mandando} onClick={() => accion(() => fuente.debateResponder(sid, null))}>
              {t("debate.seguirSin")}
            </Boton>
          </div>
          <p className="dbt-aviso">{t("debate.preguntaPlazo", { min: minutosQueFaltan(q.hasta, ahora) })}</p>
        </div>
      ) : null}

      {e.fase === "hecho" ? <p className="dbt-fin">{t(claveMotivo(e.motivo) as never)}</p> : null}
      {error ? <div className="caja-error" role="alert">{textoMain(error)}</div> : null}
      <div className="dbt-acciones">
        {ac.cancelar ? (
          <Boton className="dbt-cancelar" disabled={mandando} onClick={() => accion(() => fuente.debateCancelar(sid))}>
            <X size={13} strokeWidth={2.4} aria-hidden="true" />
            {t("debate.cancelar")}
          </Boton>
        ) : null}
        {ac.cortar ? (
          <Boton disabled={mandando} onClick={() => accion(() => fuente.debateCortar(sid))}>
            {t("debate.cortar")}
          </Boton>
        ) : null}
        {ac.ver && e.motivo !== "simple" ? (
          <Boton primario disabled={espera === e.id} onClick={alVer}>
            {espera === e.id ? t("revision.enCamino") : t("revision.verTarjeta")}
          </Boton>
        ) : null}
        {ac.cerrar ? <Boton onClick={() => limpiarDebate(sid)}>{t("revision.cerrar")}</Boton> : null}
      </div>
    </section>
  );
}

/** La conclusión del debate tal como llegó al líder (el mensaje con su marca): acuerdos, lo que sigue en desacuerdo y el plan consensuado. */
export const TarjetaConclusionDebate = memo(function TarjetaConclusionDebate({ d }: { d: NonNullable<ReturnType<typeof leerMensajeDebate>> }) {
  useIdioma();
  const nombres = d.nombres.join(", ");
  const secciones = [
    { k: "acuerdos", ico: <Check size={13} strokeWidth={2.4} />, texto: d.acuerdos },
    { k: "desacuerdos", ico: <TriangleAlert size={13} strokeWidth={2.2} />, texto: d.desacuerdos },
  ] as const;
  return (
    <section className="rv dbt-concl" aria-label={t("debate.tarjeta", { modelos: nombres })}>
      <header className="rv-cab">
        <span className="rv-ico" aria-hidden="true">
          <MessagesSquare size={15} strokeWidth={2.2} />
        </span>
        <div className="rv-txt">
          <h4 className="rv-t">{t("debate.tarjeta", { modelos: nombres })}</h4>
          <p className="rv-s">{t("debate.tarjetaSub", { n: d.rondas, motivo: t(`debate.motivoCorto.${d.motivo}` as never) })}</p>
        </div>
      </header>
      {d.libre ? (
        <div className="rv-sec">
          <h5 className="rv-h">{t("debate.libre")}</h5>
          <Texto texto={d.libre} />
        </div>
      ) : (
        <>
          {secciones.map((s) => (
            <div key={s.k} className="rv-sec" data-k={s.k}>
              <h5 className="rv-h">
                {s.ico}
                {t(`debate.${s.k}`)}
              </h5>
              {s.texto ? <Texto texto={s.texto} /> : <p className="rv-nada">{t("revision.nada")}</p>}
            </div>
          ))}
          {d.plan ? (
            <details className="rv-plan">
              <summary>{t("debate.planConsensuado")}</summary>
              <Texto texto={d.plan} />
            </details>
          ) : null}
        </>
      )}
    </section>
  );
});
