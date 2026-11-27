// Inspector de nodo (Líder, Subagente o Worker) + dock derecho compartido con Contexto (pestañas Inspector | Contexto).
// Al tocar cualquier tarjeta del canvas B3 muestra actividad en vivo, archivos tocados, caché y acciones directas.
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Cpu,
  Crown,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  XCircle,
} from "lucide-react";
import type { Lider } from "../../datos/contrato";
import type { Como } from "../../barra/arbol";
import { CacheSinTtl, Reloj } from "../../barra/piezas";
import { cacheAplica, cacheSinTtlDe } from "../../../electron/cache";
import { t as tr } from "../../i18n";
import { useIdioma } from "../../i18n/react";
import { pintorCache } from "../../tiempo";
import { clasificar } from "../actividad-logica";
import { usePasos } from "../usePasos";
import { indicador, suscribir } from "../vivo";
import { frasePaso } from "../worker-datos";
import type { EstadoNodo, NodoFlujo } from "./flujo-logica";
import { useResumenContextoLider } from "./ResumenLiderCab";

function icono(e: EstadoNodo) {
  switch (e) {
    case "lider":
      return <Crown size={12} strokeWidth={2} aria-hidden />;
    case "orq":
      return <Cpu size={12} strokeWidth={2} aria-hidden />;
    case "run":
      return <Play size={12} strokeWidth={2} aria-hidden />;
    case "decision":
      return <AlertTriangle size={12} strokeWidth={2} aria-hidden />;
    case "error":
      return <XCircle size={12} strokeWidth={2} aria-hidden />;
    case "verify":
      return <ShieldCheck size={12} strokeWidth={2} aria-hidden />;
    case "ok":
      return <CheckCircle2 size={12} strokeWidth={2} aria-hidden />;
    case "queue":
      return <Clock size={12} strokeWidth={2} aria-hidden />;
    case "pausa":
      return <Pause size={12} strokeWidth={2} aria-hidden />;
  }
}

function etiquetaEstado(e: EstadoNodo): string {
  return tr(`flujo.estado.${e}` as "flujo.estado.run");
}

export type AccionesInspector = {
  alAbrirHilo: (id: string) => void;
  alAbrirSub: (sid: string, id: string) => void;
  alCerrarWorker: (id: string, como?: Como) => void;
  alRetomarWorker: (id: string) => void;
  alIrAContexto: () => void;
};

type PropsInspector = {
  nodo: NodoFlujo | null;
  lider: Lider | null;
  acciones: AccionesInspector;
};

