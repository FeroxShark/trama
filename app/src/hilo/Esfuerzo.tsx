// El esfuerzo de un líder en la barra de la caja: un chip («▂▄▆ high») que abre un popover con un deslizador, un punto por nivel del modelo, y
// debajo Ultracode (a la izquierda) y Fast (a la derecha). La rueda sobre el chip sube o baja el nivel sin abrir. El color del relleno y de la
// perilla cambia con el nivel (de frío a caliente, `esfuerzo-extras.ts`), pero el nivel siempre se dice también con texto. Lo puro (nivel ↔ posición,
// color, cabecera) está en `electron/esfuerzo-extras.ts` y lo cubre `tests/esfuerzo-extras.test.ts`.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as PunteroEvento } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronUp, Clock, Workflow, Zap } from "lucide-react";
import { t } from "../i18n";
import type { ResultadoExtras } from "../datos/fuente";
import { acumularRueda, cabeceraEsfuerzo, colorNivel, fraccion, indiceDe, indiceDesdeX, moverNivel, nivelEn, nivelPorPasos } from "../../electron/esfuerzo-extras";
import { colocar, type Opcion } from "./Selector";

type Props = {
  /** El nombre del modelo, corto («Opus 5.5»): va en la cabecera. */
  modelo: string;
  /** Los niveles del modelo, en su orden (`effortsOpciones`); sin niveles no se dibuja nada. */
  niveles: Opcion[];
  valor: string;
  alElegir: (id: string) => void;
  /** Lo elegido difiere de lo que usa el turno en curso (el tooltip dice cuál usa): reloj y «próx.» junto al valor, no sólo color. */
  pendiente?: string;
  /** Ultracode: sólo con un modelo oficial de Anthropic. Sin `alUltracode` no hay botón. */
  ultracode?: boolean;
  alUltracode?: (v: boolean) => Promise<ResultadoExtras>;
  /** Fast: sólo con un modelo que lo sirva (Opus, Fable). */
  fast?: boolean;
  alFast?: (v: boolean) => Promise<ResultadoExtras>;
  /** Para las capturas: nace abierto, y con un aviso de rechazo de Ultracode. */
  abierto?: boolean;
  avisoInicial?: string;
};

/** Cuánto tarda la rueda quieta en olvidar lo que llevaba acumulado (ms). */
const OLVIDO_RUEDA_MS = 350;

