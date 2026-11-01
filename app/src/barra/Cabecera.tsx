// La cabecera de la barra. Arriba, sólo el logo de trama (sin la palabra: gana lugar), releer y
// ocultar la barra; abajo, los cupos de cada suscripción conectada como tarjetas (rediseño 0.4): Claude (y toda
// suscripción con ventanas propias) en dos tarjetas grandes, 5 h y semana, con la cifra protagonista, su barra y
// "vuelve en 2 h 10 min"; una suscripción con varios grupos (Google: Gemini, Claude/GPT, Argon…) en una tarjeta chica por
// grupo (la cifra es la ventana más llena; el tooltip lista todas); una con un solo grupo, o los pedidos que cuenta Trama
// (OpenCode: electron/opencode-pedidos.ts), en una cápsula ancha con sus ventanas en línea. Lo agotado (o marcado sin cupo
// por un 429) va tintado, con el ícono de agotado y "vuelve <hora>": nunca sólo color. Ámbar desde 70 %, rojo desde 90 %,
// y desde `USO_BAJO` el ícono y "queda poco cupo". El tooltip (CSS, con el mouse o con foco; no el title nativo) dice a qué
// proveedor y ventana pertenece, cuánto lleva y cuándo se reinicia; si el dato es viejo, cuándo se vio; el número de un
// dato de hace más de 15 min se apaga (`data-viejo`). Un límite del que no se sabe ni el porcentaje lo dice: "sin dato"
// (Claude) o "—" (las demás), nunca una tarjeta vacía. El botón de releer le pide a `claude` el uso como lo dice claude.ai
// (`get_usage`) y relee todo.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, PanelLeft, RotateCw, TriangleAlert } from "lucide-react";
import type { GrupoCupo, Uso, Ventana, VentanaCupo } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { nivel } from "../hilo/contexto-logica";
import { LogoSuscripcion } from "../hilo/Logos";
import { MARCA, cuentaParaElegir, filasDeCupos, type FilaSusc, type ListaCuentas } from "../datos/cuentas";
import { ElegirCuenta, useCuentasBarra } from "./ElegirCuenta";
import { MODO } from "../modo";
import { VIEJO_S, cuandoFuturo, pintorCuando, pintorVisto } from "../tiempo";
import type { Pintor } from "../reloj";
import { USO_BAJO, columnas, renglonesDeGrupos, resumenGrupo, type ResumenCupo } from "./cuposVista";
import { nombreGrupo, nombreGrupoCorto } from "./cuposNombres";
import { notaDeCelda, textoVuelve, ventanaCorta } from "./cuposNota";
import { Marca } from "./Marca";
import { filaDe, formatearHasta, type Unidades } from "./usoFila";
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
  if (id === "1m") return t("uso.minLargo");
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
  // Las cuentas de cada proveedor (sólo cuando hay varias, cada fila lleva su «En uso» / «Usar primero»).
  const [cuentas, releerCuentas] = useCuentasBarra();

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
            <Cupos id="claude" forma="grandes">
              {([celdaDe("5h", ESPERA), celdaDe("7d", ESPERA)] as Celda[]).map((c) => (
                <Tarjeta key={c.clave} nombre={t("uso.claude")} quien={t("uso.claude")} celdas={[c]} ts={0} />
              ))}
            </Cupos>
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
        <div className="usos" data-guia="uso" role="group" aria-label={t("cupos.titulo")}>
          <div className="usos-l">
            <Cupos id="claude" forma="grandes" accion={controlDe(cuentas, "claude", "claude", releerCuentas)}>
              {([celdaDe("5h", uso?.five_hour ?? null), celdaDe("7d", uso?.seven_day ?? null)] as Celda[]).map((c, i) => (
                <Tarjeta
                  key={c.clave}
                  nombre={cupos.claudeCorto ?? t("uso.claude")}
                  quien={cupos.claude ?? cupos.claudeCorto ?? t("uso.claude")}
                  celdas={[c]}
                  ts={uso?.ts ?? 0}
                  ver={VER_TIP && i === 0}
                />
              ))}
            </Cupos>
            {cupos.filas.map((f) => (
              <Suscripcion key={f.s.id} f={f} cuentas={cuentas} releerCuentas={releerCuentas} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** El control «En uso» / «Usar primero» de una fila, si su proveedor tiene varias cuentas; `undefined`: la fila queda como hoy. */
function controlDe(cuentas: ListaCuentas | null, proveedor: string, cuenta: string, releer: () => void): ReactNode {
  const perfil = cuentaParaElegir(cuentas, proveedor, cuenta);
  return perfil ? <ElegirCuenta perfil={perfil} alCambiar={releer} /> : undefined;
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

/** Agotada: el 100 % medido o la marca de un 429. */
const agotada = (c: Celda): boolean => !c.off && (c.marcado !== undefined || (c.pct !== null && c.pct >= 100));

/** La ventana de una celda para la nota de la tarjeta ("" si es la marca de un grupo o «sin límite»). */
const ventanaDe2 = (c: Celda): string => (c.clave === "marca" || c.clave === "sin-limite" ? "" : ventanaCorta(c.clave));

/** La celda que manda en una tarjeta con varias ventanas: lo marcado, lo agotado (la que vuelve más tarde), lo más usado. */
function principal(cs: Celda[]): Celda {
  const marcada = cs.find((c) => c.marcado !== undefined);
  if (marcada) return marcada;
  const llenas = cs.filter(agotada);
  if (llenas.length) return llenas.reduce((a, c) => (c.hasta > a.hasta ? c : a));
  const conPct = cs.filter((c) => !c.off && c.pct !== null);
  if (conPct.length) return conPct.reduce((a, c) => ((c.pct ?? 0) > (a.pct ?? 0) ? c : a));
  return cs.find((c) => !c.off && !c.sinLimite) ?? cs[0];
}

/** Una suscripción de `reparto` (todas menos Claude), en la forma que le toca: ver arriba. */
function Suscripcion({ f, cuentas, releerCuentas }: { f: FilaSusc; cuentas: ListaCuentas | null; releerCuentas: () => void }) {
  const { s } = f;
  // Una cuenta agregada cuelga de la de su proveedor: sin logo (ya lo dice la de arriba) y con el nombre de la cuenta.
  const logo = f.cuenta ? undefined : <LogoSuscripcion id={f.proveedor} nombre={s.nombre} />;
  const grupos = s.grupos ?? [];
  const ahora = Date.now() / 1000;
  const unico = grupos.length === 1 ? grupos[0] : null;
  // "Google AI Pro" no entra en la tarjeta: se dice la marca ("Google") y el nombre entero va al tooltip (`quien`).
  const marca = (MARCA as Record<string, string>)[f.proveedor];
  const visible = marca && f.corto === f.nombre && f.corto.startsWith(marca) ? marca : f.corto;
  const accion = controlDe(cuentas, f.proveedor, s.cuenta ?? s.id, releerCuentas);
  if (grupos.length > 1) {
    return (
      <Cupos id={s.id} cuenta={f.cuenta} accion={accion} forma="chicas" nombre={visible} logo={logo}>
        {renglonesDeGrupos(grupos, ahora).map(({ g, r }) => {
          const h = formatearHasta(g.hasta);
          return (
            <Tarjeta
              key={g.id}
              chica
              nombre={nombreGrupoCorto(g)}
              quien={`${f.nombre} · ${nombreGrupo(g)}${h ? ` · ${t("uso.hasta", h)}` : ""}`}
              celdas={celdasGrupo(g, r)}
              ts={s.ts}
            />
          );
        })}
      </Cupos>
    );
  }
  // Un solo grupo, o los pedidos que cuenta Trama (OpenCode): una cápsula ancha con sus ventanas en línea.
  if (unico || f.proveedor === "opencode") {
    const celdas = unico ? celdasGrupo(unico, resumenGrupo(unico, ahora)) : celdasCupo(s.ventanas ?? []);
    const corto = unico ? nombreGrupoCorto(unico) : "";
    const repetido = !corto || corto.toLowerCase().includes(visible.toLowerCase()) || visible.toLowerCase().includes(corto.toLowerCase());
    return (
      <Cupos id={s.id} cuenta={f.cuenta} accion={accion} forma="capsula">
        <Capsula logo={logo} nombre={repetido ? visible : `${visible} · ${corto}`} quien={unico ? `${f.nombre} · ${nombreGrupo(unico)}` : f.nombre} celdas={celdas} ts={s.ts} />
      </Cupos>
    );
  }
  return (
    <Cupos id={s.id} cuenta={f.cuenta} accion={accion} forma="grandes">
      {celdasCupo(s.ventanas ?? []).map((c) => (c ? <Tarjeta key={c.clave} nombre={visible} quien={f.nombre} celdas={[c]} ts={s.ts} /> : null))}
    </Cupos>
  );
}

/**
 * El bloque de una suscripción: sus tarjetas en la rejilla de su forma y, debajo, el control de la cuenta («En uso» / «Usar primero»),
 * sólo si el proveedor tiene varias. Es el ancla de los tooltips (cuelgan de acá, debajo de todo el bloque, a todo el ancho que necesitan).
 * `chicas`: arriba el renglón del proveedor (logo y nombre) porque las tarjetas sólo llevan el nombre del grupo.
 */
function Cupos({
  id,
  forma,
  cuenta,
  accion,
  nombre,
  logo,
  children,
}: {
  id: string;
  forma: "grandes" | "chicas" | "capsula";
  cuenta?: boolean;
  accion?: ReactNode;
  nombre?: string;
  logo?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="susc" data-susc={id} data-forma={forma} data-cuenta={cuenta ? "" : undefined}>
      {forma === "chicas" && (
        <div className="cq-cab">
          {logo}
          <span className="cq-cab-n">{nombre}</span>
        </div>
      )}
      {forma === "capsula" ? children : <div className="cq-rejilla">{children}</div>}
      {accion ? <div className="g-acc">{accion}</div> : null}
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

/** "vuelve en 2 h 10 min", repintado por el reloj solo cuando cambia. */
const pintorVuelve =
  (hasta: number): Pintor =>
  (a) =>
    textoVuelve(hasta, a, unidades());

/** El dato viejo (más de 15 min, el tooltip dice de cuándo es) se apaga: `data-viejo` en el elemento que lo pinta. */
const pintorViejo =
  (ts: number, texto: (pct: number) => string, pct: number): Pintor =>
  (a) => {
    const d = a - ts;
    const viejo = !!ts && d >= VIEJO_S;
    return { texto: texto(pct), en: ts && !viejo ? VIEJO_S - d : Infinity, attrs: { "data-viejo": viejo ? "" : null } };
  };

/** El número de la tarjeta (el «%» lo pone el CSS, más chico) y, para la cápsula, el número con su «%». */
const pintorNumero = (pct: number, ts: number): Pintor => pintorViejo(ts, (p) => String(p), pct);
const pintorPct = (pct: number, ts: number): Pintor => pintorViejo(ts, (p) => `${p}%`, pct);

/** Una línea del tooltip: la ventana y su porcentaje, y cuándo se reinicia ("visto hace…" si el dato es viejo). */
function TipLinea({ c, quien, ts }: { c: Celda; quien: string; ts: number }) {
  const hasta = c.hasta;
  const cuando = useMemo(() => pintorCuando(hasta), [hasta]);
  const explica = useMemo(() => pintorVisto(ts, (a) => (hasta > 0 ? cuando(a) : { texto: t("uso.sinHoraLinea"), en: Infinity }), true), [ts, hasta, cuando]);
  if (c.sinLimite)
    return (
      <>
        <span className="tip-t">{`${quien} · ${c.ventana}`}</span>
        <span className="tip-l">{t("cu.w.sinLimiteQue")}</span>
      </>
    );
  if (c.marcado !== undefined)
    return (
      <>
        <span className="tip-t">{t("cu.st.marcado", { cuando: cuandoFuturo(hasta) })}</span>
        <span className="tip-l">{t("cu.w.marcaQue")}</span>
      </>
    );
  if (c.off)
    return (
      <>
        <span className="tip-t">{`${quien} · ${c.ventana}`}</span>
        <span className="tip-l">{t("cu.w.noAplicaQue")}</span>
      </>
    );
  if (c.pct === null)
    return (
      <>
        <span className="tip-t">{`${quien} · ${c.ventana}`}</span>
        <span className="tip-l">{c.pedidos !== undefined ? t("uso.pedidosTip") : c.cupo ? t("uso.sinDatoCupo") : t("uso.sinDatoTip")}</span>
      </>
    );
  return (
    <>
      <span className="tip-t">{`${c.ventana} · ${t("cu.w.usado", { pct: c.pct })}`}</span>
      <Reloj pintor={explica} className="tip-l" />
    </>
  );
}

function Tip({ celdas, quien, ts }: { celdas: Celda[]; quien: string; ts: number }) {
  return (
    <span className="tip" role="tooltip">
      {celdas.length > 1 || celdas[0]?.marcado !== undefined ? <span className="tip-t">{quien}</span> : null}
      {celdas.map((c) => (
        <TipLinea key={c.clave} c={c} quien={quien} ts={ts} />
      ))}
    </span>
  );
}

/** Lo que dice la tarjeta de una celda sin porcentaje que mostrar. */
function textoAparte(c: Celda): string {
  if (c.sinLimite) return t("cu.w.sinLimite");
  if (c.off) return t("cu.w.noAplicaCorto");
  if (c.pedidos !== undefined) return t("uso.pedidosCorto", { n: c.pedidos.toLocaleString() });
  return c.cupo ? "—" : t("uso.sinDato");
}

/**
 * Una tarjeta de cupo. `celdas`: las ventanas que resume (una en las grandes; en las chicas, las del grupo: manda la más llena y el
 * tooltip las lista todas). Grande: nombre y ventana, la cifra, la barra y "vuelve en…". Chica: lo mismo más compacto, con la ventana
 * como nota. Agotada: tinte, ícono, "sin cupo" y "vuelve <hora>". `ts`: cuándo se vio el dato (0: no se sabe).
 */
function Tarjeta({
  nombre,
  quien,
  celdas,
  ts,
  chica,
  ver,
}: {
  nombre: string;
  quien: string;
  celdas: (Celda | null)[];
  ts: number;
  chica?: boolean;
  ver?: boolean;
}) {
  const cs = celdas.filter((c): c is Celda => !!c);
  const c = principal(cs);
  const hasta = c.hasta;
  const vuelve = useMemo(() => pintorVuelve(hasta), [hasta]);
  const pct = c.pct;
  const numero = useMemo(() => pintorNumero(pct ?? 0, ts), [pct, ts]);
  const sin = agotada(c);
  const aparte = !sin && (c.off || c.sinLimite || pct === null);
  const bajo = !sin && !aparte && pct !== null && pct >= USO_BAJO;
  const n = pct === null || sin ? "normal" : nivel(pct);
  const ventana = ventanaDe2(c);
  // La nota: cuándo vuelve la ventana; sin esa hora, el nombre de la ventana (chica) o «sin hora de vuelta».
  const nota = notaDeCelda({ chica: !!chica, hasta, ventana });
  const etiqueta = chica || !ventana ? nombre : `${nombre} · ${ventana}`;
  const largo = `${quien} · ${c.ventana}`;
  const aria = sin
    ? hasta > 0
      ? t("cupos.ariaSinCupo", { largo, cuando: cuandoFuturo(hasta) })
      : t("cupos.ariaSinCupoHora", { largo })
    : pct === null || c.off || c.sinLimite
      ? t("uso.ariaSinDato", { largo })
      : t("uso.aria", { largo, pct });
  return (
    <div
      className="cq"
      tabIndex={0}
      aria-label={aria}
      data-chica={chica ? "" : undefined}
      data-agotado={sin ? "" : undefined}
      data-nivel={n === "normal" ? undefined : n}
      data-aparte={aparte ? "" : undefined}
      data-ver={ver ? "" : undefined}
    >
      <span className="cq-nom">
        <span className="cq-nom-t">
          {/* "Claude/GPT" es una sola palabra: se deja partir después de la barra en vez de cortarla con "…". */}
          {etiqueta.split("/").map((p, i) => (
            <span key={i}>
              {i > 0 && "/"}
              {i > 0 && <wbr />}
              {p}
            </span>
          ))}
        </span>
        {sin && <Ban className="cq-ico" size={12} strokeWidth={2.4} aria-hidden="true" />}
      </span>
      {sin ? (
        <span className="cq-h cq-txt">{t("cupos.sinCupo")}</span>
      ) : aparte ? (
        <span className="cq-h cq-txt" data-apagado="">
          {textoAparte(c)}
        </span>
      ) : (
        <Reloj pintor={numero} className="cq-h cq-n" />
      )}
      <div className="cq-pista" data-hueco={aparte ? "" : undefined}>
        {!aparte && <i style={{ transform: `scaleX(${sin ? 1 : (pct ?? 0) / 100})` }} />}
      </div>
      <span className="cq-nota">
        {bajo && <TriangleAlert className="cq-ico" size={11} strokeWidth={2.4} aria-hidden="true" />}
        {sin && hasta > 0 ? (
          t("cu.w.vuelve", { cuando: cuandoFuturo(hasta) })
        ) : sin ? (
          nota.tipo === "ventana" ? nota.texto : t("cupos.agotado")
        ) : bajo ? (
          t("cupos.pocoCupo")
        ) : nota.tipo === "vuelve" ? (
          <Reloj pintor={vuelve} />
        ) : nota.tipo === "ventana" ? (
          nota.texto
        ) : (
          t("cupos.sinHora")
        )}
      </span>
      {/* Con poco cupo, el texto va arriba y la hora de vuelta abajo (como la grande): la chica no se queda sin ella. */}
      {bajo && hasta > 0 && <Reloj pintor={vuelve} className="cq-nota" />}
      <Tip celdas={cs} quien={quien} ts={ts} />
    </div>
  );
}

/**
 * Una suscripción de una sola fila (un solo grupo, o los pedidos que cuenta Trama): logo y nombre a la izquierda y, en línea, cada ventana
 * con su valor. Agotada (todas las que rigen): tinte, ícono y "agotado · vuelve <hora>".
 */
function Capsula({ logo, nombre, quien, celdas, ts }: { logo?: ReactNode; nombre: string; quien: string; celdas: (Celda | null)[]; ts: number }) {
  const cs = celdas.filter((c): c is Celda => !!c);
  const rigen = cs.filter((c) => !c.off);
  const todoAgotado = rigen.length > 0 && rigen.every(agotada);
  const aria = todoAgotado ? t("cupos.ariaSinCupoHora", { largo: quien }) : quien;
  return (
    <div className="cq cq-capsula" tabIndex={0} aria-label={aria} data-agotado={todoAgotado ? "" : undefined}>
      <span className="cq-nom">
        {logo}
        <span className="cq-nom-t">{nombre}</span>
      </span>
      <span className="cq-segs">
        {cs.map((c) => (
          <Segmento key={c.clave} c={c} ts={ts} />
        ))}
      </span>
      <Tip celdas={cs} quien={quien} ts={ts} />
    </div>
  );
}

/** Una ventana de la cápsula: su nombre y su valor ("24%", "37 ped.", "agotado · vuelve jue 01:01"), con el ícono de poco cupo o de agotado. */
function Segmento({ c, ts }: { c: Celda; ts: number }) {
  const pct = c.pct;
  const numero = useMemo(() => pintorPct(pct ?? 0, ts), [pct, ts]);
  const vuelve = useMemo(() => pintorVuelve(c.hasta), [c.hasta]);
  const sin = agotada(c);
  const aparte = c.off || c.sinLimite || pct === null;
  const bajo = !sin && !aparte && pct !== null && pct >= USO_BAJO;
  const ventana = ventanaDe2(c);
  const n = pct === null || sin ? "normal" : nivel(pct);
  return (
    <span className="cq-seg" data-agotado={sin ? "" : undefined} data-nivel={n === "normal" ? undefined : n}>
      {ventana && <span className="cq-seg-n">{ventana}</span>}
      {sin && <Ban className="cq-ico" size={11} strokeWidth={2.4} aria-hidden="true" />}
      {bajo && <TriangleAlert className="cq-ico" size={11} strokeWidth={2.4} aria-hidden="true" />}
      {sin ? (
        <span className="cq-seg-v">{c.hasta > 0 ? `${t("cupos.agotado")} · ${t("cu.w.vuelve", { cuando: cuandoFuturo(c.hasta) })}` : t("cupos.agotado")}</span>
      ) : aparte ? (
        <span className="cq-seg-v" data-apagado="">
          {textoAparte(c)}
        </span>
      ) : (
        <Reloj pintor={numero} className="cq-seg-v" />
      )}
      {/* Cuándo vuelve esa ventana, como en las tarjetas (agotada ya lo dice arriba). */}
      {!sin && c.hasta > 0 && <Reloj pintor={vuelve} className="cq-seg-n" />}
    </span>
  );
}
