// Panel acoplable de Cupo: muestra todas las suscripciones configuradas, el uso y reinicio de sus ventanas,
// selector de cuenta cuando hay varias, y el ritmo semanal de Claude contra lo esperado a esta altura de la semana.
import { Fragment, useMemo } from "react";
import { Minus, RotateCw } from "lucide-react";
import { cuentaParaElegir } from "../datos/cuentas";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { abrirAjustes } from "../paneles/ajustes-nav";
import type { Pintor } from "../reloj";
import { VIEJO_S, pintorVisto } from "../tiempo";
import { IcAtencion, IcCerrar, IcOk, IcSinCupo } from "../ui/iconos";
import { LogoCaja, type Proveedor } from "../ui/logos";
import { textoVuelve } from "./cuposNota";
import { ElegirCuenta, useCuentasBarra } from "./ElegirCuenta";
import {
  armarSuscripcionesPanel,
  ritmoPanel,
  type NivelVentana,
  type RitmoPanel,
  type VentanaPanel,
} from "./panel-cupo-logica";
import { Reloj } from "./piezas";
import { formatearFalta, formatearHasta, type Unidades } from "./usoFila";
import { pintorActualizado, useUso } from "./useUso";
import "./panel-cupo.css";

const PROVEEDORES_LOGO = new Set<string>(["claude", "google", "chatgpt", "opencode", "nvidia"]);

const unidades = (): Unidades => ({
  d: t("tiempo.unidadD"),
  h: t("tiempo.unidadH"),
  min: t("tiempo.unidadMin"),
  s: t("tiempo.unidadS"),
  ya: t("tiempo.ya"),
});

function nombreVentana(id: string): string {
  if (id === "5h") return t("riel.cinco");
  if (id === "7d") return t("riel.semana");
  return id;
}

function etiquetaNivel(nivel: NivelVentana): string {
  if (nivel === "agotado") return t("pcupo.estadoAgotado");
  if (nivel === "atencion") return t("pcupo.estadoAtencion");
  if (nivel === "bien") return t("pcupo.estadoBien");
  if (nivel === "off") return t("pcupo.estadoOff");
  return t("pcupo.estadoSinDato");
}

function IconoNivel({ nivel }: { nivel: NivelVentana }) {
  if (nivel === "agotado") return <IcSinCupo size={12} strokeWidth={2.2} aria-hidden="true" />;
  if (nivel === "atencion") return <IcAtencion size={12} strokeWidth={2.2} aria-hidden="true" />;
  if (nivel === "bien") return <IcOk size={12} strokeWidth={2.5} aria-hidden="true" />;
  return <Minus size={12} strokeWidth={2.2} aria-hidden="true" />;
}

const pintorReinicio = (v: VentanaPanel, ts: number): Pintor =>
  pintorVisto(
    ts,
    (a) => {
      if (v.vuelve && v.vuelve > a) {
        const f = textoVuelve(v.vuelve, a, unidades(), formatearFalta);
        return {
          texto: v.marcado ? `${t("pcupo.marcado")} · ${f.texto}` : f.texto,
          en: f.en,
        };
      }
      if (v.marcado) return { texto: t("pcupo.marcado"), en: Infinity };
      if (v.gratis) return { texto: `${t("riel.gratis")} · ${t("riel.sinLimiteConocido")}`, en: Infinity };
      return { texto: "", en: Infinity };
    },
    true,
  );

const pintorVuelveRitmo = (vuelve: number, ts: number): Pintor =>
  pintorVisto(
    ts,
    (a) => {
      if (vuelve <= a) return { texto: "", en: Infinity };
      const f = textoVuelve(vuelve, a, unidades(), formatearFalta);
      return { texto: f.texto, en: f.en };
    },
    true,
  );

function ValorVentana({ v }: { v: VentanaPanel }) {
  if (v.nivel === "off") return <span className="pc-val pc-val-apagado">—</span>;
  if (v.pct !== null) return <span className="pc-val">{v.pct} %</span>;
  if (v.pedidos !== undefined && v.tope) {
    return <span className="pc-val">{t("pcupo.pedidosTope", { n: v.pedidos.toLocaleString(), tope: v.tope.toLocaleString() })}</span>;
  }
  if (v.pedidos !== undefined) return <span className="pc-val">{t("riel.pedidos", { n: v.pedidos.toLocaleString() })}</span>;
  return <span className="pc-val pc-val-apagado">—</span>;
}

