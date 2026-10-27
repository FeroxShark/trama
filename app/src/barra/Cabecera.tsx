// La cabecera de la barra. Arriba, sólo el logo de trama (sin la palabra: gana lugar), releer y
// ocultar la barra; abajo, el uso de cada suscripción conectada, un renglón cada una: su logo y nombre
// (Claude, las que dice `reparto --cupos`: Google AI Pro, y las que vengan, sin tocar esto, y OpenCode con los pedidos que cuenta
// Trama: electron/opencode-pedidos.ts) y, en columnas
// alineadas, una celda por ventana: a la izquierda, cuánto falta para que se reinicie ("4 h 23 min", exacto y
// corto; se repinta solo, una vez por minuto) y a la derecha el porcentaje, con un riel finito (ámbar desde
// 70 %, rojo desde 90 %). El tooltip de cada celda (CSS, con el mouse o con foco; no el title nativo) dice a
// qué proveedor y ventana pertenece, el porcentaje y cuándo se reinicia ("Claude · ventana de 5 horas · 62 % usado ·
// se reinicia hoy 23:40"); si el dato es viejo, cuándo se vio; el número de un dato de hace más de 15 min se apaga
// (`data-viejo`). Una suscripción con varios grupos (Google) lleva su renglón (logo y nombre) y debajo uno por grupo, siempre a la vista. Un límite del que no se sabe ni el porcentaje lo dice: "sin dato" (Claude) o "—"
// (las demás), nunca una celda vacía. El botón de releer le pide a `claude` el uso como lo dice claude.ai
// (`get_usage`) y relee todo.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, PanelLeft, RotateCw, TriangleAlert } from "lucide-react";
import type { GrupoCupo, Uso, Ventana, VentanaCupo } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { nivel } from "../hilo/contexto-logica";
import { LogoSuscripcion } from "../hilo/Logos";
import { MARCA, filasDeCupos, type FilaSusc } from "../datos/cuentas";
import { MODO } from "../modo";
import { VIEJO_S, cuandoFuturo, pintorCuando, pintorVisto } from "../tiempo";
import type { Pintor } from "../reloj";
import { USO_BAJO, columnas, renglonesDeGrupos, resumenGrupo, type ResumenCupo } from "./cuposVista";
import { nombreGrupo, nombreGrupoCorto } from "./cuposNombres";
import { Marca } from "./Marca";
import { filaDe, formatearFaltaCorto, formatearHasta, type Unidades } from "./usoFila";
import { Reloj } from "./piezas";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";

/** Después de un clic el botón de releer descansa esto. */
const PAUSA_MS = 5000;

/** Mientras el uso no llegó: reserva el renglón (invisible) para que la lista no salte. */
const ESPERA: Ventana = { pct: 0, resets_at: 0 };

/** Las capturas `uso*` y `hover` dejan abierto el tip de la primera celda: se ve qué dice y que no tapa nada. */
const VER_TIP = MODO.captura === "hover" || !!MODO.captura?.startsWith("uso");

/**
 * Una ventana lista para pintar: `pct` null = sin dato; `hasta` en epoch s (0: no se sabe cuándo se reinicia);
 * `cupo`: viene de `reparto` (sin dato dice "—"), no de la statusline de Claude.
 */
type Celda = {
  clave: string;
  ventana: string;
  pct: number | null;
  hasta: number;
  cupo?: boolean;
  /** La ventana no rige ahora ("no aplica"), no es un 0 %. */
  off?: boolean;
  /** El grupo está marcado sin cupo hasta (epoch s) por un 429: una marca, no una medida. */
  marcado?: number;
  /** El grupo no trae ninguna ventana (Google puede sacar un límite): se dice "sin límite", no una celda vacía. */
  sinLimite?: boolean;
  /** Pedidos contados por Trama (OpenCode): sin porcentaje (los gratis no tienen tope publicado), la celda dice cuántos van. */
  pedidos?: number;
};

/** Cómo se llama una ventana en el tooltip (`5h`, `7d`; una desconocida, su id). */
function ventanaDe(id: string): string {
  if (id === "5h") return t("uso.5hLargo");
  if (id === "7d" || id === "sem") return t("uso.semLargo");
  return id;
}

