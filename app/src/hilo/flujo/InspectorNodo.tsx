// Cajón de detalle de un nodo (Líder, Subagente o Worker) que se abre abajo del canvas B3.
// Al tocar una tarjeta muestra actividad en vivo, archivos tocados, caché y acciones directas.
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Cpu,
  Crown,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  X,
  XCircle,
} from "lucide-react";
import type { Lider } from "../../datos/contrato";
import type { Como } from "../../barra/arbol";
import { t as tr } from "../../i18n";
import { useIdioma } from "../../i18n/react";
import { clasificar } from "../actividad-logica";
import { usePasos } from "../usePasos";
import { indicador, suscribir } from "../vivo";
import { frasePaso } from "../worker-datos";
import type { EstadoNodo, NodoFlujo } from "./flujo-logica";

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

export type AccionesCajon = {
  alAbrirHilo: (id: string) => void;
  alAbrirSub: (sid: string, id: string) => void;
  alCerrarWorker: (id: string, como?: Como) => void;
  alRetomarWorker: (id: string) => void;
};

function textoPasoLider(hace: Parameters<typeof clasificar>[0]): string {
  const act = clasificar(hace);
  const verbo = (tr as (k: string) => string)(act.verbo);
  const det = act.detalleClave ? (tr as (k: string, v?: Record<string, string>) => string)(act.detalleClave, { d: act.detalle }) : act.detalle;
  return det ? `${verbo} · ${det}` : verbo;
}

const carpetaCorta = (cwd: string) => cwd.replace(/^\/(?:home|Users)\/[^/]+/, "~");

type LineaPaso = { id: string | number; texto: string; estado: "vivo" | "hecho" | "fallo" };

function PasoCajon({ paso }: { paso: LineaPaso }) {
  return (
    <div className="flujo-cajon-paso" data-estado={paso.estado} title={paso.texto}>
      {paso.estado === "fallo" ? (
        <XCircle size={11} strokeWidth={2} aria-label={tr("flujo.estado.error")} />
      ) : paso.estado === "vivo" ? (
        <Play size={11} strokeWidth={2} aria-hidden />
      ) : (
        <CheckCircle2 size={11} strokeWidth={2} aria-hidden />
      )}
      <span>{paso.texto}</span>
    </div>
  );
}

function FichaCajon({ filas }: { filas: [string, ReactNode][] }) {
  return (
    <>
      {filas.map(([k, v]) => (
        <div key={k} className="flujo-cajon-kv">
          <span>{k}</span>
          <span title={typeof v === "string" ? v : undefined}>{v}</span>
        </div>
      ))}
    </>
  );
}

