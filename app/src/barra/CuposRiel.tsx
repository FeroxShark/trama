// Los cupos en el riel (rediseño 0.4): dos anillos con la cifra, los dos límites más apretados de TODAS las suscripciones conectadas (Claude 5 h y
// semana, el límite propio de un modelo como Fable, Codex, cada grupo de Google…) o los que la persona fijó en Ajustes > Plan y cupos. Cada uno dice
// qué es debajo («Fable · sem») y con su nombre entero en el tooltip: «Claude · 5 horas: 5 % usado, vuelve en 4 h 48 min». Al tocarlos se abre el
// detalle, agrupado por suscripción y con UNA FILA POR VENTANA (5 h, semana, por modelo), cada una con su barra, su % usado y cuándo vuelve: Claude (sus
// dos ventanas en grande, sus modelos y sus otras cuentas), Google (Gemini, Argon, «Claude y GPT por Google»), Codex, OpenCode… Ámbar desde 80 %, rojo sólo sin cupo (y sólo en su renglón), y lo agotado
// lo dice en palabras: nunca sólo el color. Cada renglón dice cuándo vuelve, salvo con 0 % usado. La cuenta la elige la persona: Trama no
// cambia de cuenta sola. Un dato de hace más de 15 min se apaga (`data-viejo`) y su nota dice de cuándo es. El botón de releer le pide a
// `claude` el uso como lo dice claude.ai (`get_usage`); si no puede, lo dice y deja lo viejo apagado, nunca como si fuera de ahora.
import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { cuentaParaElegir, filasDeCupos, type ListaCuentas } from "../datos/cuentas";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { Hilos } from "../paneles/Hilos";
import { abrirAjustes } from "../paneles/ajustes-nav";
import type { Pintor } from "../reloj";
import { VIEJO_S, cuandoFuturo, pintorHace, pintorVisto } from "../tiempo";
import { IcAtencion, IcCerrar, IcOk } from "../ui/iconos";
import { useAros } from "./cupos-aros";
import { AMBAR_DESDE, arosVisibles, bloquesMotores, cuentasClaude, estadoAnillo, limitesRiel, lineasCuentas, lineasModelos, marcaAnillo, nivelCupo, type FilaVentana, type LimiteRiel, type LineaRiel, type NivelAnillo, type VentanaRiel } from "./cupos-riel-logica";
import { textoVuelve } from "./cuposNota";
import { ElegirCuenta, useCuentasBarra } from "./ElegirCuenta";
import { PerfilRiel } from "./PerfilRiel";
import { Reloj } from "./piezas";
import { pintorActualizado, useUso } from "./useUso";
import { formatearFalta, type Unidades } from "./usoFila";


/** Las capturas `uso*` dejan el detalle abierto. */
const VER_ABIERTO = !!MODO.captura?.startsWith("uso");

/** Cuántos hilos tiene la barrita de un renglón: el panel es angosto. */
const HILOS_RENGLON = 14;

/** El número, apagado si el dato es viejo (`data-viejo`, lo pone el reloj). */
const pintorNumero =
  (pct: number, ts: number): Pintor =>
  (a) => {
    const d = a - ts;
    const viejo = !!ts && d >= VIEJO_S;
    return { texto: String(pct), en: ts && !viejo ? VIEJO_S - d : Infinity, attrs: { "data-viejo": viejo ? "" : null } };
  };

/** El tooltip de un anillo: «5 horas: 5 % usado, vuelve en 4 h 48 min». Sin uso (0 %) no hay nada que esperar; agotado dice «sin cupo». */
const ANILLO_R = 19.5;