export function Esfuerzo({ modelo, niveles, valor, alElegir, pendiente, ultracode = false, alUltracode, fast = false, alFast, abierto: deEntrada = false, avisoInicial }: Props) {
  const [abierto, setAbierto] = useState(deEntrada);
  // El lugar que lleva el dedo mientras arrastra la perilla: recién al soltar se elige (así no sale un pedido por cada nivel que se cruza).
  const [arrastre, setArrastre] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(avisoInicial ?? null);
  const [ocupado, setOcupado] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const carril = useRef<HTMLDivElement>(null);
  const pulgar = useRef<HTMLButtonElement>(null);

  const ids = useMemo(() => niveles.map((n) => n.id), [niveles]);
  const i = arrastre ?? indiceDe(ids, valor);
  const nivel = nivelEn(ids, i);
  const color = colorNivel(ids, nivel);
  const actual = niveles.find((n) => n.id === nivel);
  const cabecera = cabeceraEsfuerzo({ modelo, nivel, ultracode, fast, palabras: { ultracode: t("esfuerzo.ultracode"), fast: t("esfuerzo.fast") } });
  const etiqueta = t("comun.esfuerzo");

  // La rueda sobre el chip sube (hacia arriba) o baja el nivel sin abrirlo. Un oyente nativo, no `onWheel`: React los registra pasivos y no dejaría frenar el scroll.
  const ultimo = useRef({ ids, valor, alElegir });
  ultimo.current = { ids, valor, alElegir };
  useEffect(() => {
    const b = boton.current;
    if (!b) return;
    let acumulado = 0;
    let visto = 0;
    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      const ahora = performance.now();
      if (ahora - visto > OLVIDO_RUEDA_MS) acumulado = 0;
      visto = ahora;
      // `deltaMode` 1 son líneas (algunos ratones): a píxeles.
      const r = acumularRueda(acumulado, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY);
      acumulado = r.resto;
      const nuevo = nivelPorPasos(ultimo.current.ids, ultimo.current.valor, r.pasos);
      if (nuevo) {
        ultimo.current.valor = nuevo;
        ultimo.current.alElegir(nuevo);
      }
    };
    b.addEventListener("wheel", rueda, { passive: false });
    return () => b.removeEventListener("wheel", rueda);
  }, []);

  const cerrar = (conFoco = true) => {
    setAbierto(false);
    setArrastre(null);
    setAviso(null);
    if (conFoco) boton.current?.focus();
  };

  // Pegado al chip (arriba si entra, si no abajo), y siguiéndolo si se hace scroll o cambia el tamaño.
  useLayoutEffect(() => {
    if (!abierto) return;
    const poner = () => {
      if (boton.current && menu.current) colocar(boton.current, menu.current);
    };
    poner();
    const alMover = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      poner();
    };
    window.addEventListener("resize", alMover);
    window.addEventListener("scroll", alMover, true);
    return () => {
      window.removeEventListener("resize", alMover);
      window.removeEventListener("scroll", alMover, true);
    };
  }, [abierto]);
  // Al abrir, el foco va a la perilla.
  useLayoutEffect(() => {
    if (abierto) pulgar.current?.focus();
  }, [abierto]);

  if (!niveles.length) return null;

  const elegirIndice = (k: number) => {
    const n = nivelEn(ids, k);
    if (n && n !== valor) alElegir(n);
  };

  // --- El carril: clic en un punto o arrastre de la perilla ---
  const indiceDeX = (x: number) => {
    const r = carril.current?.getBoundingClientRect();
    const p = pulgar.current?.offsetWidth ?? 0;
    return r ? indiceDesdeX(niveles.length, x - r.left - p / 2, r.width - p) : 0;
  };
  const alBajar = (e: PunteroEvento) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setArrastre(indiceDeX(e.clientX));
    pulgar.current?.focus();
  };
  const alMover = (e: PunteroEvento) => {
    if (arrastre !== null) setArrastre(indiceDeX(e.clientX));
  };
  const alSoltar = (e: PunteroEvento) => {
    if (arrastre === null) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    elegirIndice(indiceDeX(e.clientX));
    setArrastre(null);
  };

  const teclaPulgar = (e: KeyboardEvent) => {
    const n = moverNivel(ids, valor, e.key);
    if (n === null) return;
    e.preventDefault();
    alElegir(n);
  };

  // Esc cierra (sin que llegue a la barra); Tab recorre lo del popover sin salirse de él.
  const teclaMenu = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      return cerrar();
    }
    if (e.key !== "Tab") return;
    const f = [...(menu.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])].filter((x) => !x.classList.contains("fondo"));
    if (!f.length) return;
    const k = f.indexOf(document.activeElement as HTMLElement);
    const sig = f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length];
    e.preventDefault();
    sig?.focus();
  };

  /** Prende o apaga Ultracode o Fast: si Claude Code lo rechaza, queda como estaba y el popover dice por qué. */
  const cambiar = async (cual: "ultracode" | "fast") => {
    const f = cual === "ultracode" ? alUltracode : alFast;
    if (!f || ocupado) return;
    setOcupado(true);
    setAviso(null);
    const r = await f(!(cual === "ultracode" ? ultracode : fast)).catch((e: unknown) => ({ ok: false, motivo: e instanceof Error ? e.message : "" }) as ResultadoExtras);
    setOcupado(false);
    if (r.ok) return;
    setAviso(r.motivo ? t(cual === "ultracode" ? "esfuerzo.ultracodeNoMotivo" : "esfuerzo.fastNoMotivo", { motivo: r.motivo }) : t(cual === "ultracode" ? "esfuerzo.ultracodeNo" : "esfuerzo.fastNo"));
  };

  const pos = (k: number) => `calc(var(--esf-pulgar) / 2 + ${fraccion(niveles.length, k)} * (100% - var(--esf-pulgar)))`;

  return (
    <div className="pick" data-esf-chip>
      <button
        ref={boton}
        type="button"
        className="pbtn esf-chip"
        data-ultra={ultracode ? "" : undefined}
        style={{ ["--esf-color" as string]: color }}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-label={`${etiqueta}: ${nivel}${ultracode ? `, ${t("esfuerzo.ultracode")}` : ""}${fast ? `, ${t("esfuerzo.fast")}` : ""}${pendiente ? `, ${t("selector.pendienteEtiqueta")}` : ""}`}
        data-tip={[t("esfuerzo.chipTip", { nivel }), pendiente].filter(Boolean).join(" · ")}
        data-pendiente={pendiente ? "" : undefined}
        onClick={() => (abierto ? cerrar(false) : setAbierto(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setAbierto(true);
          }
        }}
      >
        {actual?.marca}
        <span className="esf-chip-n">{nivel}</span>
        {ultracode ? <Workflow className="esf-chip-ex" size={12} strokeWidth={2} aria-hidden="true" /> : null}
        {fast ? <Zap className="esf-chip-ex" size={12} strokeWidth={2} aria-hidden="true" /> : null}
        {pendiente ? (
          <span className="pbtn-pend" aria-hidden="true">
            <Clock size={11} strokeWidth={2.2} />
            <span className="pbtn-pend-t">{t("selector.proximo")}</span>
          </span>
        ) : null}
        <ChevronUp className="chev" size={12} strokeWidth={2} />
      </button>
      {abierto
        ? createPortal(
            <>
              <button type="button" className="fondo" tabIndex={-1} aria-label={t("comun.cerrarMenu")} onClick={() => cerrar(false)} />
              <div ref={menu} className="menu esf-pop" data-ultra={ultracode ? "" : undefined} role="dialog" aria-label={etiqueta} style={{ ["--esf-color" as string]: color }} onKeyDown={teclaMenu}>
                <div className="esf-cab" aria-live="polite">
                  {/* El modelo fuerte y el resto (nivel, Ultracode, Fast) apagado, como «Opus 5.5 High». */}
                  <span className="esf-cab-m">{cabecera.split(" · ")[0]}</span> <span className="esf-cab-r">{cabecera.split(" · ").slice(1).join(" · ")}</span>
                </div>
                {/* La zona entera (carril y nombres) es el blanco del clic y del arrastre; la perilla es lo único que recibe el foco. */}
                <div
                  className="esf-zona"
                  data-arrastrando={arrastre !== null ? "" : undefined}
                  onPointerDown={alBajar}
                  onPointerMove={alMover}
                  onPointerUp={alSoltar}
                  onPointerCancel={() => setArrastre(null)}
                >
                  <div ref={carril} className="esf-carril">
                    <div className="esf-pista" aria-hidden="true">
                      <div className="esf-relleno" style={{ width: `calc(${pos(i)} + var(--esf-pulgar) / 2)` }}>
                        <span className="esf-chispas" />
                      </div>
                    </div>
                    {niveles.map((n, k) => (
                      <span key={n.id} className="esf-punto" data-lleno={k <= i ? "" : undefined} style={{ left: pos(k) }} aria-hidden="true" />
                    ))}
                    <button
                      ref={pulgar}
                      type="button"
                      role="slider"
                      className="esf-pulgar"
                      style={{ left: pos(i) }}
                      aria-label={etiqueta}
                      aria-orientation="horizontal"
                      aria-valuemin={0}
                      aria-valuemax={niveles.length - 1}
                      aria-valuenow={i}
                      aria-valuetext={nivel}
                      onKeyDown={teclaPulgar}
                    />
                  </div>
                </div>
                {alUltracode || alFast ? (
                  <div className="esf-pie">
                    {alUltracode ? (
                      <button type="button" className="esf-tog" data-tipo="ultracode" aria-pressed={ultracode} aria-busy={ocupado || undefined} title={t("esfuerzo.ultracodeTip")} onClick={() => void cambiar("ultracode")}>
                        {ultracode ? <Check size={12} strokeWidth={2.4} aria-hidden="true" /> : <Workflow size={12} strokeWidth={2} aria-hidden="true" />}
                        {t("esfuerzo.ultracode")}
                      </button>
                    ) : null}
                    <span className="esp" />
                    {alFast ? (
                      <button type="button" className="esf-tog esf-tog-ico" data-tipo="fast" aria-pressed={fast} aria-busy={ocupado || undefined} aria-label={t("esfuerzo.fast")} title={t("esfuerzo.fastTip")} onClick={() => void cambiar("fast")}>
                        <Zap size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {aviso ? (
                  <p className="esf-aviso" role="status">
                    {aviso}
                  </p>
                ) : null}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
