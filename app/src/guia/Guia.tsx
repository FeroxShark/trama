// Las guías de pantalla: al abrir una pantalla por primera vez (o cuando le llegó una novedad) un aro marca un elemento y un globo dice
// para qué sirve, con pasos numerados. "Entendido" la da por vista, "Más tarde" la deja para la próxima vez (no vuelve en esta sesión) y
// "Desactivar guías" las apaga todas. No tapa la app: el velo no recibe clics, Esc cierra (= Más tarde) y el foco entra al globo y vuelve
// a donde estaba. Qué guía toca lo decide `candidatas` (registro.ts) con lo que se ve en pantalla; esto sólo mira el DOM y dibuja.
// Nunca en capturas ni mediciones, salvo `?captura=guia-<id>` (que muestra esa guía, sin guardar nada).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFoco } from "../foco";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { MODO } from "../modo";
import { categoria, irA } from "../paneles/ajustes-nav";
import { colocar, type Lugar, type Rect } from "./posicion";
import { candidatas, guiaDeCaptura, guiaPorId, panelDeCaptura, pendientes, simularNovedad, type Contexto, type CualPanel, type Guia as GuiaT, type Paso } from "./registro";
import { cambiarGuias, cargarGuias, useGuias } from "./estado";
import "./guia-tour.css";

/** Lo que tarda una guía en aparecer una vez que la pantalla quedó quieta (ms): nada de globos sobre una pantalla que todavía se arma. */
const QUIETA_MS = 600;
/** Tras cerrar una guía, otra espera este rato (ms): no se encadenan tres globos seguidos. */
const ENTRE_GUIAS_MS = 20_000;

const esPanel = (x: unknown): x is CualPanel => x === "ajustes" || x === "ramas" || x === "estadisticas" || x === "tablero";

