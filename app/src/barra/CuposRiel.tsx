// Los cupos en el riel (rediseño 0.4): dos anillos con la cifra, 5 h y semana de la cuenta de Claude en uso. Al tocarlos se abre el detalle:
// esas dos ventanas en grande con cuándo vuelven, las otras cuentas y los otros motores. Ámbar desde 70 %, rojo desde 90 %, y lo agotado
// lo dice en palabras: nunca sólo el color. La cuenta la elige la persona: Trama no cambia de cuenta sola. Un dato de hace más de 15 min se
// apaga (`data-viejo`) y su nota dice de cuándo es. El botón de releer le pide a `claude` el uso como lo dice claude.ai (`get_usage`).
import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import type { Uso } from "../datos/contrato";
import { fuente } from "../datos/fuente";
import { cuentaParaElegir, filasDeCupos, type ListaCuentas } from "../datos/cuentas";
import { nivel } from "../hilo/contexto-logica";
import { t, textoMain } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import type { Pintor } from "../reloj";
import { VIEJO_S, cuandoFuturo, pintorVisto } from "../tiempo";
import { cuentasClaude, lineasCuentas, lineasMotores, type LineaRiel, type VentanaRiel } from "./cupos-riel-logica";
import { textoVuelve } from "./cuposNota";
import { ElegirCuenta, useCuentasBarra } from "./ElegirCuenta";
import { Reloj } from "./piezas";
import { formatearFalta, type Unidades } from "./usoFila";

/** Después de un clic el botón de releer descansa esto. */
const PAUSA_MS = 5000;

/** Las capturas `uso*` dejan el detalle abierto. */
const VER_ABIERTO = !!MODO.captura?.startsWith("uso");

const nivelDe = (pct: number | null) => {
  const n = pct === null ? "normal" : nivel(pct);
  return n === "normal" ? undefined : n;
};

/** El número, apagado si el dato es viejo (`data-viejo`, lo pone el reloj). */
const pintorNumero =
  (pct: number, ts: number): Pintor =>
  (a) => {
    const d = a - ts;
    const viejo = !!ts && d >= VIEJO_S;
    return { texto: String(pct), en: ts && !viejo ? VIEJO_S - d : Infinity, attrs: { "data-viejo": viejo ? "" : null } };
  };

const unidades = (): Unidades => ({ d: t("tiempo.unidadD"), h: t("tiempo.unidadH"), min: t("tiempo.unidadMin"), s: t("tiempo.unidadS"), ya: t("tiempo.ya") });

/** Lo que dice debajo de una ventana: cuándo vuelve, con la advertencia si queda poco o se acabó; "visto hace…" si el dato es viejo. */
const pintorNota = (v: VentanaRiel, ts: number): Pintor =>
  pintorVisto(
    ts,
    (a) => {
      if (v.pct === null) return { texto: t("riel.sinDato"), en: Infinity };
      if (!v.hasta) return { texto: v.pct >= 100 ? t("cupos.sinCupo") : v.pct >= 70 ? t("cupos.pocoCupo") : t("cupos.sinHora"), en: Infinity };
      const f = textoVuelve(v.hasta, a, unidades(), formatearFalta);
      return { texto: v.pct >= 100 ? t("riel.sinCupoVuelve", { vuelve: f.texto }) : v.pct >= 70 ? t("riel.quedaPoco", { vuelve: f.texto }) : f.texto, en: f.en };
    },
    true,
  );

