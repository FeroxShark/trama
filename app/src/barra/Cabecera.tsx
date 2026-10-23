// La cabecera de la barra. Arriba, la marca y ocultar la barra; abajo, en su
// propio renglón, el uso del plan: 5 h y semana, cada uno con cuándo se
// reinicia, su porcentaje y su barra (ámbar desde 70 %, roja desde 90 %). Con el
// mouse o con foco, la hora exacta del reinicio. Hay porcentaje sin hora de
// reinicio: el número va solo. Un límite del que no se sabe ni el porcentaje
// (nadie contestó desde que se reinició, o todavía no hay ninguna lectura) lo
// dice: "sin dato", nunca un renglón vacío. Cada tip sale hacia afuera del
// bloque (el de 5 h arriba, el de semana abajo): ninguno tapa al otro renglón. A la derecha del uso, el botón
// que lo actualiza (B26: arriba, junto a la marca, no se entendía qué releía): le pide a `claude`
// el uso como lo dice claude.ai (`get_usage`) y relee todo. Un dato de hace más de 15 min dice
// "visto hace 40 m" en vez de cuándo se reinicia (eso queda en el tip): puede estar atrasado.
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, RotateCw } from "lucide-react";
import type { GrupoCupo, Uso, Ventana, VentanaCupo } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { nivel } from "../hilo/contexto";
import { MODO } from "../modo";
import { pintorCuando, pintorReinicio, pintorResta, pintorVisto, pintorVuelve, pintorVuelveCorto } from "../tiempo";
import { Marca } from "./Marca";
import { filaDe, formatearHasta } from "./usoFila";
import { Reloj } from "./piezas";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";

/** Después de un clic el botón de releer descansa esto. */
const PAUSA_MS = 5000;

/** Mientras el uso no llegó: reserva el renglón (invisible) para que la lista no salte. */
const ESPERA: Ventana = { pct: 0, resets_at: 0 };

/** Las capturas `uso*` dejan abiertos los dos tips: se ve que ninguno tapa al otro renglón. */
const CAPTURA_USO = !!MODO.captura?.startsWith("uso");

export function Cabecera({ alOcultar }: { alOcultar: () => void }) {
  useIdioma();
  // `undefined`: todavía no llegó. `null`: llegó y no hay de dónde sacarlo.
  const [uso, setUso] = useState<Uso | null | undefined>(undefined);
  const [pausa, setPausa] = useState(false);
  const reloj = useRef(0);

  useEffect(() => {
    let vivo = true;
    void fuente.uso().then((u) => vivo && setUso(u));
    const soltar = fuente.alCambiarUso(setUso);
    return () => {
      vivo = false;
      soltar();
      clearTimeout(reloj.current);
    };
  }, []);

  const releer = () => {
    setPausa(true);
    reloj.current = window.setTimeout(() => setPausa(false), PAUSA_MS);
    void fuente.releerUso().then(setUso, () => {});
  };

  // El botón va en todos los estados (en la espera, invisible): el bloque no cambia de alto ni de ancho.
  const boton = (
    <button type="button" className="releer" aria-label={t("uso.releer")} data-tip={t("uso.releer")} disabled={pausa || uso === undefined} onClick={releer}>
      <RotateCw size={13} strokeWidth={2} />
    </button>
  );

  return (
    <>
      <div className="cab">
        <Marca className="logo" />
        <span className="marca">trama</span>
        {/* Con la barra abierta el botón vive acá; cerrada, el de la vista (`.migas .lado`). */}
        <button type="button" className="lado" aria-label={t("comun.ocultarBarra")} data-tip={t("comun.ocultarBarra")} onClick={alOcultar}>
          <PanelLeft size={16} strokeWidth={1.8} />
        </button>
      </div>
      {uso === undefined ? (
        <div className="usos" data-espera="" aria-hidden="true">
          <div className="usos-l">
            <Barrita nombre={t("uso.5h")} largo="" v={ESPERA} />
            <Barrita nombre={t("uso.sem")} largo="" v={ESPERA} />
          </div>
          {boton}
        </div>
      ) : uso && "error" in uso ? (
        <div className="usos">
          <div className="usos-l">
            <span data-tip={textoMain(uso.error)} className="uso-error">
              {textoMain(uso.error)}
            </span>
          </div>
          {boton}
        </div>
      ) : (
        <div className="usos">
          <div className="usos-l">
            <Barrita nombre={t("uso.5h")} largo={t("uso.5hLargo")} v={uso?.five_hour ?? null} ts={uso?.ts ?? 0} ver={MODO.captura === "hover" || CAPTURA_USO} />
            <Barrita nombre={t("uso.sem")} largo={t("uso.semLargo")} v={uso?.seven_day ?? null} ts={uso?.ts ?? 0} ver={CAPTURA_USO} />
            {uso?.google && uso.google.length > 0 && (
              <>
                <div className="usos-sep" aria-hidden="true" />
                {uso.google.map((g) => (
                  <FilaGoogle key={g.id} g={g} ts={uso.ts} />
                ))}
              </>
            )}
          </div>
          {boton}
        </div>
      )}
    </>
  );
}

