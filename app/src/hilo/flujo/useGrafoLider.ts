// Hook que arma el grafo B3 vivo del líder abierto: suscribe a su actividad en curso (`vivo`),
// su contexto (`contextoVivo`), sus workers y sus subagentes, sin lógica de layout en los componentes.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Estado, Hilo, Lider } from "../../datos/contrato";
import type { Subagente } from "../../../electron/subagentes";
import { cacheAplica, cacheSinTtlDe } from "../../../electron/cache";
import { tareaDe } from "../../barra/piezas";
import type { EncargoOrquestador } from "../../../electron/orquestador-texto";
import { fuente } from "../../datos/fuente";
import { t as tr } from "../../i18n";
import { useIdioma } from "../../i18n/react";
import { clasificar } from "../actividad-logica";
import { modeloDe, nombreModelo, useModelosVivos } from "../opciones";
import { indicador, suscribir } from "../vivo";
import { armarGrafo, type GrafoFlujo } from "./flujo-logica";
import { useResumenContextoLider } from "./ResumenLiderCab";

function duracionCorta(s: number): string {
  const n = Math.max(0, Math.round(s));
  if (n < 60) return `${n} s`;
  const m = Math.floor(n / 60);
  if (m < 60) return `${m} m`;
  return `${Math.floor(m / 60)} h`;
}

export function useGrafoLider(params: {
  lider: Lider | null;
  liderNuevo: boolean;
  workers: readonly Hilo[];
  estadoWorker: (h: Hilo) => Estado;
  subagentes: readonly Subagente[];
}): GrafoFlujo {
  useIdioma();
  useModelosVivos();
  const { lider, liderNuevo, workers, estadoWorker, subagentes } = params;
  const sid = lider?.id ?? "";
  const ind = useSyncExternalStore(
    useCallback((fn: () => void) => (sid ? suscribir(sid, fn) : () => {}), [sid]),
    () => (sid ? indicador(sid) : indicador("")),
  );
  const ctx = useResumenContextoLider(lider);

  // Encargos del Orquestador de fondo de este líder, en vivo.
  const [orquestadores, setOrquestadores] = useState<EncargoOrquestador[]>([]);
  useEffect(() => {
    if (!sid) {
      setOrquestadores([]);
      return;
    }
    let vivo = true;
    void fuente
      .orquestadores(sid)
      .then((lista) => {
        if (vivo) setOrquestadores(lista.filter((o) => o.lider_sid === sid));
      })
      .catch(() => {});
    const baja = fuente.alCambiarOrquestadores?.((lista) => {
      if (vivo) setOrquestadores(lista.filter((o) => o.lider_sid === sid));
    });
    return () => {
      vivo = false;
      baja?.();
    };
  }, [sid]);

  const actividadLider = useMemo(() => {
    if (!ind.hace) return null;
    const act = clasificar(ind.hace);
    const verbo = (tr as (k: string) => string)(act.verbo);
    const det = act.detalleClave ? (tr as (k: string, v?: Record<string, string>) => string)(act.detalleClave, { d: act.detalle }) : act.detalle;
    return det ? `${verbo} · ${det}` : verbo;
  }, [ind.hace]);

  const cacheLider = useMemo(() => {
    if (!lider || lider.ocupado) return "";
    if (lider.cache_vence !== null && cacheAplica(lider.modelo)) {
      const rem = Math.max(0, Math.floor((lider.cache_vence - Date.now() * 0.001) / 60));
      return rem > 0 ? tr("flujo.cacheMin", { m: rem }) : "";
    }
    if (cacheSinTtlDe(lider.modelo)) return tr("flujo.cacheSinTtl");
    return "";
  }, [lider]);

  return useMemo(() => {
    const contextoLider = ctx.textoCorto ? `${ctx.textoCorto} · ${ctx.pct}%` : "";
    const ahora = Date.now() * 0.001;
    return armarGrafo({
      lider,
      liderNuevo,
      actividadLider,
      contextoLider,
      cacheLider,
      workers,
      estadoWorker,
      subagentes,
      orquestadores,
      tituloWorker: tareaDe,
      tiempoWorker: (h, est) => {
        if (est === "trabajando" || h.arrancando) return duracionCorta(ahora - h.inicio);
        if (h.duracion_s != null && h.duracion_s > 0) return duracionCorta(h.duracion_s);
        return "";
      },
      modeloCorto: (m) => {
        if (!m) return "";
        const id = modeloDe(m) ?? m;
        return nombreModelo(id);
      },
      textos: {
        liderNuevo: tr("lider.nuevo"),
        liderSub: tr("flujo.liderSub"),
        liderEscucha: tr("flujo.estado.lider"),
        liderPensando: tr("flujo.estado.run"),
        liderPide: tr("flujo.estado.decision"),
        liderDormido: tr("lider.dormido"),
        liderCaido: tr("estado.fallo"),
        subMarca: tr("subv.marca"),
        subCorriendo: tr("flujo.subCorriendo"),
        subListo: tr("flujo.estado.ok"),
        subFallo: tr("flujo.estado.error"),
        workerCola: tr("flujo.workerCola"),
        workerDecision: tr("flujo.workerDecision"),
        workerFalta: tr("flujo.workerFalta"),
        workerFallo: tr("flujo.workerFallo"),
        workerFrenado: tr("flujo.estado.pausa"),
        workerTrabaja: tr("flujo.workerTrabaja"),
        workerListo: tr("flujo.workerListo"),
        orqMarca: tr("flujo.orq.marca"),
        orqRevisando: tr("flujo.orq.revisando"),
        orqConsulta: tr("flujo.orq.consulta"),
        orqEjecutando: tr("flujo.orq.ejecutando"),
        orqListo: tr("flujo.orq.listo"),
        orqFallo: tr("flujo.orq.fallo"),
        commits: (n) => (n === 1 ? tr("flujo.commit1") : tr("flujo.commits", { n })),
      },
    });
  }, [lider, liderNuevo, actividadLider, ctx.textoCorto, ctx.pct, cacheLider, workers, estadoWorker, subagentes, orquestadores]);
}
