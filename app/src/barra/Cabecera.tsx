// La cabecera de la barra. Arriba, sólo el logo de trama (sin la palabra: gana lugar), releer y
// ocultar la barra; abajo, el uso de cada proveedor, un renglón por grupo: su logo y nombre corto
// (Claude; con agy conectado también Gemini, Claude y GPT por Google, Argon) y, en columnas
// alineadas, una celda por ventana ("5h", "Sem") con su porcentaje y un riel finito (ámbar desde
// 70 %, rojo desde 90 %). Lo largo va al tooltip de cada celda (con el mouse o con foco): a qué
// proveedor y ventana pertenece, cuándo se reinicia (relativo y hora exacta) y, si el dato es viejo,
// cuándo se vio; el número de un dato de hace más de 15 min se apaga (`data-viejo`). Sin agy queda
// sólo el renglón de Claude. Un límite del que no se sabe ni el porcentaje lo dice: "sin dato",
// nunca una celda vacía. El botón de releer le pide a `claude` el uso como lo dice claude.ai
// (`get_usage`) y relee todo.
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, RotateCw } from "lucide-react";
import type { GrupoCupo, Uso, Ventana, VentanaCupo } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { nivel } from "../hilo/contexto";
import { Logo as LogoEmpresa } from "../hilo/Logos";
import type { Empresa } from "../hilo/modelos";
import { MODO } from "../modo";
import { VIEJO_S, pintorCuando, pintorReinicio, pintorVisto } from "../tiempo";
import type { Pintor } from "../reloj";
import { Marca } from "./Marca";
import { filaDe, formatearHasta } from "./usoFila";
import { Reloj } from "./piezas";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";

/** Después de un clic el botón de releer descansa esto. */
const PAUSA_MS = 5000;

/** Mientras el uso no llegó: reserva el renglón (invisible) para que la lista no salte. */
const ESPERA: Ventana = { pct: 0, resets_at: 0 };

/** Las capturas `uso*` y `hover` dejan abierto el tip de la primera celda: se ve qué dice y que no tapa nada. */
const VER_TIP = MODO.captura === "hover" || !!MODO.captura?.startsWith("uso");