export function Cabecera({ alOcultar }: { alOcultar: () => void }) {
  useIdioma();
  // `undefined`: todavía no llegó. `null`: llegó y no hay de dónde sacarlo.
  const [uso, setUso] = useState<Uso | null | undefined>(undefined);
  const [pausa, setPausa] = useState(false);
  const reloj = useRef(0);

  useEffect(() => {
    let vivo = true;
    void fuente.uso().then(
      (u) => vivo && setUso(u),
      () => vivo && setUso(null),
    );
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

  const datos = uso && !("error" in uso) ? uso : null;
  const cupos = filasDeCupos(datos?.suscripciones, datos?.claudeNombre, t("cuentas.principal"));

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
            <Grupo logo={<LogoSuscripcion id="claude" nombre="Claude" />} id="claude" nombre={t("uso.claude")} celdas={[celdaDe("5h", ESPERA), celdaDe("7d", ESPERA)]} ts={0} />
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
        <div className="usos" data-guia="uso">
          <div className="usos-l">
            <Grupo
              logo={<LogoSuscripcion id="claude" nombre="Claude" />}
              id="claude"
              nombre={cupos.claudeCorto ?? t("uso.claude")}
              quien={cupos.claude ?? undefined}
              celdas={[celdaDe("5h", uso?.five_hour ?? null), celdaDe("7d", uso?.seven_day ?? null)]}
              ts={uso?.ts ?? 0}
              ver={VER_TIP}
            />
            {cupos.filas.map((f) => (
              <Suscripcion key={f.s.id} f={f} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** La ventana de Claude (statusline / stream) como celda. */
function celdaDe(clave: "5h" | "7d", v: Ventana | null): Celda {
  const f = filaDe(v);
  return { clave, ventana: ventanaDe(clave), pct: f.pct, hasta: f.hasta ?? 0 };
}

/** Una ventana de `reparto` como celda. Con pedidos contados (OpenCode), el tooltip dice cuántos van y de qué tope. */
function celdaCupo(v: VentanaCupo | null): Celda | null {
  if (!v) return null;
  const ventana =
    v.pedidos === undefined
      ? ventanaDe(v.id)
      : v.tope
        ? t("uso.ventanaPedidos", { ventana: ventanaDe(v.id), n: v.pedidos.toLocaleString(), tope: v.tope.toLocaleString() })
        : t("uso.ventanaPedidosSin", { ventana: ventanaDe(v.id), n: v.pedidos.toLocaleString() });
  return { clave: v.id, ventana, pct: v.pct, hasta: v.vuelve ?? 0, cupo: true, ...(v.deshabilitada ? { off: true } : {}), ...(v.pedidos !== undefined ? { pedidos: v.pedidos } : {}) };
}

const celdasCupo = (ventanas: VentanaCupo[]) => columnas(ventanas).map(celdaCupo);

/** Un grupo marcado sin cupo (429): no se pintan sus 100 % inventados, una sola celda dice «marcado» y hasta cuándo. */
const celdasGrupo = (g: GrupoCupo, r: ResumenCupo): (Celda | null)[] =>
  r.estado === "marcado"
    ? [{ clave: "marca", ventana: t("cu.st.marcadoSin"), pct: null, hasta: r.vuelve ?? 0, cupo: true, marcado: r.vuelve ?? 0 }, null]
    : g.ventanas.length === 0
      ? [{ clave: "sin-limite", ventana: t("cu.w.sinLimite"), pct: null, hasta: 0, cupo: true, sinLimite: true }, null]
      : celdasCupo(g.ventanas);

/**
 * Una suscripción de `reparto` (todas menos Claude): con ventanas propias o con un solo grupo, un renglón con sus celdas; con varios grupos
 * (Google: Gemini, Claude/GPT, Argon…), el renglón del proveedor (logo y nombre) y debajo, siempre a la vista, un renglón por grupo con SUS
 * celdas en las mismas dos columnas que Claude (con "hasta d/m" si el cupo vence). Qué grupos hay y qué ventanas trae cada uno lo dice `reparto`
 * (`renglonesDeGrupos`): un grupo nuevo, sin ventanas o con una sola se dibuja igual, sin tocar esto.
 */
function Suscripcion({ f }: { f: FilaSusc }) {
  const { s } = f;
  // Una cuenta agregada cuelga de la fila de su proveedor: sin logo (ya lo dice la de arriba), sangrada y con el nombre de la cuenta.
  const logo = f.cuenta ? undefined : <LogoSuscripcion id={f.proveedor} nombre={s.nombre} />;
  const grupos = s.grupos ?? [];
  const ahora = Date.now() / 1000;
  const varios = grupos.length > 1;
  const unico = grupos.length === 1 ? grupos[0] : null;
  // "Google AI Pro" no entra en la columna del nombre: el renglón dice la marca ("Google") y el nombre entero va al tooltip (`quien`).
  const marca = (MARCA as Record<string, string>)[f.proveedor];
  const visible = marca && f.corto === f.nombre && f.corto.startsWith(marca) ? marca : f.corto;
  return (
    <>
      {f.primera && <div className="usos-sep" aria-hidden="true" />}
      <div className="susc" data-susc={s.id}>
        <Grupo
          logo={logo}
          id={s.id}
          nombre={visible}
          quien={unico ? `${f.nombre} · ${nombreGrupo(unico)}` : f.nombre}
          celdas={varios ? [] : unico ? celdasGrupo(unico, resumenGrupo(unico, ahora)) : celdasCupo(s.ventanas ?? [])}
          ts={s.ts}
          cuenta={f.cuenta}
        />
        {varios &&
          renglonesDeGrupos(grupos, ahora).map(({ g, r }) => {
            const h = formatearHasta(g.hasta);
            return (
              <Grupo
                key={g.id}
                id={`${s.id}:${g.id}`}
                nombre={nombreGrupoCorto(g)}
                quien={`${f.nombre} · ${nombreGrupo(g)}`}
                hasta={h ? t("uso.hasta", h) : undefined}
                celdas={celdasGrupo(g, r)}
                ts={s.ts}
                hijo
              />
            );
          })}
      </div>
    </>
  );
}

/**
 * Un renglón: logo y nombre, y las celdas en dos columnas fijas (5 h, semana). Un grupo sin 5 h deja la primera
 * columna vacía: las semanas quedan alineadas. El logo NUNCA se esconde, por angosta que esté la barra (se achica el texto y se pliegan las
 * barras, no la marca). `hijo`: un grupo de una suscripción (Gemini, Claude/GPT, Argon), sin logo, sangrado y con el nombre en hasta dos líneas.
 */
function Grupo({
  logo,
  id,
  nombre,
  sub,
  quien,
  hasta,
  celdas,
  ts,
  ver,
  hijo,
  cuenta,
}: {
  logo?: ReactNode;
  id: string;
  nombre: string;
  sub?: string;
  /** A quién pertenecen las celdas (tooltips); por defecto, el nombre. */
  quien?: string;
  hasta?: string;
  celdas: (Celda | null)[];
  ts: number;
  ver?: boolean;
  hijo?: boolean;
  /** Una cuenta agregada que cuelga de la fila de su proveedor (sangrada, sin logo). */
  cuenta?: boolean;
}) {
  const dueno = quien ?? nombre;
  return (
    <div className="grupo" data-grupo={id} data-hijo={hijo ? "" : undefined} data-cuenta={cuenta ? "" : undefined}>
      <span className="g-id" data-tip={hasta ? `${dueno} · ${hasta}` : dueno}>
        {logo}
        <span className="g-n">
          {/* "Claude/GPT" es una sola palabra: se deja partir después de la barra en vez de cortarla con "…". */}
          {nombre.split("/").map((p, i) => (
            <Fragment key={i}>
              {i > 0 && "/"}
              {i > 0 && <wbr />}
              {p}
            </Fragment>
          ))}
        </span>
        {sub && <span className="g-sub">{sub}</span>}
        {hasta && <span className="g-hasta">{hasta}</span>}
      </span>
      {celdas.map((c, i) =>
        c ? <UsoCelda key={c.clave} c={c} quien={dueno} ts={ts} ver={ver && i === 0} /> : <span key={`v${i}`} className="uso-vacio" aria-hidden="true" />,
      )}
    </div>
  );
}

/** Las unidades de lo que falta, ya en el idioma de ahora (el reloj las repinta al cambiarlo). */
const unidades = (): Unidades => ({
  d: t("tiempo.unidadD"),
  h: t("tiempo.unidadH"),
  min: t("tiempo.unidadMin"),
  s: t("tiempo.unidadS"),
  ya: t("tiempo.ya"),
});

/** Lo que falta para el reinicio, en el renglón: `formatearFalta`, repintado por el reloj solo cuando cambia. */
const pintorFalta =
  (hasta: number): Pintor =>
  (a) =>
    formatearFaltaCorto(hasta - a, unidades());

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
  const largo = `${quien} · ${c.ventana}`;
  const hasta = c.hasta;
  const pct = c.pct;
  const falta = useMemo(() => pintorFalta(hasta), [hasta]);
  const cuando = useMemo(() => pintorCuando(hasta), [hasta]);
  // El tooltip, chico: la ventana y cuándo se reinicia (el porcentaje, la falta y de quién es ya se ven en la barra); "visto hace…" si el dato es viejo.
  const explica = useMemo(() => pintorVisto(ts, (a) => (hasta > 0 ? cuando(a) : { texto: t("uso.sinHoraLinea"), en: Infinity }), true), [ts, hasta, cuando]);
  const numero = useMemo(() => pintorPct(pct ?? 0, ts), [pct, ts]);
  const n = pct === null ? "normal" : nivel(pct);
  // Una ventana que no rige ahora, o un grupo marcado sin cupo: ni barra ni porcentaje, una frase corta y la explicación en el tip.
  if (c.sinLimite) {
    return (
      <div className="uso" tabIndex={0} data-aparte="sin-limite" aria-label={`${largo}`}>
        <div className="r">
          <span className="sd">{t("cu.w.sinLimite")}</span>
        </div>
        <div className="riel" data-hueco="" />
        <span className="tip" role="tooltip">
          <span className="tip-t">{largo}</span>
          <span className="tip-l">{t("cu.w.sinLimiteQue")}</span>
        </span>
      </div>
    );
  }
  if (c.off || c.marcado !== undefined) {
    const marcado = c.marcado !== undefined;
    return (
      <div className="uso" tabIndex={0} data-aparte={marcado ? "marcado" : "off"} aria-label={`${largo}: ${marcado ? t("cu.w.marcadoCorto") : t("cu.w.noAplicaCorto")}`} data-ver={ver ? "" : undefined}>
        <div className="r">
          <span className="sd">{marcado ? t("cu.w.marcadoCorto") : t("cu.w.noAplicaCorto")}</span>
        </div>
        <div className="riel" data-hueco="" />
        <span className="tip" role="tooltip">
          <span className="tip-t">{marcado ? `${t("cu.st.marcado", { cuando: cuandoFuturo(hasta) })}` : largo}</span>
          <span className="tip-l">{marcado ? t("cu.w.marcaQue") : t("cu.w.noAplicaQue")}</span>
        </span>
      </div>
    );
  }
  return (
    <div
      className="uso"
      tabIndex={0}
      aria-label={pct === null ? (c.pedidos !== undefined ? largo : t("uso.ariaSinDato", { largo })) : t("uso.aria", { largo, pct })}
      data-nivel={n === "normal" ? undefined : n}
      data-sin={pct === null ? "" : undefined}
      data-ver={ver ? "" : undefined}
    >
      <div className="r">
        {/* Agotada: cuándo vuelve ("vie 01:01") y el ícono, sin el "100%" que no entra junto a la cuenta regresiva. */}
        {/* En el lugar del número (la cuenta regresiva se esconde en la barra angosta; esto no). */}
        {pct !== null && pct >= 100 && hasta > 0 ? (
          <span className="pct uso-hora">{cuandoFuturo(hasta)}</span>
        ) : hasta > 0 ? (
          <Reloj pintor={falta} className="n" />
        ) : (
          <span className="n">—</span>
        )}
        {pct === null ? (
          <span className="sd">{c.pedidos !== undefined ? t("uso.pedidosCorto", { n: c.pedidos.toLocaleString() }) : c.cupo ? "—" : t("uso.sinDato")}</span>
        ) : pct >= 100 && hasta > 0 ? null : (
          <Reloj pintor={numero} className="pct" />
        )}
        {pct !== null && pct >= 100 && <Ban className="uso-lleno" size={10} strokeWidth={2.4} aria-hidden="true" />}
        {pct !== null && pct >= USO_BAJO && pct < 100 && <TriangleAlert className="uso-bajo" size={10} strokeWidth={2.4} aria-hidden="true" />}
      </div>
      <div className="riel">{pct !== null && <i style={{ transform: `scaleX(${pct / 100})` }} />}</div>
      <span className="tip" role="tooltip">
        {pct === null ? (
          <>
            <span className="tip-t">{largo}</span>
            <span className="tip-l">{c.pedidos !== undefined ? t("uso.pedidosTip") : c.cupo ? t("uso.sinDatoCupo") : t("uso.sinDatoTip")}</span>
          </>
        ) : (
          <>
            <span className="tip-t">{c.ventana}</span>
            <Reloj pintor={explica} className="tip-l" />
          </>
        )}
      </span>
    </div>
  );
}