const pintorAnilloTip =
  (ventana: string, v: VentanaRiel, ts: number, semanal: boolean): Pintor =>
  (a) => {
    if (v.pct === null) return { texto: "", en: Infinity, attrs: { "data-tip": t("riel.anilloSinDato", { ventana }) } };
    const u = unidades();
    const estado = estadoAnillo(v, a, semanal);
    const pct = Math.round(v.pct);
    const estadoTxt =
      estado.nivel === "rojo"
        ? t("riel.anilloSinCupo")
        : estado.seAcabaEn !== null
          ? t("riel.anilloSeAcaba", { falta: formatearFalta(estado.seAcabaEn, u).texto })
          : estado.nivel === "ambar"
            ? t("riel.anilloPoco")
            : t("riel.anilloBien");
    const linea1 = `${t("riel.anilloTipSolo", { ventana, pct })} · ${estadoTxt}`;
    const falta = v.pct > 0 && v.hasta > a ? formatearFalta(v.hasta - a, u) : null;
    const vuelve = falta ? t("cupos.vuelveEn", { falta: falta.texto }) : "";
    const d = a - ts;
    const viejo = !!ts && d >= VIEJO_S;
    const hace = viejo ? t("uso.visto", { hace: pintorHace(ts)(a).texto }) : "";
    const linea2 = vuelve && hace ? `${vuelve} · ${hace}` : vuelve || hace;
    // La rayita del anillo semanal: el ritmo parejo (cuánto se habría usado a esta altura gastando igual todos los días).
    const ritmo = semanal && v.pct !== null && estado.esperado !== null ? t("riel.anilloMarca", { pct: Math.round(estado.esperado * 100) }) : "";
    const texto = [linea1, linea2, ritmo].filter(Boolean).join("\n");
    return { texto: "", en: Math.min(falta?.en ?? Infinity, ts && !viejo ? VIEJO_S - d : Infinity, viejo ? 60 : Infinity, semanal && estado.esperado !== null ? 600 : Infinity), attrs: { "data-tip": texto } };
  };

function Insignia({ nivel }: { nivel: NivelAnillo }) {
  return (
    <span className="an-insig" aria-hidden="true">
      {nivel === "rojo" ? <IcCerrar strokeWidth={3} /> : nivel === "ambar" ? <IcAtencion strokeWidth={2.5} /> : <IcOk strokeWidth={3} />}
    </span>
  );
}


const unidades = (): Unidades => ({ d: t("tiempo.unidadD"), h: t("tiempo.unidadH"), min: t("tiempo.unidadMin"), s: t("tiempo.unidadS"), ya: t("tiempo.ya") });

/** Lo que dice debajo de una ventana: cuándo vuelve, con la advertencia si queda poco o se acabó; "visto hace…" si el dato es viejo. */
const pintorNota = (v: VentanaRiel, ts: number): Pintor =>
  pintorVisto(
    ts,
    (a) => {
      if (v.pct === null) return { texto: t("riel.sinDato"), en: Infinity };
      if (!v.hasta) return { texto: v.pct >= 100 ? t("cupos.sinCupo") : v.pct >= AMBAR_DESDE ? t("cupos.pocoCupo") : v.pct > 0 ? t("cupos.sinHora") : "", en: Infinity };
      // Con 0 % usado no hay nada que esperar: la ventana no dice cuándo vuelve.
      if (v.pct <= 0) return { texto: "", en: Infinity };
      const f = textoVuelve(v.hasta, a, unidades(), formatearFalta);
      return { texto: v.pct >= 100 ? t("riel.sinCupoVuelve", { vuelve: f.texto }) : v.pct >= AMBAR_DESDE ? t("riel.quedaPoco", { vuelve: f.texto }) : f.texto, en: f.en };
    },
    true,
  );

/**
 * Un aro: el porcentaje usado adentro y, debajo, qué es en dos renglones («Fable» / «sem»; el nombre entero va en el tooltip y en el `aria-label` del botón).
 * `ventana`: el nombre entero («Claude · 5 horas»), para el tooltip.
 */
export function Anillo({ v, quien, corta, ventana, ts, semanal = false, ahora }: { v: VentanaRiel; quien: string; corta: string; ventana: string; ts: number; semanal?: boolean; ahora?: number }) {
  const numero = useMemo(() => pintorNumero(v.pct ?? 0, ts), [v.pct, ts]);
  const tip = useMemo(() => pintorAnilloTip(ventana, v, ts, semanal), [ventana, v, ts, semanal]);
  const estado = estadoAnillo(v, ahora ?? Math.floor(Date.now() / 1000), semanal);
  const marca = semanal && v.pct !== null && estado.esperado !== null ? marcaAnillo(estado.esperado, ANILLO_R) : null;
  return (
    <span className="an" data-nivel={v.pct === null ? undefined : estado.nivel}>
      <span className="an-c">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle className="an-pista" cx="24" cy="24" r={ANILLO_R} />
          {v.pct !== null && v.pct > 0 ? <circle className="an-uso" cx="24" cy="24" r={ANILLO_R} pathLength={100} strokeDasharray={`${Math.min(100, v.pct)} 100`} transform="rotate(-90 24 24)" /> : null}
          {marca ? <line className="an-marca" x1={marca.x1} y1={marca.y1} x2={marca.x2} y2={marca.y2} /> : null}
        </svg>
        {v.pct === null ? <span className="an-n">—</span> : <Reloj pintor={numero} className="an-n" />}
        {v.pct !== null ? <Insignia nivel={estado.nivel} /> : null}
      </span>
      <span className="an-e" aria-hidden="true">
        <span className="an-q">{quien}</span>
        <span className="an-w">{corta}</span>
      </span>
      <Reloj pintor={tip} className="an-tip" />
    </span>
  );
}

