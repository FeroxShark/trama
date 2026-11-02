// La píldora de la cabecera de un líder que está respondiendo: "Trabajando · 6 m" (rediseño 0.4). Lleva el punto, la palabra y
// cuánto lleva, nunca sólo el color. Lo de si trabaja sale igual que en el chat (lo que dice el stream, o la lista si todavía no
// dijo nada); el tiempo, del indicador del turno (src/hilo/vivo.ts). Un líder de terminal no lo tiene y dice sólo la palabra. Con la tarjeta
// del chat a la vista no se pinta: repetiría su estado.
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Reloj } from "../barra/piezas";
import type { Lider } from "../datos/contrato";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { pintorDura } from "../tiempo";
import { enCurso, suscribir } from "./vivo";

export function PildoraTrabajando({ l }: { l: Lider }) {
  useIdioma();
  const sub = useCallback((fn: () => void) => suscribir(l.id, fn), [l.id]);
  const vivoOcupado = useSyncExternalStore(sub, () => enCurso(l.id).ocupado);
  const desde = useSyncExternalStore(sub, () => enCurso(l.id).ind.desde);
  const dura = useMemo(() => (desde !== null ? pintorDura(desde, " · ") : null), [desde]);
  const hace = useSyncExternalStore(sub, () => enCurso(l.id).ind.hace);
  const ocupado = l.origen === "app" ? (vivoOcupado ?? l.ocupado) : l.ocupado;
  if (!ocupado || l.caido) return null;
  // La tarjeta del chat ya dice todo esto: un solo estado a la vista. La píldora queda para lo que no tiene tarjeta (un líder de terminal, compactar).
  if (l.origen === "app" && hace && hace.que !== "compactando") return null;
  return (
    <span className="estado c-trab" role="status" data-pildora-trabajando>
      <i />
      <span className="estado-t">
        {t("estado.trabajando")}
        {dura ? <Reloj pintor={dura} /> : null}
      </span>
    </span>
  );
}
