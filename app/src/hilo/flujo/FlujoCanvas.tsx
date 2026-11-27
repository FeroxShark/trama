// Mapa vivo: grafo Líder → Subagentes/Orquestadores → Workers con zoom, pan, arrastre de tarjetas, resalte de cadena,
// historial de ocultos y cajón del nodo elegido. Sin animaciones continuas: nada se repinta si no cambia un dato.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Crown,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Scan,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { t as tr } from "../../i18n";
import { useIdioma } from "../../i18n/react";
import type { Lider } from "../../datos/contrato";
import { CajonNodo, type AccionesCajon } from "./InspectorNodo";
import {
  cadenaRelacionada,
  calcularEncuadre,
  curvaPuertos,
  type AristaFlujo,
  type Camara,
  type EstadoNodo,
  type GrafoFlujo,
  type NodoFlujo,
  type NodoHistorial,
} from "./flujo-logica";
import "./flujo.css";

const COLOR_ESTADO: Record<EstadoNodo, string> = {
  lider: "var(--fam-sonnet)",
  orq: "var(--probar)",
  run: "var(--acento)",
  decision: "var(--aviso)",
  error: "var(--critico)",
  verify: "var(--ok)",
  ok: "var(--ok)",
  queue: "var(--inactivo)",
  pausa: "var(--carpeta)",
};

function iconoEstado(e: EstadoNodo) {
  switch (e) {
    case "lider":
      return <Crown size={11} strokeWidth={2} aria-hidden />;
    case "orq":
      return <Cpu size={11} strokeWidth={2} aria-hidden />;
    case "run":
      return <Play size={11} strokeWidth={2} aria-hidden />;
    case "decision":
      return <AlertTriangle size={11} strokeWidth={2} aria-hidden />;
    case "error":
      return <XCircle size={11} strokeWidth={2} aria-hidden />;
    case "verify":
      return <ShieldCheck size={11} strokeWidth={2} aria-hidden />;
    case "ok":
      return <CheckCircle2 size={11} strokeWidth={2} aria-hidden />;
    case "queue":
      return <Clock size={11} strokeWidth={2} aria-hidden />;
    case "pausa":
      return <Pause size={11} strokeWidth={2} aria-hidden />;
  }
}

function textoEstadoNodo(e: EstadoNodo): string {
  switch (e) {
    case "lider":
      return tr("flujo.estado.lider");
    case "orq":
      return tr("flujo.estado.orq");
    case "run":
      return tr("flujo.estado.run");
    case "decision":
      return tr("flujo.estado.decision");
    case "error":
      return tr("flujo.estado.error");
    case "verify":
      return tr("flujo.estado.verify");
    case "ok":
      return tr("flujo.estado.ok");
    case "queue":
      return tr("flujo.estado.queue");
    case "pausa":
      return tr("flujo.estado.pausa");
  }
}

function textoEtiquetaArista(k: AristaFlujo["etiquetaClave"]): string {
  return tr(`flujo.arista.${k}` as "flujo.arista.encargo");
}

/** Los cables que llevan etiqueta: sólo lo que pide mirar o espera. */
const CON_ETIQUETA: ReadonlySet<EstadoNodo> = new Set(["decision", "error", "orq", "queue"]);

const formatearCuenta = (s: number): string => (s < 60 ? `${s} s` : `${Math.ceil(s / 60)} m`);

function hace(finEn: number): string {
  const s = Math.max(0, Date.now() * 0.001 - finEn);
  if (s < 60) return tr("flujo.recien");
  if (s < 3600) return tr("flujo.haceMin", { m: Math.floor(s / 60) });
  return tr("flujo.haceHora", { h: Math.floor(s / 3600) });
}