/** Una ventana de Claude en grande: «5 % usado», los hilos y cuándo vuelve. */
function Ventana({ nombre, v, ts }: { nombre: string; v: VentanaRiel; ts: number }) {
  const numero = useMemo(() => pintorNumero(v.pct ?? 0, ts), [v.pct, ts]);
  const nota = useMemo(() => pintorNota(v, ts), [v, ts]);
  const nivel = nivelCupo(v.pct);
  return (
    <div className="v-ventana" data-nivel={nivel}>
      <div className="v-nom">{nombre}</div>
      <div className="v-num">
        {v.pct === null ? <span className="v-cifra">—</span> : <Reloj pintor={numero} className="v-cifra" />}
        {v.pct === null ? null : <small>{t("riel.pctUsado")}</small>}
      </div>
      <Hilos pct={v.pct} nivel={nivelHilos(nivel)} total={HILOS_RENGLON} />
      <Reloj pintor={nota} className="v-nota" />
    </div>
  );
}

/** Los hilos del panel de Ajustes hablan de «poco» y «sin»: el ámbar y el rojo de acá. */
const nivelHilos = (n: "ambar" | "rojo" | undefined) => (n === "rojo" ? "sin" : n === "ambar" ? "poco" : "ok");

/** Lo que dice debajo de una ventana: cuándo vuelve, con la advertencia si queda poco o se acabó; con 0 % usado no hay nada que esperar. */
function textoFila(pct: number | null, hasta: number): string | null {
  if (pct === null) return null;
  if (pct >= 100) return hasta ? t("riel.sinCupoVuelve", { vuelve: t("cu.w.vuelve", { cuando: cuandoFuturo(hasta) }) }) : t("cupos.sinCupo");
  if (pct <= 0) return null;
  if (!hasta) return pct >= AMBAR_DESDE ? t("cupos.pocoCupo") : null;
  const vuelve = t("cu.w.vuelve", { cuando: cuandoFuturo(hasta) });
  return pct >= AMBAR_DESDE ? t("riel.quedaPoco", { vuelve }) : vuelve;
}

/** Una ventana de un renglón (5 h, semana, por modelo…): nombre, hilos y cifra, y debajo cuándo vuelve; «sin dato» o «no aplica» en palabras, nunca vacía. */
function Mini({ f }: { f: FilaVentana }) {
  const nivel = nivelCupo(f.pct);
  const vuelve = textoFila(f.pct, f.hasta);
  return (
    <div className="v-mini" data-nivel={nivel} data-sin={f.pct === null ? "" : undefined}>
      <span>{f.nombre}</span>
      <Hilos pct={f.pct} nivel={nivelHilos(nivel)} total={HILOS_RENGLON} />
      <b>{f.noAplica ? t("cu.w.noAplicaCorto") : f.pct === null ? t("riel.sinDato") : `${Math.round(f.pct)} %`}</b>
      {vuelve ? (
        <small className="v-sub" data-nivel={nivel}>
          {vuelve}
        </small>
      ) : null}
    </div>
  );
}

/**
 * Un renglón del detalle: nombre, hilos y número, y debajo cuándo vuelve (ninguna con 0 % usado). Lo agotado, en palabras y en rojo, sólo en su
 * renglón. `titulo`: la suscripción tiene un solo renglón y se llama igual que ella: el renglón hace de título. `control`: «En uso» / «Usar primero».
 */