function FilaVentana({ v, ts, mostrarNombre }: { v: VentanaPanel; ts: number; mostrarNombre: boolean }) {
  const reinicio = useMemo(() => pintorReinicio(v, ts), [v, ts]);
  const pctBarra = v.pct !== null ? Math.max(0, Math.min(100, v.pct)) : null;

  return (
    <div className="pc-ventana" data-nivel={v.nivel}>
      <div className="pc-v-cab">
        <span className="pc-v-nom">{mostrarNombre ? nombreVentana(v.id) : ""}</span>
        <div className="pc-v-der">
          <ValorVentana v={v} />
          <span className="pc-estado" data-nivel={v.nivel}>
            <IconoNivel nivel={v.nivel} />
            <span>{etiquetaNivel(v.nivel)}</span>
          </span>
        </div>
      </div>
      {pctBarra !== null ? (
        <div className="pc-barra" aria-hidden="true">
          <span className="pc-barra-fill" data-nivel={v.nivel} style={{ width: `${pctBarra}%` }} />
        </div>
      ) : null}
      <Reloj pintor={reinicio} className="pc-sub" />
    </div>
  );
}

function TarjetaRitmo({ r }: { r: RitmoPanel }) {
  const vuelvePintor = useMemo(() => (r.vuelve ? pintorVuelveRitmo(r.vuelve, r.ts) : null), [r.vuelve, r.ts]);
  const u = unidades();

  let textoVeredicto = "";
  if (r.estadoRitmo === "agotado") textoVeredicto = t("pcupo.agotadoRitmo");
  else if (r.estadoRitmo === "seAcaba" && r.seAcabaEn !== null) {
    textoVeredicto = t("pcupo.noLlega", { falta: formatearFalta(r.seAcabaEn, u).texto });
  } else if (r.estadoRitmo === "encima") textoVeredicto = t("pcupo.arribaRitmo");
  else if (r.estadoRitmo === "llega") textoVeredicto = t("pcupo.llega");
  else textoVeredicto = t("pcupo.ritmoSinHora", { pct: r.pct });

  return (
    <section className="pc-bloque pc-ritmo" aria-label={t("pcupo.ritmoAria", { cuenta: r.cuenta })} data-nivel={r.nivel}>
      <header className="pc-bloque-cab">
        <div className="pc-tit-grupo">
          <h3>{t("pcupo.ritmo")}</h3>
          <span className="pc-subtitulo">{r.cuenta}</span>
        </div>
        <div className="pc-v-der">
          <span className="pc-cifra">{r.pct} %</span>
          <span className="pc-estado" data-nivel={r.nivel}>
            <IconoNivel nivel={r.nivel} />
            <span>{etiquetaNivel(r.nivel)}</span>
          </span>
        </div>
      </header>
      <div className="pc-medidor" role="img" aria-label={`${r.pct} %${r.esperadoPct !== null ? ` · ${t("pcupo.esperadoAhora", { pct: r.esperadoPct })}` : ""}`}>
        <div className="pc-pista">
          <span className="pc-relleno" data-nivel={r.nivel} style={{ width: `${Math.min(100, r.pct)}%` }} />
        </div>
        {r.esperadoPct !== null ? <span className="pc-marca" style={{ left: `${r.esperadoPct}%` }} aria-hidden="true" /> : null}
      </div>
      <div className="pc-ritmo-meta">
        {r.esperadoPct !== null ? <span className="pc-sub">{t("pcupo.esperadoAhora", { pct: r.esperadoPct })}</span> : null}
        {vuelvePintor ? <Reloj pintor={vuelvePintor} className="pc-sub" /> : null}
      </div>
      <p className="pc-veredicto" data-nivel={r.nivel}>
        <IconoNivel nivel={r.nivel} />
        <span>{textoVeredicto}</span>
      </p>
    </section>
  );
}

