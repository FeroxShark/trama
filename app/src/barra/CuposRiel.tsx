// Los cupos en el riel (rediseño 0.4): dos anillos con la cifra, 5 h y semana de la cuenta de Claude en uso (con su tooltip: «5 horas: 5 % usado,
// vuelve en 4 h 48 min»). Al tocarlos se abre el detalle, agrupado por suscripción: Claude (esas dos ventanas en grande y sus otras cuentas),
// Google (Gemini, Argon, «Claude y GPT por Google»), OpenCode… Ámbar desde 80 %, rojo sólo sin cupo (y sólo en su renglón), y lo agotado
// lo dice en palabras: nunca sólo el color. Cada renglón dice cuándo vuelve, salvo con 0 % usado. La cuenta la elige la persona: Trama no
// cambia de cuenta sola. Un dato de hace más de 15 min se apaga (`data-viejo`) y su nota dice de cuándo es. El botón de releer le pide a
// `claude` el uso como lo dice claude.ai (`get_usage`); si no puede, lo dice y deja lo viejo apagado, nunca como si fuera de ahora.
import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import type { Uso } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { cuentaParaElegir, filasDeCupos, type ListaCuentas } from "../datos/cuentas";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { Hilos } from "../paneles/CuposTejido";
import { abrirAjustes } from "../paneles/ajustes-nav";
import type { Pintor } from "../reloj";
import { VIEJO_S, cuandoFuturo, pintorHace, pintorVisto } from "../tiempo";
import { AMBAR_DESDE, bloquesMotores, cuentasClaude, lineasCuentas, nivelCupo, type LineaRiel, type VentanaRiel } from "./cupos-riel-logica";
import { textoVuelve } from "./cuposNota";
import { ElegirCuenta, useCuentasBarra } from "./ElegirCuenta";
import { Reloj } from "./piezas";
import { formatearFalta, type Unidades } from "./usoFila";

/** Después de un clic el botón de releer descansa esto. */
const PAUSA_MS = 5000;

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
const pintorAnilloTip =
  (ventana: string, v: VentanaRiel, ts: number): Pintor =>
  (a) => {
    if (v.pct === null) return { texto: "", en: Infinity, attrs: { "data-tip": null } };
    const falta = v.pct > 0 && v.hasta > a ? formatearFalta(v.hasta - a, unidades()) : null;
    const vuelve = falta ? t("cupos.vuelveEn", { falta: falta.texto }) : "";
    const base = v.pct >= 100 ? (vuelve ? t("riel.anilloTipLleno", { ventana, vuelve }) : t("riel.anilloTipLlenoSolo", { ventana })) : vuelve ? t("riel.anilloTip", { ventana, pct: Math.round(v.pct), vuelve }) : t("riel.anilloTipSolo", { ventana, pct: Math.round(v.pct) });
    const d = a - ts;
    const viejo = !!ts && d >= VIEJO_S;
    const texto = viejo ? `${base} · ${t("uso.visto", { hace: pintorHace(ts)(a).texto })}` : base;
    return { texto: "", en: Math.min(falta?.en ?? Infinity, ts && !viejo ? VIEJO_S - d : Infinity, viejo ? 60 : Infinity), attrs: { "data-tip": texto } };
  };

/** «Actualizado hace 2 m»; si la última lectura falló, «No se pudo actualizar · datos de hace 8 m». */
const pintorActualizado = (ts: number, fallo: boolean): Pintor => (a) => {
  const h = ts ? pintorHace(ts)(a) : null;
  if (fallo) return { texto: h ? t("riel.noActualizoVisto", { hace: h.texto }) : t("riel.noActualizo"), en: h?.en ?? Infinity };
  return { texto: h ? t("riel.actualizado", { hace: h.texto }) : "", en: h?.en ?? Infinity };
};

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