export function InspectorNodo({ nodo, lider, acciones }: PropsInspector) {
  useIdioma();
  const idPasos = nodo?.tipo === "worker" && nodo.hilo ? nodo.hilo.id : nodo?.tipo === "subagente" && nodo.claveSub ? nodo.claveSub : null;
  const pasos = usePasos(idPasos);
  const sidLider = nodo?.tipo === "lider" && lider ? lider.id : "";
  const indLider = useSyncExternalStore(
    useCallback((fn: () => void) => (sidLider ? suscribir(sidLider, fn) : () => {}), [sidLider]),
    () => (sidLider ? indicador(sidLider) : indicador("")),
  );
  const ctxLider = useResumenContextoLider(nodo?.tipo === "lider" ? lider : null);

  const cacheLider = useMemo(() => {
    if (!lider || lider.ocupado || lider.cache_vence === null || !cacheAplica(lider.modelo)) return null;
    return pintorCache(lider.id, lider.cache_vence, lider.cache_ttl_s, false);
  }, [lider]);
  const cacheSinTtlLider = Boolean(lider && !lider.ocupado && !cacheLider && cacheSinTtlDe(lider.modelo));

  if (!nodo) {
    return (
      <div className="insp">
        <p className="insp-desc">{tr("flujo.inspVacio")}</p>
      </div>
    );
  }

  const h = nodo.hilo ?? null;
  const sub = nodo.subagente ?? null;
  const orq = nodo.tipo === "orquestador" ? (nodo.encargo ?? null) : null;
  const vive = nodo.estado === "run" || nodo.estado === "orq";
  // El encargo no tiene un campo de preguntas: las opciones de la propuesta hacen de preguntas antes de delegar.
  const preguntasOrq = orq?.propuesta?.opciones?.filter((q) => q.trim()) ?? [];
  const ultimosPasos = pasos?.hay ? pasos.pasos.slice(-8).reverse() : [];
  const archivos = pasos?.hay ? pasos.encabezado.archivos : [];
  const pasosLider = indLider.pasos.slice(0, 6);

  return (
    <div className="insp" aria-label={tr("flujo.inspAria")}>
      <div className="insp-cab">
        <span className="flujo-dot" data-estado={nodo.estado} style={{ marginTop: "0.3rem" }} aria-hidden="true" />
        <div className="insp-cab-txt">
          <div className="insp-cab-tit">{nodo.titulo}</div>
          <div className="insp-cab-sub">
            {[tr(`flujo.rol.${nodo.tipo}` as "flujo.rol.worker"), nodo.modelo].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className="flujo-pill" data-estado={nodo.estado}>
          {icono(nodo.estado)}
          {etiquetaEstado(nodo.estado)}
        </span>
      </div>

      <p className="insp-desc">{orq
          ? orq.propuesta?.resumen?.trim() || orq.resumen?.trim() || orq.error?.trim() || orq.objetivo.trim()
          : h?.decision?.trim() || h?.resultado?.trim() || nodo.subtitulo}</p>

      {/* Acciones directas según tipo y estado del nodo */}
      <div className="insp-acciones">
        {h ? (
          <>
            {nodo.estado === "run" || nodo.estado === "queue" ? (
              <button type="button" className="insp-btn" data-tono="critico" onClick={() => acciones.alCerrarWorker(h.id)}>
                <Square size={11} strokeWidth={2} aria-hidden />
                {tr("accion.parar")}
              </button>
            ) : null}
            {nodo.estado === "error" && h.commits > 0 ? (
              <button type="button" className="insp-btn" data-tono="acento" onClick={() => acciones.alRetomarWorker(h.id)}>
                <RotateCcw size={11} strokeWidth={2} aria-hidden />
                {tr("flujo.retomar")}
              </button>
            ) : null}
            {nodo.estado === "ok" && h.rama && !h.leer ? (
              <button type="button" className="insp-btn" data-tono="acento" onClick={() => acciones.alCerrarWorker(h.id, "integrar")}>
                <CheckCircle2 size={11} strokeWidth={2} aria-hidden />
                {tr("accion.integrar")}
              </button>
            ) : null}
            <button type="button" className="insp-btn" onClick={() => acciones.alAbrirHilo(h.id)}>
              <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
              {tr("flujo.abrirHilo")}
            </button>
          </>
        ) : sub && lider ? (
          <button type="button" className="insp-btn" onClick={() => acciones.alAbrirSub(lider.id, sub.id)}>
            <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
            {tr("flujo.abrirSub")}
          </button>
        ) : (
          <button type="button" className="insp-btn" onClick={acciones.alIrAContexto}>
            <Layers size={12} strokeWidth={2} aria-hidden />
            {tr("flujo.verContexto")}
          </button>
        )}
      </div>

      {/* Datos clave del nodo */}
      <div className="insp-card">
        {orq ? (
          <>
            <div className="insp-kv">
              <span>{tr("flujo.kv.proyecto")}</span>
              <span>{orq.proyecto || "—"}</span>
            </div>
            <div className="insp-kv">
              <span>{tr("flujo.kv.modelo")}</span>
              <span>{nodo.modelo || orq.modelo || "—"}</span>
            </div>
            <div className="insp-kv">
              <span>{tr("flujo.kv.preset")}</span>
              <span>{orq.preset_contexto || "—"}</span>
            </div>
            <div className="insp-kv">
              <span>{tr("flujo.kv.workers")}</span>
              <span>{String(orq.workers.length)}</span>
            </div>
          </>
        ) : h ? (
          <>
            <div className="insp-kv">
              <span>{tr("flujo.kv.rama")}</span>
              <span>{h.rama || (h.leer ? tr("flujo.soloLectura") : "—")}</span>
            </div>
            <div className="insp-kv">
              <span>{tr("flujo.kv.commits")}</span>
              <span>{h.commits}</span>
            </div>
            {h.puesto ? (
              <div className="insp-kv">
                <span>{tr("flujo.kv.puesto")}</span>
                <span>{h.puesto}</span>
              </div>
            ) : null}
            {nodo.tiempo ? (
              <div className="insp-kv">
                <span>{tr("flujo.kv.tiempo")}</span>
                <span>{nodo.tiempo}</span>
              </div>
            ) : null}
          </>
        ) : sub ? (
          <>
            <div className="insp-kv">
              <span>{tr("flujo.kv.tipo")}</span>
              <span>{sub.tipo || tr("subv.marca")}</span>
            </div>
            <div className="insp-kv">
              <span>{tr("flujo.kv.modelo")}</span>
              <span>{nodo.modelo || "—"}</span>
            </div>
          </>
        ) : (
          <>
            <div className="insp-kv">
              <span>{tr("flujo.kv.contexto")}</span>
              <span>{ctxLider.textoCorto ? `${ctxLider.textoCorto} (${ctxLider.pct}%)` : "—"}</span>
            </div>
            <div className="insp-kv">
              <span>{tr("flujo.kv.cache")}</span>
              <span>
                {cacheLider ? <Reloj pintor={cacheLider} /> : cacheSinTtlLider && lider ? <CacheSinTtl modelo={lider.modelo} /> : "—"}
              </span>
            </div>
            {lider?.cwd ? (
              <div className="insp-kv">
                <span>{tr("flujo.kv.carpeta")}</span>
                <span title={lider.cwd}>{lider.cwd.replace(/^\/(?:home|Users)\/[^/]+/, "~")}</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Actividad en vivo */}
      {nodo.tipo === "lider" ? (
        <>
          <div className="insp-sec">
            <span>{tr("flujo.actividad")}</span>
            <span>{indLider.pasosN > 0 ? indLider.pasosN : ""}</span>
          </div>
          {indLider.hace || pasosLider.length ? (
            <div className="insp-pasos">
              {indLider.hace ? (() => {
                const act = clasificar(indLider.hace);
                const verbo = (tr as (k: string) => string)(act.verbo);
                const det = act.detalleClave ? (tr as (k: string, v?: Record<string, string>) => string)(act.detalleClave, { d: act.detalle }) : act.detalle;
                return (
                  <div className="insp-paso" data-vivo="true">
                    <span>{det ? `${verbo} · ${det}` : verbo}</span>
                  </div>
                );
              })() : null}
              {pasosLider.map((p, idx) => {
                const act = clasificar(p.hace);
                const verbo = (tr as (k: string) => string)(act.verbo);
                const det = act.detalleClave ? (tr as (k: string, v?: Record<string, string>) => string)(act.detalleClave, { d: act.detalle }) : act.detalle;
                return (
                  <div key={idx} className="insp-paso">
                    <span>{det ? `${verbo} · ${det}` : verbo}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="insp-desc">{tr("flujo.sinPasos")}</p>
          )}
        </>
      ) : orq ? (
        preguntasOrq.length > 0 ? (
          <>
            <div className="insp-sec">
              <span>{tr("flujo.orq.preguntas")}</span>
              <span>{preguntasOrq.length}</span>
            </div>
            <div className="insp-pasos">
              {preguntasOrq.map((q, idx) => (
                <div key={idx} className="insp-paso">
                  <span>{q}</span>
                </div>
              ))}
            </div>
          </>
        ) : null
      ) : (
        <>
          <div className="insp-sec">
            <span>{tr("flujo.actividad")}</span>
            <span>{pasos?.hay ? pasos.encabezado.pasos : ""}</span>
          </div>
          {pasos === undefined ? (
            <p className="insp-desc">{tr("flujo.leyendoPasos")}</p>
          ) : ultimosPasos.length ? (
            <div className="insp-pasos">
              {ultimosPasos.map((p) => (
                <div
                  key={p.id}
                  className="insp-paso"
                  data-vivo={p.estado === "corriendo" && vive ? "true" : undefined}
                  data-error={p.estado === "fallo" ? "true" : undefined}
                >
                  <span>{frasePaso(p, vive)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="insp-desc">{tr("flujo.sinPasos")}</p>
          )}

          {archivos.length > 0 ? (
            <>
              <div className="insp-sec">
                <span>{tr("flujo.archivos")}</span>
                <span>{archivos.length}</span>
              </div>
              <div className="insp-card insp-archivos">
                {archivos.slice(0, 8).map((a) => (
                  <div key={a.ruta} className="insp-arch-fila" title={a.ruta}>
                    <span className="insp-arch-ruta">{a.ruta}</span>
                    {a.mas > 0 || a.menos > 0 ? (
                      <span className="insp-arch-diff">
                        {a.mas > 0 ? <span className="insp-arch-mas">+{a.mas}</span> : null}
                        {a.menos > 0 ? <span className="insp-arch-menos">−{a.menos}</span> : null}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

export type TabDock = "inspector" | "contexto";

export function DockDerechoFlujo({
  mostrarTabs,
  tab,
  alCambiarTab,
  lider,
  inspector,
  contexto,
}: {
  mostrarTabs: boolean;
  tab: TabDock;
  alCambiarTab: (t: TabDock) => void;
  lider: Lider | null;
  inspector: ReactNode;
  contexto: ReactNode;
}) {
  useIdioma();
  const ctx = useResumenContextoLider(lider);
  if (!mostrarTabs) return <>{contexto}</>;

  return (
    <div className="dock-flujo">
      <div className="dock-flujo-tabs" role="tablist" aria-label={tr("flujo.dockTabs")}>
        <button
          type="button"
          role="tab"
          className="dock-flujo-tab"
          aria-selected={tab === "inspector"}
          onClick={() => alCambiarTab("inspector")}
        >
          <Cpu size={13} strokeWidth={1.8} aria-hidden />
          {tr("flujo.tabInspector")}
        </button>
        <button
          type="button"
          role="tab"
          className="dock-flujo-tab"
          aria-selected={tab === "contexto"}
          onClick={() => alCambiarTab("contexto")}
        >
          <Layers size={13} strokeWidth={1.8} aria-hidden />
          {tr("acople.contexto")}
          {ctx.pct > 0 ? (
            <span className="lider-ctx-pill" data-nivel={ctx.nivel} style={{ height: "1.25rem", padding: "0 0.375rem" }}>
              {ctx.pct}%
            </span>
          ) : null}
        </button>
      </div>
      {tab === "inspector" ? inspector : contexto}
    </div>
  );
}