function Linea({ l, cuentas, alCambiar, titulo }: { l: LineaRiel; cuentas: ListaCuentas | null; alCambiar: () => void; titulo?: boolean }) {
  const perfil = l.cuenta ? cuentaParaElegir(cuentas, l.cuenta.proveedor, l.cuenta.id) : null;
  const lleno = l.estado === "lleno" || l.estado === "marcado";
  // Con una sola ventana (Argon, un modelo de Claude, NVIDIA) el renglón es uno: «Fable · Semana», su barra y su cifra; con varias, el nombre y una fila por ventana.
  const uno = l.ventanas?.length === 1 ? l.ventanas[0] : null;
  const pct = uno ? uno.pct : l.pct;
  const nivel = lleno ? "rojo" : nivelCupo(pct);
  const palabra = !lleno && pct === null;
  const vuelve = uno
    ? textoFila(uno.pct, uno.hasta)
    : lleno
    ? l.vuelve
      ? t("riel.sinCupoVuelve", { vuelve: t("cu.w.vuelve", { cuando: cuandoFuturo(l.vuelve) }) })
      : t("cupos.sinCupo")
    : l.cuando
      ? nivel === "ambar"
        ? t("riel.quedaPoco", { vuelve: t("cu.w.vuelve", { cuando: cuandoFuturo(l.cuando) }) })
        : t("cu.w.vuelve", { cuando: cuandoFuturo(l.cuando) })
      : null;
  const dos = !uno && l.ventanas?.length ? l.ventanas : null;
  const tip = l.gratis ? [l.quien, t("riel.sinLimiteTip"), l.pedidos !== undefined ? t("riel.pedidos", { n: l.pedidos.toLocaleString() }) : ""].filter(Boolean).join(" · ") : l.quien;
  return (
    <>
      <div className="v-lin" data-nivel={dos ? undefined : nivel} data-lleno={lleno ? "" : undefined} data-palabra={palabra && !dos ? "" : undefined} data-dos={dos ? "" : undefined} data-titulo={titulo ? "" : undefined} data-tip={tip}>
        <span className="v-ln">{uno ? `${l.nombre} · ${uno.nombre}` : l.nombre}</span>
        {dos ? (
          <div className="v-dos">
            {dos.map((f) => (
              <Mini key={f.clave} f={f} />
            ))}
          </div>
        ) : palabra ? (
          <b>{uno?.noAplica ? t("cu.w.noAplicaCorto") : l.gratis ? `${t("riel.gratis")} · ${t("riel.sinLimiteConocido")}` : l.sinLimite ? t("riel.sinLimite") : l.pedidos !== undefined ? t("riel.pedidos", { n: l.pedidos.toLocaleString() }) : "—"}</b>
        ) : (
          <>
            <Hilos pct={lleno ? 100 : pct} nivel={nivelHilos(nivel)} total={HILOS_RENGLON} />
            <b>{l.estado === "marcado" ? "" : `${lleno ? 100 : pct} %`}</b>
          </>
        )}
        {vuelve && !dos ? <small className="v-sub">{vuelve}</small> : null}
      </div>
      {perfil ? (
        <div className="g-acc">
          <ElegirCuenta perfil={perfil} alCambiar={alCambiar} />
        </div>
      ) : null}
    </>
  );
}