function Anillo({ v, etiqueta, ventana, ts }: { v: VentanaRiel; etiqueta: string; ventana: string; ts: number }) {
  const numero = useMemo(() => pintorNumero(v.pct ?? 0, ts), [v.pct, ts]);
  const tip = useMemo(() => pintorAnilloTip(ventana, v, ts), [ventana, v, ts]);
  return (
    <span className="an" data-nivel={nivelCupo(v.pct)}>
      <Reloj pintor={tip} className="an-tip" />
      <span className="an-c">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle className="an-pista" cx="16" cy="16" r="13" />
          {v.pct !== null ? <circle className="an-uso" cx="16" cy="16" r="13" pathLength={100} strokeDasharray={`${Math.min(100, v.pct)} 100`} /> : null}
        </svg>
        {v.pct === null ? <span className="an-n">—</span> : <Reloj pintor={numero} className="an-n" />}
      </span>
      <span className="an-e">{etiqueta}</span>
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

/**
 * Un renglón del detalle: nombre, hilos y número, y debajo cuándo vuelve (ninguna con 0 % usado). Lo agotado, en palabras y en rojo, sólo en su
 * renglón. `titulo`: la suscripción tiene un solo renglón y se llama igual que ella: el renglón hace de título. `control`: «En uso» / «Usar primero».
 */
function Linea({ l, cuentas, alCambiar, titulo }: { l: LineaRiel; cuentas: ListaCuentas | null; alCambiar: () => void; titulo?: boolean }) {
  const perfil = l.cuenta ? cuentaParaElegir(cuentas, l.cuenta.proveedor, l.cuenta.id) : null;
  const lleno = l.estado === "lleno" || l.estado === "marcado";
  const nivel = lleno ? "rojo" : nivelCupo(l.pct);
  const palabra = !lleno && l.pct === null;
  const vuelve = lleno
    ? l.vuelve
      ? t("riel.sinCupoVuelve", { vuelve: t("cu.w.vuelve", { cuando: cuandoFuturo(l.vuelve) }) })
      : t("cupos.sinCupo")
    : l.cuando
      ? nivel === "ambar"
        ? t("riel.quedaPoco", { vuelve: t("cu.w.vuelve", { cuando: cuandoFuturo(l.cuando) }) })
        : t("cu.w.vuelve", { cuando: cuandoFuturo(l.cuando) })
      : null;
  const tip = l.gratis ? [l.quien, t("riel.sinLimiteTip"), l.pedidos !== undefined ? t("riel.pedidos", { n: l.pedidos.toLocaleString() }) : ""].filter(Boolean).join(" · ") : l.quien;
  return (
    <>
      <div className="v-lin" data-nivel={nivel} data-lleno={lleno ? "" : undefined} data-palabra={palabra ? "" : undefined} data-titulo={titulo ? "" : undefined} data-tip={tip}>
        <span className="v-ln">{l.nombre}</span>
        {palabra ? (
          <b>{l.gratis ? `${t("riel.gratis")} · ${t("riel.sinLimiteConocido")}` : l.sinLimite ? t("riel.sinLimite") : l.pedidos !== undefined ? t("riel.pedidos", { n: l.pedidos.toLocaleString() }) : "—"}</b>
        ) : (
          <>
            <Hilos pct={lleno ? 100 : l.pct} nivel={nivelHilos(nivel)} total={HILOS_RENGLON} />
            <b>{l.estado === "marcado" ? "" : `${lleno ? 100 : l.pct} %`}</b>
          </>
        )}
        {vuelve ? <small className="v-sub">{vuelve}</small> : null}
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
  // `undefined`: todavía no llegó. `null`: llegó y no hay de dónde sacarlo.
  const [uso, setUso] = useState<Uso | null | undefined>(undefined);
  const [pausa, setPausa] = useState(false);
  // La última lectura a pedido falló: lo que se ve es lo de antes, y se muestra apagado y diciéndolo.
  const [fallo, setFallo] = useState(false);
  const [abierto, setAbierto] = useState(VER_ABIERTO);
  const reloj = useRef(0);
  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const [cuentas, releerCuentas] = useCuentasBarra();

  useEffect(() => {
    let vivo = true;
    void fuente.uso().then(
      (u) => vivo && setUso(u),
      () => vivo && setUso(null),
    );
    const soltar = fuente.alCambiarUso((u) => {
      setUso(u);
      if (u && !("error" in u)) setFallo(false);
    });
    return () => {
      vivo = false;
      soltar();
      clearTimeout(reloj.current);
    };
  }, []);

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

  const releer = () => {
    setPausa(true);
    reloj.current = window.setTimeout(() => setPausa(false), PAUSA_MS);
    void fuente.releerUso().then(
      (u) => {
        if (u && !("error" in u)) {
          setUso(u);
          setFallo(false);
        } else {
          setFallo(true);
          // Sin nada anterior que mostrar, el error ocupa el lugar de los números.
          setUso((antes) => (antes && !("error" in antes) ? antes : u));
        }
      },
      () => setFallo(true),
    );
  };

  const error = uso && "error" in uso ? uso.error : null;
  const datos = uso && !("error" in uso) ? uso : null;
  const cupos = filasDeCupos(datos?.suscripciones, datos?.claudeNombre, t("cuentas.principal"));
  const todas = cuentasClaude(datos, cupos.filas, cupos.claudeCorto ?? datos?.claudeNombre ?? t("uso.claude"), cuentas);
  const enUso = todas[0];
  const varias = todas.length > 1;
  const otras = lineasCuentas(todas);
  const bloques = bloquesMotores(cupos.filas, Date.now() / 1000);
  // «Trama no cambia de cuenta sola» sólo dice algo cuando hay una cuenta para cambiar.
  const hayCuentas = varias || cupos.filas.some((f, i, todas) => todas.findIndex((x) => x.proveedor === f.proveedor) !== i);
  const actualizado = useMemo(() => pintorActualizado(datos?.ts ?? 0, fallo), [datos?.ts, fallo]);
  const dice = (v: VentanaRiel) => (v.pct === null ? t("riel.sinDato") : `${v.pct} %`);
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
        aria-label={t("riel.cuposAria", { h5: dice(enUso.h5), sem: dice(enUso.sem) })}
        data-tip={abierto ? undefined : t("cupos.titulo")}
        onClick={() => setAbierto((x) => !x)}
      >
        <Anillo v={enUso.h5} etiqueta={t("cupos.w5h")} ventana={t("riel.cinco")} ts={enUso.ts} />
        <Anillo v={enUso.sem} etiqueta={t("riel.sem")} ventana={t("riel.semana")} ts={enUso.ts} />
      </button>
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