/** Cajón inferior dentro del canvas: lo esencial del nodo elegido, sin tocar el panel derecho. */
export function CajonNodo({
  nodo,
  lider,
  acciones,
  alCerrar,
}: {
  nodo: NodoFlujo;
  lider: Lider | null;
  acciones?: AccionesCajon;
  alCerrar?: () => void;
}) {
  useIdioma();
  const h = nodo.hilo ?? null;
  const sub = nodo.subagente ?? null;
  const orq = nodo.tipo === "orquestador" ? (nodo.encargo ?? null) : null;
  const esLider = nodo.tipo === "lider";
  const idPasos = nodo.tipo === "worker" && h ? h.id : nodo.tipo === "subagente" && nodo.claveSub ? nodo.claveSub : null;
  const pasos = usePasos(idPasos);
  const sidLider = esLider && lider ? lider.id : "";
  const indLider = useSyncExternalStore(
    useCallback((fn: () => void) => (sidLider ? suscribir(sidLider, fn) : () => {}), [sidLider]),
    () => (sidLider ? indicador(sidLider) : indicador("")),
  );

  const vive = nodo.estado === "run" || nodo.estado === "orq";
  const preguntas = orq?.propuesta?.opciones?.filter((q) => q.trim()) ?? [];
  const resumenOrq = orq
    ? orq.propuesta?.resumen?.trim() || orq.resumen?.trim() || orq.error?.trim() || orq.objetivo.trim()
    : "";
  // Sin preguntas el resumen del encargo ya ocupa la caja izquierda: no se repite arriba.
  const largo = orq ? (preguntas.length ? resumenOrq : "") : h ? h.decision?.trim() || h.resultado?.trim() || "" : sub?.resultado?.trim() || "";
  const pide = nodo.estado === "decision" || nodo.estado === "error";
  const desc = orq && !preguntas.length ? "" : largo && largo !== nodo.subtitulo ? largo : pide ? nodo.subtitulo : "";

  const meta = [tr(`flujo.rol.${nodo.tipo}` as "flujo.rol.worker"), nodo.modelo, h?.puesto || h?.rama, nodo.tiempo].filter(Boolean).join(" · ");

  const lineas: LineaPaso[] = esLider
    ? [
        ...(indLider.hace ? [{ id: "vivo", texto: textoPasoLider(indLider.hace), estado: "vivo" as const }] : []),
        ...indLider.pasos.map((p, i) => ({ id: i, texto: textoPasoLider(p.hace), estado: "hecho" as const })),
      ].slice(0, 4)
    : pasos?.hay
      ? pasos.pasos
          .slice(-4)
          .reverse()
          .map((p) => ({
            id: p.id,
            texto: frasePaso(p, vive),
            estado: p.estado === "fallo" ? ("fallo" as const) : p.estado === "corriendo" && vive ? ("vivo" as const) : ("hecho" as const),
          }))
      : [];
  const archivos = !esLider && !orq && pasos?.hay ? pasos.encabezado.archivos : [];
  const leyendo = Boolean(idPasos) && pasos === undefined;

  const filas: [string, ReactNode][] = h
    ? [
        [tr("flujo.kv.rama"), h.rama || (h.leer ? tr("flujo.soloLectura") : "—")],
        [tr("flujo.kv.commits"), String(h.commits)],
        [tr("flujo.kv.puesto"), h.puesto || "—"],
      ]
    : orq
      ? [
          [tr("flujo.kv.proyecto"), orq.proyecto || "—"],
          [tr("flujo.kv.preset"), orq.preset_contexto || "—"],
          [tr("flujo.kv.workers"), String(orq.workers.length)],
        ]
      : sub
        ? [
            [tr("flujo.kv.tipo"), sub.tipo || tr("subv.marca")],
            [tr("flujo.kv.modelo"), nodo.modelo || "—"],
          ]
        : [
            ...(lider?.cwd ? ([[tr("flujo.kv.carpeta"), carpetaCorta(lider.cwd)]] as [string, ReactNode][]) : []),
            [tr("flujo.kv.modelo"), nodo.modelo || "—"],
          ];

  return (
    <div className="flujo-cajon" role="region" aria-label={tr("flujo.inspAria")}>
      <div className="flujo-cajon-cab">
        <span className="flujo-dot" data-estado={nodo.estado} aria-hidden="true" />
        <span className="flujo-cajon-tit" title={nodo.titulo}>{nodo.titulo}</span>
        <span className="flujo-pill" data-estado={nodo.estado}>
          {icono(nodo.estado)}
          {etiquetaEstado(nodo.estado)}
        </span>
        <span className="flujo-cajon-meta" title={meta}>{meta}</span>
        <div className="flujo-cajon-acciones">
          {h && acciones ? (
            <>
              {nodo.estado === "run" || nodo.estado === "queue" ? (
                <button type="button" className="flujo-cajon-btn" data-tono="critico" onClick={() => acciones.alCerrarWorker(h.id)}>
                  <Square size={11} strokeWidth={2} aria-hidden />
                  {tr("accion.parar")}
                </button>
              ) : null}
              {nodo.estado === "error" && h.commits > 0 ? (
                <button type="button" className="flujo-cajon-btn" data-tono="acento" onClick={() => acciones.alRetomarWorker(h.id)}>
                  <RotateCcw size={11} strokeWidth={2} aria-hidden />
                  {tr("flujo.retomar")}
                </button>
              ) : null}
              {nodo.estado === "ok" && h.rama && !h.leer ? (
                <button type="button" className="flujo-cajon-btn" data-tono="acento" onClick={() => acciones.alCerrarWorker(h.id, "integrar")}>
                  <CheckCircle2 size={11} strokeWidth={2} aria-hidden />
                  {tr("accion.integrar")}
                </button>
              ) : null}
              {acciones.alAbrirHilo ? (
                <button type="button" className="flujo-cajon-btn" data-tono="prim" onClick={() => acciones.alAbrirHilo(h.id)}>
                  <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
                  {tr("flujo.abrirHilo")}
                </button>
              ) : null}
            </>
          ) : sub && lider && acciones?.alAbrirSub ? (
            <button type="button" className="flujo-cajon-btn" onClick={() => acciones.alAbrirSub(lider.id, sub.id)}>
              <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
              {tr("flujo.abrirSub")}
            </button>
          ) : null}
          <button
            type="button"
            className="flujo-cajon-btn flujo-cajon-cerrar"
            aria-label={tr("flujo.cerrarDetalle")}
            title={tr("flujo.cerrarDetalle")}
            onClick={alCerrar}
          >
            <X size={13} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      {desc ? <p className="flujo-cajon-desc" title={desc}>{desc}</p> : null}

      <div className="flujo-cajon-grid">
        <div className="flujo-cajon-caja">
          {orq ? (
            preguntas.length ? (
              <>
                <div className="flujo-cajon-caja-hd">{tr("flujo.orq.preguntas")}</div>
                {preguntas.map((q, i) => (
                  <div key={i} className="flujo-cajon-texto">{q}</div>
                ))}
              </>
            ) : (
              <>
                <div className="flujo-cajon-caja-hd">{tr("flujo.orq.marca")}</div>
                <div className="flujo-cajon-texto">{resumenOrq}</div>
              </>
            )
          ) : (
            <>
              <div className="flujo-cajon-caja-hd">{tr("flujo.pasosRecientes")}</div>
              {lineas.length ? (
                lineas.map((p) => <PasoCajon key={p.id} paso={p} />)
              ) : (
                <div className="flujo-cajon-texto">{tr(leyendo ? "flujo.leyendoPasos" : "flujo.sinPasos")}</div>
              )}
            </>
          )}
        </div>
        <div className="flujo-cajon-caja">
          {archivos.length > 0 ? (
            <>
              <div className="flujo-cajon-caja-hd">
                {tr("flujo.archivos")} ({archivos.length})
              </div>
              {archivos.slice(0, 5).map((a) => (
                <div key={a.ruta} className="flujo-cajon-arch" title={a.ruta}>
                  <span>{a.ruta.split(/[\\/]/).pop()}</span>
                  <span className="insp-arch-diff">
                    {a.mas > 0 ? <span className="insp-arch-mas">+{a.mas}</span> : null}
                    {a.menos > 0 ? <span className="insp-arch-menos">−{a.menos}</span> : null}
                  </span>
                </div>
              ))}
            </>
          ) : (
            <FichaCajon filas={filas} />
          )}
        </div>
      </div>
    </div>
  );
}