/** ¿Está de verdad en pantalla? Con tamaño (no escondido ni plegado); si queda fuera de la vista de un panel que scrollea, el globo lo trae. */
function visible(el: Element): boolean {
  if (el.closest(".tour")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function buscar(p: Paso): HTMLElement | null {
  let n = p.indice ?? 0;
  for (const el of document.querySelectorAll<HTMLElement>(p.ancla)) {
    if (!visible(el)) continue;
    if (n-- === 0) return el;
  }
  return null;
}

/** Lo que se ve en pantalla, en lo que importa para elegir guía. */
function contextoActual(): Contexto {
  const p = document.querySelector<HTMLElement>("main[data-panel]")?.dataset.panel;
  const panel = esPanel(p) ? p : null;
  const cat = document.querySelector<HTMLElement>(".aj-cat:not([hidden])")?.dataset.cat;
  return { panel, categoria: panel === "ajustes" ? ((cat as Contexto["categoria"]) ?? categoria()) : null, menuModelo: !!document.querySelector(".menu[data-columnas]") };
}

/** Un modal abierto (bienvenida, atajos, confirmaciones): la guía espera. */
const hayModal = () => !!document.querySelector('[aria-modal="true"]');

/** El usuario está escribiendo: no le sacamos el foco. */
function escribiendo(): boolean {
  const a = document.activeElement;
  return (a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement) && a.value.length > 0;
}

/**
 * Trae el elemento al centro de lo que scrollea (sólo contenedores que scrollean de verdad: `scrollIntoView` también movería los
 * `overflow: hidden` —la ventana entera de la app— y la dejaría corrida).
 */
function traer(el: HTMLElement, suave: boolean) {
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const o = getComputedStyle(a).overflowY;
    if ((o !== "auto" && o !== "scroll") || a.scrollHeight <= a.clientHeight) continue;
    const c = a.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const delta = r.top + r.height / 2 - (c.top + c.height / 2);
    if (Math.abs(delta) > 1) a.scrollTo({ top: a.scrollTop + delta, behavior: suave ? "smooth" : "auto" });
  }
}

type Activa = { guia: GuiaT; pasos: Paso[]; novedad: boolean };

export function Guia() {
  useIdioma();
  const captura = MODO.captura ? guiaDeCaptura(MODO.captura) : null;
  const { estado: guardado, cargado } = useGuias();
  // En una captura, lo guardado no cuenta: todo por ver (o, con `?variante=nuevo`, la versión siguiente con sus novedades).
  const sim = captura && MODO.variante === "nuevo" ? simularNovedad(captura) : null;
  const estado = captura ? (sim?.estado ?? { off: false, vistas: {} }) : guardado;
  const [activa, setActiva] = useState<Activa | null>(null);
  const [aviso, setAviso] = useState(false);
  const pospuestas = useRef(new Set<string>());
  const quieta = useRef<string | null>(null);
  const descanso = useRef(0);
  const yaEstado = useRef(estado);
  yaEstado.current = estado;
  const habilitada = (!MODO.captura && !MODO.guion) || !!captura;

  useEffect(() => {
    if (habilitada && !captura) void cargarGuias();
  }, [habilitada, captura]);

  // Capturas: lo que la guía necesita en pantalla (la categoría de Ajustes, el selector abierto).
  useEffect(() => {
    if (!captura) return;
    const p = panelDeCaptura(captura.id);
    if (p?.categoria) irA(p.categoria);
    // Lo que se abre con un clic: el selector de modelo; el análisis de Ramas (con fixtures contesta con un veredicto de cada una).
    const clics = captura.id === "modelo" ? [".caja .pick .pbtn"] : captura.id === "ramas-analisis" ? [".pn-analista-btn:not([data-aplicar])", ".lz-caja .btn2[data-primario]"] : [];
    const ids = clics.map((c, n) => setTimeout(() => document.querySelector<HTMLButtonElement>(c)?.click(), 700 * (n + 1)));
    return () => ids.forEach(clearTimeout);
  }, [captura]);

  const evaluar = useCallback(() => {
    if (!habilitada || document.hidden) return;
    const ahora = yaEstado.current;
    const ctx = contextoActual();
    const ids = captura ? [captura.id] : candidatas(ctx);
    if (activa) {
      if (!ids.includes(activa.guia.id)) {
        // Se fue a otra pantalla sin contestar: cuenta como "Más tarde" en esta sesión.
        pospuestas.current.add(activa.guia.id);
        setActiva(null);
        quieta.current = null;
      }
      return;
    }
    if (hayModal() || escribiendo() || (!captura && Date.now() < descanso.current)) return;
    for (const id of ids) {
      const base = sim && id === captura?.id ? sim.guia : guiaPorId(id);
      if (!base || pospuestas.current.has(id)) continue;
      if (base.requiere && ![...document.querySelectorAll(base.requiere)].some(visible)) continue;
      const pend = pendientes(base, ahora, (p) => buscar(p) !== null);
      if (!pend) continue;
      if (quieta.current !== id) {
        quieta.current = id;
        return;
      }
      quieta.current = null;
      setActiva({ guia: pend.guia, pasos: pend.pasos, novedad: pend.novedad });
      return;
    }
    quieta.current = null;
  }, [habilitada, captura, sim, activa]);

  // Mira la pantalla cuando cambia (el DOM se mueve seguido: se junta en un tic) y de a ratos, para confirmar que quedó quieta.
  useEffect(() => {
    if (!habilitada || (!cargado && !captura) || estado.off) return;
    let id = 0;
    const pronto = () => {
      clearTimeout(id);
      id = window.setTimeout(evaluar, QUIETA_MS);
    };
    const mo = new MutationObserver(pronto);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "data-panel"] });
    window.addEventListener("hashchange", pronto);
    const tic = window.setInterval(evaluar, QUIETA_MS * 2);
    pronto();
    return () => {
      mo.disconnect();
      window.removeEventListener("hashchange", pronto);
      clearInterval(id);
      clearInterval(tic);
    };
  }, [habilitada, cargado, captura, estado.off, evaluar]);

  // Si las apagan (desde Ajustes, otra ventana) con una abierta, se va.
  useEffect(() => {
    if (estado.off && activa) setActiva(null);
  }, [estado.off, activa]);

  const cerrar = useCallback(() => {
    descanso.current = Date.now() + ENTRE_GUIAS_MS;
    setActiva(null);
  }, []);
  if (!habilitada) return null;
  return (
    <>
      {activa ? (
        <Globo
          key={activa.guia.id}
          a={activa}
          alEntender={() => {
            if (!captura) cambiarGuias({ vista: { id: activa.guia.id, version: activa.guia.version } });
            cerrar();
          }}
          alLuego={() => {
            pospuestas.current.add(activa.guia.id);
            cerrar();
          }}
          alApagar={() => {
            if (!captura) cambiarGuias({ off: true });
            cerrar();
            setAviso(true);
            setTimeout(() => setAviso(false), 7000);
          }}
        />
      ) : null}
      {aviso
        ? createPortal(
            <div className="tour-aviso" role="status">
              {t("tour.apagadas")}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** El rectángulo de un elemento, o `null` si no se ve. */
const rectDe = (el: HTMLElement | null): Rect | null => {
  if (!el || !visible(el)) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
const igual = (a: Rect | null, b: Rect | null) => (a === b) || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

const AIRE = 4;

function Globo({ a, alEntender, alLuego, alApagar }: { a: Activa; alEntender: () => void; alLuego: () => void; alApagar: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [lugar, setLugar] = useState<Lugar | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const ancla = useRef<HTMLElement | null>(null);
  const junto = useRef<HTMLElement | null>(null);
  const [rectJunto, setRectJunto] = useState<Rect | null>(null);
  const total = a.pasos.length;
  const p = a.pasos[i];
  const ultimo = i === total - 1;
  useFoco(raiz, { atrapar: false, enfocar: "raiz", alCerrar: alLuego });

  const ir = useCallback(
    (n: number) => {
      if (n < 0 || n >= total) return;
      setRect(null);
      setRectJunto(null);
      setLugar(null);
      setI(n);
    },
    [total],
  );

  // Al llegar a un paso: busca su ancla y la trae a la vista; si no está (cambió la pantalla), pasa al siguiente.
  useEffect(() => {
    const el = buscar(p);
    ancla.current = el;
    junto.current = p.junto ? (document.querySelector<HTMLElement>(p.junto) ?? null) : null;
    if (!el) {
      if (i + 1 < total) ir(i + 1);
      else alLuego();
      return;
    }
    const quieto = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    traer(el, !quieto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, p]);

  // Sigue al ancla mientras el globo está abierto (scroll, ventana, animaciones de entrada): un cuadro por vez, sólo si cambió.
  useEffect(() => {
    let raf = 0;
    const mira = () => {
      const el = ancla.current;
      const r = el && el.isConnected ? rectDe(el) : null;
      setRect((previo) => (igual(previo, r) ? previo : r));
      const j = junto.current && junto.current.isConnected ? rectDe(junto.current) : null;
      setRectJunto((previo) => (igual(previo, j) ? previo : j));
      raf = requestAnimationFrame(mira);
    };
    raf = requestAnimationFrame(mira);
    return () => cancelAnimationFrame(raf);
  }, [i]);

  // El globo se coloca con su tamaño real.
  useLayoutEffect(() => {
    const g = raiz.current;
    if (!g || !rect) return;
    const base = rectJunto ?? rect;
    const l = colocar({ x: base.x - AIRE, y: base.y - AIRE, w: base.w + 2 * AIRE, h: base.h + 2 * AIRE }, { w: g.offsetWidth, h: g.offsetHeight }, { w: innerWidth, h: innerHeight }, p.lado);
    setLugar((previo) => (previo && previo.x === l.x && previo.y === l.y && previo.lado === l.lado ? previo : l));
  }, [rect, rectJunto, p.lado, i]);

  // El foco queda en el globo al cambiar de paso (el botón que se tocó puede desaparecer).
  useEffect(() => {
    const r = raiz.current;
    if (r && !r.contains(document.activeElement)) r.focus({ preventScroll: true });
  }, [i]);

  const tecla = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight") (e.preventDefault(), ir(i + 1));
    else if (e.key === "ArrowLeft") (e.preventDefault(), ir(i - 1));
  };

  const nuevo = a.novedad;
  const paso = t("tour.paso", { n: i + 1, total });
  const anuncio = nuevo ? `${paso}. ${t("tour.nuevo")}` : paso;
  const titulo = t(p.titulo);
  const cuerpo = t(p.cuerpo);
  return createPortal(
    <div className="tour">
      {rect ? (
        <div className="tour-aro" data-borde={rect.y < 14 || rect.x < 14 ? "" : undefined} style={{ left: rect.x - AIRE, top: rect.y - AIRE, width: rect.w + 2 * AIRE, height: rect.h + 2 * AIRE }} aria-hidden="true">
          <span className="tour-n">{i + 1}</span>
        </div>
      ) : null}
      <div
        ref={raiz}
        className="tour-globo"
        role="dialog"
        aria-label={t("tour.aria", { guia: t(a.guia.nombre) })}
        aria-labelledby="tour-t"
        aria-describedby="tour-b"
        tabIndex={-1}
        data-lado={lugar?.lado}
        // Hasta saber dónde va, fuera de la ventana pero enfocable (con `visibility: hidden` el foco no entra).
        style={lugar ? { left: lugar.x, top: lugar.y } : { left: -9999, top: 0 }}
        onKeyDown={tecla}
      >
        <div className="tour-cab">
          <span>{paso}</span>
          {nuevo ? <span className="tour-nuevo">{t("tour.nuevo")}</span> : null}
        </div>
        <h2 id="tour-t" className="tour-t">
          {titulo}
        </h2>
        <p id="tour-b" className="tour-b">
          {cuerpo}
        </p>
        <div className="tour-nav">
          <button type="button" className="btn2" disabled={i === 0} onClick={() => ir(i - 1)}>
            {t("tour.atras")}
          </button>
          {ultimo ? null : (
            <button type="button" className="btn2" data-primario="" onClick={() => ir(i + 1)}>
              {t("tour.sig")}
            </button>
          )}
        </div>
        <div className="tour-acc">
          <button type="button" className="btn2" data-primario={ultimo ? "" : undefined} onClick={alEntender}>
            {t("tour.entendido")}
          </button>
          <button type="button" className="btn2" data-tip={t("tour.luegoTip")} onClick={alLuego}>
            {t("tour.luego")}
          </button>
          <button type="button" className="tour-link tour-apagar" onClick={alApagar}>
            {t("tour.apagar")}
          </button>
        </div>
        <div className="tour-sr" role="status" aria-live="polite">
          {t("tour.anuncio", { paso: anuncio, titulo, cuerpo })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