/** Una ventana lista para pintar: `pct` null = sin dato; `hasta` en epoch s (0: no se sabe cuándo se reinicia). */
type Celda = { clave: "5h" | "sem"; pct: number | null; hasta: number };

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

  return (
    <>
      <div className="cab">
        <Marca className="logo" />
        <span className="oculto">trama</span>
        {/* Releer vive acá, en la fila de arriba: ya no le roba ancho a las celdas. */}
        <button type="button" className="releer" aria-label={t("uso.releer")} data-tip={t("uso.releer")} disabled={pausa || uso === undefined} onClick={releer}>
          <RotateCw size={13} strokeWidth={2} />
        </button>
        {/* Con la barra abierta el botón vive acá; cerrada, el de la vista (`.migas .lado`). */}
        <button type="button" className="lado" aria-label={t("comun.ocultarBarra")} data-tip={t("comun.ocultarBarra")} onClick={alOcultar}>
          <PanelLeft size={16} strokeWidth={1.8} />
        </button>
      </div>
      {uso === undefined ? (
        <div className="usos" data-espera="" aria-hidden="true">
          <div className="usos-l">
            <Grupo empresa="anthropic" id="claude" nombre={t("uso.claude")} celdas={[celdaDe("5h", ESPERA), celdaDe("sem", ESPERA)]} ts={0} />
          </div>
        </div>
      ) : uso && "error" in uso ? (
        <div className="usos">
          <div className="usos-l">
            <span data-tip={textoMain(uso.error)} className="uso-error">
              {textoMain(uso.error)}
            </span>
          </div>
        </div>
      ) : (
        <div className="usos">
          <div className="usos-l">
            <Grupo
              empresa="anthropic"
              id="claude"
              nombre={t("uso.claude")}
              celdas={[celdaDe("5h", uso?.five_hour ?? null), celdaDe("sem", uso?.seven_day ?? null)]}
              ts={uso?.ts ?? 0}
              ver={VER_TIP}
            />
            {uso?.google && uso.google.length > 0 && (
              <>
                <div className="usos-sep" aria-hidden="true" />
                {uso.google.map((g) => (
                  <GrupoGoogle key={g.id} g={g} ts={uso.ts} />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** La ventana de Claude (statusline / stream) como celda. */
function celdaDe(clave: Celda["clave"], v: Ventana | null): Celda {
  const f = filaDe(v);
  return { clave, pct: f.pct, hasta: f.hasta ?? 0 };
}

function hastaVentanaS(w: VentanaCupo | undefined, ts: number): number {
  if (!w) return 0;
  if (typeof w.resetea === "number" && w.resetea > 0) return Math.round(w.resetea / 1000);
  if (typeof w.vuelveEnS === "number" && w.vuelveEnS > 0 && ts > 0) return ts + w.vuelveEnS;
  return 0;
}

/** La ventana de un grupo de Google como celda. */
function celdaGoogle(clave: Celda["clave"], w: VentanaCupo, ts: number): Celda {
  return { clave, pct: Math.max(0, Math.min(100, Math.round(w.pct))), hasta: hastaVentanaS(w, ts) };
}

function GrupoGoogle({ g, ts }: { g: GrupoCupo; ts: number }) {
  const largo = g.id === "gemini" ? "Gemini 3.8 Flash" : g.id === "claude-gpt" ? t("uso.googleClaudeGpt") : t("uso.googleArgon");
  const corto = g.id === "gemini" ? "Gemini 3.8 Flash" : g.id === "claude-gpt" ? t("uso.cortoClaudeGpt") : t("uso.cortoArgon");
  const h = formatearHasta(g.hasta);
  return (
    <Grupo
      empresa="google"
      id={g.id}
      nombre={corto}
      largo={largo}
      hasta={h ? t("uso.hasta", h) : undefined}
      celdas={[g.cincoH ? celdaGoogle("5h", g.cincoH, ts) : null, celdaGoogle("sem", g.semanal, ts)]}
      ts={ts}
    />
  );
}

/**
 * Un proveedor (o un grupo de modelos de él): logo y nombre corto, y las celdas en dos columnas fijas (5 h, semana).
 * Un grupo sin 5 h (Argon) deja la primera columna vacía: las semanas quedan alineadas.
 */
function Grupo({
  empresa,
  id,
  nombre,
  largo,
  hasta,
  celdas,
  ts,
  ver,
}: {
  empresa: Empresa;
  id: string;
  nombre: string;
  largo?: string;
  hasta?: string;
  celdas: (Celda | null)[];
  ts: number;
  ver?: boolean;
}) {
  const quien = largo ?? nombre;
  return (
    <div className="grupo" data-grupo={id}>
      <span className="g-id" data-tip={hasta ? `${quien} · ${hasta}` : quien}>
        <LogoEmpresa empresa={empresa} />
        <span className="g-n">{nombre}</span>
        {hasta && <span className="g-hasta">{hasta}</span>}
      </span>
      {celdas.map((c, i) =>
        c ? <UsoCelda key={c.clave} c={c} quien={quien} ts={ts} ver={ver && i === 0} /> : <span key={`v${i}`} className="uso-vacio" aria-hidden="true" />,
      )}
    </div>
  );
}

/** El número de la celda: se apaga (`data-viejo`) cuando el dato tiene más de 15 min (en el tip dice de cuándo es). */
const pintorPct =
  (pct: number, ts: number): Pintor =>
  (a) => {
    const d = a - ts;
    const viejo = !!ts && d >= VIEJO_S;
    return { texto: `${pct}%`, en: ts && !viejo ? VIEJO_S - d : Infinity, attrs: { "data-viejo": viejo ? "" : null } };
  };

/** `ts`: cuándo se vio el dato (0: no se sabe). */
function UsoCelda({ c, quien, ts, ver }: { c: Celda; quien: string; ts: number; ver?: boolean }) {
  const etiqueta = c.clave === "5h" ? t("uso.5h") : t("uso.semCorto");
  const largo = `${quien} · ${c.clave === "5h" ? t("uso.5hLargo") : t("uso.semLargo")}`;
  const hasta = c.hasta;
  const pct = c.pct;
  const reinicio = useMemo(() => pintorVisto(ts, hasta > 0 ? pintorReinicio(hasta) : () => ({ texto: t("uso.sinHoraTip"), en: Infinity }), true), [ts, hasta]);
  const cuando = useMemo(() => pintorCuando(hasta), [hasta]);
  const numero = useMemo(() => pintorPct(pct ?? 0, ts), [pct, ts]);
  const n = pct === null ? "normal" : nivel(pct);
  return (
    <div
      className="uso"
      tabIndex={0}
      aria-label={pct === null ? t("uso.ariaSinDato", { largo }) : t("uso.aria", { largo, pct })}
      data-nivel={n === "normal" ? undefined : n}
      data-sin={pct === null ? "" : undefined}
      data-ver={ver ? "" : undefined}
    >
      <div className="r">
        <span className="n">{etiqueta}</span>
        {pct === null ? <span className="sd">{t("uso.sinDato")}</span> : <Reloj pintor={numero} className="pct" />}
      </div>
      <div className="riel">{pct !== null && <i style={{ transform: `scaleX(${pct / 100})` }} />}</div>
      <span className="tip" role="tooltip">
        <span className="tip-t">{largo}</span>
        {pct === null ? (
          <span className="tip-l">{t("uso.sinDatoTip")}</span>
        ) : (
          <>
            <Reloj pintor={reinicio} className="tip-l" />
            {hasta > 0 && <Reloj pintor={cuando} className="tip-l" />}
          </>
        )}
      </span>
    </div>
  );
}
