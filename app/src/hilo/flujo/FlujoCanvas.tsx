// Lienzo interactivo B3: grafo en vivo Líder → Subagentes/Orquestadores → Workers con zoom, pan,
// arrastre libre de tarjetas, puertos anclados al píxel, partículas de flujo, resalte de cadena y minimapa.
import {
  useCallback,
  useEffect,
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
  RefreshCw,
  Scan,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { t as tr } from "../../i18n";
import { useIdioma } from "../../i18n/react";
import {
  cadenaRelacionada,
  calcularEncuadre,
  curvaPuertos,
  type AristaFlujo,
  type Camara,
  type EstadoNodo,
  type GrafoFlujo,
  type NodoFlujo,
} from "./flujo-logica";
import "./flujo.css";

const CLAVE_ANIM = "hilos:flujo:anim";

function leerAnim(): boolean {
  try {
    return localStorage.getItem(CLAVE_ANIM) !== "0";
  } catch {
    return true;
  }
}

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

export type PropsFlujoCanvas = {
  grafo: GrafoFlujo;
  seleccionado: string | null;
  alSeleccionar: (id: string) => void;
  maximizado: boolean;
  alAlternarMaximizar: () => void;
  tituloSesion: string;
};

export function FlujoCanvas({
  grafo,
  seleccionado,
  alSeleccionar,
  maximizado,
  alAlternarMaximizar,
  tituloSesion,
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
  const [animOn, setAnimOn] = useState(leerAnim);

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

  const medirAlturas = useCallback(() => {
    const next = new Map<string, number>();
    let cambio = false;
    for (const n of nodosConPos) {
      const el = nodoRefs.current.get(n.id);
      const h = el ? el.offsetHeight : 108;
      next.set(n.id, h);
      if (alturas.get(n.id) !== h) cambio = true;
    }
    if (cambio || next.size !== alturas.size) setAlturas(next);
  }, [nodosConPos, alturas]);

  useLayoutEffect(() => {
    medirAlturas();
  }, [medirAlturas]);

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
  const ultimaFirma = useRef("");
  useEffect(() => {
    if (ultimaFirma.current === firmaGrafo) return;
    ultimaFirma.current = firmaGrafo;
    setDesplazamientos({});
    const id = requestAnimationFrame(() => encuadrar());
    return () => cancelAnimationFrame(id);
  }, [firmaGrafo, encuadrar]);

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
    if ((e.target as HTMLElement).closest(".flujo-nodo,.flujo-hud,.flujo-minimapa,.flujo-leyenda")) return;
    setArrastrandoFondo(true);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const cam0 = { ...cam };
    const mover = (e2: PointerEvent) => {
      setCam((c) => ({ ...c, x: Math.round(cam0.x + (e2.clientX - x0)), y: Math.round(cam0.y + (e2.clientY - y0)) }));
    };
    const soltar = () => {
      setArrastrandoFondo(false);
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  const alBajarNodo = (n: NodoFlujo, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const d0 = desplazamientos[n.id] ?? { dx: 0, dy: 0 };
    const z0 = cam.z;
    let movio = false;
    const mover = (e2: PointerEvent) => {
      const dx = (e2.clientX - x0) / z0;
      const dy = (e2.clientY - y0) / z0;
      if (Math.hypot(dx, dy) > 4) movio = true;
      if (!movio) return;
      setDesplazamientos((prev) => ({ ...prev, [n.id]: { dx: Math.round(d0.dx + dx), dy: Math.round(d0.dy + dy) } }));
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      if (!movio) alSeleccionar(n.id);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  const alTeclaNodo = (id: string, e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      alSeleccionar(id);
    }
  };

  const alternarAnim = () => {
    setAnimOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CLAVE_ANIM, next ? "1" : "0");
      } catch {
        // sin storage
      }
      return next;
    });
  };

  const ordenar = () => {
    setDesplazamientos({});
    requestAnimationFrame(() => encuadrar(grafo.nodos, alturas));
  };

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
    <section className="flujo-panel" data-anim={animOn ? "on" : "off"} aria-label={tr("flujo.aria")}>
      <header className="flujo-cab">
        <Cpu size={14} strokeWidth={1.9} style={{ color: "var(--probar)", flex: "none" }} aria-hidden />
        <span className="flujo-cab-tit">{tr("flujo.cabTitulo", { nombre: tituloSesion })}</span>
        <span className="flujo-cab-resumen">{resumenTexto}</span>
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

        {/* Leyenda semántica: cada estado con color + palabra */}
        <div className="flujo-leyenda" aria-hidden="true">
          <span className="flujo-ley-it"><span className="flujo-dot" data-estado="run" />{tr("flujo.estado.run")}</span>
          <span className="flujo-ley-it"><span className="flujo-dot" data-estado="orq" />{tr("flujo.estado.orq")}</span>
          <span className="flujo-ley-it"><span className="flujo-dot" data-estado="decision" />{tr("flujo.estado.decision")}</span>
          <span className="flujo-ley-it"><span className="flujo-dot" data-estado="error" />{tr("flujo.estado.error")}</span>
          <span className="flujo-ley-it"><span className="flujo-dot" data-estado="ok" />{tr("flujo.estado.ok")}</span>
          <span className="flujo-ley-it"><span className="flujo-dot" data-estado="queue" />{tr("flujo.estado.queue")}</span>
        </div>

        <div className="flujo-mundo" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
          <svg className="flujo-svg" viewBox="0 0 1600 1100" aria-hidden="true">
            <defs>
              {(Object.entries(COLOR_ESTADO) as [EstadoNodo, string][]).map(([k, c]) => (
                <g key={k}>
                  <marker id={`flujo-arr-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
                    <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill={c} />
                  </marker>
                  <marker id={`flujo-arr-rev-${k}`} viewBox="0 0 10 10" refX="2" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
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
              const col = COLOR_ESTADO[a.tipo];
              return (
                <g key={a.id} className={dim ? "flujo-dim" : undefined}>
                  <path className="flujo-cable-base" d={curva.d} />
                  <path
                    className="flujo-cable"
                    data-tipo={a.tipo}
                    d={curva.d}
                    markerStart={a.inversa ? `url(#flujo-arr-rev-${a.tipo})` : undefined}
                    markerEnd={!a.inversa ? `url(#flujo-arr-${a.tipo})` : undefined}
                  />
                  {a.particula && animOn ? (
                    <circle r="3.6" fill={col}>
                      <animateMotion dur={a.inversa ? "1.8s" : "1.5s"} repeatCount="indefinite" path={a.inversa ? curva.dRev : curva.d} />
                    </circle>
                  ) : null}
                  <rect className="flujo-etq-bg" data-tipo={a.tipo} x={curva.mx - lblW / 2} y={curva.my - 10} width={lblW} height={20} rx={10} />
                  <text className="flujo-etq-txt" data-tipo={a.tipo} x={curva.mx} y={curva.my + 0.5}>
                    {etq}
                  </text>
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

                {n.progreso ? (
                  <div className="flujo-prog" aria-hidden="true">
                    <i style={{ width: `${n.progreso}%` }} />
                  </div>
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

        {/* Barra flotante de controles de zoom, encuadre, orden y animaciones */}
        <div className="flujo-hud" role="toolbar" aria-label={tr("flujo.controles")}>
          <button type="button" className="flujo-hud-btn" onClick={() => hacerZoom(-0.12)} title={tr("flujo.alejar")} aria-label={tr("flujo.alejar")}>
            −
          </button>
          <span className="flujo-zoom-val">{Math.round(cam.z * 100)}%</span>
          <button type="button" className="flujo-hud-btn" onClick={() => hacerZoom(0.12)} title={tr("flujo.acercar")} aria-label={tr("flujo.acercar")}>
            +
          </button>
          <span className="flujo-hud-sep" aria-hidden="true" />
          <button type="button" className="flujo-hud-btn" onClick={() => encuadrar()} title={tr("flujo.encuadrar")}>
            <Scan size={12} strokeWidth={1.9} aria-hidden />
            {tr("flujo.encuadrar")}
          </button>
          <button type="button" className="flujo-hud-btn" onClick={ordenar} title={tr("flujo.ordenar")}>
            <RefreshCw size={12} strokeWidth={1.9} aria-hidden />
            {tr("flujo.ordenar")}
          </button>
          <button
            type="button"
            className="flujo-hud-btn"
            aria-pressed={animOn}
            onClick={alternarAnim}
            title={tr("flujo.animaciones")}
          >
            <Sparkles size={12} strokeWidth={1.9} aria-hidden />
          </button>
        </div>

        {/* Minimapa en vivo */}
        <div className="flujo-minimapa" aria-hidden="true">
          <svg viewBox="0 0 1600 1100">
            {nodosConPos.map((n) => (
              <rect
                key={n.id}
                x={n.x}
                y={n.y}
                width={n.w}
                height={alturas.get(n.id) ?? 108}
                rx={18}
                fill={COLOR_ESTADO[n.estado]}
                fillOpacity={seleccionado === n.id ? 0.95 : 0.45}
              />
            ))}
            <rect
              x={-cam.x / cam.z}
              y={-cam.y / cam.z}
              width={tamStage.w / cam.z}
              height={tamStage.h / cam.z}
              rx={14}
              fill="var(--acento)"
              fillOpacity={0.08}
              stroke="var(--acento)"
              strokeWidth={14}
            />
          </svg>
        </div>
      </div>
    </section>
  );
}