function Anillo({ v, etiqueta, ts }: { v: VentanaRiel; etiqueta: string; ts: number }) {
  const numero = useMemo(() => pintorNumero(v.pct ?? 0, ts), [v.pct, ts]);
  return (
    <span className="an" data-nivel={nivelDe(v.pct)}>
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

function Medidor({ pct }: { pct: number | null }) {
  return (
    <span className="medidor" aria-hidden="true">
      <i style={{ transform: `scaleX(${Math.min(100, pct ?? 0) / 100})` }} />
    </span>
  );
}

function Ventana({ nombre, v, ts }: { nombre: string; v: VentanaRiel; ts: number }) {
  const numero = useMemo(() => pintorNumero(v.pct ?? 0, ts), [v.pct, ts]);
  const nota = useMemo(() => pintorNota(v, ts), [v, ts]);
  return (
    <div className="v-ventana" data-nivel={nivelDe(v.pct)}>
      <div className="v-nom">{nombre}</div>
      <div className="v-num">
        {v.pct === null ? <span className="v-cifra">—</span> : <Reloj pintor={numero} className="v-cifra" />}
        {v.pct === null ? null : <small>%</small>}
      </div>
      <Medidor pct={v.pct} />
      <Reloj pintor={nota} className="v-nota" />
    </div>
  );
}

/** Un renglón del detalle: nombre, barrita y número; lo agotado, en palabras y con cuándo vuelve. `control`: «En uso» / «Usar primero». */
function Linea({ l, cuentas, alCambiar }: { l: LineaRiel; cuentas: ListaCuentas | null; alCambiar: () => void }) {
  const perfil = l.cuenta ? cuentaParaElegir(cuentas, l.cuenta.proveedor, l.cuenta.id) : null;
  const lleno = l.estado === "lleno" || l.estado === "marcado";
  return (
    <>
      {lleno ? (
        <div className="v-lin" data-lleno="" data-tip={l.quien}>
          <b>{l.nombre}</b>
          <em>{l.vuelve ? t("riel.sinCupoVuelve", { vuelve: t("cu.w.vuelve", { cuando: cuandoFuturo(l.vuelve) }) }) : t("cupos.sinCupo")}</em>
        </div>
      ) : l.pct === null ? (
        <div className="v-lin" data-palabra="" data-tip={l.quien}>
          <span>{l.nombre}</span>
          <b>{l.sinLimite ? t("riel.sinLimite") : l.pedidos !== undefined ? t("riel.pedidos", { n: l.pedidos.toLocaleString() }) : "—"}</b>
        </div>
      ) : (
        <div className="v-lin" data-nivel={nivelDe(l.pct)} data-tip={l.quien}>
          <span>{l.nombre}</span>
          <Medidor pct={l.pct} />
          <b>{l.pct} %</b>
        </div>
      )}
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
    const soltar = fuente.alCambiarUso(setUso);
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
    void fuente.releerUso().then(setUso, () => {});
  };

  const error = uso && "error" in uso ? uso.error : null;
  const datos = uso && !("error" in uso) ? uso : null;
  const cupos = filasDeCupos(datos?.suscripciones, datos?.claudeNombre, t("cuentas.principal"));
  const todas = cuentasClaude(datos, cupos.filas, cupos.claudeCorto ?? datos?.claudeNombre ?? t("uso.claude"), cuentas);
  const enUso = todas[0];
  const varias = todas.length > 1;
  const otras = lineasCuentas(todas);
  const motores = lineasMotores(cupos.filas, Date.now() / 1000);
  const dice = (v: VentanaRiel) => (v.pct === null ? t("riel.sinDato") : `${v.pct} %`);

  return (
    <div ref={caja} className="cupos-riel">
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
        <Anillo v={enUso.h5} etiqueta={t("cupos.w5h")} ts={enUso.ts} />
        <Anillo v={enUso.sem} etiqueta={t("riel.sem")} ts={enUso.ts} />
      </button>
      {abierto ? (
        <section className="vuelo" role="dialog" aria-label={t("cupos.titulo")}>
          <header className="v-cab">
            <h2>
              {t("uso.claude")}
              {varias ? <span>{t("riel.cuentaEnUso", { n: enUso.nombre })}</span> : null}
            </h2>
            <button type="button" className="releer" aria-label={t("uso.releer")} data-tip={t("uso.releer")} disabled={pausa || uso === undefined} onClick={releer}>
              <RotateCw size={13} strokeWidth={2} />
            </button>
          </header>
          {error ? (
            <p className="v-pie uso-error">{textoMain(error)}</p>
          ) : (
            <div className="v-par">
              <Ventana nombre={t("riel.cinco")} v={enUso.h5} ts={enUso.ts} />
              <Ventana nombre={t("riel.semana")} v={enUso.sem} ts={enUso.ts} />
            </div>
          )}
          {otras.length ? (
            <div className="v-bloque">
              <h3>{t("riel.otrasCuentas")}</h3>
              {otras.map((l) => (
                <Linea key={l.clave} l={l} cuentas={cuentas} alCambiar={releerCuentas} />
              ))}
            </div>
          ) : null}
          {motores.length ? (
            <div className="v-bloque">
              <h3>{t("riel.otrosMotores")}</h3>
              {motores.map((l) => (
                <Linea key={l.clave} l={l} cuentas={cuentas} alCambiar={releerCuentas} />
              ))}
            </div>
          ) : null}
          <p className="v-pie">{t("riel.noCambia")}</p>
        </section>
      ) : null}
    </div>
  );
}