/** Junta los eventos de puntero y aplica a lo sumo uno por frame; al soltar aplica el último. */
function arrastrar(alMover: (e: PointerEvent) => void, alAplicar: (e: PointerEvent) => void, alSoltar: (cancelado: boolean) => void) {
  let raf = 0;
  let ultimo: PointerEvent | null = null;
  const aplicar = () => {
    raf = 0;
    if (ultimo) alAplicar(ultimo);
    ultimo = null;
  };
  const mover = (e: PointerEvent) => {
    alMover(e);
    ultimo = e;
    if (!raf) raf = requestAnimationFrame(aplicar);
  };
  const soltar = (e: PointerEvent) => {
    if (raf) cancelAnimationFrame(raf);
    aplicar();
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
    window.removeEventListener("pointercancel", soltar);
    alSoltar(e.type === "pointercancel");
  };
  window.addEventListener("pointermove", mover);
  window.addEventListener("pointerup", soltar);
  window.addEventListener("pointercancel", soltar);
}

export type PropsFlujoCanvas = {
  grafo: GrafoFlujo;
  seleccionado: string | null;
  alSeleccionar: (id: string) => void;
  maximizado: boolean;
  alAlternarMaximizar: () => void;
  tituloSesion: string;
  lider?: Lider | null;
  acciones?: AccionesCajon;
  alCerrarDetalle?: () => void;
};