export function CuposRiel() {
  useIdioma();
  const { uso, fallo, pausa, releer } = useUso();
  const [abierto, setAbierto] = useState(VER_ABIERTO);
  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const [cuentas, releerCuentas] = useCuentasBarra();

  // Se cierra con Esc (el foco vuelve a los anillos) o con un clic afuera.
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAbierto(false);
      boton.current?.focus();
    };
    document.addEventListener("pointerdown", afuera, true);
    document.addEventListener("keydown", tecla, true);
    return () => {
      document.removeEventListener("pointerdown", afuera, true);
      document.removeEventListener("keydown", tecla, true);
    };
  }, [abierto]);


  const error = uso && "error" in uso ? uso.error : null;
  const datos = uso && !("error" in uso) ? uso : null;
  const cupos = filasDeCupos(datos?.suscripciones, datos?.claudeNombre, t("cuentas.principal"));
  const todas = cuentasClaude(datos, cupos.filas, cupos.claudeCorto ?? datos?.claudeNombre ?? t("uso.claude"), cuentas);
  const enUso = todas[0];
  const varias = todas.length > 1;
  const otras = lineasCuentas(todas);
  const modelos = lineasModelos(datos);
  const pref = useAros();
  const aros = arosVisibles(limitesRiel(datos, todas, cupos.filas), pref);
  const bloques = bloquesMotores(cupos.filas, Date.now() / 1000);
  // «Trama no cambia de cuenta sola» sólo dice algo cuando hay una cuenta para cambiar.
  const hayCuentas = varias || cupos.filas.some((f, i, todas) => todas.findIndex((x) => x.proveedor === f.proveedor) !== i);
  const actualizado = useMemo(() => pintorActualizado(datos?.ts ?? 0, fallo), [datos?.ts, fallo]);
  const dice = (l: LimiteRiel) => (l.v.pct === null ? t("riel.anilloSinDato", { ventana: l.nombre }) : t("riel.anilloTipSolo", { ventana: l.nombre, pct: Math.round(l.v.pct) }));
  const verPlan = () => {
    setAbierto(false);
    abrirAjustes("cupos");
  };

  return (
    <div ref={caja} className="cupos-riel" data-fallo={fallo ? "" : undefined}>
      <button
        ref={boton}
        type="button"
        className="anillos"
        data-guia="uso"
        aria-expanded={abierto}
        aria-haspopup="dialog"
        aria-label={t("riel.cuposAria", { lista: aros.map(dice).join("; ") })}
        data-tip={abierto ? undefined : t("cupos.titulo")}
        onClick={() => setAbierto((x) => !x)}
      >
        {aros.map((l) => (
          <Anillo key={l.clave} v={l.v} quien={l.quien} corta={l.ventana} ventana={l.nombre} ts={l.ts} semanal={l.semanal} />
        ))}
      </button>
      <PerfilRiel alAbrir={() => setAbierto(false)} />
      {abierto ? (
        <section className="vuelo" role="dialog" aria-label={t("cupos.titulo")}>
          <header className="v-cab">
            <div className="v-tit">
              <h2>{t("cupos.titulo")}</h2>
              <Reloj pintor={actualizado} className="v-act" data-fallo={fallo ? "" : undefined} role={fallo ? "alert" : undefined} />
            </div>
            <button type="button" className="releer" aria-label={t("uso.releer")} data-tip={t("uso.releer")} disabled={pausa || uso === undefined} onClick={releer}>
              <RotateCw size={13} strokeWidth={2} />
            </button>
          </header>
          <div className="v-bloque" data-claude="">
            <h3>
              {t("uso.claude")}
              {varias ? <span>{t("riel.cuentaEnUso", { n: enUso.nombre })}</span> : null}
            </h3>
            {error ? (
              <p className="v-pie uso-error">{textoMain(error)}</p>
            ) : (
              <div className="v-par">
                <Ventana nombre={t("riel.cinco")} v={enUso.h5} ts={enUso.ts} />
                <Ventana nombre={t("riel.semana")} v={enUso.sem} ts={enUso.ts} />
              </div>
            )}
            {modelos.length && !error ? (
              <>
                <h4>{t("riel.porModelo")}</h4>
                {modelos.map((l) => (
                  <Linea key={l.clave} l={l} cuentas={cuentas} alCambiar={releerCuentas} />
                ))}
              </>
            ) : null}
            {otras.length ? (
              <>
                <h4>{t("riel.otrasCuentas")}</h4>
                {otras.map((l) => (
                  <Linea key={l.clave} l={l} cuentas={cuentas} alCambiar={releerCuentas} />
                ))}
              </>
            ) : null}
          </div>
          {bloques.map((b) => {
            const solo = b.lineas.length === 1 && b.lineas[0].nombre === b.titulo;
            return (
              <div key={b.clave} className="v-bloque" data-proveedor={b.proveedor}>
                {solo ? null : <h3>{b.titulo}</h3>}
                {b.lineas.map((l) => (
                  <Linea key={l.clave} l={l} cuentas={cuentas} alCambiar={releerCuentas} titulo={solo} />
                ))}
              </div>
            );
          })}
          <footer className="v-pie-caja">
            {hayCuentas ? <p className="v-pie">{t("riel.noCambia")}</p> : null}
            <button type="button" className="v-ver" onClick={verPlan}>
              {t("riel.verPlan")}
            </button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