export function PanelCupo() {
  useIdioma();
  const { uso, fallo, pausa, releer } = useUso();
  const [cuentas, releerCuentas] = useCuentasBarra();

  const error = uso && "error" in uso ? uso.error : null;
  const datos = uso && !("error" in uso) ? uso : null;
  const tsGlobal = datos?.ts ?? 0;
  const viejo = !!tsGlobal && Math.floor(Date.now() / 1000) - tsGlobal >= VIEJO_S;
  const actualizado = useMemo(() => pintorActualizado(tsGlobal, fallo), [tsGlobal, fallo]);

  const ahoraS = Math.floor(Date.now() / 1000);
  const nombres = { claude: t("uso.claude"), principal: t("cuentas.principal") };
  const suscripciones = useMemo(() => armarSuscripcionesPanel(datos, cuentas, ahoraS, nombres), [datos, cuentas, ahoraS, nombres.claude, nombres.principal]);
  const ritmo = useMemo(() => ritmoPanel(datos, cuentas, ahoraS, nombres), [datos, cuentas, ahoraS, nombres.claude, nombres.principal]);

  const hayCuentas = suscripciones.some((s, i, arr) => arr.findIndex((x) => x.proveedor === s.proveedor) !== i);

  return (
    <div className="panel-cupo" data-fallo={fallo ? "" : undefined} data-viejo={viejo ? "" : undefined}>
      <div className="pc-top">
        <Reloj pintor={actualizado} className="pc-act" data-fallo={fallo ? "" : undefined} role={fallo ? "alert" : undefined} />
        <button
          type="button"
          className="pc-releer"
          aria-label={t("uso.releer")}
          data-tip={t("uso.releer")}
          disabled={pausa || uso === undefined}
          onClick={releer}
        >
          <RotateCw size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <p className="pc-error" role="alert">
          <IcCerrar size={14} strokeWidth={2.2} aria-hidden="true" />
          <span>{textoMain(error)}</span>
        </p>
      ) : null}

      <div className="pc-scroll">
        {!error ? (
          <Fragment>
            {ritmo ? (
              <TarjetaRitmo r={ritmo} />
            ) : (
              <p className="pc-sin-ritmo">{t("pcupo.sinRitmo")}</p>
            )}

            <h3 className="pc-sec-tit">{t("pcupo.suscripciones")}</h3>
            <div className="pc-tarjetas">
              {suscripciones.map((s) => {
                const perfil = s.cuenta ? cuentaParaElegir(cuentas, s.cuenta.proveedor, s.cuenta.id) : null;
                return (
                <article key={s.clave} className="pc-bloque pc-tarjeta" data-proveedor={s.proveedor}>
                  <header className="pc-bloque-cab">
                    <div className="pc-tit-grupo">
                      {PROVEEDORES_LOGO.has(s.proveedor) ? <LogoCaja id={s.proveedor as Proveedor} /> : null}
                      <h4>{s.titulo}</h4>
                      {s.enUso ? <span className="pc-pill-uso">{t("pcupo.enUso")}</span> : null}
                    </div>
                    {perfil ? (
                      <div className="pc-cuenta-acc">
                        <ElegirCuenta perfil={perfil} alCambiar={releerCuentas} />
                      </div>
                    ) : null}
                  </header>

                  <div className="pc-grupos">
                    {s.grupos.map((g) => {
                      const vence = formatearHasta(g.hasta);
                      return (
                        <div key={g.clave} className="pc-grupo">
                          {g.nombre || vence ? (
                            <div className="pc-grupo-cab">
                              {g.nombre ? <span className="pc-grupo-nom">{g.nombre}</span> : null}
                              {vence ? (
                                <span className="pc-sub">{t("pcupo.hastaFecha", { fecha: `${vence.d}/${vence.m}` })}</span>
                              ) : null}
                            </div>
                          ) : null}
                          {g.sinLimite ? (
                            <p className="pc-sin-limite">{t("riel.sinLimite")}</p>
                          ) : (
                            <div className="pc-ventanas">
                              {g.ventanas.map((v) => (
                                <FilaVentana key={v.id} v={v} ts={s.ts || tsGlobal} mostrarNombre={g.ventanas.length > 1 || s.proveedor === "claude"} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
                );
              })}
            </div>
          </Fragment>
        ) : null}

        <footer className="pc-pie">
          {hayCuentas ? <p className="pc-nota">{t("riel.noCambia")}</p> : null}
          <button type="button" className="pc-ver" onClick={() => abrirAjustes("cupos")}>
            {t("riel.verPlan")}
          </button>
        </footer>
      </div>
    </div>
  );
}