export function FlujoCanvas({
  grafo,
  seleccionado,
  alSeleccionar,
  maximizado,
  alAlternarMaximizar,
  tituloSesion,
  lider,
  acciones,
  alCerrarDetalle,
}: PropsFlujoCanvas) {
  useIdioma();
  const stageRef = useRef<HTMLDivElement>(null);
  const nodoRefs = useRef(new Map<string, HTMLDivElement>());

  const [cam, setCam] = useState<Camara>({ x: 24, y: 24, z: 0.92 });
  const [arrastrandoFondo, setArrastrandoFondo] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [desplazamientos, setDesplazamientos] = useState<Record<string, { dx: number; dy: number }>>({});
  const [alturas, setAlturas] = useState<ReadonlyMap<string, number>>(new Map());
  const [tamStage, setTamStage] = useState({ w: 720, h: 480 });
  const [histAbierto, setHistAbierto] = useState(false);
  const histBtnRef = useRef<HTMLButtonElement>(null);
  const histPopRef = useRef<HTMLDivElement>(null);
  const idHist = useId();

  // Nodos efectivos aplicando corrimientos manuales del usuario (sin mutar la lógica pura).
  const nodosConPos = useMemo<NodoFlujo[]>(
    () =>
      grafo.nodos.map((n) => {
        const d = desplazamientos[n.id];
        return d ? { ...n, x: n.x + d.dx, y: n.y + d.dy } : n;
      }),
    [grafo.nodos, desplazamientos],
  );
  const mapaNodos = useMemo(() => new Map(nodosConPos.map((n) => [n.id, n])), [nodosConPos]);

  const entradas = useMemo(() => new Set(grafo.aristas.map((a) => a.a)), [grafo.aristas]);
  const salidas = useMemo(() => new Set(grafo.aristas.map((a) => a.de)), [grafo.aristas]);
  const cadena = useMemo(() => cadenaRelacionada(grafo.aristas, hoverId), [grafo.aristas, hoverId]);

  // Medir sólo cuando cambia el contenido de las tarjetas: arrastrar una no fuerza ningún reflow.
  const firmaContenido = grafo.nodos.map((n) => `${n.id}:${n.subtitulo.length}:${n.expiraEnS != null ? 1 : 0}`).join("|");
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const [id, el] of nodoRefs.current) next.set(id, el.offsetHeight);
    setAlturas((prev) => (next.size === prev.size && [...next].every(([id, h]) => prev.get(id) === h) ? prev : next));
  }, [firmaContenido]);

  const encuadrar = useCallback(
    (lista = nodosConPos, alts = alturas) => {
      const el = stageRef.current;
      const w = el?.clientWidth || tamStage.w;
      const h = el?.clientHeight || tamStage.h;
      const extras =
        lista.length === 1
          ? [...lista, { id: "__vacio", x: lista[0].x + lista[0].w + 96, y: lista[0].y + 8, w: 256 }]
          : lista;
      setCam(calcularEncuadre(extras, alts, w, h));
    },
    [nodosConPos, alturas, tamStage.w, tamStage.h],
  );

  // Al cambiar el líder o la cantidad de nodos, reencuadrar automáticamente para que nada quede fuera de vista.
  const firmaGrafo = `${grafo.nodos[0]?.id ?? ""}:${grafo.nodos.length}`;
  const encuadrarRef = useRef(encuadrar);
  encuadrarRef.current = encuadrar;
  useEffect(() => {
    setDesplazamientos({});
    const id = requestAnimationFrame(() => encuadrarRef.current(grafo.nodos));
    return () => cancelAnimationFrame(id);
  }, [firmaGrafo]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const actualizar = () => setTamStage({ w: el.clientWidth || 720, h: el.clientHeight || 480 });
    actualizar();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(actualizar);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hacerZoom = useCallback(
    (delta: number, cx?: number, cy?: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      const px = cx !== undefined && rect ? cx - rect.left : (rect?.width ?? tamStage.w) / 2;
      const py = cy !== undefined && rect ? cy - rect.top : (rect?.height ?? tamStage.h) / 2;
      setCam((prev) => {
        const nz = Math.max(0.35, Math.min(1.65, Math.round((prev.z + delta) * 100) / 100));
        const wx = (px - prev.x) / prev.z;
        const wy = (py - prev.y) / prev.z;
        return { z: nz, x: Math.round(px - wx * nz), y: Math.round(py - wy * nz) };
      });
    },
    [tamStage.w, tamStage.h],
  );

  const alRueda = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    hacerZoom(e.deltaY < 0 ? 0.08 : -0.08, e.clientX, e.clientY);
  };

  const alBajarFondo = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".flujo-nodo,.flujo-hud,.flujo-hist-pop")) return;
    setArrastrandoFondo(true);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const cam0 = { ...cam };
    arrastrar(
      () => {},
      (e2) => setCam((c) => ({ ...c, x: Math.round(cam0.x + (e2.clientX - x0)), y: Math.round(cam0.y + (e2.clientY - y0)) })),
      () => setArrastrandoFondo(false),
    );
  };

  const alBajarNodo = (n: NodoFlujo, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const d0 = desplazamientos[n.id] ?? { dx: 0, dy: 0 };
    const z0 = cam.z;
    let movio = false;
    arrastrar(
      (e2) => {
        if (Math.hypot(e2.clientX - x0, e2.clientY - y0) / z0 > 4) movio = true;
      },
      (e2) => {
        if (!movio) return;
        const dx = Math.round(d0.dx + (e2.clientX - x0) / z0);
        const dy = Math.round(d0.dy + (e2.clientY - y0) / z0);
        setDesplazamientos((prev) => ({ ...prev, [n.id]: { dx, dy } }));
      },
      (cancelado) => {
        if (!movio && !cancelado) alSeleccionar(n.id);
      },
    );
  };

  const alTeclaNodo = (id: string, e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      alSeleccionar(id);
    }
  };

  const ordenar = () => {
    setDesplazamientos({});
    requestAnimationFrame(() => encuadrar(grafo.nodos, alturas));
  };

  const hayOcultos = grafo.ocultos.length > 0;
  const histVisible = histAbierto && hayOcultos;
  useEffect(() => {
    if (!histVisible) return;
    histPopRef.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setHistAbierto(false);
      histBtnRef.current?.focus();
    };
    const afuera = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!histPopRef.current?.contains(t) && !histBtnRef.current?.contains(t)) setHistAbierto(false);
    };
    document.addEventListener("keydown", tecla, true);
    document.addEventListener("pointerdown", afuera, true);
    return () => {
      document.removeEventListener("keydown", tecla, true);
      document.removeEventListener("pointerdown", afuera, true);
    };
  }, [histVisible]);

  const abrirDeHistorial = (o: NodoHistorial): (() => void) | null => {
    const h = o.hilo;
    if (o.tipo === "worker" && h && acciones?.alAbrirHilo) return () => acciones.alAbrirHilo(h.id);
    const u = o.subagente;
    if (o.tipo === "subagente" && u && lider && acciones?.alAbrirSub) return () => acciones.alAbrirSub(lider.id, u.id);
    return null;
  };

  const nodoActivo = seleccionado ? (grafo.nodos.find((n) => n.id === seleccionado) ?? null) : null;

  // Resumen legible de cabecera.
  const resumenPartes: string[] = [];
  if (grafo.resumen.corriendo) resumenPartes.push(tr("flujo.res.corriendo", { n: grafo.resumen.corriendo }));
  if (grafo.resumen.decision) resumenPartes.push(tr("flujo.res.decision", { n: grafo.resumen.decision }));
  if (grafo.resumen.error) resumenPartes.push(tr("flujo.res.error", { n: grafo.resumen.error }));
  if (grafo.resumen.cola) resumenPartes.push(tr("flujo.res.cola", { n: grafo.resumen.cola }));
  if (grafo.resumen.listo) resumenPartes.push(tr("flujo.res.listo", { n: grafo.resumen.listo }));
  const resumenTexto = resumenPartes.length ? resumenPartes.join(" · ") : tr("flujo.res.sinWorkers");

  const soloLider = nodosConPos.length === 1 ? nodosConPos[0] : null;
  const ranuraVacia = soloLider ? { x: soloLider.x + soloLider.w + 96, y: soloLider.y + 4, w: 256, h: 96 } : null;

  return (
    <section className="flujo-panel" aria-label={tr("flujo.aria")}>
      <header className="flujo-cab">
        <Cpu size={14} strokeWidth={1.9} style={{ color: "var(--probar)", flex: "none" }} aria-hidden />
        <span className="flujo-cab-tit">{tr("flujo.cabTitulo", { nombre: tituloSesion })}</span>
        <span className="flujo-cab-resumen">{resumenTexto}</span>
        {hayOcultos ? (
          <button
            ref={histBtnRef}
            type="button"
            className="flujo-hist-btn"
            aria-expanded={histVisible}
            aria-controls={histVisible ? idHist : undefined}
            aria-label={tr("flujo.historialAria")}
            title={tr("flujo.historialAria")}
            onClick={() => setHistAbierto((v) => !v)}
          >
            {tr("flujo.historial", { n: grafo.ocultos.length })}
          </button>
        ) : null}
        <button type="button" className="flujo-cab-btn" title={tr("flujo.encuadrar")} aria-label={tr("flujo.encuadrar")} onClick={() => encuadrar()}>
          <Scan size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="flujo-cab-btn"
          title={tr(maximizado ? "flujo.restaurar" : "flujo.maximizar")}
          aria-label={tr(maximizado ? "flujo.restaurar" : "flujo.maximizar")}
          aria-pressed={maximizado}
          onClick={alAlternarMaximizar}
        >
          {maximizado ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
        </button>
      </header>

      <div
        ref={stageRef}
        className="flujo-stage"
        data-arrastrando={arrastrandoFondo ? "true" : undefined}
        onWheel={alRueda}
        onPointerDown={alBajarFondo}
      >
        {/* Grilla arquitectónica plana en SVG (sin degradados CSS) */}
        <svg className="flujo-grid-bg" aria-hidden="true">
          <defs>
            <pattern id="flujoGridDots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1" fill="currentColor" opacity="0.09" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#flujoGridDots)" />
        </svg>

        <div className="flujo-mundo" style={{ transform: `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.z})` }}>
          <svg className="flujo-svg" viewBox="0 0 1600 1100" aria-hidden="true">
            <defs>
              {(Object.entries(COLOR_ESTADO) as [EstadoNodo, string][]).map(([k, c]) => (
                <g key={k}>
                  <marker id={`flujo-arr-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                    <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill={c} />
                  </marker>
                  <marker id={`flujo-arr-rev-${k}`} viewBox="0 0 10 10" refX="2" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                    <path d="M 9 1.5 L 1.5 5 L 9 8.5 z" fill={c} />
                  </marker>
                </g>
              ))}
            </defs>

            {grafo.aristas.map((a) => {
              const n1 = mapaNodos.get(a.de);
              const n2 = mapaNodos.get(a.a);
              if (!n1 || !n2) return null;
              const curva = curvaPuertos(n1, n2, alturas.get(n1.id) ?? 108, alturas.get(n2.id) ?? 108);
              const dim = Boolean(cadena && !(cadena.has(a.de) && cadena.has(a.a)));
              const etq = textoEtiquetaArista(a.etiquetaClave);
              const lblW = Math.max(46, etq.length * 6.4 + 14);
              return (
                <g key={a.id} className={dim ? "flujo-dim" : undefined}>
                  <path
                    className="flujo-cable"
                    data-tipo={a.tipo}
                    d={curva.d}
                    markerStart={a.inversa ? `url(#flujo-arr-rev-${a.tipo})` : undefined}
                    markerEnd={!a.inversa ? `url(#flujo-arr-${a.tipo})` : undefined}
                  />
                  {CON_ETIQUETA.has(a.tipo) ? (
                    <>
                      <rect className="flujo-etq-bg" data-tipo={a.tipo} x={curva.mx - lblW / 2} y={curva.my - 10} width={lblW} height={20} rx={10} />
                      <text className="flujo-etq-txt" data-tipo={a.tipo} x={curva.mx} y={curva.my + 0.5}>
                        {etq}
                      </text>
                    </>
                  ) : null}
                </g>
              );
            })}

            {/* Cable guía suave cuando todavía no se lanzaron workers */}
            {soloLider && ranuraVacia ? (() => {
              const curva = curvaPuertos(soloLider, ranuraVacia, alturas.get(soloLider.id) ?? 108, ranuraVacia.h);
              return (
                <path
                  className="flujo-cable"
                  data-tipo="queue"
                  d={curva.d}
                  markerEnd="url(#flujo-arr-queue)"
                />
              );
            })() : null}
          </svg>

          {nodosConPos.map((n) => {
            const dim = Boolean(cadena && !cadena.has(n.id));
            const tieneIn = entradas.has(n.id);
            const tieneOut = salidas.has(n.id) || Boolean(soloLider);
            const estTexto = textoEstadoNodo(n.estado);
            return (
              <div
                key={n.id}
                ref={(el) => {
                  if (el) nodoRefs.current.set(n.id, el);
                  else nodoRefs.current.delete(n.id);
                }}
                role="button"
                tabIndex={0}
                className={`flujo-nodo${dim ? " flujo-dim" : ""}`}
                data-estado={n.estado}
                data-sel={seleccionado === n.id ? "true" : undefined}
                data-expira={n.expiraEnS != null ? "true" : undefined}
                aria-label={`${n.titulo}, ${estTexto}`}
                aria-pressed={seleccionado === n.id}
                style={{ left: n.x, top: n.y, width: n.w }}
                onPointerDown={(e) => alBajarNodo(n, e)}
                onKeyDown={(e) => alTeclaNodo(n.id, e)}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                {tieneIn ? <span className="flujo-puerto" data-lado="in" aria-hidden="true" /> : null}
                {tieneOut ? <span className="flujo-puerto" data-lado="out" aria-hidden="true" /> : null}

                <div className="flujo-nodo-cab">
                  <span className="flujo-dot" data-estado={n.estado} aria-hidden="true" />
                  <span className="flujo-nodo-tit">{n.titulo}</span>
                  <span className="flujo-pill" data-estado={n.estado}>
                    {iconoEstado(n.estado)}
                    {estTexto}
                  </span>
                </div>

                <p className="flujo-nodo-sub">{n.subtitulo}</p>

                {n.expiraEnS != null ? (
                  <>
                    <span className="flujo-nodo-expira">{tr("flujo.seOcultaEn", { t: formatearCuenta(n.expiraEnS) })}</span>
                    <div className="flujo-expira-bar" data-estado={n.estado} aria-hidden="true">
                      <i style={{ width: `${n.expiraPct ?? 0}%` }} />
                    </div>
                  </>
                ) : null}

                <div className="flujo-nodo-pie">
                  {n.modelo ? <span>{n.modelo}</span> : null}
                  {n.contexto ? <span>· {n.contexto}</span> : null}
                  {n.tiempo ? <span className="flujo-nodo-pie-fin">{n.tiempo}</span> : null}
                </div>
              </div>
            );
          })}

          {ranuraVacia ? (
            <div
              className="flujo-ranura-vacia"
              style={{ left: ranuraVacia.x, top: ranuraVacia.y, width: ranuraVacia.w, minHeight: ranuraVacia.h }}
            >
              <strong>{tr("flujo.vacioTitulo")}</strong>
              <span>{tr("flujo.vacioSub")}</span>
            </div>
          ) : null}
        </div>

        <div className="flujo-hud" role="toolbar" aria-label={tr("flujo.controles")}>
          <button type="button" className="flujo-hud-btn" onClick={() => hacerZoom(-0.12)} title={tr("flujo.alejar")} aria-label={tr("flujo.alejar")}>
            −
          </button>
          <span className="flujo-zoom-val">{Math.round(cam.z * 100)}%</span>
          <button type="button" className="flujo-hud-btn" onClick={() => hacerZoom(0.12)} title={tr("flujo.acercar")} aria-label={tr("flujo.acercar")}>
            +
          </button>
          <span className="flujo-hud-sep" aria-hidden="true" />
          <button type="button" className="flujo-hud-btn" onClick={() => encuadrar()}>
            {tr("flujo.encuadrar")}
          </button>
          <button type="button" className="flujo-hud-btn" onClick={ordenar}>
            {tr("flujo.ordenar")}
          </button>
        </div>

        {histVisible ? (
          <div
            ref={histPopRef}
            id={idHist}
            className="flujo-hist-pop"
            role="dialog"
            aria-label={tr("flujo.historialTitulo")}
            tabIndex={-1}
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="flujo-hist-cab">
              <strong>{tr("flujo.historialTitulo")}</strong>
              <span>
                {tr("flujo.historialResumen", {
                  fallos: grafo.ocultos.filter((o) => o.estado === "error").length,
                  listos: grafo.ocultos.filter((o) => o.estado === "ok").length,
                })}
              </span>
            </div>
            <div className="flujo-hist-lista">
              {grafo.ocultos.map((o) => {
                const abrir = abrirDeHistorial(o);
                const contenido = (
                  <>
                    <span className="flujo-dot" data-estado={o.estado} aria-hidden="true" />
                    <span className="flujo-hist-ico" data-estado={o.estado} title={textoEstadoNodo(o.estado)}>
                      {iconoEstado(o.estado)}
                      <span className="flujo-solo-lector">{textoEstadoNodo(o.estado)}</span>
                    </span>
                    <span className="flujo-hist-tit" title={o.titulo}>{o.titulo}</span>
                    <span className="flujo-hist-t">{hace(o.finEn)}</span>
                  </>
                );
                return abrir ? (
                  <button
                    key={o.id}
                    type="button"
                    className="flujo-hist-fila"
                    onClick={() => {
                      setHistAbierto(false);
                      abrir();
                    }}
                  >
                    {contenido}
                  </button>
                ) : (
                  <div key={o.id} className="flujo-hist-fila">
                    {contenido}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {nodoActivo ? (
        <CajonNodo key={nodoActivo.id} nodo={nodoActivo} lider={lider ?? null} acciones={acciones} alCerrar={alCerrarDetalle} />
      ) : null}
    </section>
  );
}
