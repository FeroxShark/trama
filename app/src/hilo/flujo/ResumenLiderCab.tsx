// Resumen de contexto y caché (p. ej. "19k · ⚡ 4m" o "19k · ⚡ ?") para la cabecera izquierda del chat del líder.
// Se actualiza por frame vía `contextoVivo` sin repintar durante el streaming.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { Lider } from "../../datos/contrato";
import { cacheAplica, cacheSinTtlDe } from "../../../electron/cache";
import { CacheSinTtl, Reloj } from "../../barra/piezas";
import { tokens as tokensCorto } from "../../paneles/resumen";
import { t } from "../../i18n";
import { useIdioma } from "../../i18n/react";
import { pintorCache } from "../../tiempo";
import { cuenta, umbralDeLider, ventanaDe, ventanaDicha } from "../contexto-logica";
import { contextoDe, escucharContexto, leerUmbral, suscribirContexto, suscribirUmbral, umbralLeido } from "../contextoVivo";

escucharContexto();

export function useResumenContextoLider(lider: Lider | null) {
  const sid = lider?.id ?? "";
  const vivo = useSyncExternalStore(
    useCallback((fn: () => void) => (sid ? suscribirContexto(sid, fn) : () => {}), [sid]),
    () => (sid ? contextoDe(sid) : contextoDe("")),
  );
  const { autoCompact, tope } = useSyncExternalStore(suscribirUmbral, umbralLeido);
  useEffect(leerUmbral, []);

  return useMemo(() => {
    if (!lider) return { usados: 0, pct: 0, nivel: "normal" as const, textoCorto: "" };
    const ventana = ventanaDicha(vivo.ventanas, lider.modelo) ?? ventanaDe(lider.modelo);
    const c = cuenta(vivo.usage, umbralDeLider(lider.modelo, tope, autoCompact, ventana));
    const textoCorto = vivo.usage && c.usados > 0 ? tokensCorto(c.usados) : "";
    return { usados: c.usados, pct: c.pct, nivel: c.nivel, textoCorto };
  }, [lider, vivo.usage, vivo.ventanas, tope, autoCompact]);
}

export function ResumenLiderCab({ lider }: { lider: Lider | null }) {
  useIdioma();
  const ctx = useResumenContextoLider(lider);
  const cache = useMemo(() => {
    if (!lider || lider.ocupado) return null;
    if (lider.cache_vence === null || !cacheAplica(lider.modelo)) return null;
    return pintorCache(lider.id, lider.cache_vence, lider.cache_ttl_s, false);
  }, [lider]);
  const sinTtl = Boolean(lider && !lider.ocupado && !cache && cacheSinTtlDe(lider.modelo));

  if (!lider || (!ctx.textoCorto && !cache && !sinTtl)) return null;

  return (
    <span className="lider-resumen-cab">
      {ctx.textoCorto ? (
        <span
          className="lider-ctx-pill"
          data-nivel={ctx.nivel}
          data-tip={t("contexto.tip", { pct: ctx.pct })}
          aria-label={t("contexto.tip", { pct: ctx.pct })}
        >
          {ctx.textoCorto}
        </span>
      ) : null}
      {cache ? <Reloj pintor={cache} className="cache" /> : sinTtl ? <CacheSinTtl modelo={lider.modelo} /> : null}
    </span>
  );
}