/** `ts`: cuándo se vio el dato (0: no se sabe). */
function Barrita({ nombre, largo, v, ts = 0, ver }: { nombre: string; largo: string; v: Ventana | null; ts?: number; ver?: boolean }) {
  const f = filaDe(v);
  const hasta = f.hasta ?? 0;
  const reinicio = useMemo(() => pintorVisto(ts, pintorReinicio(hasta)), [ts, hasta]);
  const resta = useMemo(() => pintorVisto(ts, pintorResta(hasta)), [ts, hasta]);
  const cuando = useMemo(() => pintorVisto(ts, pintorCuando(hasta), true), [ts, hasta]);
  // Sin hora de reinicio no hay `cuando`: queda vacío (y no se ve) hasta que el dato envejece.
  const sinHora = useMemo(() => pintorVisto(ts, () => ({ texto: "", en: Infinity })), [ts]);
  const sinHoraTip = useMemo(() => pintorVisto(ts, () => ({ texto: t("uso.sinHoraTip"), en: Infinity }), true), [ts]);
  // Sin porcentaje: el renglón queda, con su riel vacío, y dice por qué no hay número.
  if (f.pct === null)
    return (
      <div className="uso" tabIndex={0} aria-label={t("uso.ariaSinDato", { largo })} data-sin="" data-ver={ver ? "" : undefined}>
        <div className="r">
          <span className="n">{nombre}</span>
          <span className="cuando">{t("uso.sinDato")}</span>
        </div>
        <div className="riel" />
        <span className="tip" role="tooltip">
          {t("uso.sinDatoTip")}
        </span>
      </div>
    );
  const n = nivel(f.pct);
  return (
    <div
      className="uso"
      tabIndex={largo ? 0 : undefined}
      aria-label={t("uso.aria", { largo, pct: f.pct })}
      data-nivel={n === "normal" ? undefined : n}
      data-ver={ver ? "" : undefined}
    >
      <div className="r">
        <span className="n">{nombre}</span>
        {f.cuando === "hora" ? (
          <>
            {/* Angosta, queda el corto ("en 16 min"): lo elige el CSS por el ancho del renglón. */}
            <Reloj pintor={reinicio} className="cuando largo" />
            <Reloj pintor={resta} className="cuando corto" />
          </>
        ) : (
          <Reloj pintor={sinHora} className="cuando" />
        )}
        <b>{f.pct}%</b>
      </div>
      <div className="riel">
        <i style={{ transform: `scaleX(${f.pct / 100})` }} />
      </div>
      <Reloj pintor={f.cuando === "hora" ? cuando : sinHoraTip} className="tip" role="tooltip" />
    </div>
  );
}

function hastaVentanaS(w: VentanaCupo | undefined, ts: number): number {
  if (!w) return 0;
  if (typeof w.resetea === "number" && w.resetea > 0) return Math.round(w.resetea / 1000);
  if (typeof w.vuelveEnS === "number" && w.vuelveEnS > 0 && ts > 0) return ts + w.vuelveEnS;
  return 0;
}

function FilaGoogle({ g, ts }: { g: GrupoCupo; ts: number }) {
  const nombre =
    g.id === "gemini"
      ? t("uso.googleGemini")
      : g.id === "claude-gpt"
        ? t("uso.googleClaudeGpt")
        : t("uso.googleArgon");
  const h = formatearHasta(g.hasta);
  const hastaTxt = h ? t("uso.hasta", h) : null;
  const pctSem = Math.max(0, Math.min(100, Math.round(g.semanal.pct)));
  const pct5h = g.cincoH ? Math.max(0, Math.min(100, Math.round(g.cincoH.pct))) : null;
  const pctBarra = pct5h !== null ? Math.max(pctSem, pct5h) : pctSem;
  const hastaSem = hastaVentanaS(g.semanal, ts);
  const hasta5h = hastaVentanaS(g.cincoH, ts);
  const hasta = pct5h !== null && pct5h > pctSem && hasta5h > 0 ? hasta5h : hastaSem || hasta5h;
  const vuelve = useMemo(() => pintorVisto(ts, pintorVuelve(hasta)), [ts, hasta]);
  const vuelveCorto = useMemo(() => pintorVisto(ts, pintorVuelveCorto(hasta)), [ts, hasta]);
  const cuando = useMemo(() => pintorVisto(ts, pintorCuando(hasta), true), [ts, hasta]);
  const n = nivel(pctBarra);
  return (
    <div
      className="uso uso-google"
      tabIndex={0}
      aria-label={t("uso.aria", { largo: nombre, pct: pctBarra })}
      data-grupo={g.id}
      data-nivel={n === "normal" ? undefined : n}
    >
      <div className="r">
        <span className="n">{nombre}</span>
        {hastaTxt && <span className="uso-hasta">{hastaTxt}</span>}
        {!hastaTxt && hasta > 0 && (
          <>
            <Reloj pintor={vuelve} className="cuando largo" />
            <Reloj pintor={vuelveCorto} className="cuando corto" />
          </>
        )}
        <b>
          {pct5h !== null ? (
            <>
              <span className="uso-5h">5h {pct5h}%</span>
              {t("uso.semCorto")} {pctSem}%
            </>
          ) : (
            `${pctSem}%`
          )}
        </b>
      </div>
      {hastaTxt && hasta > 0 && (
        <div className="uso-sub">
          <Reloj pintor={vuelve} className="cuando largo" />
          <Reloj pintor={vuelveCorto} className="cuando corto" />
        </div>
      )}
      <div className="riel">
        <i style={{ transform: `scaleX(${pctBarra / 100})` }} />
      </div>
      {hasta > 0 && <Reloj pintor={cuando} className="tip" role="tooltip" />}
    </div>
  );
}
